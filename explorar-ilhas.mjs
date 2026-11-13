// Exploração temporária (ramo ilhas-teste), 2.ª volta: os PDFs dos jornais da I série dos Açores (ficheiros públicos)
// e o pdftotext no runner. Sem a API (responde 403 aos runners e não é para usar).
import { writeFile, mkdir } from "node:fs/promises";
import { execSync } from "node:child_process";
const UA = "Mozilla/5.0 (compatible; LF-combustiveis/1.0; +https://www.literaciafinanceira.pt)";
const out = [];
const log = (...a) => { const s = a.join(" "); console.log(s); out.push(s); };
await mkdir("explorar", { recursive: true });
try { log("pdftotext:", execSync("command -v pdftotext; pdftotext -v 2>&1 | head -1", { encoding: "utf8" }).trim()); } catch { log("pdftotext: não existe"); }
async function pedir(url, method = "GET") {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method, headers: { "User-Agent": UA }, signal: AbortSignal.timeout(40000) });
    const buf = Buffer.from(await r.arrayBuffer());
    log(`${method} ${url} -> ${r.status} [${r.headers.get("content-type")}] ${method === "HEAD" ? r.headers.get("content-length") : buf.length}B ${Date.now() - t0}ms`);
    return { status: r.status, buf };
  } catch (e) { log(`${method} ${url} -> ERRO ${e.name}: ${e.message}`); return null; }
}
const JO = "https://jo.azores.gov.pt/pdf/jornais/";
const j139 = await pedir(JO + "I-2026-139-S0.pdf");
if (j139 && j139.status === 200) await writeFile("explorar/jo-I-2026-139-S0.pdf", j139.buf);
for (let n = 140; n <= 148; n++) await pedir(JO + `I-2026-${n}-S0.pdf`, "HEAD");
for (const s of ["S1", "S2"]) { await pedir(JO + `I-2026-146-${s}.pdf`, "HEAD"); await pedir(JO + `I-2026-139-${s}.pdf`, "HEAD"); }
await pedir("https://jo.azores.gov.pt/pdf/atos/", "GET");
await writeFile("explorar/log2.txt", out.join("\n") + "\n");
