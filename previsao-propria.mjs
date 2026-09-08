// previsao-propria.mjs v2.1 - o modelo proprio ALIMENTA a pagina (combustiveis.json).
// Corre a seguir ao update-combustiveis.mjs (espelho) e antes do posprocessar-isp.mjs (override manual).
// Se o modelo falhar por qualquer razao, nao toca no combustiveis.json: a pagina fica com os dados do espelho.
//
// Modelo (validado em 4 segundas-feiras de sombra, 17 ago - 7 set 2026, erro medio ~1 ct no gasoleo e ~1,5 na gasolina):
//   variacao de segunda-feira (leitura DGEG) = k x variacao da media semanal das cotacoes em EUR/L
//   gasoleo: gasoil ICE (USD/t) ou ULSD NY (USD/gal), k = 0.60
//   gasolina: RBOB NY (USD/gal), k = 1.04 (proxy americano - semanas de choque nas margens europeias podem desviar)
//   cambio EUR/USD do BCE. O efeito das portarias do ISP entra pelo override.json (revisao de terca-feira).
// Fontes de cotacoes com cadeia de transportes (direto, r.jina.ai, allorigins) porque o stooq bloqueia
// os runners do GitHub e o Yahoo limita pedidos. Basta uma fonte responder.
// Calendario: qui-dom = previsao para a proxima segunda (janela parcial que se completa ate sexta);
//             seg-qua = semana em vigor (estimativa a partir da semana anterior completa, ate a confirmacao DGEG
//             entrar pelo override na revisao de terca).

import { readFile, writeFile, appendFile } from "node:fs/promises";

const K = { gasoleo: 0.60, gasolina: 1.04 };
const LITROS_TONELADA_GASOIL = 1183;
const LITROS_GALAO = 3.78541;
const LIMITE_SANIDADE_CTS = 25;
const PROXY = "https://lf-proxy.SUBSTITUIR.workers.dev/?u=";   // Worker Cloudflare (ver worker-proxy.js) - os runners do GitHub sao bloqueados pelas fontes
const UA = { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "accept": "text/csv,application/json,text/plain,*/*" } };

const hoje = new Date();
const d0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const iso = (d) => d.toISOString().slice(0, 10);
const compacta = (d) => iso(d).replace(/-/g, "");
function segundaDaSemana(d) { const x = d0(d); const dia = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dia); return x; }
function somaDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function arred(n, casas = 1) { return Number(n.toFixed(casas)); }
function meioCentimo(n) { return Math.round(n * 2) / 2; }

// --- transporte: tenta direto, depois dois proxies publicos ---
async function buscar(url) {
  const rotas = PROXY.indexOf("SUBSTITUIR") === -1 ? [PROXY + encodeURIComponent(url), url] : [url];
  let ultimoErro = null;
  for (const rota of rotas) {
    try {
      const r = await fetch(rota, { headers: UA.headers, signal: AbortSignal.timeout(25000) });
      if (!r.ok) throw new Error("http " + r.status);
      const texto = await r.text();
      if (!texto || texto.length < 20) throw new Error("resposta vazia");
      return texto;
    } catch (e) { ultimoErro = e; console.log("    rota falhou (" + rota.slice(0, 32) + "...): " + (e && e.message ? e.message : e)); }
  }
  throw ultimoErro || new Error("sem transporte");
}

