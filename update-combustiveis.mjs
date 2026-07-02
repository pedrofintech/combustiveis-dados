/**
 * Atualização automática dos dados de combustíveis - literaciafinanceira.pt
 * Corre no GitHub Actions (2ª e 6ª feira). Sem dependências (Node 20+).
 *
 * 6ª feira: lê a previsão da semana seguinte (variações em cêntimos) das
 *           fontes públicas e atualiza variacao/semana + linha "previsto".
 * 2ª feira: lê os preços médios de referência confirmados (base DGEG) e
 *           fixa a linha da semana, repondo variacao a 0.
 *
 * Regras de segurança: se as fontes falharem ou os valores forem
 * implausíveis, NÃO altera nada (o site continua com os dados anteriores).
 * Nunca usa a API da DGEG - apenas fontes públicas de imprensa/agregadores.
 */

import { readFileSync, writeFileSync } from 'node:fs';

const FICHEIRO = new URL('./combustiveis.json', import.meta.url);
const UA = { headers: { 'user-agent': 'Mozilla/5.0 (compatible; LiteraciaFinanceiraBot/1.0; +https://www.literaciafinanceira.pt)' } };

/* ── Utilitários ── */
const hojeLisboa = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Lisbon' }));
const iso = (d) => d.toISOString().slice(0, 10);
const ddmm = (isoStr) => { const p = isoStr.split('-'); return `${p[2]}/${p[1]}`; };
const num = (s) => parseFloat(String(s).replace(',', '.'));

function proximaSegunda(d) {
  const r = new Date(d);
  r.setDate(r.getDate() + ((8 - r.getDay()) % 7 || 7));
  return r;
}
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

