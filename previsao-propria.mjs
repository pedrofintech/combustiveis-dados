// previsao-propria.mjs - previsao propria dos combustiveis, em MODO SOMBRA.
// Nao toca no combustiveis.json: escreve previsao-propria.json e regista precisao em precisao-log.csv.
// Corre no workflow horario a seguir ao posprocessar-isp.mjs, com "|| true" (nunca parte o pipeline).
//
// Modelo: variacao de segunda-feira (leitura DGEG) = k x variacao da media semanal das cotacoes em EUR/L
//         + efeito fiscal (mudancas do desconto ISP, com IVA), quando conhecido.
// Fontes: stooq (lf.f = gasoil ICE em USD/t, rb.f = RBOB em USD/gal) + BCE (EUR/USD).
// Calibracao inicial (backtest 20 jul - 17 ago 2026, alvo = leitura de segunda da DGEG):
//   K_GASOLEO = 0.60 (erro medio 0.17 cts), K_GASOLINA = 1.04 (erro medio 0.96 cts).
// A janela de cotacoes e a semana corrente (seg-sex). Ate sexta a janela esta incompleta:
// usa os dias disponiveis, assinala janelaCompleta=false e alarga o intervalo. E isto que
// permite publicar previsao logo a quinta-feira e refinar ate sabado.

import { readFile, writeFile, appendFile } from "node:fs/promises";