// --- parsers tolerantes a embrulhos dos proxies ---
function parseStooq(texto) {
  const out = {};
  for (const linha of texto.split("\n")) {
    const m = linha.match(/(\d{4}-\d{2}-\d{2}),([^,\s]*),([^,\s]*),([^,\s]*),([^,\s]*)/);
    if (m) { const v = Number(m[5]); if (Number.isFinite(v) && v > 0) out[m[1]] = v; }
  }
  return out;
}
function parseYahoo(texto) {
  const i = texto.indexOf("{"), j = texto.lastIndexOf("}");
  if (i < 0 || j < 0) return {};
  const jn = JSON.parse(texto.slice(i, j + 1));
  const res = jn && jn.chart && jn.chart.result && jn.chart.result[0];
  if (!res) return {};
  const ts = res.timestamp || [];
  const fechos = (res.indicators && res.indicators.quote && res.indicators.quote[0] && res.indicators.quote[0].close) || [];
  const out = {};
  for (let k = 0; k < ts.length; k++) { const v = Number(fechos[k]); if (Number.isFinite(v) && v > 0) out[new Date(ts[k] * 1000).toISOString().slice(0, 10)] = v; }
  return out;
}
function parseFrankfurter(texto) {
  const i = texto.indexOf("{"), j = texto.lastIndexOf("}");
  if (i < 0 || j < 0) return {};
  const jn = JSON.parse(texto.slice(i, j + 1));
  const out = {};
  for (const d of Object.keys(jn.rates || {})) { const v = Number(jn.rates[d] && jn.rates[d].USD); if (Number.isFinite(v) && v > 0) out[d] = v; }
  return out;
}
function parseBce(xml) {
  const out = {};
  const re = /time='(\d{4}-\d{2}-\d{2})'[\s\S]*?currency='USD'\s+rate='([\d.]+)'/g;
  let m;
  while ((m = re.exec(xml)) !== null) out[m[1]] = Number(m[2]);
  return out;
}

async function serie(nome, fontes) {
  for (const f of fontes) {
    try {
      const s = f.parse(await buscar(f.url));
      const n = Object.keys(s).length;
      if (n < 5) throw new Error("so " + n + " dias");
      console.log("  " + nome + ": " + f.id + " (" + n + " dias)");
      return { serie: s, litros: f.litros, id: f.id };
    } catch (e) { console.log("  " + nome + " " + f.id + " falhou: " + (e && e.message ? e.message : e)); }
  }
  throw new Error(nome + ": todas as fontes falharam");
}

// Media da serie nos dias uteis [ini..fim]; dias sem valor usam o ultimo conhecido (carry-forward)
function mediaJanela(s, ini, fim) {
  const chaves = Object.keys(s).sort();
  let ultimo = null;
  for (const k of chaves) { if (k < iso(ini)) ultimo = s[k]; else break; }
  const valores = []; let usados = 0;
  for (let d = d0(ini); d.getTime() <= d0(fim).getTime(); d = somaDias(d, 1)) {
    const dia = d.getDay();
    if (dia === 0 || dia === 6) continue;
    const v = s[iso(d)];
    if (Number.isFinite(v)) { ultimo = v; usados++; }
    if (Number.isFinite(ultimo)) valores.push(ultimo);
  }
  if (!valores.length) throw new Error("janela sem valores");
  return { media: valores.reduce((a, b) => a + b, 0) / valores.length, diasComDados: usados };
}

// Nucleo puro (testavel sem rede): recebe as series e devolve a previsao
export function calcular(gasoil, rbob, fx, janIni, janFim, antIni, antFim, hojeRef) {
  const fimEfetivo = hojeRef < janFim ? hojeRef : janFim;
  const eurL = (bruto, fxm, litros) => bruto / litros / fxm;
  const fxAnt = mediaJanela(fx, antIni, antFim).media;
  const fxCur = mediaJanela(fx, janIni, fimEfetivo).media;
  const calc = (obj) => {
    const ant = mediaJanela(obj.serie, antIni, antFim), cur = mediaJanela(obj.serie, janIni, fimEfetivo);
    return { delta: (eurL(cur.media, fxCur, obj.litros) - eurL(ant.media, fxAnt, obj.litros)) * 100, diasComDados: cur.diasComDados };
  };
  const dG = calc(gasoil), dGas = calc(rbob);
  const janelaCompleta = fimEfetivo.getTime() >= d0(janFim).getTime() && dG.diasComDados >= 5 && dGas.diasComDados >= 5;
  const prever = (delta, k, folgaBase) => {
    const central = delta * k;
    let folga = Math.max(folgaBase, Math.abs(central) * 0.25);
    if (!janelaCompleta) folga += 0.5;
    return { variacao: arred(central), min: meioCentimo(central - folga), max: meioCentimo(central + folga) };
  };
  return { gasoleo: prever(dG.delta, K.gasoleo, 0.5), gasolina: prever(dGas.delta, K.gasolina, 1.0), janelaCompleta,
    diasDeCotacoes: Math.min(dG.diasComDados, dGas.diasComDados), deltaCotacoesCts: { gasoleo: arred(dG.delta, 2), gasolina: arred(dGas.delta, 2) } };
}

