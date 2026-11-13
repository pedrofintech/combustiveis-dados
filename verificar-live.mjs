// Verificação temporária (ramo ilhas-teste): abre a página publicada num Chromium do runner e confirma as ilhas.
import { chromium } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
const URL = "https://www.literaciafinanceira.pt/combustivel-mais-barato";
await mkdir("explorar/live", { recursive: true });
const rel = [];
const log = (k, v) => { rel.push(k + ": " + (typeof v === "string" ? v : JSON.stringify(v))); console.log(k, v); };
const browser = await chromium.launch();
async function abrir(extra = {}, hash = "") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "pt-PT", ...extra });
  const p = await ctx.newPage();
  const erros = [];
  p.on("pageerror", (e) => erros.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error" || /combustivel-mais-barato\]/.test(m.text())) erros.push(m.type() + ": " + m.text()); });
  await p.goto(URL + hash, { waitUntil: "load", timeout: 60000 });
  await p.waitForFunction(() => document.getElementById("lfcmb-resultados") && !document.getElementById("lfcmb-resultados").hidden, null, { timeout: 30000 });
  await p.waitForTimeout(2000);
  return { ctx, p, erros };
}
const estado = (p) => p.evaluate(() => ({
  titulo: document.getElementById("lfcmb-titulo").textContent,
  tag: document.getElementById("lfcmb-hora").hidden ? "(escondida)" : document.getElementById("lfcmb-hora").textContent,
  rotulos: [...document.querySelectorAll("#lfcmb-kpis .lfk-stat-l")].map((e) => e.textContent),
  kpis: document.getElementById("lfcmb-kpis").hidden ? null : ["lfcmb-k-min", "lfcmb-k-min-s", "lfcmb-k-media", "lfcmb-k-media-s", "lfcmb-k-poup", "lfcmb-k-poup-s"].map((id) => document.getElementById(id).textContent),
  tabela: !document.getElementById("lfcmb-tabela-wrap").hidden,
  alerta: document.getElementById("lfcmb-sem").hidden ? "" : document.getElementById("lfcmb-sem").textContent,
  frase: document.getElementById("lfcmb-frase").hidden ? "" : document.getElementById("lfcmb-frase").textContent,
  fonte: document.getElementById("lfcmb-fonte").textContent,
  links: [...document.querySelectorAll("#lfcmb-fonte a")].map((a) => a.href),
  botao: document.getElementById("lfcmb-ver").textContent.trim(),
  hash: location.hash,
  opcoes: [...document.querySelectorAll("#lfcmb-distrito option")].map((o) => o.textContent),
  script: [...document.scripts].map((s) => s.src).filter((s) => /combustivel-mais-barato/.test(s)),
}));
async function ver(p, distrito, comb) {
  if (comb) await p.click(`#lfcmb-comb button[data-comb="${comb}"]`);
  await p.selectOption("#lfcmb-distrito", distrito);
  await p.click("#lfcmb-ver");
  await p.waitForTimeout(800);
  return estado(p);
}
{
  const { ctx, p, erros } = await abrir();
  const e0 = await estado(p);
  log("script", e0.script); log("opcoes (fim)", e0.opcoes.slice(-4)); log("pais titulo", e0.titulo); log("pais frase", e0.frase);
  const m = await ver(p, "Madeira", "gasoleo"); log("madeira gasoleo", m);
  await p.screenshot({ path: "explorar/live/madeira.png", fullPage: false });
  await (await p.$("#lfcmb-resultados")).screenshot({ path: "explorar/live/madeira-cartao.png" });
  log("madeira gasolina", await ver(p, "Madeira", "gasolina"));
  log("madeira gpl", await ver(p, "Madeira", "gpl"));
  const a = await ver(p, "Açores", "gasoleo"); log("acores gasoleo", a);
  await (await p.$("#lfcmb-resultados")).screenshot({ path: "explorar/live/acores-cartao.png" });
  const porto = await ver(p, "Porto", "gasoleo"); log("porto (repõe)", { titulo: porto.titulo, rotulos: porto.rotulos, tabela: porto.tabela, botao: porto.botao, tag: porto.tag });
  log("erros consola", erros);
  await ctx.close();
}
{
  const { ctx, p, erros } = await abrir({}, "#gasolina/acores");
  log("link #gasolina/acores", await estado(p));
  log("erros consola (link)", erros);
  await ctx.close();
}
{
  const { ctx, p, erros } = await abrir({ geolocation: { latitude: 32.65, longitude: -16.91 }, permissions: ["geolocation"] });
  await p.selectOption("#lfcmb-distrito", "__perto");
  await p.dispatchEvent("#lfcmb-distrito", "input");
  await p.waitForFunction(() => /Madeira/.test(document.getElementById("lfcmb-titulo").textContent), null, { timeout: 15000 });
  const e = await estado(p); log("perto de mim no Funchal", { titulo: e.titulo, frase: e.frase.slice(0, 120), kpis: e.kpis });
  log("erros consola (perto)", erros);
  await ctx.close();
}
{
  const { ctx, p } = await abrir({ viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
  await ver(p, "Madeira", "gasoleo");
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  log("movel scroll", w);
  await (await p.$("#lfcmb-resultados")).screenshot({ path: "explorar/live/madeira-movel.png" });
  await ctx.close();
}
await browser.close();
await writeFile("explorar/live/relatorio.txt", rel.join("\n") + "\n");
