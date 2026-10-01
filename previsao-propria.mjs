// previsao-propria.mjs v2.6 - o modelo proprio ALIMENTA a pagina (combustiveis.json).
// Corre a seguir ao update-combustiveis.mjs (espelho) e ao dgeg-oficial.mjs (leituras oficiais), antes do placar.mjs e do posprocessar-isp.mjs.
// Se o modelo falhar por qualquer razao, nao toca no combustiveis.json: a pagina fica com os dados do espelho.
//
// Modelo (validado em 4 segundas-feiras de sombra, 17 ago - 7 set 2026, erro medio ~1 ct no gasoleo e ~1,5 na gasolina):
// variacao de segunda-feira (leitura DGEG) = k x variacao da media semanal das cotacoes em EUR/L
// gasoleo: gasoil ICE (USD/t) ou ULSD NY (USD/gal), k = 0.60
// gasolina: RBOB NY (USD/gal), k = 1.04 (proxy americano - semanas de choque nas margens europeias podem desviar)
// cambio EUR/USD do BCE. O efeito das portarias do ISP entra pelo override.json (revisao de terca-feira).
// Fontes de cotacoes com cadeia de transportes (direto, r.jina.ai, allorigins) porque o stooq bloqueia
// os runners do GitHub e o Yahoo limita pedidos. Basta uma fonte responder.
// Calendario: qui-dom = previsao para a proxima segunda (janela parcial que se completa ate sexta);
// seg-qua = semana em vigor (estimativa a partir da semana anterior completa, ate a confirmacao DGEG entrar).
//
// v2.6 (1 out 2026) - BASE PROVISORIA: a leitura oficial de 28 set nao foi registada e a pagina ficou a mostrar como preco atual
//    o de 21 set, com a previsao de 5 out somada a essa base de ha duas semanas. Agora, quando falta a leitura oficial da(s)
//    segunda(s) entre a ultima oficial e o alvo (ate duas), a base passa a ser: ultima oficial + variacao que o modelo calcula
//    para cada segunda em falta (janela completa de cotacoes). Fica marcada como provisoria: baseConfirmada false,
//    baseProvisoria com o detalhe, ponto "aprox" no grafico e aviso na pagina (notaAcumulado). O baseData continua a ser a data
//    da ultima leitura OFICIAL, e e por ele que o email as redacoes decide se envia (com base provisoria nao envia).
//    Quando a leitura oficial e registada, tudo isto desaparece sozinho na execucao seguinte.
//
// v2.5 (21 set 2026) - o que mudou e porque:
// 1) BASE OFICIAL: a base (dados.gasoleo.atual) vinha da semente + override.json. O override nao foi atualizado a 15 set,
//    e por isso a pagina mediu a variacao de 21 set contra a leitura de 7 set (duas semanas atras). Agora as leituras oficiais
//    vem de tres sitios, por esta ordem de prioridade: semente < dgeg-oficial.json (automatico) < override.json (manual, ganha sempre).
//    O override.json passa a ser aceite nos dois formatos: "historicoOficial" (data ISO) ou "historico" (semana dd/mm, o que la estava).
// 2) ESPELHO: o "mirror" (previsao do setor) era lido de dados.gasoleo.variacao, que este script ja tinha substituido pelo modelo
//    (ou pelo override, na semana confirmada). Resultado: o log comparava o modelo com ele proprio ou com o valor real.
//    Agora o update-combustiveis.mjs guarda o setor em dados.espelho e e so dai que o espelho e lido.
// 3) SEMANA CONFIRMADA: quando a leitura oficial do alvo existe, a pagina passa a mostrar a variacao confirmada
//    (oficial do alvo - oficial anterior) e deixa de mostrar intervalo, sem depender do override.
// 4) FECHO DO LOG: a linha do precisao-log.csv fecha na primeira execucao de segunda-feira (transicao previsao -> em-vigor),
//    com a previsao que estava publicada de sexta a domingo. O real e preenchido depois pelo placar.mjs.

import { readFile, writeFile, appendFile } from "node:fs/promises";

