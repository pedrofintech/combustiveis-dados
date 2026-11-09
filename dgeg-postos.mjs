// dgeg-postos.mjs - lê os preços de todos os postos na API oficial da DGEG (web service do portal Preços dos
// Combustíveis Online). Acesso dado pela DGEG a 6 nov 2026 à PROSPERITY CHOICES, Lda.: o utilizador e a palavra-passe
// estão nos secrets DGEG_USER e DGEG_PASSWORD e nunca no código, porque este repositório é público.
// Manual: ManualWebService_20240417_V1.3. Swagger: https://ws-precoscombustiveis.dgeg.gov.pt/swagger/index.html
//
// Escreve três ficheiros:
//   postos-resumo.json    preço médio por marca e por distrito (lido pelo bloco "Que marca tem o combustível mais barato?")
//   postos-top.json       os postos mais baratos de cada distrito, com o preço e a hora a que o posto o comunicou
//   postos-historico.csv  uma linha por dia, combustível e grupo (país, marca, distrito). A API não guarda histórico.
//
// A API só responde em três janelas de uma hora: 03h, 13h e 20h, hora de Lisboa. O workflow "Ler postos DGEG" corre
// três vezes em cada hora à volta das 13h e das 20h, porque o cron do GitHub é em UTC e atrasa. Este script só pede à
// DGEG dentro de uma janela e uma vez por janela. Nas outras corridas sai em segundos sem fazer nada.
//
// Condições da DGEG (emails de 14 out e 6 nov 2026): citar a DGEG como fonte com a data e a hora da leitura e deixar
// claro que as médias e as listas são cálculo nosso, não informação produzida pela DGEG.
//
// Para testar fora do GitHub: DGEG_WS_BASE (outro servidor), LF_AGORA (outra hora) e LF_FORCAR=1 (ignora as janelas).
import { readFile, writeFile } from "node:fs/promises";

const BASE = (process.env.DGEG_WS_BASE || "https://ws-precoscombustiveis.dgeg.gov.pt").replace(/\/+$/, "");
const UTILIZADOR = process.env.DGEG_USER || "";
const SENHA = process.env.DGEG_PASSWORD || "";
const UA = "Mozilla/5.0 (compatible; LF-combustiveis/1.0; +https://www.literaciafinanceira.pt)";
const HORAS_JANELA = [3, 13, 20]; // 03h-04h, 13h-14h e 20h-21h
// dias: preços comunicados há mais tempo do que isto não contam (num posto parado, o preço antigo engana)
const COMBUSTIVEIS = {
  gasoleo: { id: 2101, nome: "Gasóleo simples", dias: 8 },
  gasolina: { id: 3201, nome: "Gasolina simples 95", dias: 8 },
  gpl: { id: 1120, nome: "GPL Auto", dias: 31 },
};
const MIN_POSTOS_MARCA = 20; // marcas com menos postos não entram na lista: a média seria pouco fiável
const TOP_POR_DISTRITO = 10;
const MIN_POSTOS_LEITURA = 1000; // menos postos do que isto no gasóleo ou na gasolina = resposta incompleta, não se grava
const HORAS_ENTRE_LEITURAS = 3; // uma leitura por janela: as janelas estão a pelo menos 7 horas umas das outras
const HORAS_ALERTA = 26; // sem leitura boa há mais tempo do que isto, o workflow falha e o GitHub avisa por email
const F_RESUMO = "postos-resumo.json";
const F_TOP = "postos-top.json";
const F_HIST = "postos-historico.csv";
const FONTE = "DGEG - Direção-Geral de Energia e Geologia, portal Preços dos Combustíveis Online (https://precoscombustiveis.dgeg.gov.pt/)";
const CAMPOS_TOP = ["id", "nome", "marca", "municipio", "localidade", "morada", "codPostal", "preco", "atualizado", "lat", "lon"];

const agora = process.env.LF_AGORA ? new Date(process.env.LF_AGORA) : new Date();
const noGitHub = !!process.env.GITHUB_ACTIONS;

// ---------- utilitários ----------

function lisboa(d) {
  const p = {};
  const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Lisbon", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  for (const x of fmt.formatToParts(d)) p[x.type] = x.value;
  return { data: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), txt: `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}` };
}