async function texto(url) {
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

/* ── Fonte A: Poupa Pilim (previsão, base ENSE) ── */
async function previsaoPoupaPilim() {
  const lista = await texto('https://www.poupapilim.com/combustiveis-noticias-e-previsoes/');
  const m = lista.match(/https:\/\/www\.poupapilim\.com\/preco-dos-combustiveis-na-proxima-semana-[a-z0-9-]+\//i);
  if (!m) throw new Error('Poupa Pilim: artigo de previsão não encontrado');
  const html = await texto(m[0]);
  const gasolina = html.match(/Gasolina\s*95[^<]*<\/td>\s*<td[^>]*>[^<]*?([+-]\s*\d+(?:[.,]\d+)?)\s*cêntimo/i)
    || html.match(/Gasolina\s*95[^\n]{0,80}?([+-]\s*\d+(?:[.,]\d+)?)\s*cêntimo/i);
  const gasoleo = html.match(/Gasóleo[^<]*<\/td>\s*<td[^>]*>[^<]*?([+-]\s*\d+(?:[.,]\d+)?)\s*cêntimo/i)
    || html.match(/Gasóleo[^\n]{0,80}?([+-]\s*\d+(?:[.,]\d+)?)\s*cêntimo/i);
  if (!gasolina || !gasoleo) throw new Error('Poupa Pilim: variações não encontradas');
  return {
    fonte: m[0],
    gasolina: num(gasolina[1].replace(/\s/g, '')) / 100,
    gasoleo: num(gasoleo[1].replace(/\s/g, '')) / 100,
  };
}

/* ── Fonte B: precocombustiveis.pt (variações + preços de referência DGEG) ── */
async function dadosPrecoCombustiveis() {
  const html = await texto('https://precocombustiveis.pt/proxima-semana/');
  const out = { fonte: 'https://precocombustiveis.pt/proxima-semana/' };
  const refGasoleo = html.match(/([12][.,]\d{3})\s*€\/L<\/(?:b|strong)>\s*para\s*gasóleo/i)
    || html.match(/gasóleo[^€]{0,120}?([12][.,]\d{3})\s*€\/L/i);
  const refGasolina = html.match(/([12][.,]\d{3})\s*€\/L<\/(?:b|strong)>\s*para\s*gasolina/i)
    || html.match(/gasolina[^€]{0,120}?([12][.,]\d{3})\s*€\/L/i);
  if (refGasoleo) out.refGasoleo = num(refGasoleo[1]);
  if (refGasolina) out.refGasolina = num(refGasolina[1]);
  const varGasoleo = html.match(/Gasóleo simples[\s\S]{0,300}?([+-]?\d+(?:[.,]\d+)?)\s*cêntimos/i);
  const varGasolina = html.match(/Gasolina 95[\s\S]{0,300}?([+-]?\d+(?:[.,]\d+)?)\s*cêntimos/i);
  if (varGasoleo) out.varGasoleo = num(varGasoleo[1]) / 100;
  if (varGasolina) out.varGasolina = num(varGasolina[1]) / 100;
  return out;
}

/* ── Validações ── */
const precoOk = (v) => typeof v === 'number' && v > 1.0 && v < 3.0;
const varOk = (v) => typeof v === 'number' && Math.abs(v) <= 0.15;

function abortar(msg) {
  console.log(`SEM ALTERAÇÕES: ${msg}`);
  process.exit(0);
}

/* ── Principal ── */
const dados = JSON.parse(readFileSync(FICHEIRO, 'utf8'));
const hoje = hojeLisboa();
const dia = hoje.getDay(); /* 1 = segunda, 5 = sexta */
const modo = process.env.MODO || (dia === 1 ? 'confirmar' : 'prever');
console.log(`Modo: ${modo} (${iso(hoje)})`);

if (modo === 'prever') {
  /* 6ª feira: previsão para a semana seguinte */
  let prev;
  try {
    prev = await previsaoPoupaPilim();
  } catch (e) {
    console.log('Poupa Pilim falhou:', e.message);
  }
  let pc = {};
  try { pc = await dadosPrecoCombustiveis(); } catch (e) { console.log('precocombustiveis falhou:', e.message); }

  /* cruzamento: se ambas existirem, têm de concordar dentro de 1 cêntimo */
  if (prev && varOk(pc.varGasoleo) && Math.abs(pc.varGasoleo - prev.gasoleo) > 0.01) {
    abortar(`fontes em conflito no gasóleo (${prev.gasoleo} vs ${pc.varGasoleo})`);
  }
  if (!prev && varOk(pc.varGasoleo) && varOk(pc.varGasolina)) {
    prev = { fonte: pc.fonte, gasoleo: pc.varGasoleo, gasolina: pc.varGasolina };
  }
  if (!prev || !varOk(prev.gasoleo) || !varOk(prev.gasolina)) abortar('sem previsão fiável');

  const inicio = iso(proximaSegunda(hoje));
  const fim = maisDias(inicio, 6);
  dados.atualizado = iso(hoje);
  dados.semanaInicio = inicio;
  dados.semanaFim = fim;
  dados.gasoleo.variacao = Math.round(prev.gasoleo * 1000) / 1000;
  dados.gasolina.variacao = Math.round(prev.gasolina * 1000) / 1000;

  const label = ddmm(inicio);
  const prevRow = {
    semana: label,
    gasolina: Math.round((dados.gasolina.atual + dados.gasolina.variacao) * 1000) / 1000,
    gasoleo: Math.round((dados.gasoleo.atual + dados.gasoleo.variacao) * 1000) / 1000,
    previsto: true,
  };
  const idx = dados.historico.findIndex((h) => h.semana === label);
  if (idx >= 0) dados.historico[idx] = prevRow; else dados.historico.push(prevRow);
  console.log(`Previsão ${label}: gasóleo ${prev.gasoleo * 100}c, gasolina ${prev.gasolina * 100}c (${prev.fonte})`);
} else {
  /* 2ª feira: confirmar preços médios de referência (base DGEG) */
  const pc = await dadosPrecoCombustiveis().catch((e) => abortar('fonte indisponível: ' + e.message));
  if (!precoOk(pc.refGasoleo) || !precoOk(pc.refGasolina)) abortar('preços de referência não encontrados/implausíveis');

  const inicio = iso(segundaDestaSemana(hoje));
  dados.atualizado = iso(hoje);
  dados.semanaInicio = inicio;
  dados.semanaFim = maisDias(inicio, 6);
  dados.gasoleo.atual = pc.refGasoleo;
  dados.gasolina.atual = pc.refGasolina;
  dados.gasoleo.variacao = 0;
  dados.gasolina.variacao = 0;

  const label = ddmm(inicio);
  const row = { semana: label, gasolina: pc.refGasolina, gasoleo: pc.refGasoleo };
  const idx = dados.historico.findIndex((h) => h.semana === label);
  if (idx >= 0) dados.historico[idx] = row; else dados.historico.push(row);
  console.log(`Confirmado ${label}: gasóleo ${pc.refGasoleo}€, gasolina ${pc.refGasolina}€`);
}

/* manter no máximo 12 semanas (a página mostra as últimas 5) */
dados.historico = dados.historico.slice(-12);

writeFileSync(FICHEIRO, JSON.stringify(dados, null, 2) + '\n');
console.log('combustiveis.json atualizado.');
