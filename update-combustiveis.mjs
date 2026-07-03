/**
 * Atualização automática dos dados de combustíveis - literaciafinanceira.pt
 * Corre no GitHub Actions (2ª e 6ª feira). Sem dependências (Node 20+).
 *
 * Desenho (v2, robusto):
 *  - Lê o TEXTO das páginas (tags removidas), não a estrutura HTML -> resistente
 *    a mudanças de marcação.
 *  - Cada fonte para o que serve, SEM cruzamento (o antigo cruzamento causava
 *    falsos conflitos e abortava):
 *      · Poupa Pilim (base ENSE) -> VARIAÇÃO prevista (cêntimos).
 *      · precocombustiveis.pt (base DGEG) -> PREÇO médio de referência (atual).
 *  - A semana vem do próprio artigo de previsão (título), não é adivinhada.
 *  - Se a variação não for extraível, NÃO escreve nada (mantém o último bom).
 *    Se o preço não for extraível, mantém o preço anterior e aplica só a variação.
 *
 * Nunca usa a API da DGEG (só cita estatísticas públicas reportadas).
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FICHEIRO = new URL('./combustiveis.json', import.meta.url);
const UA = { headers: {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
} };
const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];

/* ── Utilitários ── */
const hojeLisboa = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Lisbon' }));
const iso = (d) => d.toISOString().slice(0, 10);
const ddmm = (isoStr) => { const p = isoStr.split('-'); return `${p[2]}/${p[1]}`; };
const round3 = (n) => Math.round(n * 1000) / 1000;