const K = { gasoleo: 1.04, gasolina: 1.04 }; // valores por defeito (fontes Yahoo)
// Multiplicador por fonte: o gasoil ICE (stooq) foi calibrado a 0.60 no backtest de agosto; o ULSD NY (Yahoo)
// calibrou a 1.04 nas semanas 24 ago-7 set (k implicito 0.92 / 1.19 / 1.04, erros 0.6 / 0.6 / 0.0 cts).
const K_POR_FONTE = { gasoleo: { "stooq lf.f": 0.60, "yahoo HO=F": 1.04, "yahoo HO=F q1": 1.04 }, gasolina: { "stooq rb.f": 1.04, "yahoo RB=F": 1.04, "yahoo RB=F q1": 1.04 } };
const LITROS_TONELADA_GASOIL = 1183;
const LITROS_GALAO = 3.78541;
const LIMITE_SANIDADE_CTS = 25;
// Leituras oficiais da DGEG (segunda-feira) ja confirmadas - semente; a partir daqui vivem em dgeg-oficial.json (automatico) e override.json (manual)
const SEMENTE_OFICIAL = [
  { data: "2026-08-10", gasolina: 1.896, gasoleo: 1.975 },
  { data: "2026-08-17", gasolina: 1.954, gasoleo: 2.026 },
  { data: "2026-08-24", gasolina: 1.986, gasoleo: 2.066 },
  { data: "2026-08-31", gasolina: 2.013, gasoleo: 2.029 },
  { data: "2026-09-07", gasolina: 2.093, gasoleo: 2.104 }
];
const ddmm = (isoData) => isoData.slice(8, 10) + "/" + isoData.slice(5, 7);
const MESES_PT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const diaMes = (isoData) => Number(isoData.slice(8, 10)) + " de " + MESES_PT[Number(isoData.slice(5, 7)) - 1];
const ctsTxt = (n) => (n > 0 ? "+" : n < 0 ? "-" : "") + String(Math.abs(n)).replace(".", ",");
const PROXY = "https://lf-proxy.success-f03.workers.dev/?u="; // Worker Cloudflare (ver worker-proxy.js) - os runners do GitHub sao bloqueados pelas fontes
const UA = { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "accept": "text/csv,application/json,text/plain,*/*" } };

const hoje = new Date();
const d0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const iso = (d) => d.toISOString().slice(0, 10);
const compacta = (d) => iso(d).replace(/-/g, "");
function segundaDaSemana(d) { const x = d0(d); const dia = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dia); return x; }
function somaDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
// Contrato NYMEX que esta "front" num dia d: o contrato do mes seguinte (o de M expira no ultimo dia util de M-1).
// Usar o MESMO contrato nas duas semanas evita o salto artificial do roll (ex.: RBOB set->out, gasolina de inverno).
const CODIGOS_MES = "FGHJKMNQUVXZ";
function contratoFront(d) { const m = (d.getMonth() + 1) % 12; const ano = d.getFullYear() + (d.getMonth() === 11 ? 1 : 0); return CODIGOS_MES[m] + String(ano).slice(2); }
function valorAntes(s, dia) { let v = null; for (const k of Object.keys(s).sort()) { if (k <= iso(dia)) v = s[k]; else break; } return v; }
function valorDesde(s, dia) { for (const k of Object.keys(s).sort()) { if (k >= iso(dia)) return s[k]; } return null; }
function saltoSuspeito(s, antFim, janIni) { const a = valorAntes(s, antFim), b = valorDesde(s, janIni); if (!a || !b) return 0; return Math.abs(b / a - 1); }

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
    } catch (e) { ultimoErro = e; console.log(" rota falhou (" + rota.slice(0, 32) + "...): " + (e && e.message ? e.message : e)); }
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
      console.log(" " + nome + ": " + f.id + " (" + n + " dias)");
      return { serie: s, litros: f.litros, id: f.id };
    } catch (e) { console.log(" " + nome + " " + f.id + " falhou: " + (e && e.message ? e.message : e)); }
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
export function calcular(gasoil, rbob, fx, janIni, janFim, antIni, antFim, hojeRef, kG, kGas) {
  if (!Number.isFinite(kG)) kG = K.gasoleo;
  if (!Number.isFinite(kGas)) kGas = K.gasolina;
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
  return { gasoleo: prever(dG.delta, kG, 0.5), gasolina: prever(dGas.delta, kGas, 1.0), janelaCompleta, kUsado: { gasoleo: kG, gasolina: kGas },
    diasDeCotacoes: Math.min(dG.diasComDados, dGas.diasComDados), deltaCotacoesCts: { gasoleo: arred(dG.delta, 2), gasolina: arred(dGas.delta, 2) } };
}

