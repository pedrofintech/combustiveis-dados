// webflow-postos.mjs
// Atualiza o item "Combustível mais barato (hoje)" no CMS do Webflow com os postos mais baratos de cada
// distrito (postos-top.json e postos-resumo.json, escritos pelo dgeg-postos.mjs) e publica só esse item.
// Nunca publica o site: o que estiver por publicar no Designer continua por publicar.
//
// A página /combustivel-mais-barato mostra este item no HTML que o servidor entrega (frase-resumo e tabela
// "Postos mais baratos em cada distrito"). Assim o Google, o Bing e os assistentes de IA leem os preços e os
// nomes dos postos mesmo sem correr JavaScript. A ferramenta da página continua a ler os JSON ao vivo.
// Estilos: classes do LF kit e do embed da ferramenta (lfk-*, lfcmb-*), que já estão na página.
//
// Uso:
//   WEBFLOW_TOKEN=... node webflow-postos.mjs     na Action (token do site com cms:read e cms:write)
//   node webflow-postos.mjs --print               só mostra os campos calculados, não toca no Webflow

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.WEBFLOW_API || 'https://api.webflow.com/v2';
// Coleção "Combustível mais barato (hoje)" e o seu único item, no site literaciafinanceira.pt (Webflow).
const COLLECTION_ID = process.env.WEBFLOW_POSTOS_COLLECTION_ID || '6b0aa0dfeddb0b21c3c13b95';
const ITEM_ID = process.env.WEBFLOW_POSTOS_ITEM_ID || '6b0aa10332b1ba24862fda42';
const TOKEN = process.env.WEBFLOW_TOKEN || '';
const PRINT = process.argv.includes('--print');
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const COMBS = [['gasoleo', 'Gasóleo'], ['gasolina', 'Gasolina 95']];
// Se a última leitura boa da DGEG tiver mais do que isto, não se mexe no item (fica a última versão, com a data dela).
const MAX_HORAS = 48;

