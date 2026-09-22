// registar-dgeg.mjs - regista a media oficial da DGEG de uma segunda-feira no override.json (historicoOficial).
// Corre no workflow "Registar leitura DGEG" (Actions > Run workflow), com os tres campos: data, gasoleo, gasolina.
// Uso local: node registar-dgeg.mjs 2026-09-21 2,230 2,130   (virgula ou ponto, tanto faz)
import { readFile, writeFile } from "node:fs/promises";

const [data, g, a] = process.argv.slice(2).map((s) => String(s || "").trim());
const num = (s) => Number(s.replace(",", "."));
const gasoleo = num(g), gasolina = num(a);
if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { console.log("data invalida (usar AAAA-MM-DD): " + data); process.exit(1); }
if (new Date(data + "T00:00:00Z").getUTCDay() !== 1) { console.log("a data " + data + " nao e uma segunda-feira"); process.exit(1); }
if (!(gasoleo > 1 && gasoleo < 3) || !(gasolina > 1 && gasolina < 3)) { console.log("precos fora do intervalo plausivel (1 a 3 euros): gasoleo " + g + " gasolina " + a); process.exit(1); }

let ov = {};
try { ov = JSON.parse(await readFile("override.json", "utf8")); } catch { /* primeira vez */ }
if (!Array.isArray(ov.historicoOficial)) ov.historicoOficial = [];
const i = ov.historicoOficial.findIndex((o) => o && o.data === data);
const linha = { data, gasolina: +gasolina.toFixed(3), gasoleo: +gasoleo.toFixed(3) };
if (i >= 0) ov.historicoOficial[i] = linha; else ov.historicoOficial.push(linha);
ov.historicoOficial.sort((x, y) => x.data.localeCompare(y.data));
await writeFile("override.json", JSON.stringify(ov, null, 2) + "\n");
console.log("override.json: " + data + " gasoleo " + linha.gasoleo + " gasolina " + linha.gasolina + (i >= 0 ? " (substituido)" : " (novo)"));