async function principal() {
  const dow = hoje.getDay();
  const segAtual = segundaDaSemana(hoje);
  const modoPrevisao = dow >= 4 || dow === 0;     // qui..dom: prever a proxima segunda
  const alvo = modoPrevisao ? somaDias(segAtual, 7) : segAtual;
  const janIni = somaDias(alvo, -7), janFim = somaDias(alvo, -3);       // semana de cotacoes que determina o alvo
  const antIni = somaDias(alvo, -14), antFim = somaDias(alvo, -10);
  const desde = somaDias(alvo, -21);
  console.log("previsao-propria v2: alvo " + iso(alvo) + " (" + (modoPrevisao ? "previsao" : "semana em vigor") + ")");

  const stooqUrl = (s) => "https://stooq.com/q/d/l/?s=" + s + "&d1=" + compacta(desde) + "&d2=" + compacta(hoje) + "&i=d";
  const yahooUrl = (s, host) => "https://" + host + ".finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=1mo&interval=1d";
  const [gasoil, rbob, fxObj] = await Promise.all([
    serie("gasoleo", [
      { id: "stooq lf.f", url: stooqUrl("lf.f"), parse: parseStooq, litros: LITROS_TONELADA_GASOIL },
      { id: "yahoo HO=F", url: yahooUrl("HO=F", "query2"), parse: parseYahoo, litros: LITROS_GALAO },
      { id: "yahoo HO=F q1", url: yahooUrl("HO=F", "query1"), parse: parseYahoo, litros: LITROS_GALAO }
    ]),
    serie("gasolina", [
      { id: "stooq rb.f", url: stooqUrl("rb.f"), parse: parseStooq, litros: LITROS_GALAO },
      { id: "yahoo RB=F", url: yahooUrl("RB=F", "query2"), parse: parseYahoo, litros: LITROS_GALAO },
      { id: "yahoo RB=F q1", url: yahooUrl("RB=F", "query1"), parse: parseYahoo, litros: LITROS_GALAO }
    ]),
    serie("cambio", [
      { id: "frankfurter", url: "https://api.frankfurter.app/" + iso(desde) + ".." + iso(hoje) + "?from=EUR&to=USD", parse: parseFrankfurter, litros: 1 },
      { id: "BCE", url: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml", parse: parseBce, litros: 1 }
    ])
  ]);

  const p = calcular(gasoil, rbob, fxObj.serie, janIni, janFim, antIni, antFim, hoje);
  console.log("  modelo: gasoleo " + p.gasoleo.variacao + " [" + p.gasoleo.min + ".." + p.gasoleo.max + "] gasolina " + p.gasolina.variacao + " [" + p.gasolina.min + ".." + p.gasolina.max + "] (janela " + (p.janelaCompleta ? "completa" : "parcial, " + p.diasDeCotacoes + " dias") + ")");
  if (Math.abs(p.gasoleo.variacao) > LIMITE_SANIDADE_CTS || Math.abs(p.gasolina.variacao) > LIMITE_SANIDADE_CTS) throw new Error("variacao fora do limite de sanidade - pagina fica com o espelho");

  // Sombra/log: snapshot do espelho e fecho da semana anterior
  const dados = JSON.parse(await readFile("combustiveis.json", "utf8"));
  const mirror = { gasoleo: arred(dados.gasoleo.variacao * 100), gasolina: arred(dados.gasolina.variacao * 100), semanaInicio: dados.semanaInicio };
  let anterior = null;
  try { anterior = JSON.parse(await readFile("previsao-propria.json", "utf8")); } catch {}
  if (anterior && anterior.semanaAlvo && anterior.semanaAlvo < iso(alvo)) {
    const linha = [iso(hoje), anterior.semanaAlvo, anterior.gasoleo.variacao, anterior.gasoleo.min + ".." + anterior.gasoleo.max, anterior.gasolina.variacao, anterior.gasolina.min + ".." + anterior.gasolina.max, anterior.mirror ? anterior.mirror.gasoleo : "?", anterior.mirror ? anterior.mirror.gasolina : "?", "?", "?"].join(";") + "\n";
    try { await readFile("precisao-log.csv", "utf8"); } catch { await writeFile("precisao-log.csv", "data;semanaAlvo;propria_gasoleo;intervalo_gasoleo;propria_gasolina;intervalo_gasolina;mirror_gasoleo;mirror_gasolina;real_gasoleo;real_gasolina\n"); }
    await appendFile("precisao-log.csv", linha);
  }
  await writeFile("previsao-propria.json", JSON.stringify({ geradoEm: new Date().toISOString(), semanaAlvo: iso(alvo), modo: modoPrevisao ? "previsao" : "em-vigor", ...p, k: K, fontes: { gasoleo: gasoil.id, gasolina: rbob.id, cambio: fxObj.id }, mirror }, null, 2) + "\n");

  // Base de partida: a semana em vigor confirmada pelo override (revisao de terca) e a fonte mais fiavel
  let override = null;
  try { override = JSON.parse(await readFile("override.json", "utf8")); } catch {}
  const overrideConfirmaSemanaAtual = override && override.semanaInicio === iso(segAtual) && override.gasoleo && Number.isFinite(override.gasoleo.atual) && Number.isFinite(override.gasoleo.variacao) && override.gasolina && Number.isFinite(override.gasolina.atual) && Number.isFinite(override.gasolina.variacao);

  if (!modoPrevisao && overrideConfirmaSemanaAtual) {
    // Semana em vigor ja confirmada pela DGEG: o posprocessar aplica o override; aqui so garantimos o calendario e o intervalo
    dados.semanaInicio = iso(segAtual); dados.semanaFim = iso(somaDias(segAtual, 6));
    dados.fonte = "dgeg-confirmado";
  } else {
    if (modoPrevisao && overrideConfirmaSemanaAtual) {
      dados.gasoleo.atual = +(override.gasoleo.atual + override.gasoleo.variacao).toFixed(3);
      dados.gasolina.atual = +(override.gasolina.atual + override.gasolina.variacao).toFixed(3);
      dados.baseConfirmada = true;
    } else { dados.baseConfirmada = false; }
    dados.gasoleo.variacao = +(p.gasoleo.variacao / 100).toFixed(3);
    dados.gasolina.variacao = +(p.gasolina.variacao / 100).toFixed(3);
    dados.gasoleo.intervalo = { min: p.gasoleo.min, max: p.gasoleo.max };
    dados.gasolina.intervalo = { min: p.gasolina.min, max: p.gasolina.max };
    dados.semanaInicio = iso(alvo); dados.semanaFim = iso(somaDias(alvo, 6));
    dados.fonte = "modelo-proprio";
    dados.modelo = { janelaCompleta: p.janelaCompleta, diasDeCotacoes: p.diasDeCotacoes, k: K, fontes: { gasoleo: gasoil.id, gasolina: rbob.id, cambio: fxObj.id } };
    if (dados.notaIsp && (!override || override.semanaInicio !== dados.semanaInicio)) delete dados.notaIsp;   // nota orfa de outra semana
    const h = dados.historico;
    if (Array.isArray(h) && h.length && h[h.length - 1].previsto) {
      h[h.length - 1].gasoleo = +(dados.gasoleo.atual + dados.gasoleo.variacao).toFixed(3);
      h[h.length - 1].gasolina = +(dados.gasolina.atual + dados.gasolina.variacao).toFixed(3);
    }
  }
  dados.atualizado = iso(hoje);
  await writeFile("combustiveis.json", JSON.stringify(dados, null, 2) + "\n");
  console.log("  combustiveis.json escrito pelo modelo proprio (" + dados.fonte + ", semana " + dados.semanaInicio + ")");
}

if (process.argv[1] && process.argv[1].endsWith("previsao-propria.mjs")) {
  principal().catch((e) => { console.log("previsao-propria falhou (a pagina fica com o espelho): " + (e && e.message ? e.message : e)); });
}
