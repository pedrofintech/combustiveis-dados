// Teste temporário (ramo ilhas-teste): corre os leitores do ilhas-precos.mjs sobre os despachos de 2026 e alguns dos Açores
// de 2024-2026, para ver se o texto dos despachos muda de semana para semana. Escreve explorar/historico.txt.
import { writeFile, mkdtemp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { lerMadeira, lerAcores } from "./ilhas-precos.mjs";
const UA = "Mozilla/5.0 (compatible; LF-combustiveis/1.0; +https://www.literaciafinanceira.pt)";
const out = [];
const log = (s) => { console.log(s); out.push(s); };
const dir = await mkdtemp(path.join(tmpdir(), "hist-"));
async function texto(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  const f = path.join(dir, "d.pdf");
  await writeFile(f, Buffer.from(await r.arrayBuffer()));
  return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", f, "-"], { encoding: "utf8", maxBuffer: 1 << 26 });
}
// Madeira: semanas de 2026 - ficheiros de quinta e sexta (e quarta, por causa dos feriados), até achar o despacho da semana
const pasta = "https://joram.madeira.gov.pt/joram/2serie/Ano%20de%202026/";
const listagem = await (await fetch(pasta, { headers: { "User-Agent": UA } })).text();
const nomes = [...new Set([...listagem.matchAll(/href="(IISerie-\d{3}-(\d{4}-\d{2}-\d{2})[A-Za-z0-9]*\.pdf)"/g)].map((m) => m[1]))].sort();
const porSemana = new Map();
for (const n of nomes) {
  const d = n.match(/(\d{4}-\d{2}-\d{2})/)[1], dt = new Date(d + "T12:00:00Z"), dow = dt.getUTCDay();
  if (![3, 4, 5].includes(dow)) continue;
  const seg = new Date(dt); seg.setUTCDate(dt.getUTCDate() + ((8 - dow) % 7)); const k = seg.toISOString().slice(0, 10);
  if (!porSemana.has(k)) porSemana.set(k, []);
  porSemana.get(k).push(n);
}
let semanas = 0, achadas = 0;
for (const [segunda, fich] of [...porSemana.entries()].sort()) {
  if (segunda < "2026-03-01") continue; // de março em diante chega para o teste
  semanas++;
  // primeiro sexta, depois quinta, depois quarta; dentro do dia, suplementos do último para o primeiro
  fich.sort((a, b) => b.localeCompare(a));
  let achou = false;
  for (const f of fich) {
    let t; try { t = await texto(pasta + f); } catch (e) { log(`M ${segunda} ${f} ERRO ${e.message}`); continue; }
    if (!t) continue;
    const r = lerMadeira(t);
    const fala = /pre[çc]os\s+m[áa]ximos\s+de\s+venda\s+ao\s+p[úu]blico/i.test(t.replace(/\s+/g, " "));
    if (r.length) { for (const a of r) log(`M ${segunda} ${f} -> ${a.ato} desde ${a.desde} gasolina ${a.gasolina} gasoleo ${a.gasoleo}${a.desde && a.gasolina && a.gasoleo ? "" : "  <-- INCOMPLETO"}`); achou = true; achadas++; break; }
    if (fala) log(`M ${segunda} ${f} fala de preços máximos mas não li nada  <-- VER`);
  }
  if (!achou) log(`M ${segunda} sem despacho nos ficheiros de qua-sex (${fich.length})`);
}
log(`Madeira: ${achadas} de ${semanas} semanas`);
// Açores: despachos conhecidos (2024-2026) e jornais da I série de 2026 do n.º 100 ao 138
for (const u of ["31-I-Despacho_Normativo-2024-10-30", "23-I-Despacho_Normativo-2024-08-28", "4-I-Despacho_Normativo-2025-01-31", "30-I-Despacho_Normativo-2026-09-28"]) {
  try { const t = await texto(`https://jo.azores.gov.pt/pdf/atos/${u}.pdf`); log(`A ${u} -> ${t ? JSON.stringify(lerAcores(t)) : "404"}`); } catch (e) { log(`A ${u} ERRO ${e.message}`); }
}
for (let n = 100; n <= 138; n++) {
  const f = `I-2026-${String(n).padStart(3, "0")}-S0.pdf`;
  try {
    const t = await texto("https://jo.azores.gov.pt/pdf/jornais/" + f);
    if (!t) { log(`A ${f} 404`); continue; }
    const r = lerAcores(t);
    const fala = /pre[çc]os\s+m[áa]ximos\s+de\s+venda\s+ao\s+p[úu]blico\s+dos\s+combust/i.test(t.replace(/\s+/g, " "));
    const cab = t.replace(/\s+/g, " ").match(/I S[ÉE]RIE\s+N\.?\s*[º°o]\s*\d+\s+([A-ZÇÁÉÍÓÚÃÕÂÊÔ-]+,\s*\d{1,2} DE [A-ZÇÃ]+ DE \d{4})/i);
    if (r.length || fala) log(`A ${f} (${cab ? cab[1] : "?"}) -> ${JSON.stringify(r)}${fala && !r.length ? "  <-- VER" : ""}`);
  } catch (e) { log(`A ${f} ERRO ${e.message}`); }
}
await writeFile("explorar/historico.txt", out.join("\n") + "\n");
