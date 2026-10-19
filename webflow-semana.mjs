// webflow-semana.mjs
// Atualiza o item "Combustíveis (semana atual)" no CMS do Webflow a partir do
// combustiveis.json e publica só esse item. Nunca publica o site: o que estiver
// por publicar no Designer continua por publicar.
//
// A página /precos-combustiveis lê este item no HTML que o servidor entrega
// (H1, linha "Atualizado a", frase-resumo, nota de estado e schema), por isso
// os textos aqui são calculados com as mesmas regras do script da página.
//
// Uso:
//   WEBFLOW_TOKEN=... node webflow-semana.mjs     na Action (token do site com cms:read e cms:write)
//   node webflow-semana.mjs --print               só mostra os campos calculados, não toca no Webflow
//   node webflow-semana.mjs --print --json x.json idem, a partir de outro ficheiro

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.WEBFLOW_API || 'https://api.webflow.com/v2';
// Coleção "Combustíveis (semana atual)" e o seu único item, no site literaciafinanceira.pt (Webflow).
const COLLECTION_ID = process.env.WEBFLOW_COLLECTION_ID || '6ad5dfb5d03030a3b8d47026';
const ITEM_ID = process.env.WEBFLOW_ITEM_ID || '6ad5dfd6adfdb13ffdac84f1';
const TOKEN = process.env.WEBFLOW_TOKEN || '';
const PRINT = process.argv.includes('--print');
const JSON_PATH = argumento('--json') || 'combustiveis.json';

const BASE = 'Preço dos Combustíveis na Próxima Semana';
const PAGINA = 'https://www.literaciafinanceira.pt/precos-combustiveis';
const DATA_PUBLICACAO = '2026-07-02';
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

function argumento(nome) {
  const i = process.argv.indexOf(nome);
  return i !== -1 ? process.argv[i + 1] : '';
}

/* ---- As mesmas regras do script da página (embed principal e embed "fase da semana") ---- */
function dataPT(iso) {
  const p = iso.split('-');
  return `${parseInt(p[2], 10)} de ${MESES[parseInt(p[1], 10) - 1]} de ${p[0]}`;
}
function semanaPT(inicio, fim) {
  const a = inicio.split('-'), b = fim.split('-');
  if (a[1] === b[1]) return `${+a[2]} a ${+b[2]} de ${MESES[+b[1] - 1]}`;
  return `${+a[2]} de ${MESES[+a[1] - 1]} a ${+b[2]} de ${MESES[+b[1] - 1]}`;
}
function decimas(v) { return Math.round(Math.abs(v) * 1000); }
function fmtCent(v) {
  const d = decimas(v);
  const s = (d % 10 === 0 ? String(d / 10) : (d / 10).toFixed(1)).replace('.', ',');
  return s + (d === 10 ? ' cêntimo' : ' cêntimos');
}
function estado(variacao) {
  if (decimas(variacao) === 0) return 'estavel';
  return variacao < 0 ? 'desce' : 'sobe';
}
function miolo(D) {
  const st1 = estado(D.gasoleo.variacao), st2 = estado(D.gasolina.variacao);
  if (st1 === 'estavel' && st2 === 'estavel') {
    return 'estabilidade nos preços do <strong>gasóleo</strong> e da <strong>gasolina 95</strong>';
  }
  if (st1 === st2) {
    return `uma ${st1 === 'desce' ? 'descida' : 'subida'} de cerca de ${fmtCent(D.gasoleo.variacao)}` +
      ` no <strong>gasóleo</strong> e de ${fmtCent(D.gasolina.variacao)} na <strong>gasolina 95</strong>`;
  }
  const f = (v, nome, fem) => {
    const st = estado(v);
    if (st === 'estavel') return `estabilidade ${fem ? 'na' : 'no'} <strong>${nome}</strong>`;
    return `uma ${st === 'desce' ? 'descida' : 'subida'} de cerca de ${fmtCent(v)} ${fem ? 'na' : 'no'} <strong>${nome}</strong>`;
  };
  return `${f(D.gasoleo.variacao, 'gasóleo', false)} e ${f(D.gasolina.variacao, 'gasolina 95', true)}`;
}

/* Data de hoje em Lisboa, AAAA-MM-DD (o runner está em UTC) */
function hojeLisboa() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function diasEntre(isoA, isoB) {
  return Math.round((Date.parse(`${isoB}T00:00:00Z`) - Date.parse(`${isoA}T00:00:00Z`)) / 86400000);
}