// A palavra-passe vai na query string do login: nada do que se escreve no log pode trazê-la.
function limpar(s) {
  let t = String(s ?? "");
  if (SENHA) for (const v of new Set([SENHA, encodeURIComponent(SENHA), new URLSearchParams({ p: SENHA }).toString().slice(2)])) t = t.split(v).join("***");
  return t.replace(/\s+/g, " ").trim().slice(0, 400);
}
function anotar(tipo, msg) {
  const t = limpar(msg);
  if (noGitHub) console.log(`::${tipo}::` + t.replace(/%/g, "%25"));
  else console.log((tipo === "error" ? "ERRO: " : "AVISO: ") + t);
}

// A API pode responder em camelCase (como no manual) ou em PascalCase: passa tudo a camelCase.
function normalizar(v) {
  if (Array.isArray(v)) return v.map(normalizar);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k.charAt(0).toLowerCase() + k.slice(1)] = normalizar(x);
    return o;
  }
  return v;
}

const texto = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const num = (v) => {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace("€", "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const r4 = (x) => Math.round(x * 1e4) / 1e4;
const media = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const coord = (v) => { const n = num(v); return Number.isFinite(n) && n !== 0 ? Math.round(n * 1e5) / 1e5 : null; };

// Datas da DGEG ("2026-11-02T07:00:00", hora de Lisboa sem fuso). Devolve o texto e os milissegundos (lidos como UTC:
// o desvio de uma hora não interessa para contar dias). Datas vazias ou "0001-01-01" dão null.
function quando(s) {
  const t = String(s ?? "");
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  if (m) {
    if (Number(m[1]) < 2000) return null;
    return { iso: `${m[1]}-${m[2]}-${m[3]}T${m[4] || "00"}:${m[5] || "00"}`, ms: Date.UTC(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) };
  }
  m = t.match(/^(\d{2})[-/](\d{2})[-/](\d{4})(?:[T ](\d{2}):(\d{2}))?/);
  if (m && Number(m[3]) >= 2000) {
    return { iso: `${m[3]}-${m[2]}-${m[1]}T${m[4] || "00"}:${m[5] || "00"}`, ms: Date.UTC(+m[3], m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0)) };
  }
  return null;
}

async function lerJSON(f) {
  try { return JSON.parse(await readFile(f, "utf8")); } catch { return null; }
}

// ---------- API da DGEG ----------

async function pedir(url, init = {}, ms = 120000) {
  let r;
  try {
    r = await fetch(url, { ...init, headers: { "User-Agent": UA, Accept: "application/json", ...(init.headers || {}) }, signal: AbortSignal.timeout(ms) });
  } catch (e) {
    // não se escreve e.message: nalguns erros de rede o Node junta o endereço, que no login leva a palavra-passe
    throw new Error("sem resposta da DGEG (" + (e?.cause?.code || e?.name || "erro de rede") + ")");
  }
  const txt = (await r.text()).trimStart(); // trimStart também tira o BOM que alguns servidores Windows põem no início
  let json = null;
  try { json = normalizar(JSON.parse(txt)); } catch { /* resposta que não é JSON (página de erro) */ }
  return { status: r.status, json, txt };
}
const mensagem = (r) => texto(r.json?.mensagem || r.txt.replace(/<[^>]+>/g, " ")) || "sem mensagem";
const foraDeHoras = (r) => /n[ãa]o dispon[íi]vel|hor[áa]rio de funcionamento/i.test(mensagem(r));

function falha(texto, r) {
  const e = new Error(texto);
  e.foraDeHoras = !!r && foraDeHoras(r);
  return e;
}

async function entrar() {
  const credenciais = new URLSearchParams({ username: UTILIZADOR, password: SENHA });
  // No swagger, o utilizador e a palavra-passe vão na query string do POST
  let r = await pedir(`${BASE}/v1/PrecoComb/Logon?${credenciais}`, { method: "POST" }, 60000);
  if (!r.json?.token && /informe um username/i.test(mensagem(r))) {
    // se esta versão da API os quiser no corpo do pedido, tenta assim uma vez
    r = await pedir(`${BASE}/v1/PrecoComb/Logon`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: credenciais.toString() }, 60000);
  }
  if (r.json?.status && r.json?.token) return r.json.token;
  throw falha(`login recusado (HTTP ${r.status}): ${mensagem(r)}`, r);
}

