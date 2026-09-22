// placar.mjs - fecha o placar do modelo contra o setor, sem intervencao manual.
// Corre no workflow depois do previsao-propria.mjs. Faz duas coisas:
// 1) No precisao-log.csv, preenche real_gasoleo/real_gasolina (em centimos) nas linhas cuja semana-alvo ja tem leitura
//    oficial da DGEG (e leitura oficial da segunda anterior), usando as mesmas fontes do modelo (semente, dgeg-oficial.json, override.json).
// 2) Escreve dados.placar no combustiveis.json: erro medio absoluto do modelo e do setor, numero de semanas e vitorias,
//    para a pagina poder mostrar o historico de acertos sem ninguem ter de o calcular a mao.
// So escreve ficheiros quando algo muda; se falhar, nao toca em nada.
import { readFile, writeFile } from "node:fs/promises";
import { carregarOficiais } from "./previsao-propria.mjs";

const LOG = "precisao-log.csv";
const arred = (n, c = 1) => Number(Number(n).toFixed(c));
const num = (s) => { const v = Number(String(s).replace(",", ".")); return Number.isFinite(v) ? v : null; };

async function principal() {
  let texto;
  try { texto = await readFile(LOG, "utf8"); } catch { console.log("placar: sem " + LOG); return; }
  const linhas = texto.split("\n").filter((l) => l.trim());
  if (linhas.length < 2) { console.log("placar: log vazio"); return; }
  const cab = linhas[0].split(";");
  const idx = (n) => cab.indexOf(n);
  const iAlvo = idx("semanaAlvo"), iRg = idx("real_gasoleo"), iRa = idx("real_gasolina");
  if (iAlvo < 0 || iRg < 0 || iRa < 0) { console.log("placar: cabecalho inesperado"); return; }

  const { oficiais } = await carregarOficiais();
  const datas = Object.keys(oficiais).sort();
  let mudouLog = false;
  const filas = linhas.slice(1).map((l) => l.split(";"));
  for (const f of filas) {
    if (f[iRg] !== "?" && f[iRg] !== "" && f[iRa] !== "?" && f[iRa] !== "") continue;
    const alvo = f[iAlvo];
    const anterior = datas.filter((d) => d < alvo).pop();
    if (!oficiais[alvo] || !anterior) continue;
    f[iRg] = String(arred((oficiais[alvo].gasoleo - oficiais[anterior].gasoleo) * 100));
    f[iRa] = String(arred((oficiais[alvo].gasolina - oficiais[anterior].gasolina) * 100));
    mudouLog = true;
    console.log(" real preenchido para " + alvo + ": gasoleo " + f[iRg] + " gasolina " + f[iRa]);
  }
  if (mudouLog) await writeFile(LOG, [cab.join(";"), ...filas.map((f) => f.join(";"))].join("\n") + "\n");

  // Placar: so linhas com real conhecido; o setor conta so quando o espelho dessa semana foi apanhado
  const iPg = idx("propria_gasoleo"), iPa = idx("propria_gasolina"), iMg = idx("mirror_gasoleo"), iMa = idx("mirror_gasolina");
  const det = [];
  for (const f of filas) {
    const rg = num(f[iRg]), ra = num(f[iRa]), pg = num(f[iPg]), pa = num(f[iPa]);
    if (rg === null || ra === null || pg === null || pa === null) continue;
    const mg = num(f[iMg]), ma = num(f[iMa]);
    det.push({ semana: f[iAlvo], gasoleo: { modelo: pg, setor: mg, real: rg }, gasolina: { modelo: pa, setor: ma, real: ra } });
  }
  if (!det.length) { console.log("placar: ainda sem semanas fechadas"); return; }
  const media = (xs) => xs.length ? arred(xs.reduce((a, b) => a + b, 0) / xs.length, 2) : null;
  const errM = { gasoleo: [], gasolina: [] }, errS = { gasoleo: [], gasolina: [] };
  const vit = { modelo: 0, setor: 0, empates: 0 };
  for (const d of det) for (const c of ["gasoleo", "gasolina"]) {
    const eM = Math.abs(d[c].modelo - d[c].real); errM[c].push(eM);
    if (d[c].setor !== null) { const eS = Math.abs(d[c].setor - d[c].real); errS[c].push(eS); if (eM < eS - 0.05) vit.modelo++; else if (eS < eM - 0.05) vit.setor++; else vit.empates++; }
  }
  const placar = {
    atualizado: new Date().toISOString().slice(0, 10),
    semanas: det.length,
    semanasComSetor: Math.max(errS.gasoleo.length, errS.gasolina.length),
    gasoleo: { erroMedioModelo: media(errM.gasoleo), erroMedioSetor: media(errS.gasoleo) },
    gasolina: { erroMedioModelo: media(errM.gasolina), erroMedioSetor: media(errS.gasolina) },
    vitorias: vit,
    ultimas: det.slice(-8)
  };
  const dados = JSON.parse(await readFile("combustiveis.json", "utf8"));
  const antes = JSON.stringify(dados.placar || null);
  const depois = JSON.stringify(placar);
  if (antes !== depois) { dados.placar = placar; await writeFile("combustiveis.json", JSON.stringify(dados, null, 2) + "\n"); console.log(" placar atualizado: " + det.length + " semanas, modelo " + placar.gasoleo.erroMedioModelo + "/" + placar.gasolina.erroMedioModelo + " vs setor " + placar.gasoleo.erroMedioSetor + "/" + placar.gasolina.erroMedioSetor); }
  else console.log(" placar sem alteracoes");
}

principal().catch((e) => console.log("placar falhou (nada foi alterado): " + (e && e.message ? e.message : e)));