// --- leituras oficiais da DGEG (segunda-feira), por ordem de prioridade: semente < dgeg-oficial.json < override.json ---
const leituraValida = (o) => !!o && /^\d{4}-\d{2}-\d{2}$/.test(String(o.data || "")) && Number.isFinite(o.gasolina) && Number.isFinite(o.gasoleo) && o.gasolina > 1 && o.gasolina < 3 && o.gasoleo > 1 && o.gasoleo < 3;
const overrideConfirma = (ov) => !!(ov && ov.semanaInicio && ov.gasoleo && Number.isFinite(ov.gasoleo.atual) && Number.isFinite(ov.gasoleo.variacao) && ov.gasolina && Number.isFinite(ov.gasolina.atual) && Number.isFinite(ov.gasolina.variacao));
export async function carregarOficiais() {
  const oficiais = {};
  for (const o of SEMENTE_OFICIAL) oficiais[o.data] = { gasolina: o.gasolina, gasoleo: o.gasoleo, fonte: "semente" };
  try {
    const auto = JSON.parse(await readFile("dgeg-oficial.json", "utf8"));
    for (const o of (auto.leituras || [])) if (leituraValida(o)) oficiais[o.data] = { gasolina: o.gasolina, gasoleo: o.gasoleo, fonte: "dgeg" };
  } catch { /* sem leituras automaticas ainda */ }
  let override = null;
  try { override = JSON.parse(await readFile("override.json", "utf8")); } catch { /* sem override */ }
  if (override) {
    const lista = [];
    if (Array.isArray(override.historicoOficial)) lista.push(...override.historicoOficial);
    // formato antigo do override: "historico": [{ semana: "dd/mm", gasolina, gasoleo }] - o ano vem do semanaInicio (com viragem dez->jan)
    if (Array.isArray(override.historico) && /^\d{4}-\d{2}-\d{2}$/.test(String(override.semanaInicio || ""))) {
      const ano = Number(override.semanaInicio.slice(0, 4));
      for (const h of override.historico) {
        if (!h || !/^\d{2}\/\d{2}$/.test(String(h.semana || ""))) continue;
        const [dd, mm] = h.semana.split("/");
        let data = ano + "-" + mm + "-" + dd;
        if (data > override.semanaInicio) data = (ano - 1) + "-" + mm + "-" + dd;
        lista.push({ data, gasolina: h.gasolina, gasoleo: h.gasoleo });
      }
    }
    for (const o of lista) if (leituraValida(o)) oficiais[o.data] = { gasolina: o.gasolina, gasoleo: o.gasoleo, fonte: "override" };
    if (overrideConfirma(override)) oficiais[override.semanaInicio] = { gasolina: +(override.gasolina.atual + override.gasolina.variacao).toFixed(3), gasoleo: +(override.gasoleo.atual + override.gasoleo.variacao).toFixed(3), fonte: "override" };
  }
  return { oficiais, override };
}

