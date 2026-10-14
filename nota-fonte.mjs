// nota-fonte.mjs - escreve no combustiveis.json a linha de fonte da DGEG que a página mostra por baixo do estado.
// Condições da DGEG para usar o preço médio diário (email de 14 out 2026): identificar a DGEG como fonte,
// indicar a data dos dados e reproduzi-los de forma fiel e não enganosa.
// Corre no fim do passo "Atualizar dados" dos workflows, depois do posprocessar-isp.mjs.
// A página mostra o campo notaIsp por baixo da linha de estado. A linha da fonte vai dentro de <span data-fonte>,
// para ser substituída em cada corrida sem apagar uma nota do ISP que o override.json tenha posto.
import { readFile, writeFile } from "node:fs/promises";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const dataLonga = (iso) => { const d = new Date(iso + "T00:00:00Z"); return d.getUTCDate() + " de " + MESES[d.getUTCMonth()] + " de " + d.getUTCFullYear(); };
const valida = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const DGEG = '<a href="https://precoscombustiveis.dgeg.gov.pt/estatistica/preco-medio-diario/" target="_blank" rel="noopener" class="blue-link">DGEG</a> (Direção-Geral de Energia e Geologia)';
const fonte = (iso) => DGEG + ", preço médio diário de segunda-feira, " + dataLonga(iso);

const d = JSON.parse(await readFile("combustiveis.json", "utf8"));
let linha = "";
if (d.fonte === "dgeg-confirmado" && d.confirmacao && valida(d.confirmacao.data)) {
  // Semana em vigor: os dois preços do cartão são médias da DGEG, a variação é a diferença entre elas
  linha = "Fonte: " + fonte(d.confirmacao.data) + ".";
} else if (valida(d.baseData)) {
  // Previsão: o preço de partida é da DGEG (ou a última leitura oficial, quando a base é provisória); o previsto é nosso
  linha = (d.baseConfirmada ? "Preço atual: " : "Última leitura oficial: ") + fonte(d.baseData) + ". O preço previsto é uma estimativa do nosso modelo.";
}

const resto = String(d.notaIsp || "").replace(/\s*<span data-fonte>[\s\S]*?<\/span>/g, "").trim();
const nota = [resto, linha && "<span data-fonte>" + linha + "</span>"].filter(Boolean).join(" ");
if (nota) d.notaIsp = nota; else delete d.notaIsp;
await writeFile("combustiveis.json", JSON.stringify(d, null, 2) + "\n");
console.log("nota-fonte: " + (linha ? linha.replace(/<[^>]+>/g, "") : "sem linha de fonte (sem datas da DGEG nos dados)"));
