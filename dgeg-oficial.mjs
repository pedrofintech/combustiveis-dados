// dgeg-oficial.mjs - lê sozinho a média oficial da DGEG de segunda-feira (preço médio diário) e grava-a em
// dgeg-oficial.json, que o modelo, o placar e o aviso já usam como leitura oficial (o override.json manual continua a ganhar).
// Corre no "Atualizar combustíveis" antes do previsao-propria.mjs.
// Só chama a DGEG quando falta a leitura de uma das últimas segundas-feiras já terminadas: na prática, um pedido
// por semana, na primeira corrida de terça de manhã. Se a DGEG não responder, não mexe em nada e o aviso de terça
// à tarde avisa por email, como antes (aí regista-se à mão em Actions > Registar leitura DGEG).
// Fonte: https://precoscombustiveis.dgeg.gov.pt/estatistica/preco-medio-diario/ (campo PrecoMedio).
import { readFile, writeFile } from "node:fs/promises";
import { carregarOficiais } from "./previsao-propria.mjs";

const API = "https://precoscombustiveis.dgeg.gov.pt/api/PrecoComb/PMD";
const IDS = { gasoleo: 2101, gasolina: 3201 }; // Gasóleo simples e Gasolina simples 95
const UA = "Mozilla/5.0 (compatible; LF-combustiveis/1.0; +https://www.literaciafinanceira.pt)";
const SEMANAS = 4; // segundas-feiras para trás que ainda se tentam recuperar

// Data de hoje em Lisboa (os runners do GitHub estão em UTC)
const hojeLisboa = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(new Date());
const dia = (s) => new Date(s + "T00:00:00Z");
const iso = (d) => d.toISOString().slice(0, 10);
const hoje = dia(hojeLisboa);

// Últimas segundas-feiras já terminadas: à segunda, a média do próprio dia ainda está a mexer, por isso não conta.
const segundas = [];
const seg = new Date(hoje);
seg.setUTCDate(seg.getUTCDate() - ((seg.getUTCDay() + 6) % 7));
if (iso(seg) === hojeLisboa) seg.setUTCDate(seg.getUTCDate() - 7);
for (let i = 0; i < SEMANAS; i++) { segundas.push(iso(seg)); seg.setUTCDate(seg.getUTCDate() - 7); }

const { oficiais } = await carregarOficiais();
const emFalta = segundas.filter((d) => !oficiais[d]).sort();
if (!emFalta.length) {
  console.log("dgeg-oficial: leitura de " + segundas[0] + " já registada, nada a pedir à DGEG.");
  process.exit(0);
}

const num = (s) => Number(String(s || "").replace("€", "").replace(",", ".").trim());
const params = new URLSearchParams({ idsTiposComb: IDS.gasoleo + "," + IDS.gasolina, dataIni: emFalta[0],
  dataFim: emFalta[emFalta.length - 1], qtdPorPagina: 100, pagina: 1, orderDesc: 1 });
let resposta;
try {
  const r = await fetch(API + "?" + params, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  resposta = await r.json();
  if (!resposta.status || !Array.isArray(resposta.resultado)) throw new Error("resposta inesperada: " + JSON.stringify(resposta).slice(0, 200));
} catch (e) {
  console.log("dgeg-oficial: a DGEG não respondeu (" + e.message + "). Fica como estava.");
  process.exit(0);
}

const novas = [];
for (const data of emFalta) {
  const linha = (nome) => resposta.resultado.find((x) => x.Data === data && x.TipoCombustivel === nome);
  const gasoleo = num(linha("Gasóleo simples")?.PrecoMedio);
  const gasolina = num(linha("Gasolina simples 95")?.PrecoMedio);
  if (gasoleo > 1 && gasoleo < 3 && gasolina > 1 && gasolina < 3) novas.push({ data, gasolina, gasoleo });
  else console.log("dgeg-oficial: sem valores válidos para " + data + " na resposta da DGEG.");
}
if (!novas.length) process.exit(0);

let ficheiro = {};
try { ficheiro = JSON.parse(await readFile("dgeg-oficial.json", "utf8")); } catch { /* primeira vez */ }
const leituras = (Array.isArray(ficheiro.leituras) ? ficheiro.leituras : []).filter((o) => !novas.some((n) => n.data === o.data));
leituras.push(...novas);
leituras.sort((a, b) => a.data.localeCompare(b.data));
await writeFile("dgeg-oficial.json", JSON.stringify({
  _nota: "Escrito pelo dgeg-oficial.mjs: média oficial da DGEG de cada segunda-feira (preço médio diário, gasóleo simples e gasolina simples 95). O override.json ganha sempre.",
  fonte: "https://precoscombustiveis.dgeg.gov.pt/estatistica/preco-medio-diario/",
  atualizado: new Date().toISOString(),
  leituras,
}, null, 2) + "\n");
for (const n of novas) console.log("dgeg-oficial: " + n.data + " gasóleo " + n.gasoleo + " gasolina " + n.gasolina + " (lido da DGEG)");
