// enviar-previsao.mjs - compoe o email semanal com a previsao para as redacoes (Leak e quem mais disser que sim).
// Corre no workflow enviar-previsao.yml a quinta-feira. Nao envia nada: escreve email-assunto.txt, email-corpo.txt e email-para.txt
// e diz ao workflow (GITHUB_OUTPUT: enviar=sim|nao, motivo=...) se a previsao esta em condicoes de sair.
// Guardas: so sai se a previsao for do modelo, para a proxima segunda-feira, atualizada hoje e medida contra uma base oficial recente.
// Se alguma falhar, o workflow avisa geral@literaciafinanceira.pt em vez de mandar numeros errados para fora.
import { readFile, writeFile, appendFile } from "node:fs/promises";

const iso = (d) => d.toISOString().slice(0, 10);
const hoje = new Date();
const proximaSegunda = (() => { const x = new Date(hoje); x.setUTCHours(0, 0, 0, 0); const dow = x.getUTCDay(); const dias = dow === 1 ? 7 : ((8 - dow) % 7); x.setUTCDate(x.getUTCDate() + dias); return iso(x); })();
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const pt = (n, casas) => n.toFixed(casas).replace(".", ",");
const sinal = (n, casas) => (n > 0 ? "+" : n < 0 ? "-" : "") + pt(Math.abs(n), casas);
const diasEntre = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

async function saida(chave, valor) { if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, chave + "=" + valor + "\n"); console.log(chave + "=" + valor); }

async function principal() {
  const d = JSON.parse(await readFile("combustiveis.json", "utf8"));
  const dest = JSON.parse(await readFile("destinatarios.json", "utf8"));
  const problemas = [];
  if (d.fonte !== "modelo-proprio") problemas.push("fonte e " + d.fonte + ", nao modelo-proprio");
  if (d.semanaInicio !== proximaSegunda) problemas.push("semanaInicio " + d.semanaInicio + " nao e a proxima segunda (" + proximaSegunda + ")");
  if (d.atualizado !== iso(hoje)) problemas.push("atualizado a " + d.atualizado + ", nao hoje");
  if (!d.baseConfirmada || !d.baseData) problemas.push("base nao confirmada");
  else if (diasEntre(d.baseData, proximaSegunda) > 7) problemas.push("base oficial de " + d.baseData + " e demasiado antiga para " + proximaSegunda + " (falta a leitura DGEG da ultima segunda)");
  for (const c of ["gasoleo", "gasolina"]) {
    const x = d[c];
    if (!x || !Number.isFinite(x.atual) || !Number.isFinite(x.variacao) || !x.intervalo || !Number.isFinite(x.intervalo.min) || !Number.isFinite(x.intervalo.max)) problemas.push(c + " sem variacao/intervalo");
  }
  if (problemas.length) { await saida("enviar", "nao"); await saida("motivo", problemas.join("; ")); return; }

  const seg = new Date(d.semanaInicio + "T00:00:00Z");
  const dataCurta = String(seg.getUTCDate()).padStart(2, "0") + "/" + String(seg.getUTCMonth() + 1).padStart(2, "0");
  const dataLonga = seg.getUTCDate() + " de " + MESES[seg.getUTCMonth()];
  const g = d.gasoleo, a = d.gasolina;
  const gc = g.variacao * 100, ac = a.variacao * 100;
  const linha = (nome, x, cts) => nome + ": " + sinal(cts, 1) + " cts/L (intervalo " + sinal(x.intervalo.min, 1) + " a " + sinal(x.intervalo.max, 1) + "). Preço médio esperado: " + pt(x.atual + x.variacao, 3) + " €/L.";
  const janela = d.modelo && d.modelo.janelaCompleta === false ? "\nNota: previsão feita com " + d.modelo.diasDeCotacoes + " dias de cotações; a página atualiza-se todos os dias até domingo." : "";

  const assunto = "Combustíveis para segunda, " + dataCurta + ": gasóleo " + sinal(gc, 1) + " cts, gasolina " + sinal(ac, 1) + " cts";
  const corpo = [
    dest.saudacao || "Bom dia,",
    "",
    "Previsão do Literacia Financeira para segunda-feira, " + dataLonga + ":",
    "",
    linha("Gasóleo simples", g, gc),
    linha("Gasolina 95", a, ac),
    "Depósito de 50 L: " + sinal(g.variacao * 50, 2) + " € no gasóleo, " + sinal(a.variacao * 50, 2) + " € na gasolina." + janela,
    "",
    "Confirmação com as médias oficiais da DGEG na segunda-feira, na página: https://www.literaciafinanceira.pt/precos-combustiveis",
    "Fonte a citar: LiteraciaFinanceira.pt",
    "",
    dest.assinatura || "Abraço,\nPedro"
  ].join("\n");

  await writeFile("email-assunto.txt", assunto + "\n");
  await writeFile("email-corpo.txt", corpo + "\n");
  await writeFile("email-para.txt", (dest.para || []).join(",") + "\n");
  await writeFile("email-cc.txt", (dest.cc || []).join(",") + "\n");
  await saida("enviar", "sim");
  await saida("assunto", assunto);
  await saida("para", (dest.para || []).join(","));
  await saida("cc", (dest.cc || []).join(","));
  console.log("\n" + assunto + "\n\n" + corpo);
}

principal().catch(async (e) => { await saida("enviar", "nao"); await saida("motivo", "erro: " + (e && e.message ? e.message : e)); });
