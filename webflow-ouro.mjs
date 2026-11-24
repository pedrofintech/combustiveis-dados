// webflow-ouro.mjs
// Atualiza o item "Ouro (hoje)" no CMS do Webflow com a cotação do dia e publica só esse item.
// Nunca publica o site: o que estiver por publicar no Designer continua por publicar.
//
// A página /preco-do-ouro mostra este item no HTML que o servidor entrega (cartões do topo,
// frase-resumo, calculadora com a tabela de quilates e as perguntas com preço). Assim o Google,
// o Bing e os assistentes de IA leem o preço do dia mesmo sem correr JavaScript. Os textos seguem
// as regras do script da página (embed "script" do /preco-do-ouro), que continua a pôr os valores
// ao vivo em cada visita.
//
// Uso:
//   WEBFLOW_TOKEN=... node webflow-ouro.mjs    na Action (token do site com cms:read e cms:write)
//   node webflow-ouro.mjs --print              só mostra os campos calculados, não toca no Webflow
//   node webflow-ouro.mjs --print --mock       idem, com valores fixos (sem rede)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.WEBFLOW_API || 'https://api.webflow.com/v2';
// Coleção "Ouro (hoje)" e o seu único item, no site literaciafinanceira.pt (Webflow).
const COLLECTION_ID = process.env.WEBFLOW_OURO_COLLECTION_ID || '6b05a57febe40a6fb5ed11b6';
const ITEM_ID = process.env.WEBFLOW_OURO_ITEM_ID || '6b05a5b8684d333d7f87d775';
const TOKEN = process.env.WEBFLOW_TOKEN || '';
const PRINT = process.argv.includes('--print');
const MOCK = process.argv.includes('--mock');

// Fontes: as mesmas do script da página.
const URL_OURO = 'https://api.gold-api.com/price/XAU';
const URL_CAMBIO = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR';
const URL_FIXINGS = 'https://api.nbp.pl/api/cenyzlota/last/10/?format=json';
const URL_RESERVA = 'https://cdn.jsdelivr.net/gh/pedrofintech/lf-site-assets@main/ouro-dados.json';

const GRAMA = 31.1034768; // gramas numa onça troy
// Igual ao LF_OURO.fecho2025 do script da página: fecho de 31 dez 2025, referência do "Este ano".
// Em janeiro de 2027 é preciso atualizar os dois sítios (aqui e na página) com o fecho de 2026.
const FECHO_ANO = { eurG: 118.35, ano: 2026 };
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const TOQUES = [
  { id: '24', rot: '24 quilates', sub: 'ouro fino', mil: '999', f: 1 },
  { id: '22', rot: '22 quilates', sub: 'libras de ouro', mil: '916', f: 0.916 },
  { id: '19.2', rot: '19,2 quilates', sub: 'ouro português', mil: '800', f: 0.800 },
  { id: '18', rot: '18 quilates', sub: 'padrão internacional', mil: '750', f: 0.750 },
  { id: '14', rot: '14 quilates', sub: '', mil: '585', f: 0.585 },
  { id: '9', rot: '9 quilates', sub: '', mil: '375', f: 0.375 }
];

/* ---- Markup dos três blocos: cópia dos embeds da página (ouro-*.html), com os valores do dia nos @@CAMPOS@@ ---- */
function modelo(nome) {
  return readFileSync(fileURLToPath(new URL(nome, import.meta.url)), 'utf8').trim();
}
const TPL_HERO = modelo('ouro-hero.html');
const TPL_CALC = modelo('ouro-calculadora.html');
const TPL_FAQ = modelo('ouro-faq.html');

/* ---- As mesmas regras do script da página ---- */
function fmtNum(v, dec) {
  const p = v.toFixed(dec).split('.');
  p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return dec > 0 ? `${p[0]},${p[1]}` : p[0];
}
const fmtEuro = (v, dec = 2) => `${fmtNum(v, dec)}€`;
const fmtUsd = (v, dec = 2) => `${fmtNum(v, dec)} USD`;
const fmtPct = (v) => `${v >= 0 ? '+' : '-'}${Math.abs(v * 100).toFixed(1).replace('.', ',')}%`;
const fmtPeso = (v) => `${v % 1 === 0 ? String(v) : v.toFixed(1).replace('.', ',')} g`;
const classeVar = (v) => (v >= 0.0005 ? 'is-up' : v <= -0.0005 ? 'is-down' : 'is-flat');
function dataPT(iso) {
  const p = iso.split('-');
  return `${parseInt(p[2], 10)} de ${MESES[parseInt(p[1], 10) - 1]} de ${p[0]}`;
}
function hojeLisboa() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
const isoDate = (d) => d.toISOString().slice(0, 10);
function preenche(tpl, valores) {
  return tpl.replace(/@@([A-Z0-9_]+)@@/g, (m, k) => {
    if (!(k in valores)) throw new Error(`falta o valor ${k}`);
    return valores[k];
  });
}
function validaSpot(o, c) {
  return o && typeof o.price === 'number' && o.price > 500 && o.price < 50000 &&
    c && c.rates && typeof c.rates.EUR === 'number' && c.rates.EUR > 0.4 && c.rates.EUR < 2;
}
function validaReserva(g) {
  return g && typeof g.xauUsd === 'number' && g.xauUsd > 500 && g.xauUsd < 50000 &&
    typeof g.usdEur === 'number' && g.usdEur > 0.4 && g.usdEur < 2 && typeof g.data === 'string';
}
// Igual ao buildHist() da página: fixing diário do NBP (PLN por grama) convertido a euros.
function historico(fixings, fxRange) {
  if (!Array.isArray(fixings) || !fixings.length || !fxRange || !fxRange.rates) return [];
  let ultimoFx = null;
  const out = [];
  for (const q of fixings) {
    if (!q || typeof q.cena !== 'number' || !q.data) continue;
    const r = fxRange.rates[q.data];
    if (r && typeof r.PLN === 'number') ultimoFx = r.PLN;
    if (!ultimoFx) continue;
    const eur = q.cena / ultimoFx;
    if (eur > 5 && eur < 1000) out.push({ d: q.data, eur });
  }
  return out;
}

