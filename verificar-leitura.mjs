// verificar-leitura.mjs - falha (exit 1) quando a leitura oficial da DGEG da segunda-feira desta semana ainda nao esta registada.
// Corre no workflow "Aviso: falta a leitura DGEG" (terca ao fim do dia, quarta e quinta de manha): o GitHub manda email quando o workflow falha.
// Nao mexe em ficheiros. As leituras vem dos mesmos sitios que o modelo usa (semente, dgeg-oficial.json, override.json).
import { carregarOficiais } from "./previsao-propria.mjs";

const hoje = new Date();
const seg = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
seg.setUTCDate(seg.getUTCDate() - ((seg.getUTCDay() + 6) % 7));
const data = seg.toISOString().slice(0, 10);
const { oficiais } = await carregarOficiais();
if (!oficiais[data]) {
  console.log("FALTA a leitura oficial da DGEG de segunda-feira, " + data + ". Regista-a em Actions > Registar leitura DGEG > Run workflow.");
  console.log("Ate la a pagina usa uma base provisoria (estimativa do modelo) e o email as redacoes nao sai.");
  process.exit(1);
}
console.log("Leitura de " + data + " registada: gasoleo " + oficiais[data].gasoleo + ", gasolina " + oficiais[data].gasolina + ".");
