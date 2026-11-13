// Exploração temporária (ramo ilhas-teste): como encontrar os despachos dos preços máximos das ilhas.
import { writeFile, mkdir } from "node:fs/promises";
const UA = "Mozilla/5.0 (compatible; LF-combustiveis/1.0; +https://www.literaciafinanceira.pt)";
const out = [];
const log = (...a) => { const s = a.join(" "); console.log(s); out.push(s); };
await mkdir("explorar", { recursive: true });
async function get(url, opts = {}) {
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method: opts.method || "GET", headers: { "User-Agent": UA, Accept: opts.accept || "*/*" }, signal: AbortSignal.timeout(opts.ms || 40000), redirect: "follow" });
    const buf = Buffer.from(await r.arrayBuffer());
    log(`${opts.method || "GET"} ${url} -> ${r.status} [${r.headers.get("content-type")}] ${buf.length}B ${Date.now() - t0}ms${r.url !== url ? " final=" + r.url : ""}`);
    return { status: r.status, ct: r.headers.get("content-type") || "", buf, txt: buf.toString("utf8"), url: r.url };
  } catch (e) { log(`${opts.method || "GET"} ${url} -> ERRO ${e.name}: ${e.message}`); return null; }
}
const links = (html, base) => [...new Set([...html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)].map((m) => { try { return new URL(m[1].trim(), base).href; } catch { return m[1]; } }))];
const guardar = async (nome, conteudo) => { await writeFile("explorar/" + nome, conteudo); log("  gravado explorar/" + nome); };

// ---------- Madeira: JORAM ----------
log("\n===== JORAM =====");
for (const u of ["https://joram.madeira.gov.pt/", "https://joram.madeira.gov.pt/joram/", "https://joram.madeira.gov.pt/joram/2serie/",
  "https://joram.madeira.gov.pt/joram/2serie/Ano%20de%202026/", "https://joram.madeira.gov.pt/joram/IIserie/Ano%20de%202026/"]) {
  const r = await get(u);
  if (r && /html/i.test(r.ct)) {
    const l = links(r.txt, r.url);
    log("  title:", (r.txt.match(/<title[^>]*>([^<]*)/i) || [])[1] || "-", "| links:", l.length);
    log("  " + l.slice(0, 120).join("\n  "));
    await guardar("joram-" + u.replace(/[^a-z0-9]+/gi, "_").slice(8, 60) + ".html", r.txt);
  }
}
const pdfM = "https://joram.madeira.gov.pt/joram/2serie/Ano%20de%202026/IISerie-202-2026-11-06Supl3.pdf";
const rm = await get(pdfM);
if (rm && rm.status === 200) await guardar("joram-202-supl3.pdf", rm.buf);
await get(pdfM.replace("/2serie/", "/IIserie/"), { method: "HEAD" });
// números à volta: que nomes existem para o dia 13 nov (sexta) e 12 nov?
for (const n of [203, 204, 205, 206, 207]) for (const d of ["2026-11-12", "2026-11-13"]) for (const s of ["", "Supl", "Supl2", "Supl3"]) {
  const u = `https://joram.madeira.gov.pt/joram/2serie/Ano%20de%202026/IISerie-${n}-${d}${s}.pdf`;
  try { const r = await fetch(u, { method: "HEAD", headers: { "User-Agent": UA }, signal: AbortSignal.timeout(15000) }); if (r.status !== 404) log(`HEAD ${u} -> ${r.status} ${r.headers.get("content-length")}`); } catch (e) { log(`HEAD ${u} -> ERRO ${e.message}`); }
}

// ---------- Madeira: DREC (madeira.gov.pt) ----------
log("\n===== DREC =====");
for (const u of ["https://www.madeira.gov.pt/drec", "https://www.madeira.gov.pt/drec/Estrutura/Com%C3%A9rcio"]) {
  const r = await get(u);
  if (r && /html/i.test(r.ct)) {
    const l = links(r.txt, r.url).filter((x) => /ombust|omercio|om%C3%A9rcio|ercado|reco|re%C3%A7o/i.test(x));
    log("  links relevantes:", l.length, "\n  " + l.slice(0, 80).join("\n  "));
    await guardar("drec-" + u.replace(/[^a-z0-9]+/gi, "_").slice(8, 50) + ".html", r.txt);
  }
}

// ---------- Açores: Jornal Oficial (API pública) ----------
log("\n===== JO Açores =====");
const JO = "https://jo.azores.gov.pt/api/public";
const DN = "e9d5f7b5-f417-4f5a-9591-f25da52ecd54"; // tipo de ato "Despacho Normativo"
const j1 = await get(`${JO}/search/jornal?page=1&pageSize=100`, { accept: "application/json" });
if (j1 && j1.status === 200) {
  await guardar("jo-jornais.json", j1.txt);
  const d = JSON.parse(j1.txt);
  log("  resultSize", d.resultSize, "primeiro", d.list[0]?.dataPublicacao, "último", d.list.at(-1)?.dataPublicacao);
  for (const jn of d.list) for (const e of jn.entidades || []) for (const a of e.atos || [])
    if (/combust|pre[çc]os? m[áa]x/i.test(a.sumario || "")) log("  *", jn.dataPublicacao, "|", jn.descricaoPublicacao, "|", a.humanId, "|", a.sumario, "|", a.id);
}
for (const o of ["0", "1", "2", "3"]) {
  const r = await get(`${JO}/search/ato?` + new URLSearchParams({ searchText: "preços máximos de venda ao público", tipoAto: DN, page: 1, pageSize: 8, ordenacao: o }), { accept: "application/json" });
  if (r && r.status === 200) { const d = JSON.parse(r.txt); log("  ordenacao", o, "resultSize", d.resultSize); for (const a of d.list || []) log("   -", a.humanId, "|", a.dataPorExtensoJornal, "|", (a.sumario || "").slice(0, 110), "|", a.id); }
}
for (const [f, t] of [["2026-10-01", "2026-11-13"], ["01-10-2026", "13-11-2026"], ["2026-10-01T00:00:00Z", "2026-11-13T23:59:59Z"], [String(Date.UTC(2026, 9, 1)), String(Date.UTC(2026, 10, 13))]]) {
  const r = await get(`${JO}/search/ato?` + new URLSearchParams({ searchText: "combustíveis", tipoAto: DN, page: 1, pageSize: 8, ordenacao: "0", fromDate: f, toDate: t }), { accept: "application/json" });
  if (r && r.status === 200) { const d = JSON.parse(r.txt); log("  datas", f, t, "resultSize", d.resultSize); for (const a of d.list || []) log("   -", a.humanId, "|", (a.sumario || "").slice(0, 110), "|", a.id); }
}
const p33 = await get("https://jo.azores.gov.pt/pdf/atos/33-I-Despacho_Normativo-2026-10-30.pdf");
if (p33 && p33.status === 200) await guardar("jo-dn33-2026.pdf", p33.buf);
const p32 = await get("https://jo.azores.gov.pt/pdf/atos/32-I-Despacho_Normativo-2026-10-30.pdf");
if (p32 && p32.status === 200) await guardar("jo-dn32-2026.pdf", p32.buf);

await writeFile("explorar/log.txt", out.join("\n") + "\n");