function chips(D) {
  const mostraDia = typeof D.varDia === 'number';
  const mostraAno = Number(D.data.slice(0, 4)) === FECHO_ANO.ano && FECHO_ANO.eurG > 0;
  if (!mostraDia && !mostraAno) {
    return `Onça troy: <span data-onca style="color:#202432;font-weight:700">${fmtUsd(D.xauUsd, 0)}</span>`;
  }
  const esconde = ' style="display:none"';
  const dia = mostraDia ? `<span class="lfc-ouro-var ${classeVar(D.varDia)}" data-var-dia>${fmtPct(D.varDia)}</span>` : '<span class="lfc-ouro-var is-flat" data-var-dia>n/d</span>';
  const vAno = mostraAno ? D.eurG / FECHO_ANO.eurG - 1 : 0;
  const ano = `<span class="lfc-ouro-var ${classeVar(vAno)}" data-var-ano>${fmtPct(vAno)}</span>`;
  return '\n' +
    `        <span data-seg-dia${mostraDia ? '' : esconde}>Hoje: ${dia}</span>\n` +
    `        <span class="lfc-ouro-prices-sep" data-sep-dia${mostraDia && mostraAno ? '' : esconde}>·</span>\n` +
    `        <span data-seg-ano${mostraAno ? '' : esconde}>Este ano: ${ano}</span>`;
}
function frase(D) {
  let dia = '';
  if (typeof D.varDia === 'number' && Math.abs(D.varDia) >= 0.0005) {
    dia = ` Face a ontem, o preço ${D.varDia > 0 ? 'sobe' : 'desce'} cerca de ${fmtPct(D.varDia).replace('+', '').replace('-', '')}.`;
  }
  return `A <strong>${dataPT(D.data)}</strong>, um grama de <strong>ouro fino</strong> vale cerca de <strong>${fmtEuro(D.eurG)}</strong> (${fmtUsd(D.xauUsd)} por onça troy, convertido ao câmbio do BCE). No <strong>ouro português de 19,2 quilates</strong>, o metal vale cerca de <strong>${fmtEuro(D.eurG * 0.800)}</strong> por grama.${dia}`;
}
function linhasQuilates(D) {
  return TOQUES.map((t) => '<div class="lfc-ouro-tq-row">' +
    `<div class="lfc-ouro-tq-cell">${t.rot}${t.sub ? ` <span class="lfc-ouro-tq-sub">· ${t.sub}</span>` : ''}</div>` +
    `<div class="lfc-ouro-tq-cell">${t.mil}</div>` +
    `<div class="lfc-ouro-tq-cell is-valor">${fmtEuro(D.eurG * t.f)}</div>` +
    '</div>').join('');
}
function resultado(D) {
  const t = TOQUES[2]; // 19,2 quilates, o botão ativo por defeito; peso por defeito 10 g
  const peso = 10;
  return `O ouro de uma peça de <strong>${fmtPeso(peso)}</strong> com <strong>${t.rot} (${t.sub})</strong> vale hoje cerca de <strong>${fmtEuro(peso * t.f * D.eurG)}</strong> (${fmtEuro(D.eurG * t.f)} por grama). Numa loja de compra de ouro, espera uma proposta abaixo deste valor - é a margem do comprador. Compara sempre 2 ou 3 propostas.`;
}
const embed = (html) => `<div data-rt-embed-type='true'>${html}</div>`;