const K = { gasoleo: 0.60, gasolina: 1.04 };
const LITROS_TONELADA_GASOIL = 1183; // densidade 0.845
const LITROS_GALAO = 3.78541;
const IVA = 1.23;
const UA = { headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", "accept": "text/csv,text/plain,*/*" } };

const hoje = new Date();
const d0 = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const iso = (d) => d.toISOString().slice(0, 10);
const compacta = (d) => iso(d).replace(/-/g, "");

function segundaDaSemana(d) { const x = d0(d); const dia = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dia); return x; }
function somaDias(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

async function csvStooq(simbolo, desde, ate) {
  const url = "https://stooq.com/q/d/l/?s=" + simbolo + "&d1=" + compacta(desde) + "&d2=" + compacta(ate) + "&i=d";
  const r = await fetch(url, UA);
  if (!r.ok) throw new Error("stooq " + simbolo + " http " + r.status);
  const linhas = (await r.text()).trim().split("\n").slice(1);
  const out = {};
  for (const l of linhas) {
    const c = l.split(",");
    const fecho = Number(c[4]);
    if (c[0] && Number.isFinite(fecho) && fecho > 0) out[c[0]] = fecho;
  }
  if (!Object.keys(out).length) throw new Error("stooq " + simbolo + " sem dados");
  return out;
}

async function cambioBce() {
  const r = await fetch("https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml", UA);
  if (!r.ok) throw new Error("BCE http " + r.status);
  const xml = await r.text();
  const out = {};
  const re = /time='(\d{4}-\d{2}-\d{2})'[\s\S]*?currency='USD'\s+rate='([\d.]+)'/g;
  let m;
  while ((m = re.exec(xml)) !== null) out[m[1]] = Number(m[2]);
  if (!Object.keys(out).length) throw new Error("BCE sem taxas USD");
  return out;
}

// Media da serie nos dias uteis [ini..fim]; dias sem valor usam o ultimo conhecido (carry-forward)
function mediaJanela(serie, ini, fim) {
  const chaves = Object.keys(serie).sort();
  let ultimo = null;
  for (const k of chaves) { if (k < iso(ini)) ultimo = serie[k]; else break; }
  const valores = [];
  let usados = 0;
  for (let d = d0(ini); d.getTime() <= d0(fim).getTime(); d = somaDias(d, 1)) {
    const dia = d.getDay();
    if (dia === 0 || dia === 6) continue;
    const v = serie[iso(d)];
    if (Number.isFinite(v)) { ultimo = v; usados++; }
    if (Number.isFinite(ultimo)) valores.push(ultimo);
  }
  if (!valores.length) throw new Error("janela sem valores");
  return { media: valores.reduce((a, b) => a + b, 0) / valores.length, diasComDados: usados, diasJanela: valores.length };
}

function arred(n, casas = 1) { return Number(n.toFixed(casas)); }
function meioCentimo(n) { return Math.round(n * 2) / 2; }

async function principal() {
  const segAtual = segundaDaSemana(hoje);
  const alvoSegunda = somaDias(segAtual, 7);           // proxima segunda-feira
  const janIni = segAtual, janFim = somaDias(segAtual, 4);   // seg-sex desta semana
  const antIni = somaDias(segAtual, -7), antFim = somaDias(segAtual, -3); // semana anterior

  const desde = somaDias(segAtual, -21);
  const [gasoil, rbob, fx] = await Promise.all([
    csvStooq("lf.f", desde, hoje),
    csvStooq("rb.f", desde, hoje),
    cambioBce()
  ]);

  const eurL = (bruto, fxm, litros) => bruto / litros / fxm;
  const calc = (serie, litros) => {
    const ant = mediaJanela(serie, antIni, antFim);
    const cur = mediaJanela(serie, janIni, hoje < janFim ? hoje : janFim);
    const fxAnt = mediaJanela(fx, antIni, antFim).media;
    const fxCur = mediaJanela(fx, janIni, hoje < janFim ? hoje : janFim).media;
    return { delta: (eurL(cur.media, fxCur, litros) - eurL(ant.media, fxAnt, litros)) * 100, diasComDados: cur.diasComDados };
  };

  const dG = calc(gasoil, LITROS_TONELADA_GASOIL);
  const dGas = calc(rbob, LITROS_GALAO);
  const janelaCompleta = hoje.getDay() === 6 || hoje.getDay() === 0 || (hoje.getDay() === 5 && hoje.getHours() >= 22);

  // Fiscal: assume manutencao do desconto ISP ate haver portaria nova (le isp-estado.json so para referencia).
  // Quando o leitor do DRE existir, o delta entra aqui (efeito na bomba = delta_desconto x 1.23, sinal invertido).
  let isp = null;
  try { isp = JSON.parse(await readFile("isp-estado.json", "utf8")); } catch {}

  const prever = (delta, k, folgaBase) => {
    const central = delta * k;
    let folga = Math.max(folgaBase, Math.abs(central) * 0.25);
    if (!janelaCompleta) folga += 0.5;
    return { variacao: arred(central), min: meioCentimo(central - folga), max: meioCentimo(central + folga) };
  };
  const pG = prever(dG.delta, K.gasoleo, 0.5);
  const pGas = prever(dGas.delta, K.gasolina, 1.0);

  // Snapshot do mirror para o log de precisao
  let mirror = null, baseAtual = null;
  try {
    const c = JSON.parse(await readFile("combustiveis.json", "utf8"));
    mirror = { gasoleo: arred(c.gasoleo.variacao * 100), gasolina: arred(c.gasolina.variacao * 100) };
    baseAtual = { gasoleo: c.gasoleo.atual, gasolina: c.gasolina.atual };
  } catch {}

  // Fecho da previsao anterior quando a semana alvo avanca: regista no precisao-log.csv
  let anterior = null;
  try { anterior = JSON.parse(await readFile("previsao-propria.json", "utf8")); } catch {}
  if (anterior && anterior.semanaAlvo && anterior.semanaAlvo < iso(alvoSegunda) && !anterior.registada) {
    let realG = "?", realGas = "?";
    if (baseAtual && anterior.baseAtual) {
      const rg = (baseAtual.gasoleo - anterior.baseAtual.gasoleo) * 100;
      const rgas = (baseAtual.gasolina - anterior.baseAtual.gasolina) * 100;
      if (Math.abs(rg) > 0.001 || Math.abs(rgas) > 0.001) { realG = arred(rg); realGas = arred(rgas); }
    }
    const linha = [iso(hoje), anterior.semanaAlvo, anterior.gasoleo.variacao, anterior.gasoleo.min + ".." + anterior.gasoleo.max, anterior.gasolina.variacao, anterior.gasolina.min + ".." + anterior.gasolina.max, anterior.mirror ? anterior.mirror.gasoleo : "?", anterior.mirror ? anterior.mirror.gasolina : "?", realG, realGas].join(";") + "\n";
    try { await readFile("precisao-log.csv", "utf8"); } catch { await writeFile("precisao-log.csv", "data;semanaAlvo;propria_gasoleo;intervalo_gasoleo;propria_gasolina;intervalo_gasolina;mirror_gasoleo;mirror_gasolina;real_gasoleo;real_gasolina\n"); }
    await appendFile("precisao-log.csv", linha);
    console.log("precisao-log: registada a semana " + anterior.semanaAlvo + " (real " + realG + "/" + realGas + ")");
  }

  const saida = {
    geradoEm: new Date().toISOString(),
    semanaAlvo: iso(alvoSegunda),
    janelaCompleta,
    diasDeCotacoes: Math.min(dG.diasComDados, dGas.diasComDados),
    gasoleo: pG,
    gasolina: pGas,
    deltaCotacoesCts: { gasoleo: arred(dG.delta, 2), gasolina: arred(dGas.delta, 2) },
    k: K,
    fiscal: { assumido: "desconto ISP mantem-se", emVigor: isp },
    mirror,
    baseAtual,
    nota: "Previsao propria em modo sombra - nao alimenta a pagina. Alvo: leitura de segunda-feira da DGEG."
  };
  await writeFile("previsao-propria.json", JSON.stringify(saida, null, 2) + "\n");
  console.log("previsao-propria.json: " + iso(alvoSegunda) + " gasoleo " + pG.variacao + " [" + pG.min + ".." + pG.max + "] gasolina " + pGas.variacao + " [" + pGas.min + ".." + pGas.max + "] (janela " + (janelaCompleta ? "completa" : "parcial, " + saida.diasDeCotacoes + " dias") + ")");
}

principal().catch((e) => { console.log("previsao-propria falhou (nao critico): " + (e && e.message ? e.message : e)); });