// --- base provisoria (v2.6): quando falta a leitura oficial de uma ou duas segundas-feiras antes do alvo ---
// Devolve a lista das segundas em falta com o preco estimado em cada uma (ultima oficial + variacao do modelo, janela completa), ou null.
export function baseProvisoria(gasoil, rbob, fx, alvo, baseData, base, hojeRef, kG, kGas) {
  if (!baseData || !base) return null;
  const emFalta = [];
  for (let n = 1; n <= 3; n++) { const seg = somaDias(alvo, -7 * n); if (iso(seg) <= baseData) break; emFalta.unshift(seg); }
  if (!emFalta.length) return null; // a base e a segunda-feira anterior ao alvo: nada a fazer
  if (emFalta.length > 2 || iso(somaDias(emFalta[0], -7)) !== baseData) throw new Error("ultima leitura oficial (" + baseData + ") demasiado antiga para estimar a base");
  let g = base.gasoleo, s = base.gasolina;
  const passos = [];
  for (const seg of emFalta) {
    const q = calcular(gasoil, rbob, fx, somaDias(seg, -7), somaDias(seg, -3), somaDias(seg, -14), somaDias(seg, -10), hojeRef, kG, kGas);
    if (q.diasDeCotacoes < 3) throw new Error("poucas cotacoes na semana anterior a " + iso(seg));
    if (Math.abs(q.gasoleo.variacao) > LIMITE_SANIDADE_CTS || Math.abs(q.gasolina.variacao) > LIMITE_SANIDADE_CTS) throw new Error("variacao de " + iso(seg) + " fora do limite de sanidade");
    g = +(g + q.gasoleo.variacao / 100).toFixed(3); s = +(s + q.gasolina.variacao / 100).toFixed(3);
    passos.push({ data: iso(seg), gasoleo: g, gasolina: s, variacao: { gasoleo: q.gasoleo.variacao, gasolina: q.gasolina.variacao } });
  }
  return passos;
}
function notaProvisoria(passos, baseData) {
  const datas = passos.map((x) => diaMes(x.data));
  const tot = (c) => arred(passos.reduce((a, x) => a + x.variacao[c], 0));
  return "Preço atual por confirmar: " + (datas.length > 1 ? "faltam as médias oficiais da DGEG das segundas-feiras " + datas.join(" e ") : "falta a média oficial da DGEG de segunda-feira, " + datas[0]) +
    ". Usámos a última leitura oficial (" + diaMes(baseData) + ") e a variação que o nosso modelo calcula desde então: gasóleo " + ctsTxt(tot("gasoleo")) + " cêntimos e gasolina " + ctsTxt(tot("gasolina")) + ".";
}
// Notas escritas por este script (notaAuto) saem quando deixam de se aplicar; notas manuais do override nao sao tocadas.
function limparProvisoria(dados) {
  if (dados.notaAuto) { delete dados.notaAcumulado; delete dados.notaAuto; }
  delete dados.baseProvisoria;
}

// --- log de precisao: uma linha por semana-alvo, com a previsao que estava publicada antes de segunda-feira ---
const CABECALHO_LOG = "data;semanaAlvo;propria_gasoleo;intervalo_gasoleo;propria_gasolina;intervalo_gasolina;mirror_gasoleo;mirror_gasolina;real_gasoleo;real_gasolina\n";
async function registarNoLog(snap) {
  let atual = "";
  try { atual = await readFile("precisao-log.csv", "utf8"); } catch { atual = CABECALHO_LOG; await writeFile("precisao-log.csv", atual); }
  if (atual.split("\n").some((l) => l.split(";")[1] === snap.semanaAlvo)) return false; // ja fechada
  const espelhoOk = snap.mirror && snap.mirror.semanaInicio === snap.semanaAlvo && Number.isFinite(snap.mirror.gasoleo) && Number.isFinite(snap.mirror.gasolina);
  const linha = [iso(hoje), snap.semanaAlvo, snap.gasoleo.variacao, snap.gasoleo.min + ".." + snap.gasoleo.max, snap.gasolina.variacao, snap.gasolina.min + ".." + snap.gasolina.max,
    espelhoOk ? snap.mirror.gasoleo : "?", espelhoOk ? snap.mirror.gasolina : "?", "?", "?"].join(";") + "\n";
  await appendFile("precisao-log.csv", (atual.endsWith("\n") ? "" : "\n") + linha);
  console.log(" log fechado para " + snap.semanaAlvo + ": modelo " + snap.gasoleo.variacao + "/" + snap.gasolina.variacao + (espelhoOk ? " setor " + snap.mirror.gasoleo + "/" + snap.mirror.gasolina : " (sem espelho valido)"));
  return true;
}