export function camposDoItem(D) {
  const hero = preenche(TPL_HERO, {
    FINO: fmtEuro(D.eurG), PT: fmtEuro(D.eurG * 0.800), CHIPS: chips(D), HEADLINE: frase(D), DATA: dataPT(D.data)
  });
  const calc = preenche(TPL_CALC, { RESULT: resultado(D), ROWS: linhasQuilates(D) });
  const faq = preenche(TPL_FAQ, {
    FINO: fmtEuro(D.eurG), PT: fmtEuro(D.eurG * 0.800), V18: fmtEuro(D.eurG * 0.750),
    V18X5: fmtEuro(D.eurG * 0.750 * 5), V192X10: fmtEuro(D.eurG * 0.800 * 10)
  });
  const resumo = [D.data, `24k ${fmtEuro(D.eurG)}`, `19,2k ${fmtEuro(D.eurG * 0.800)}`, fmtUsd(D.xauUsd),
    `EUR/USD ${D.usdEur}`, `dia ${typeof D.varDia === 'number' ? fmtPct(D.varDia) : 'n/d'}`, D.fonte].join(' | ');
  return { resumo, 'hero-html': embed(hero), 'calculadora-html': embed(calc), 'faq-html': embed(faq) };
}

/* ---- Dados do dia ---- */
async function getJson(url) {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (tentativa === 2) { console.log(`webflow-ouro: falhou ${url} (${e.message})`); return null; }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}
async function dadosDoDia() {
  if (MOCK) {
    return { xauUsd: 3628.699951, usdEur: 0.91416, eurG: 3628.699951 * 0.91416 / GRAMA, data: '2026-11-24', varDia: 0.012687, fonte: 'mock' };
  }
  const inicio = isoDate(new Date(Date.now() - 30 * 86400000));
  const [ouro, cambio, fixings, fx] = await Promise.all([
    getJson(URL_OURO), getJson(URL_CAMBIO), getJson(URL_FIXINGS),
    getJson(`https://api.frankfurter.dev/v1/${inicio}..?base=EUR&symbols=PLN`)
  ]);
  let D;
  if (validaSpot(ouro, cambio)) {
    D = { xauUsd: ouro.price, usdEur: cambio.rates.EUR, data: hojeLisboa(), fonte: 'spot' };
  } else {
    const reserva = await getJson(URL_RESERVA);
    if (!validaReserva(reserva)) return null;
    D = { xauUsd: reserva.xauUsd, usdEur: reserva.usdEur, data: reserva.data, fonte: 'reserva' };
  }
  D.eurG = D.xauUsd * D.usdEur / GRAMA;
  const hist = historico(fixings, fx);
  D.varDia = hist.length >= 2 ? hist[hist.length - 1].eur / hist[hist.length - 2].eur - 1 : null;
  return D;
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
  const D = await dadosDoDia();
  if (!D || !(D.eurG > 15 && D.eurG < 1500)) {
    // Sem dados fiáveis não se mexe: a página fica com os valores de ontem e o script dela tem a sua própria reserva.
    console.log('::warning::webflow-ouro: sem cotação fiável (gold-api, frankfurter e reserva falharam). Não mexo no Webflow.');
    return;
  }
  const campos = camposDoItem(D);
  for (const k of ['hero-html', 'calculadora-html', 'faq-html']) {
    if (/@@|undefined|NaN/.test(campos[k])) throw new Error(`markup inválido em ${k}`);
  }
  if (PRINT) {
    console.log(JSON.stringify(campos, null, 2));
    return;
  }
  if (!TOKEN) {
    console.log('webflow-ouro: sem WEBFLOW_TOKEN, não mexo no Webflow.');
    return;
  }

  // 1) O item já está no site? Antes da primeira publicação do site com a coleção não há versão live.
  const live = await webflow('GET', `/collections/${COLLECTION_ID}/items/${ITEM_ID}/live`);
  if (live.status === 404) {
    console.log('webflow-ouro: o item ainda não existe no site publicado. Publica o site uma vez e a partir daí a Action atualiza-o sozinha.');
    return;
  }
  if (!live.ok) {
    console.error(`webflow-ouro: erro ao ler o item (${live.status}): ${live.texto.slice(0, 300)}`);
    process.exit(1);
  }
  if ((live.json.fieldData || {}).resumo === campos.resumo) {
    console.log(`webflow-ouro: sem alterações (${campos.resumo}).`);
    return;
  }

  // 2) Atualiza o item (versão de trabalho) e 3) publica só esse item.
  const upd = await webflow('PATCH', `/collections/${COLLECTION_ID}/items/${ITEM_ID}`, {
    isArchived: false, isDraft: false, fieldData: campos
  });
  if (!upd.ok) {
    console.error(`webflow-ouro: erro ao atualizar o item (${upd.status}): ${upd.texto.slice(0, 300)}`);
    process.exit(1);
  }
  const pub = await webflow('POST', `/collections/${COLLECTION_ID}/items/publish`, { itemIds: [ITEM_ID] });
  if (!pub.ok) {
    console.error(`webflow-ouro: erro ao publicar o item (${pub.status}): ${pub.texto.slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`webflow-ouro: item atualizado e publicado (${campos.resumo}).`);
}

// Corre só quando é chamado diretamente; importado como módulo expõe camposDoItem().
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('webflow-ouro:', e.message || e); process.exit(1); });
}
