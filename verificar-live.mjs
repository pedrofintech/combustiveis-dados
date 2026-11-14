// Verificação temporária (ramo ilhas-teste): a Madeira mostra o preço da semana seguinte na página publicada?
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
const URL = "https://www.literaciafinanceira.pt/combustivel-mais-barato";
await mkdir("explorar/live2", { recursive: true });
const rel = [];
const log = (k, v) => { rel.push(k + ": " + (typeof v === "string" ? v : JSON.stringify(v))); console.log(k, v); };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-PT", timezoneId: "Europe/Lisbon" });
const p = await ctx.newPage();
const erros = [];
p.on("pageerror", (e) => erros.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error" || /combustivel-mais-barato\]/.test(m.text())) erros.push(m.type() + ": " + m.text()); });
await p.goto(URL + "?v=" + Date.now(), { waitUntil: "load", timeout: 60000 });
await p.waitForFunction(() => document.getElementById("lfcmb-resultados") && !document.getElementById("lfcmb-resultados").hidden, null, { timeout: 30000 });
await p.waitForTimeout(1500);
const estado = () => p.evaluate(() => ({
  titulo: document.getElementById("lfcmb-titulo").textContent,
  tag: document.getElementById("lfcmb-hora").textContent,
  kpis: document.getElementById("lfcmb-kpis").hidden ? null : ["lfcmb-k-min", "lfcmb-k-media", "lfcmb-k-poup"].map((id) => document.getElementById(id).textContent),
  frase: document.getElementById("lfcmb-frase").textContent,
  fonte: document.getElementById("lfcmb-fonte").textContent,
}));
for (const comb of ["gasoleo", "gasolina"]) {
  await p.click(`#lfcmb-comb button[data-comb="${comb}"]`);
  await p.selectOption("#lfcmb-distrito", "Madeira");
  await p.click("#lfcmb-ver");
  await p.waitForTimeout(800);
  log("madeira " + comb, await estado());
}
await (await p.$("#lfcmb-resultados")).screenshot({ path: "explorar/live2/madeira-gasolina.png" });
log("erros consola", erros);
await browser.close();
await writeFile("explorar/live2/relatorio.txt", rel.join("\n") + "\n");