async function principal() {
  const dow = hoje.getDay();
  const segAtual = segundaDaSemana(hoje);
  const modoPrevisao = dow >= 4 || dow === 0; // qui..dom: prever a proxima segunda
  const alvo = modoPrevisao ? somaDias(segAtual, 7) : segAtual;
  const janIni = somaDias(alvo, -7), janFim = somaDias(alvo, -3); // semana de cotacoes que determina o alvo
  const antIni = somaDias(alvo, -14), antFim = somaDias(alvo, -10);
  const desde = somaDias(alvo, -28); // quatro semanas: chega para estimar ate duas segundas-feiras sem leitura oficial
  console.log("previsao-propria v2.6: alvo " + iso(alvo) + " (" + (modoPrevisao ? "previsao" : "semana em vigor") + ")");

  const stooqUrl = (s) => "https://stooq.com/q/d/l/?s=" + s + "&d1=" + compacta(desde) + "&d2=" + compacta(hoje) + "&i=d";
  const yahooUrl = (s, host) => "https://" + host + ".finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s) + "?range=1mo&interval=1d";
  const contrato = contratoFront(janFim); // mesmo contrato nas duas semanas comparadas
  console.log(" contrato NYMEX de referencia: " + contrato + " (front a " + iso(janFim) + ")");
  const [gasoil, rbob, fxObj] = await Promise.all([
    serie("gasoleo", [
      { id: "stooq lf.f", url: stooqUrl("lf.f"), parse: parseStooq, litros: LITROS_TONELADA_GASOIL },
      { id: "yahoo HO=F", url: yahooUrl("HO=F", "query2"), parse: parseYahoo, litros: LITROS_GALAO },
      { id: "yahoo HO" + contrato + ".NYM", url: yahooUrl("HO" + contrato + ".NYM", "query2"), parse: parseYahoo, litros: LITROS_GALAO },
      { id: "yahoo HO=F q1", url: yahooUrl("HO=F", "query1"), parse: parseYahoo, litros: LITROS_GALAO }
    ]),
    serie("gasolina", [
      { id: "stooq rb.f", url: stooqUrl("rb.f"), parse: parseStooq, litros: LITROS_GALAO },
      { id: "yahoo RB" + contrato + ".NYM", url: yahooUrl("RB" + contrato + ".NYM", "query2"), parse: parseYahoo, litros: LITROS_GALAO },
      { id: "yahoo RB=F", url: yahooUrl("RB=F", "query2"), parse: parseYahoo, litros: LITROS_GALAO },
      { id: "yahoo RB=F q1", url: yahooUrl("RB=F", "query1"), parse: parseYahoo, litros: LITROS_GALAO }
    ]),
    serie("cambio", [
      { id: "frankfurter", url: "https://api.frankfurter.app/" + iso(desde) + ".." + iso(hoje) + "?from=EUR&to=USD", parse: parseFrankfurter, litros: 1 },
      { id: "BCE", url: "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml", parse: parseBce, litros: 1 }
    ])
  ]);

  const kG = K_POR_FONTE.gasoleo[gasoil.id] || K.gasoleo, kGas = K_POR_FONTE.gasolina[rbob.id] || K.gasolina;
  const p = calcular(gasoil, rbob, fxObj.serie, janIni, janFim, antIni, antFim, hoje, kG, kGas);
  console.log(" k usado: gasoleo " + kG + " (" + gasoil.id + "), gasolina " + kGas + " (" + rbob.id + ")");
  for (const par of [["gasoleo", gasoil, p.gasoleo], ["gasolina", rbob, p.gasolina]]) {
    if (par[1].id.indexOf("=F") > -1) {
      const salto = saltoSuspeito(par[1].serie, antFim, janIni);
      if (salto > 0.07) { console.log(" AVISO " + par[0] + ": salto de " + arred(salto * 100) + "% entre as semanas na serie continua " + par[1].id + " - provavel roll de contrato; margem alargada"); par[2].min = meioCentimo(par[2].min - 2); par[2].max = meioCentimo(par[2].max + 2); }
    }
  }
  console.log(" modelo: gasoleo " + p.gasoleo.variacao + " [" + p.gasoleo.min + ".." + p.gasoleo.max + "] gasolina " + p.gasolina.variacao + " [" + p.gasolina.min + ".." + p.gasolina.max + "] (janela " + (p.janelaCompleta ? "completa" : "parcial, " + p.diasDeCotacoes + " dias") + ")");
  if (Math.abs(p.gasoleo.variacao) > LIMITE_SANIDADE_CTS || Math.abs(p.gasolina.variacao) > LIMITE_SANIDADE_CTS) throw new Error("variacao fora do limite de sanidade - pagina fica com o espelho");

  // Espelho (previsao do setor): SO de dados.espelho, escrito pelo update-combustiveis.mjs. Nunca de dados.gasoleo.variacao,
  // que a partir daqui e do modelo (ou da leitura confirmada) e ja poluiu o log com o modelo/real disfarcados de setor.
  const dados = JSON.parse(await readFile("combustiveis.json", "utf8"));
  const esp = dados.espelho && dados.espelho.semanaInicio && dados.espelho.gasoleo && dados.espelho.gasolina ? dados.espelho : null;
  const mirror = esp ? { gasoleo: arred(esp.gasoleo.variacao * 100), gasolina: arred(esp.gasolina.variacao * 100), semanaInicio: esp.semanaInicio, fonte: esp.fonte || "" } : null;

  // Fecho do log: na primeira execucao de segunda-feira (transicao previsao -> em-vigor) congela-se a previsao publicada.
  // Salvaguarda: se nao houve execucao entre domingo e segunda, fecha na transicao seguinte (mesmos numeros, janela ja completa).
  let anterior = null;
  try { anterior = JSON.parse(await readFile("previsao-propria.json", "utf8")); } catch { /* primeira execucao */ }
  if (anterior && anterior.semanaAlvo && anterior.gasoleo && anterior.gasolina) {
    if (anterior.modo === "previsao" && !modoPrevisao && anterior.semanaAlvo === iso(alvo)) await registarNoLog(anterior);
    else if (anterior.semanaAlvo < iso(alvo)) await registarNoLog(anterior);
  }
  await writeFile("previsao-propria.json", JSON.stringify({ geradoEm: new Date().toISOString(), semanaAlvo: iso(alvo), modo: modoPrevisao ? "previsao" : "em-vigor", ...p, k: p.kUsado, fontes: { gasoleo: gasoil.id, gasolina: rbob.id, cambio: fxObj.id }, mirror }, null, 2) + "\n");

  // Historico oficial: semente + dgeg-oficial.json (automatico) + override.json (manual, ganha sempre)
  const { oficiais, override } = await carregarOficiais();
  const datasOficiais = Object.keys(oficiais).sort();
  const alvoConfirmado = !!oficiais[iso(alvo)];
  const baseData = datasOficiais.filter((d) => d < iso(alvo)).pop(); // ultima leitura oficial antes do alvo
  const base = baseData ? oficiais[baseData] : null;
  const baseAntiga = !!baseData && baseData !== iso(somaDias(alvo, -7)); // falta a leitura da segunda-feira anterior ao alvo
  if (baseData) console.log(" base oficial: " + baseData + " (" + oficiais[baseData].fonte + ") gasoleo " + base.gasoleo + " gasolina " + base.gasolina + (alvoConfirmado ? " | alvo " + iso(alvo) + " confirmado (" + oficiais[iso(alvo)].fonte + ")" : ""));

  // Base provisoria: so quando o alvo ainda nao esta confirmado e falta a leitura da(s) segunda(s) anterior(es)
  let provisoria = null;
  if (baseAntiga && !alvoConfirmado) {
    try { provisoria = baseProvisoria(gasoil, rbob, fxObj.serie, alvo, baseData, base, hoje, kG, kGas); }
    catch (e) { console.log(" base provisoria nao calculada: " + (e && e.message ? e.message : e)); }
    if (provisoria) console.log(" BASE PROVISORIA (falta leitura oficial): " + provisoria.map((x) => x.data + " gasoleo " + x.gasoleo + " (" + ctsTxt(x.variacao.gasoleo) + ") gasolina " + x.gasolina + " (" + ctsTxt(x.variacao.gasolina) + ")").join(" | "));
  }

  if (alvoConfirmado) {
    // Semana em vigor ja confirmada pela DGEG: a pagina mostra a variacao confirmada, sem intervalo. O override, se existir para esta semana, sobrepoe-se no posprocessar-isp.mjs.
    const conf = oficiais[iso(alvo)];
    limparProvisoria(dados);
    if (base) {
      dados.gasoleo.atual = base.gasoleo; dados.gasolina.atual = base.gasolina;
      dados.gasoleo.variacao = +(conf.gasoleo - base.gasoleo).toFixed(3);
      dados.gasolina.variacao = +(conf.gasolina - base.gasolina).toFixed(3);
      dados.baseConfirmada = true; dados.baseData = baseData;
      if (baseAntiga) { dados.notaAcumulado = "A variação desta semana compara com a leitura oficial de " + diaMes(baseData) + ", porque falta a de " + diaMes(iso(somaDias(alvo, -7))) + "."; dados.notaAuto = true; }
    }
    delete dados.gasoleo.intervalo; delete dados.gasolina.intervalo;
    dados.semanaInicio = iso(alvo); dados.semanaFim = iso(somaDias(alvo, 6));
    dados.fonte = "dgeg-confirmado";
    dados.confirmacao = { data: iso(alvo), gasoleo: conf.gasoleo, gasolina: conf.gasolina, fonte: conf.fonte };
  } else {
    limparProvisoria(dados);
    if (provisoria) {
      const ult = provisoria[provisoria.length - 1];
      dados.gasoleo.atual = ult.gasoleo; dados.gasolina.atual = ult.gasolina;
      dados.baseConfirmada = false; dados.baseData = baseData; // baseData = ultima leitura OFICIAL (o email as redacoes decide por ela)
      dados.baseProvisoria = { ultimaOficial: baseData, semanas: provisoria };
      dados.notaAcumulado = notaProvisoria(provisoria, baseData); dados.notaAuto = true;
    } else if (base) { dados.gasoleo.atual = base.gasoleo; dados.gasolina.atual = base.gasolina; dados.baseConfirmada = !baseAntiga; dados.baseData = baseData; }
    else { dados.baseConfirmada = false; }
    dados.gasoleo.variacao = +(p.gasoleo.variacao / 100).toFixed(3);
    dados.gasolina.variacao = +(p.gasolina.variacao / 100).toFixed(3);
    dados.gasoleo.intervalo = { min: p.gasoleo.min, max: p.gasoleo.max };
    dados.gasolina.intervalo = { min: p.gasolina.min, max: p.gasolina.max };
    dados.semanaInicio = iso(alvo); dados.semanaFim = iso(somaDias(alvo, 6));
    dados.fonte = "modelo-proprio";
    dados.modelo = { janelaCompleta: p.janelaCompleta, diasDeCotacoes: p.diasDeCotacoes, k: p.kUsado, fontes: { gasoleo: gasoil.id, gasolina: rbob.id, cambio: fxObj.id } };
    delete dados.confirmacao;
    if (dados.notaIsp && (!override || override.semanaInicio !== dados.semanaInicio)) delete dados.notaIsp; // nota orfa de outra semana
  }
  // Grafico: ultimas leituras oficiais antes do alvo (+ as segundas estimadas, marcadas "aprox") + o alvo (confirmado ou previsto) - 5 pontos
  const nProv = provisoria ? provisoria.length : 0;
  const hist = datasOficiais.filter((d) => d < iso(alvo)).slice(-(4 - nProv)).map((d) => ({ semana: ddmm(d), gasolina: oficiais[d].gasolina, gasoleo: oficiais[d].gasoleo }));
  if (provisoria) for (const x of provisoria) hist.push({ semana: ddmm(x.data), gasolina: x.gasolina, gasoleo: x.gasoleo, aprox: true });
  if (alvoConfirmado) hist.push({ semana: ddmm(iso(alvo)), gasolina: oficiais[iso(alvo)].gasolina, gasoleo: oficiais[iso(alvo)].gasoleo });
  else hist.push({ semana: ddmm(iso(alvo)), gasolina: +(dados.gasolina.atual + dados.gasolina.variacao).toFixed(3), gasoleo: +(dados.gasoleo.atual + dados.gasoleo.variacao).toFixed(3), previsto: true });
  dados.historico = hist;
  dados.historicoOficial = datasOficiais.map((d) => ({ data: d, gasolina: oficiais[d].gasolina, gasoleo: oficiais[d].gasoleo }));
  dados.atualizado = iso(hoje);
  await writeFile("combustiveis.json", JSON.stringify(dados, null, 2) + "\n");
  console.log(" combustiveis.json escrito pelo modelo proprio (" + dados.fonte + ", semana " + dados.semanaInicio + (provisoria ? ", base provisoria" : "") + ")");
}

if (process.argv[1] && process.argv[1].endsWith("previsao-propria.mjs")) {
  principal().catch((e) => { console.log("previsao-propria falhou (a pagina fica com o espelho): " + (e && e.message ? e.message : e)); });
}
