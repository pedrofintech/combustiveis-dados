/**
 * Atualização automática dos dados de combustíveis - literaciafinanceira.pt
 * Corre no GitHub Actions (diariamente). Sem dependências (Node 20+).
 *
 * Desenho (v3):
 *  - Lê o TEXTO das páginas (tags removidas), não a estrutura HTML.
 *  - Fonte PRINCIPAL: precocombustiveis.pt (base DGEG) -> dá a variação JÁ COM
 *    o efeito do ISP (o valor que o condutor paga), o preço de referência e a
 *    semana, tudo numa página. É o número "líquido", certo.
 *  - Fonte de RESERVA: Poupa Pilim (base ENSE) -> só se a principal falhar.
 *    Atenção: os números do Poupa Pilim são "brutos", ANTES das medidas de ISP,
 *    por isso podem exagerar a subida em semanas de intervenção do Governo.
 *  - A semana vem sempre da fonte usada.
 *  - Se nenhuma fonte der a variação, NÃO escreve nada (mantém o último bom).
 *    Se só o preço faltar, mantém o preço anterior e aplica só a variação.
 *
 * Nunca usa a API da DGEG (só cita estatísticas públicas reportadas).
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FICHEIRO = new URL('./combustiveis.json', import.meta.url);
const UA = { headers: {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'pt-PT,pt;q=0.9,en;q=0.8',
  'sec-ch-ua': '"Chromium";v="126", "Not-A.Brand";v="24", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'upgrade-insecure-requests': '1',
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

async function html(url, ms = 25000) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try {
    const r = await fetch(url, { ...UA, signal: c.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}
function toText(h) {
  return h
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8364;|&euro;/g, '€')
    .replace(/&#x?[0-9a-f]+;/gi, ' ')
    .replace(/\|/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* Semana a partir de "(6 a 12 julho)" | "semana de 6 a 12 julho" | "entre 6 e 12 julho" */
function parseSemana(texto) {
  const pats = [
    /\((\d{1,2})\s*(?:de\s+)?([a-zç]+)?\s*a\s*(\d{1,2})\s*(?:de\s+)?([a-zç]+)\)/i,
    /semana de\s+(\d{1,2})\s*(?:de\s+)?([a-zç]+)?\s*a\s*(\d{1,2})\s*(?:de\s+)?([a-zç]+)/i,
    /entre\s+(\d{1,2})\s*(?:de\s+)?([a-zç]+)?\s*e\s*(\d{1,2})\s*(?:de\s+)?([a-zç]+)/i,
  ];
  for (const re of pats) {
    const m = texto.match(re);
    if (!m) continue;
    const d1 = parseInt(m[1], 10), d2 = parseInt(m[3], 10);
    const mes2 = MESES.indexOf(m[4].toLowerCase());
    const mes1 = m[2] ? MESES.indexOf(m[2].toLowerCase()) : mes2;
    if (mes1 < 0 || mes2 < 0) continue;
    const ano = hojeLisboa().getFullYear();
    const anoFim = (mes2 < mes1) ? ano + 1 : ano; // dezembro -> janeiro
    const pad = (n) => String(n).padStart(2, '0');
    return { inicio: `${ano}-${pad(mes1 + 1)}-${pad(d1)}`, fim: `${anoFim}-${pad(mes2 + 1)}-${pad(d2)}` };
  }
  return null;
}

/* ── FONTE PRINCIPAL: precocombustiveis.pt (variação COM ISP + preço + semana) ──
   O IP do GitHub Actions está num datacenter e é por vezes bloqueado (403).
   Por isso tenta-se, por ordem: (1) direto, (2) leitor r.jina.ai, (3) proxy
   allorigins. As três devolvem o MESMO conteúdo da página, do qual se extrai a
   variação líquida (a que o condutor paga, já com o efeito do ISP). Só se as
   três falharem é que se cai para o Poupa Pilim (valor bruto, sem ISP). */
async function fontePrecoCombustiveis() {
  const alvo = 'https://precocombustiveis.pt/proxima-semana/';
  const vias = [
    { nome: 'direto', url: alvo },
    { nome: 'r.jina.ai', url: 'https://r.jina.ai/' + alvo },
    { nome: 'allorigins', url: 'https://api.allorigins.win/raw?url=' + encodeURIComponent(alvo) },
  ];
  for (const via of vias) {
    let texto;
    try {
      texto = toText(await html(via.url));
    } catch (e) {
      console.log(`  precocombustiveis via ${via.nome}: ${e.message}`);
      continue;
    }
    const vg = parseVarEuroL(texto, 'gas[oó]leo');
    const va = parseVarEuroL(texto, 'gasolina');
    const semana = parseSemana(texto);
    if (vg === null || va === null || !semana) {
      console.log(`  precocombustiveis via ${via.nome}: lida mas sem dados extraíveis`);
      continue;
    }
    return {
      variacaoGasoleo: vg,
      variacaoGasolina: va,
      precoGasoleo: parsePreco(texto, 'gas[oó]leo'),
      precoGasolina: parsePreco(texto, 'gasolina'),
      semanaInicio: semana.inicio,
      semanaFim: semana.fim,
      fonte: `precocombustiveis.pt via ${via.nome} (com ISP)`,
    };
  }
  return null;
}
/* Valor parentetizado tipo "(+0,03 €/L)" a seguir ao nome do combustível */
function parseVarEuroL(texto, nomeRe) {
  const re = new RegExp(nomeRe + '[^()]{0,90}?\\(([+\\-]?\\d(?:[.,]\\d+)?)\\s*€\\/?\\s*L?\\)', 'i');
  const m = texto.match(re);
  return m ? round3(parseFloat(m[1].replace(',', '.'))) : null;
}
function parsePreco(texto, nomeRe) {
  const re = new RegExp('([12][.,]\\d{3})\\s*€\\/?\\s*L?\\s*para\\s*' + nomeRe, 'i');
  const m = texto.match(re);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
}