async function listarPostos(token) {
  const r = await pedir(`${BASE}/v1/PrecoComb/ListarPostos`, { headers: { Authorization: `Bearer ${token}` } }, 240000);
  if (r.status === 200 && r.json?.status && Array.isArray(r.json.resultado)) return r.json.resultado;
  throw falha(`ListarPostos (HTTP ${r.status}): ${mensagem(r)}`, r);
}

// ---------- cálculos ----------

function processar(postos) {
  const resumo = {}, topo = {}, historico = [];
  for (const [chave, c] of Object.entries(COMBUSTIVEIS)) {
    const validos = [];
    let antigos = 0;
    for (const p of postos) {
      if (p.estado && !/^a[c]?tiv/i.test(texto(p.estado))) continue; // a API só devolve postos ativos, mas confirma-se
      const linha = (p.precosCombustiveis || p.combustiveis || []).find((x) => Number(x.idTipoCombustivel) === c.id);
      if (!linha) continue;
      const preco = num(linha.preco);
      if (!(preco > 0.3 && preco < 5)) continue;
      const q = quando(linha.dataAtualizacao);
      if (!q || (agora.getTime() - q.ms) / 864e5 > c.dias) { antigos++; continue; }
      validos.push({ p, preco, atualizado: q.iso, marca: texto(p.marca) || "Genérico", distrito: texto(p.distrito) });
    }

    const porMarca = new Map(), porDistrito = new Map();
    for (const v of validos) {
      if (!porMarca.has(v.marca)) porMarca.set(v.marca, []);
      porMarca.get(v.marca).push(v.preco);
      if (!v.distrito) continue;
      if (!porDistrito.has(v.distrito)) porDistrito.set(v.distrito, []);
      porDistrito.get(v.distrito).push(v);
    }
    const precos = validos.map((v) => v.preco);
    const lista = [...porMarca].filter(([, a]) => a.length >= MIN_POSTOS_MARCA)
      .map(([m, a]) => [m, a.length, r4(media(a))])
      .sort((a, b) => a[2] - b[2] || b[1] - a[1]);
    const nomesDistritos = [...porDistrito.keys()].sort((a, b) => a.localeCompare(b, "pt"));
    const distritos = nomesDistritos.map((d) => {
      const a = porDistrito.get(d).map((v) => v.preco);
      return [d, a.length, r4(media(a)), r4(Math.min(...a))];
    });

    resumo[chave] = {
      id: c.id, nome: c.nome, diasValidos: c.dias, postos: validos.length, semPrecoRecente: antigos,
      media: precos.length ? r4(media(precos)) : null,
      minimo: precos.length ? r4(Math.min(...precos)) : null,
      maximo: precos.length ? r4(Math.max(...precos)) : null,
      lista, distritos,
    };

    topo[chave] = {};
    for (const d of nomesDistritos) {
      topo[chave][d] = porDistrito.get(d)
        .sort((a, b) => a.preco - b.preco || b.atualizado.localeCompare(a.atualizado))
        .slice(0, TOP_POR_DISTRITO)
        .map((v) => [v.p.id ?? null, texto(v.p.nome), v.marca, texto(v.p.municipio), texto(v.p.localidade), texto(v.p.morada),
          texto(v.p.codPostal), v.preco, v.atualizado, coord(v.p.latitude), coord(v.p.longitude)]);
    }

    if (precos.length) {
      historico.push([c.id, "pais", "Portugal continental", precos.length, resumo[chave].media, resumo[chave].minimo]);
      for (const [m, n, x] of lista) historico.push([c.id, "marca", m, n, x, r4(Math.min(...porMarca.get(m)))]);
      for (const [d, n, x, min] of distritos) historico.push([c.id, "distrito", d, n, x, min]);
    }
  }
  return { resumo, topo, historico };
}