/* ---- Regras de texto iguais às do combustivel-mais-barato.js ---- */
function nome(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  if (s.length > 4 && s === s.toUpperCase() && s !== s.toLowerCase()) {
    s = s.toLowerCase().replace(/(^|[\s\-\/(."'])(\S)/g, (m, a, b) => a + b.toUpperCase())
      .replace(/(\s)(De|Da|Do|Das|Dos|E|Em|A|O)(?=\s)/g, (m, a, b) => a + b.toLowerCase())
      .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, (m) => m.toUpperCase())
      .replace(/\bS\.a\./g, 'S.A.').replace(/\bE\.p\./g, 'E.P.');
  }
  return s;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const preco = (v) => v.toFixed(3).replace('.', ',') + '€';
function dataHoraPT(lisboa) { // "2026-11-28 13:02" -> "28 de novembro de 2026, às 13:02"
  const [d, h] = lisboa.split(' ');
  const p = d.split('-');
  return `${parseInt(p[2], 10)} de ${MESES[parseInt(p[1], 10) - 1]} de ${p[0]}, às ${h}`;
}

/* Lista do distrito -> objetos com os campos do postos-top.json */
function postos(top, comb, distrito) {
  const c = top.campos;
  return (top[comb][distrito] || []).map((r) => Object.fromEntries(c.map((k, i) => [k, r[i]])));
}
function maisBarato(top, comb, distrito) {
  const l = postos(top, comb, distrito).filter((p) => typeof p.preco === 'number');
  l.sort((a, b) => a.preco - b.preco);
  return l[0] || null;
}

export function camposDoItem(top, resumo) {
  const distritos = Object.keys(top.gasoleo).filter((d) => !/a[çc]ores|madeira/i.test(d)).sort((a, b) => a.localeCompare(b, 'pt'));
  const quando = dataHoraPT(top.lidoEmLisboa);

  // Mais barato do continente em cada combustível (o primeiro de todos os distritos)
  const nacional = {};
  for (const [comb] of COMBS) {
    let melhor = null, dist = '';
    for (const d of distritos) { const p = maisBarato(top, comb, d); if (p && (!melhor || p.preco < melhor.preco)) { melhor = p; dist = d; } }
    nacional[comb] = { p: melhor, d: dist };
  }
  // "Intermarché Vila Flor (Vila Flor)" -> "Intermarché Vila Flor": o concelho só vai entre parênteses se não estiver no nome
  const semAcento = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const local = (p) => semAcento(p.nome).includes(semAcento(p.municipio)) ? esc(nome(p.nome)) : `${esc(nome(p.nome))} (${esc(p.municipio)})`;
  const g = nacional.gasoleo.p, a = nacional.gasolina.p;
  const mg = resumo.gasoleo && resumo.gasoleo.media, ma = resumo.gasolina && resumo.gasolina.media;
  const media = (m) => (typeof m === 'number' ? `, contra um preço médio afixado de ${preco(m)}` : '');
  const resumoTxt = `Na leitura de ${quando}, o gasóleo simples mais barato de Portugal continental estava a <strong>${preco(g.preco)}</strong> ` +
    `por litro, no posto ${local(g)}${media(mg)}. Na gasolina 95 simples, ` +
    (a.id === g.id ? 'o mais barato era o mesmo posto, a ' : `o posto mais barato era ${local(a)}, a `) +
    `<strong>${preco(a.preco)}</strong> por litro${media(ma)}.`;

  const linhas = distritos.map((d) => {
    const cel = COMBS.map(([comb]) => {
      const p = maisBarato(top, comb, d);
      if (!p) return '<td class="is-num">-</td>';
      return `<td><span class="lfcmb-posto"><span>${preco(p.preco)}</span><small>${local(p)}</small></span></td>`;
    }).join('');
    return `<tr><td>${esc(d)}</td>${cel}</tr>`;
  }).join('');

  const html =
    // No telemóvel (375px) a tabela tem de caber sem scroll: o kit dá largura mínima às células e não deixa quebrar linha.
    `<style>#lf-cmb-resumo .lfk-table th,#lf-cmb-resumo .lfk-table td{min-width:0;white-space:normal}` +
    `#lf-cmb-resumo .lfcmb-posto{min-width:0}#lf-cmb-resumo .lfcmb-posto small{overflow-wrap:anywhere}</style>` +
    `<div class="lfk" id="lf-cmb-resumo"><div class="lfk-calc"><div class="lfk-calc-results"><div class="lfk-calc-form"><div class="lfk-calc-inner">` +
    `<h2 class="lfk-h-sm">Postos mais baratos em cada distrito</h2>` +
    `<p class="lfk-text" style="margin-top:.75rem">${resumoTxt}</p>` +
    `<div class="lfk-table-wrap" style="margin-top:1.5rem"><table class="lfk-table lfcmb-tabela">` +
    `<thead><tr><th>Distrito</th>${COMBS.map(([, r]) => `<th>${r}</th>`).join('')}</tr></thead><tbody>${linhas}</tbody></table></div>` +
    `<p class="lfk-foot" style="margin-top:1rem">Leitura de ${quando}. Preços comunicados pelos próprios postos ao ` +
    `<a href="https://precoscombustiveis.dgeg.gov.pt/" target="_blank" rel="noopener">portal Preços dos Combustíveis Online da DGEG</a> ` +
    `(Direção-Geral de Energia e Geologia). A ordenação e as médias são cálculo do Literacia Financeira, não informação da DGEG.</p>` +
    `</div></div></div></div></div>`;

  return { 'resumo-html': `<div data-rt-embed-type='true'>${html}</div>`, 'lido-em': top.lidoEmLisboa };
}

function valida(top, resumo) {
  return top && resumo && top.campos && top.gasoleo && top.gasolina && typeof top.lidoEmLisboa === 'string' &&
    top.lidoEm === resumo.lidoEm && Object.keys(top.gasoleo).length >= 18;
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

async function main() {
  const top = JSON.parse(readFileSync('postos-top.json', 'utf8'));
  const resumo = JSON.parse(readFileSync('postos-resumo.json', 'utf8'));
  if (!valida(top, resumo)) {
    console.error('webflow-postos: postos-top.json / postos-resumo.json incompletos ou de leituras diferentes, não mexo no item.');
    process.exit(1);
  }
  const horas = (Date.now() - Date.parse(top.lidoEm)) / 3600000;
  const campos = camposDoItem(top, resumo);
  if (PRINT) { console.log(JSON.stringify(campos, null, 2)); return; }
  if (horas > MAX_HORAS) { console.log(`webflow-postos: leitura com ${Math.round(horas)} horas, fica a versão anterior do item.`); return; }
  if (!TOKEN) { console.log('webflow-postos: sem WEBFLOW_TOKEN, não mexo no Webflow.'); return; }

  const live = await webflow('GET', `/collections/${COLLECTION_ID}/items/${ITEM_ID}/live`);
  if (live.status === 404) { console.log('webflow-postos: o item ainda não está no site publicado. Publica o site uma vez no Webflow.'); return; }
  if (!live.ok) { console.error(`webflow-postos: erro ao ler o item (${live.status}): ${live.texto.slice(0, 300)}`); process.exit(1); }
  if ((live.json.fieldData || {})['lido-em'] === campos['lido-em']) { console.log(`webflow-postos: sem alterações (leitura ${campos['lido-em']}).`); return; }

  const upd = await webflow('PATCH', `/collections/${COLLECTION_ID}/items/${ITEM_ID}`, { isArchived: false, isDraft: false, fieldData: campos });
  if (!upd.ok) { console.error(`webflow-postos: erro ao atualizar o item (${upd.status}): ${upd.texto.slice(0, 300)}`); process.exit(1); }
  const pub = await webflow('POST', `/collections/${COLLECTION_ID}/items/publish`, { itemIds: [ITEM_ID] });
  if (!pub.ok) { console.error(`webflow-postos: erro ao publicar o item (${pub.status}): ${pub.texto.slice(0, 300)}`); process.exit(1); }
  console.log(`webflow-postos: item atualizado e publicado (leitura ${campos['lido-em']}).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('webflow-postos:', e.message || e); process.exit(1); });
}