export function camposDoItem(D, hoje = hojeLisboa()) {
  const range = semanaPT(D.semanaInicio, D.semanaFim);
  const fresca = diasEntre(D.atualizado, hoje) < 12;   // igual ao syncTitulo() da página
  const emCurso = hoje >= D.semanaInicio;              // igual ao emCurso() do embed "fase da semana"
  const m = miolo(D);

  const titulo = fresca && !emCurso ? `${BASE} (${range})` : BASE;
  const frase = emCurso
    ? `Esta semana, de <strong>${range}</strong>, os preços em vigor refletem ${m}. A previsão para a próxima semana sai na quinta-feira.`
    : `Nova semana, novos preços: para <strong>${range}</strong>, o nosso modelo aponta para ${m}.`;

  let nota;
  if (!emCurso) nota = 'Confirmação oficial (DGEG) à segunda-feira';
  else if (D.fonte === 'dgeg-confirmado') nota = `Preços em vigor esta semana (${range}), confirmados pela DGEG`;
  else if (D.fonte === 'modelo-proprio') nota = `Preços em vigor esta semana (${range}) - estimativa do nosso modelo até à confirmação oficial da DGEG`;
  else nota = `Preços em vigor esta semana (${range})`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: `${BASE} (${range})`,
    inLanguage: 'pt-PT',
    datePublished: DATA_PUBLICACAO,
    dateModified: D.atualizado,
    author: { '@type': 'Organization', name: 'Literacia Financeira', url: 'https://www.literaciafinanceira.pt' },
    publisher: { '@type': 'Organization', name: 'Literacia Financeira', url: 'https://www.literaciafinanceira.pt' },
    mainEntityOfPage: PAGINA
  };
  // Só o JSON: o <script type="application/ld+json"> está no embed da página (id lfc-comb-schema).
  const schemaJson = JSON.stringify(schema).replace(/<\//g, '<\\/');

  return {
    'titulo-h1': titulo,
    'semana': range,
    'atualizado-a': dataPT(D.atualizado),
    'frase-resumo': `<p>${frase}</p>`,
    'estado': nota,
    'schema-json-ld': schemaJson
  };
}

function validaJson(j) {
  return j && j.gasoleo && j.gasolina &&
    typeof j.gasoleo.atual === 'number' && typeof j.gasoleo.variacao === 'number' &&
    typeof j.gasolina.atual === 'number' && typeof j.gasolina.variacao === 'number' &&
    typeof j.semanaInicio === 'string' && typeof j.semanaFim === 'string' && typeof j.atualizado === 'string';
}

/* ---- API do Webflow ---- */
async function webflow(metodo, caminho, corpo) {
  const res = await fetch(API + caminho, {
    method: metodo,
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json', 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
  return { status: res.status, ok: res.ok, json, texto };
}

const semTags = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
function igual(live, novo) {
  return Object.keys(novo).every((k) =>
    k === 'frase-resumo' ? semTags(live[k]) === semTags(novo[k]) : String(live[k] ?? '') === novo[k]);
}

async function main() {
  const D = JSON.parse(readFileSync(JSON_PATH, 'utf8'));
  if (!validaJson(D)) {
    console.error('webflow-semana: combustiveis.json incompleto (faltam atualizado, semanaInicio/Fim ou variações).');
    process.exit(1);
  }
  const campos = camposDoItem(D);

  if (PRINT) {
    console.log(JSON.stringify(campos, null, 2));
    return;
  }
  if (!TOKEN) {
    console.log('webflow-semana: sem WEBFLOW_TOKEN, não mexo no Webflow.');
    return;
  }

  // 1) O item já está no site? Enquanto o site não for publicado uma vez com a coleção nova,
  //    não há versão live e a Action não tem nada para atualizar.
  const live = await webflow('GET', `/collections/${COLLECTION_ID}/items/${ITEM_ID}/live`);
  if (live.status === 404) {
    console.log('webflow-semana: o item ainda não existe no site publicado. Publica o site uma vez no Webflow e a partir daí a Action atualiza-o sozinha.');
    return;
  }
  if (!live.ok) {
    console.error(`webflow-semana: erro ao ler o item (${live.status}): ${live.texto.slice(0, 300)}`);
    process.exit(1);
  }
  if (igual(live.json.fieldData || {}, campos)) {
    console.log(`webflow-semana: sem alterações (${campos['titulo-h1']}; ${campos['atualizado-a']}).`);
    return;
  }

  // 2) Atualiza o item (versão de trabalho) e 3) publica só esse item.
  const upd = await webflow('PATCH', `/collections/${COLLECTION_ID}/items/${ITEM_ID}`, {
    isArchived: false, isDraft: false, fieldData: campos
  });
  if (!upd.ok) {
    console.error(`webflow-semana: erro ao atualizar o item (${upd.status}): ${upd.texto.slice(0, 300)}`);
    process.exit(1);
  }
  const pub = await webflow('POST', `/collections/${COLLECTION_ID}/items/publish`, { itemIds: [ITEM_ID] });
  if (!pub.ok) {
    console.error(`webflow-semana: erro ao publicar o item (${pub.status}): ${pub.texto.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`webflow-semana: item atualizado e publicado (${campos['titulo-h1']}; ${campos['atualizado-a']}).`);
}

// Corre só quando é chamado diretamente (node webflow-semana.mjs); importado como módulo expõe camposDoItem().
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('webflow-semana:', e.message || e); process.exit(1); });
}