/* ── FONTE DE RESERVA: Poupa Pilim (variação bruta, base ENSE) ── */
async function fontePoupaPilim() {
  const lista = await html('https://www.poupapilim.com/combustiveis-noticias-e-previsoes/');
  const m = lista.match(/https:\/\/www\.poupapilim\.com\/preco-dos-combustiveis-na-proxima-semana-[a-z0-9-]+\//i);
  if (!m) throw new Error('artigo de previsão não encontrado');
  const url = m[0];
  const texto = toText(await html(url));
  const vg = parseVarCent(texto, 'Gas[oó]leo');
  const va = parseVarCent(texto, 'Gasolina\\s*95');
  const semana = parseSemana(texto);
  if (vg === null || va === null || !semana) throw new Error('dados não extraídos');
  return { variacaoGasoleo: vg, variacaoGasolina: va, precoGasoleo: null, precoGasolina: null, semanaInicio: semana.inicio, semanaFim: semana.fim, fonte: url + ' (sem ISP)' };
}
/* Valor em cêntimos "+3,5 cêntimos" a seguir ao nome */
function parseVarCent(texto, nomeRe) {
  const re = new RegExp(nomeRe + '([^\\d+\\-]{0,24})([+\\-]?)(\\d+(?:[.,]\\d+)?)\\s*c[êe]ntimo', 'i');
  const m = texto.match(re);
  if (!m) return null;
  let val = parseFloat(m[3].replace(',', '.'));
  let sinal = m[2];
  if (!sinal && /⬇|↓|desc/i.test(m[1])) sinal = '-';
  if (sinal === '-') val = -val;
  return round3(val / 100);
}

/* ── Validações ── */
const precoOk = (v) => typeof v === 'number' && v > 1.0 && v < 3.0;
const varOk = (v) => typeof v === 'number' && Math.abs(v) <= 0.15;
fonction abortar(msg) { console.log(`SEM ALTERAÇÕES: ${msg}`); process.exit(0); }

/* ── Principal ── */
const dados = JSON.parse(readFileSync(FICHEIRO, 'utf8'));
const hoje = hojeLisboa();
console.log(`Execução: ${iso(hoje)}`);

let d = null;
try {
  d = await fontePrecoCombustiveis();
  if (d) console.log('Fonte usada: ' + d.fonte);
} catch (e) {
  console.log('precocombustiveis indisponível:', e.message);
}
if (!d) {
  try {
    d = await fontePoupaPilim();
    console.log('Fonte usada: Poupa Pilim (RESERVA - variação bruta, sem ISP)');
  } catch (e) {
    abortar('nenhuma fonte disponível: ' + e.message);
  }
}
if (!varOk(d.variacaoGasoleo) || !varOk(d.variacaoGasolina)) abortar('variações implausíveis');

if (precoOk(d.precoGasoleo)) dados.gasoleo.atual = round3(d.precoGasoleo);
if (precoOk(d.precoGasolina)) dados.gasolina.atual = round3(d.precoGasolina);

dados.atualizado = iso(hoje);
dados.semanaInicio = d.semanaInicio;
dados.semanaFim = d.semanaFim;
dados.gasoleo.variacao = d.variacaoGasoleo;
dados.gasolina.variacao = d.variacaoGasolina;

/* Histórico: semana atual (realizado) + semana prevista */
function upsert(label, gasolina, gasoleo, previsto) {
  const row = previsto
    ? { semana: label, gasolina: round3(gasolina), gasoleo: round3(gasoleo), previsto: true }
    : { semana: label, gasolina: round3(gasolina), gasoleo: round3(gasoleo) };
  const i = dados.historico.findIndex((h) => h.semana === label);
  if (i >= 0) dados.historico[i] = row; else dados.historico.push(row);
}
const labelAtual = ddmm(iso(segundaDestaSemana(hoje)));
const labelPrev = ddmm(d.semanaInicio);
if (labelAtual !== labelPrev) {
  upsert(labelAtual, dados.gasolina.atual, dados.gasoleo.atual, false);
}
upsert(labelPrev, dados.gasolina.atual + dados.gasolina.variacao, dados.gasoleo.atual + dados.gasoleo.variacao, true);

dados.historico = dados.historico.slice(-12);

writeFileSync(FICHEIRO, JSON.stringify(dados, null, 2) + '\n');
console.log('OK combustiveis.json atualizado:');
console.log(`  semana ${d.semanaInicio} a ${d.semanaFim}`);
console.log(`  gasóleo  atual ${dados.gasoleo.atual}  variação ${dados.gasoleo.variacao}`);
console.log(`  gasolina atual ${dados.gasolina.atual}  variação ${dados.gasolina.variacao}`);
console.log(`  fonte: ${d.fonte}`);