async function gravarHistorico(dia, linhasNovas) {
  const CAB = "data,combustivel,grupo,nome,postos,media,minimo";
  const csv = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  let linhas = [];
  try { linhas = (await readFile(F_HIST, "utf8")).split("\n").filter(Boolean); } catch { /* primeira vez */ }
  // a segunda leitura do dia (20h) substitui a primeira (13h): fica uma fotografia por dia
  const antigas = linhas.filter((l) => l !== CAB && !l.startsWith(dia + ","));
  const novas = linhasNovas.map((r) => [dia, ...r].map(csv).join(","));
  await writeFile(F_HIST, [CAB, ...antigas, ...novas].join("\n") + "\n");
}

// ---------- decidir se é hora de pedir ----------

const anterior = await lerJSON(F_RESUMO);
const ultima = anterior?.lidoEm ? Date.parse(anterior.lidoEm) : NaN;
const horasDesde = Number.isFinite(ultima) ? (agora.getTime() - ultima) / 36e5 : Infinity;
const L = lisboa(agora);
const forcar = process.env.LF_FORCAR === "1";
// As janelas devem ser hora de Lisboa. Por precaução também se tenta à mesma hora em UTC (só muda no verão).
const naJanela = HORAS_JANELA.includes(L.hora) || HORAS_JANELA.includes(agora.getUTCHours());

if (!forcar && !naJanela) {
  console.log(`dgeg-postos: ${L.txt} em Lisboa, fora das janelas da API (03h, 13h e 20h). Nada a fazer.`);
  process.exit(0);
}
if (!forcar && horasDesde >= 0 && horasDesde < HORAS_ENTRE_LEITURAS) {
  console.log(`dgeg-postos: já li nesta janela (${anterior.lidoEmLisboa}). Nada a fazer.`);
  process.exit(0);
}
if (!UTILIZADOR || !SENHA) {
  anotar("warning", "dgeg-postos: faltam os secrets DGEG_USER e DGEG_PASSWORD (Settings > Secrets and variables > Actions). Não li nada.");
  process.exit(0);
}

// ---------- ler, calcular e gravar ----------

try {
  const token = await entrar();
  const postos = await listarPostos(token);
  const { resumo, topo, historico } = processar(postos);
  for (const k of ["gasoleo", "gasolina"]) {
    if (resumo[k].postos < MIN_POSTOS_LEITURA) {
      throw falha(`resposta incompleta: só ${resumo[k].postos} postos com ${COMBUSTIVEIS[k].nome} recente (de ${postos.length} postos lidos), não gravei nada`);
    }
  }
  const comum = { fonte: FONTE, lidoEm: agora.toISOString(), lidoEmLisboa: L.txt };
  await writeFile(F_RESUMO, JSON.stringify({
    _nota: "Escrito pelo dgeg-postos.mjs com os preços dos postos lidos na API da DGEG. Médias e listas são cálculo do Literacia Financeira, não informação produzida pela DGEG. Na página citar a DGEG com a data e a hora da leitura (lidoEmLisboa).",
    ...comum, postosLidos: postos.length, minPostos: MIN_POSTOS_MARCA, ...resumo,
  }, null, 1) + "\n");
  await writeFile(F_TOP, JSON.stringify({
    _nota: "Escrito pelo dgeg-postos.mjs: os postos mais baratos de cada distrito (preço por litro, data e hora a que o posto o comunicou à DGEG). Cálculo do Literacia Financeira com dados da DGEG.",
    ...comum, campos: CAMPOS_TOP, ...topo,
  }) + "\n");
  await gravarHistorico(L.data, historico);
  const txt = (k) => `${COMBUSTIVEIS[k].nome} ${resumo[k].postos} postos, média ${resumo[k].media ?? "-"}`;
  console.log(`dgeg-postos: ${postos.length} postos lidos às ${L.txt}. ${txt("gasoleo")}; ${txt("gasolina")}; ${txt("gpl")}.`);
} catch (e) {
  const onde = anterior?.lidoEmLisboa ? `Fica a leitura de ${anterior.lidoEmLisboa}.` : "Ainda não há nenhuma leitura boa.";
  const msg = `dgeg-postos: ${e.message}${e.foraDeHoras ? " (a DGEG diz que está fora do horário)" : ""}. ${onde}`;
  if (horasDesde > HORAS_ALERTA) {
    anotar("error", msg);
    process.exit(1);
  }
  anotar("warning", msg);
}