function segundaDestaSemana(d) {
  const r = new Date(d);
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}
function maisDias(isoStr, n) {
  const d = new Date(isoStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

async function html(url) {
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}
function toText(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8364;|&euro;/g, '€')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Poupa Pilim: artigo de previsão + variação ── */
async function previsaoPoupaPilim() {
  const listaRaw = await html('https://www.poupapilim.com/combustiveis-noticias-e-previsoes/');
  console.log('[diag] listagem bytes:', listaRaw.length, '| bloqueio?', /just a moment|cloudflare|cf-browser|challenge|enable javascript/i.test(listaRaw));
  const m = listaRaw.match(/https:\/\/www\.poupapilim\.com\/preco-dos-combustiveis-na-proxima-semana-[a-z0-9-]+\//i);
  if (!m) throw new Error('Poupa Pilim: artigo de previsão não encontrado na listagem');
  const url = m[0];
  const raw = await html(url);
  const texto = toText(raw);
  console.log('[diag] artigo url:', url);
  console.log('[diag] artigo bytes raw:', raw.length, '| texto:', texto.length, '| bloqueio?', /just a moment|cloudflare|cf-browser|challenge|enable javascript/i.test(raw));
  const iG = texto.indexOf('Gasolina');
  console.log('[diag] idx Gasolina:', iG, '| contexto:', JSON.stringify(iG >= 0 ? texto.slice(iG, iG + 60) : texto.slice(0, 120)));
  const iD = texto.search(/Gas[oó]leo/);
  console.log('[diag] idx Gasoleo:', iD, '| contexto:', JSON.stringify(iD >= 0 ? texto.slice(iD, iD + 60) : ''));
  console.log('[diag] tem "cêntimo"?', /c[êe]ntimo/i.test(texto));

  const gasolina = parseVar(texto, 'Gasolina\\s*95');
  const gasoleo = parseVar(texto, 'Gas[oó]leo');
  if (gasolina === null || gasoleo === null) throw new Error('Poupa Pilim: variações não extraídas');

  const semana = parseSemana(texto) || parseSemanaUrl(url);
  if (!semana) throw new Error('Poupa Pilim: semana não extraída');

  return { url, gasolina, gasoleo, semanaInicio: semana.inicio, semanaFim: semana.fim };
}

function parseVar(texto, nomeRe) {
  const re = new RegExp(nomeRe + '([^\\d+\\-]{0,14})([+\\-]?)(\\d+(?:[.,]\\d+)?)\\s*c[êe]ntimo', 'i');
  const m = texto.match(re);
  if (!m) return null;
  let val = parseFloat(m[3].replace(',', '.'));
  let sinal = m[2];
  if (!sinal && /⬇|↓|desc/i.test(m[1])) sinal = '-';
  if (sinal === '-') val = -val;
  return round3(val / 100);
}

/* Semana a partir do título "(6 a 12 julho)" ou "(29 junho a 5 julho)" */
function parseSemana(texto) {
  const re = /\((\d{1,2})\s*(?:de\s+)?([a-zç]+)?\s*a\s*(\d{1,2})\s*(?:de\s+)?([a-zç]+)\)/i;
  const m = texto.match(re);
  if (!m) return null;
  const d1 = parseInt(m[1], 10), d2 = parseInt(m[3], 10);
  const mes2 = MESES.indexOf(m[4].toLowerCase());
  const mes1 = m[2] ? MESES.indexOf(m[2].toLowerCase()) : mes2;
  if (mes1 < 0 || mes2 < 0) return null;
  const ano = hojeLisboa().getFullYear();
  const anoFim = (mes2 < mes1) ? ano + 1 : ano; // dezembro -> janeiro
  const pad = (n) => String(n).padStart(2, '0');
  return {
    inicio: `${ano}-${pad(mes1 + 1)}-${pad(d1)}`,
    fim: `${anoFim}-${pad(mes2 + 1)}-${pad(d2)}`,
  };
}
function parseSemanaUrl(url) {
  const m = url.match(/proxima-semana-(\d{1,2})-a-(\d{1,2})-([a-zç]+)/i);
  if (!m) return null;
  const mes = MESES.indexOf(m[3].toLowerCase());
  if (mes < 0) return null;
  const ano = hojeLisboa().getFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  return { inicio: `${ano}-${pad(mes + 1)}-${pad(+m[1])}`, fim: `${ano}-${pad(mes + 1)}-${pad(+m[2])}` };
}

/* ── precocombustiveis.pt: preço médio de referência (base DGEG) ── */
async function precoReferencia() {
  const texto = toText(await html('https://precocombustiveis.pt/proxima-semana/'));
  return {
    gasoleo: parsePreco(texto, 'gas[oó]leo'),
    gasolina: parsePreco(texto, 'gasolina'),
  };
}
function parsePreco(texto, nomeRe) {
  const re = new RegExp('([12][.,]\\d{3})\\s*€\\/?L?\\s*para\\s*' + nomeRe, 'i');
  const m = texto.match(re);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

/* ── Validações ── */
const precoOk = (v) => typeof v === 'number' && v > 1.0 && v < 3.0;
const varOk = (v) => typeof v === 'number' && Math.abs(v) <= 0.15;
function abortar(msg) { console.log(`SEM ALTERAÇÕES: ${msg}`); process.exit(0); }

/* ── Principal ── */
const dados = JSON.parse(readFileSync(FICHEIRO, 'utf8'));
const hoje = hojeLisboa();
console.log(`Execução: ${iso(hoje)} (${['dom','2ª','3ª','4ª','5ª','6ª','sáb'][hoje.getDay()]})`);

let prev;
try {
  prev = await previsaoPoupaPilim();
} catch (e) {
  abortar('previsão indisponível: ' + e.message);
}
if (!varOk(prev.gasoleo) || !varOk(prev.gasolina)) abortar('variações implausíveis');

/* Preço de referência (opcional; se falhar, mantém o atual) */
let ref = { gasoleo: null, gasolina: null };
try { ref = await precoReferencia(); } catch (e) { console.log('precoReferencia falhou (mantém atual):', e.message); }
if (precoOk(ref.gasoleo)) dados.gasoleo.atual = round3(ref.gasoleo);
if (precoOk(ref.gasolina)) dados.gasolina.atual = round3(ref.gasolina);

/* Aplicar */
dados.atualizado = iso(hoje);
dados.semanaInicio = prev.semanaInicio;
dados.semanaFim = prev.semanaFim;
dados.gasoleo.variacao = prev.gasoleo;
dados.gasolina.variacao = prev.gasolina;

/* Histórico: semana atual (realizado) + semana prevista */
function upsert(label, gasolina, gasoleo, previsto) {
  const row = previsto
    ? { semana: label, gasolina: round3(gasolina), gasoleo: round3(gasoleo), previsto: true }
    : { semana: label, gasolina: round3(gasolina), gasoleo: round3(gasoleo) };
  const i = dados.historico.findIndex((h) => h.semana === label);
  if (i >= 0) dados.historico[i] = row; else dados.historico.push(row);
}
const labelAtual = ddmm(iso(segundaDestaSemana(hoje)));
const labelPrev = ddmm(prev.semanaInicio);
if (labelAtual !== labelPrev) {
  upsert(labelAtual, dados.gasolina.atual, dados.gasoleo.atual, false);
}
upsert(labelPrev, dados.gasolina.atual + dados.gasolina.variacao, dados.gasoleo.atual + dados.gasoleo.variacao, true);

/* manter no máximo 12 semanas */
dados.historico = dados.historico.slice(-12);

writeFileSync(FICHEIRO, JSON.stringify(dados, null, 2) + '\n');
console.log('OK combustiveis.json atualizado:');
console.log(`  semana ${prev.semanaInicio} a ${prev.semanaFim}`);
console.log(`  gasóleo  atual ${dados.gasoleo.atual}  variação ${dados.gasoleo.variacao}`);
console.log(`  gasolina atual ${dados.gasolina.atual}  variação ${dados.gasolina.variacao}`);
console.log(`  fonte previsão: ${prev.url}`);
