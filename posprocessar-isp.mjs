// Pos-processamento do combustiveis.json - corre no workflow depois do update-combustiveis.mjs.
// 1) Aplica o override.json quando pertence a semana em curso (alavanca manual para incidentes como o de 14 ago 2026)
// 2) Recalcula a ultima barra "previsto" do historico para bater certo com a variacao final
// A detecao automatica das portarias do ISP liga aqui num passo futuro - ver isp-overlay.mjs e isp-estado.json.
import { readFile, writeFile } from "node:fs/promises";
const F = "combustiveis.json";
const dados = JSON.parse(await readFile(F, "utf8"));
let mudou = false;
try { const ov = JSON.parse(await readFile("override.json", "utf8")); if (ov.semanaInicio === dados.semanaInicio) { Object.assign(dados, ov); mudou = true; console.log("override aplicado: " + ov.semanaInicio); } else { console.log("override ignorado (semana diferente)"); } } catch { console.log("sem override.json"); }
const h = dados.historico;
if (mudou && Array.isArray(h) && h.length && h[h.length - 1].previsto) { const u = h[h.length - 1]; u.gasoleo = +(dados.gasoleo.atual + dados.gasoleo.variacao).toFixed(3); u.gasolina = +(dados.gasolina.atual + dados.gasolina.variacao).toFixed(3); }
if (mudou) { await writeFile(F, JSON.stringify(dados, null, 2) + "\n"); console.log("combustiveis.json atualizado pelo pos-processamento"); }
