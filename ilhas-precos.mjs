// ilhas-precos.mjs - preços máximos de venda ao público dos combustíveis na Madeira e nos Açores, lidos dos jornais
// oficiais das duas regiões. A DGEG só tem os postos de Portugal continental. Nas ilhas o preço não varia de posto para
// posto como no continente: é um preço máximo fixado pelo Governo Regional, e os postos não podem vender acima dele.
//   Madeira: muda todas as semanas. Despacho conjunto das Secretarias Regionais da Economia e das Finanças, publicado na
//            II série do Jornal Oficial (JORAM), normalmente à sexta, em vigor a partir das 0 horas de segunda.
//   Açores:  muda todos os meses. Despacho normativo na I série do Jornal Oficial, em vigor no dia 1.
// Nenhuma das duas regiões fixa preço para o GPL Auto (os Açores fixam o do butano, que não é o GPL dos carros).
//
// Escreve dois ficheiros:
//   ilhas.json         os últimos despachos de cada região (preços, entrada em vigor, despacho, jornal e link), lido pela
//                      página /combustivel-mais-barato, que escolhe o que está em vigor e o seguinte, se já for conhecido
//   ilhas-estado.json  os PDFs que já foram vistos, para não voltar a descarregá-los
//
// Como encontra os despachos (só ficheiros públicos):
//   Madeira: a pasta da II série de cada ano no site do JORAM tem listagem pública ("Index of /joram/2serie/Ano de 2026").
//            Vê os PDFs dos últimos DIAS_MADEIRA dias que ainda não viu e procura o despacho de homologação dos preços.
//   Açores:  os jornais da I série estão em https://jo.azores.gov.pt/pdf/jornais/I-AAAA-NNN-S0.pdf, numerados por ordem
//            (os suplementos são S1, S2...). Vê os números a seguir ao último visto até dar 404 e procura o despacho
//            normativo dos preços máximos. A API do Jornal Oficial dos Açores não responde aos servidores do GitHub e não
//            se usa.
//
// Verificações (um despacho que falhe não entra e o workflow falha, para o GitHub avisar por email):
//   - tem de ter o preço da gasolina 95 e do gasóleo rodoviário e a data de entrada em vigor;
//   - preços entre PRECO_MIN e PRECO_MAX €/L e a menos de MAX_DESVIO €/L da média dos postos do continente;
//   - entrada em vigor entre a data de publicação e 15 dias depois;
//   - variação face ao despacho anterior da mesma região abaixo de MAX_VARIACAO.
// O workflow também falha se uma região ficar sem preço do período em curso (ver atrasado()).
//
// Testes sem rede: node ilhas-precos.mjs --pdf madeira|acores ficheiro.pdf [ficheiro.pdf ...] mostra o que se lê de cada PDF.
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const UA = "Mozilla/5.0 (compatible; LF-combustiveis/1.0; +https://www.literaciafinanceira.pt)";
const F_ILHAS = "ilhas.json";
const F_ESTADO = "ilhas-estado.json";
const F_RESUMO = "postos-resumo.json";
const JORAM = "https://joram.madeira.gov.pt/joram/2serie/";
const JOA = "https://jo.azores.gov.pt/pdf/";
const DIAS_MADEIRA = 12; // PDFs da II série publicados nos últimos dias que se examinam (o despacho sai uma vez por semana)
const MAX_JORNAIS_ACORES = 20; // jornais da I série examinados numa corrida, no máximo
const MAX_PRECOS = 6; // despachos guardados por região
const PRECO_MIN = 1.2, PRECO_MAX = 3.2; // €/L
const MAX_DESVIO = 0.6; // €/L face à média dos postos do continente
const MAX_VARIACAO = { madeira: 0.35, acores: 0.6 }; // €/L face ao despacho anterior (uma semana / um mês)
const REGIOES = {
  madeira: { nome: "Madeira", jornal: "Jornal Oficial da Região Autónoma da Madeira", periodo: "semana" },
  acores: { nome: "Açores", jornal: "Jornal Oficial da Região Autónoma dos Açores", periodo: "mês" },
};
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
// alerta(): faz falhar o workflow (o GitHub avisa por email). aviso(): só fica no registo da corrida (falhas de rede
// passageiras; se durarem, a região fica atrasada e aí sim há alerta).
const alertas = [];
const alerta = (msg) => { alertas.push(msg); console.log("::error::" + msg); };
const aviso = (msg) => console.log("::warning::" + msg);

// ---------- utilitários ----------
const pad = (n) => String(n).padStart(2, "0");
const sem = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
function dataISO(dia, mes, ano) {
  const m = MESES.findIndex((x) => sem(x) === sem(mes)) + 1;
  const d = parseInt(dia, 10), a = parseInt(ano, 10);
  if (!m || !(d >= 1 && d <= 31) || !(a > 2000)) return null;
  return `${a}-${pad(m)}-${pad(d)}`;
}
const numero = (s) => Math.round(parseFloat(String(s).replace(/\s/g, "").replace(",", ".")) * 1000) / 1000;
const diasEntre = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
function hoje(fuso) {
  const agora = process.env.LF_AGORA ? new Date(process.env.LF_AGORA) : new Date();
  return new Intl.DateTimeFormat("en-CA", { timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit" }).format(agora);
}
async function lerJSON(f, def) { try { return JSON.parse(await readFile(f, "utf8")); } catch { return def; } }

async function pedir(url, { method = "GET", tentativas = 2 } = {}) {
  let ultimo;
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(url, { method, headers: { "User-Agent": UA }, signal: AbortSignal.timeout(60000), redirect: "follow" });
      if (r.status === 404) return { status: 404 };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return { status: r.status, buf: method === "HEAD" ? null : Buffer.from(await r.arrayBuffer()) };
    } catch (e) { ultimo = e; if (i + 1 < tentativas) await new Promise((s) => setTimeout(s, 5000)); }
  }
  throw new Error(`${url}: ${ultimo?.message || ultimo}`);
}

let pastaTemp = null;
async function textoPDF(buf) {
  if (!pastaTemp) pastaTemp = await mkdtemp(path.join(tmpdir(), "ilhas-"));
  const f = path.join(pastaTemp, "doc.pdf");
  await writeFile(f, buf);
  if (buf.subarray(0, 5).toString() !== "%PDF-") throw new Error("o ficheiro não é um PDF");
  // stderr calado: alguns jornais dos Açores dão dezenas de avisos de sintaxe ao pdftotext, sem efeito no texto
  return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", f, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] }).replace(/\u00a0/g, " ");
}

// Divide o texto do pdftotext nos atos: cada ato começa numa linha que só tem o título ("Despacho Conjunto n.º 101/2026",
// "Despacho Normativo n.º 33/2026 de 30 de outubro de 2026"). As referências a outros atos no meio do texto ("da Portaria
// n.º 25/2022, de 26 de janeiro") não dividem. O sumário da capa também cita o ato: esse pedaço não tem os preços nem a
// data de entrada em vigor e os leitores põem-no de parte.
function pedacos(texto, reTitulo) {
  const out = [];
  let atual = null;
  for (const linha of texto.split(/\r?\n/)) {
    const m = linha.match(reTitulo);
    if (m) { atual = { tipo: m[1].replace(/\s+/g, " "), num: m[2], ano: m[3], linhas: [linha] }; out.push(atual); }
    else if (atual) atual.linhas.push(linha);
  }
  return out.map(({ linhas, ...p }) => ({ ...p, txt: linhas.join(" ").replace(/\s+/g, " ").trim() }));
}
const NUM_ATO = "n\\.?\\s*[º°o]\\s*(\\d+(?:-[A-Z])?)\\s*\\/\\s*(\\d{4})";
const PRECO = "(\\d[.,]\\d{3})";

// ---------- Madeira (II série do JORAM) ----------
// "Despacho Conjunto n.º 101/2026 ... Homologação dos preços máximos de venda ao público dos combustíveis ... são
//  homologados para vigorar na Região Autónoma da Madeira, a partir das 0 horas do dia 09 de novembro de 2026 os seguintes
//  preços máximos de venda ao público: Gasolina super sem chumbo IO 95 ..... 1,937 €por litro / Gasóleo rodoviário ..... 2,145 €"
export function lerMadeira(texto) {
  const achados = [];
  for (const p of pedacos(texto, new RegExp(`^\\s*(Despacho\\s+Conjunto|Despacho|Portaria)\\s+${NUM_ATO}\\s*$`, "i"))) {
    if (!/pre[çc]os m[áa]ximos de venda ao p[úu]blico/i.test(p.txt)) continue;
    const vigor = p.txt.match(/a partir das (?:0|zero) horas do dia (\d{1,2}) de ([a-zçã]+) de (\d{4})/i);
    const gasolina = p.txt.match(new RegExp(`Gasolina[^€\\d]{0,60}?95[\\s.…_]*(?:€\\s*)?${PRECO}`, "i"));
    const gasoleo = p.txt.match(new RegExp(`Gas[óo]leo\\s+rodovi[áa]rio[\\s.…_]*(?:€\\s*)?${PRECO}`, "i"));
    if (!vigor && !gasolina && !gasoleo) continue; // é a citação no sumário da capa
    const assinado = p.txt.match(/Assinado,? em (\d{1,2}) de ([a-zçã]+) de (\d{4})/i);
    achados.push({
      ato: `${p.tipo} n.º ${p.num}/${p.ano}`,
      desde: vigor ? dataISO(vigor[1], vigor[2], vigor[3]) : null,
      gasolina: gasolina ? numero(gasolina[1]) : null,
      gasoleo: gasoleo ? numero(gasoleo[1]) : null,
      assinado: assinado ? dataISO(assinado[1], assinado[2], assinado[3]) : null,
    });
  }
  return achados;
}

// ---------- Açores (I série do Jornal Oficial) ----------
// "Despacho Normativo n.º 33/2026 de 30 de outubro de 2026 ... 1 - Fixar os seguintes preços máximos de venda ao público
//  dos combustíveis líquidos: a) Gasolina sem chumbo I.O. 95 octanas, ... - € 1,934 por litro ...; b) Gasóleo, classificado
//  pelo código NC 2710 19 41 a 2710 19 49 - € 1,994 por litro ... entram em vigor na Região Autónoma dos Açores a partir das
//  zero horas do dia 1 de novembro de 2026."
// O despacho do gasóleo colorido e marcado (agricultura e pescas) sai no mesmo dia e não tem a gasolina: fica de fora.
export function lerAcores(texto) {
  const achados = [];
  for (const p of pedacos(texto, new RegExp(`^\\s*(Despacho\\s+Normativo)\\s+${NUM_ATO}\\s+de\\s+\\d{1,2}\\s+de\\s+[a-zçã]+\\s+de\\s+\\d{4}\\s*$`, "i"))) {
    if (!/pre[çc]os m[áa]ximos de venda ao p[úu]blico dos combust[íi]veis l[íi]quidos/i.test(p.txt)) continue;
    const vigor = p.txt.match(/a partir das (?:zero|0) horas do dia (\d{1,2}) de ([a-zçã]+) de (\d{4})/i);
    const gasolina = p.txt.match(new RegExp(`Gasolina sem chumbo[^€]{0,240}?€\\s*${PRECO}\\s*por litro`, "i"));
    const gasoleo = p.txt.match(new RegExp(`\\b[a-z]\\)\\s*Gas[óo]leo(?![^€]{0,60}(?:colorido|marcado|agr[íi]col|pesca))[^€]{0,240}?€\\s*${PRECO}\\s*por litro`, "i"));
    if (!vigor && !gasolina && !gasoleo) continue;
    const data = p.txt.slice(0, 120).match(/^[^/]+\/\d{4}\s+de\s+(\d{1,2}) de ([a-zçã]+) de (\d{4})/i);
    achados.push({
      ato: `${p.tipo} n.º ${p.num}/${p.ano}`,
      num: p.num,
      desde: vigor ? dataISO(vigor[1], vigor[2], vigor[3]) : null,
      gasolina: gasolina ? numero(gasolina[1]) : null,
      gasoleo: gasoleo ? numero(gasoleo[1]) : null,
      assinado: data ? dataISO(data[1], data[2], data[3]) : null,
    });
  }
  return achados;
}

// ---------- verificações ----------
function verificar(regiao, a, publicado, anterior, mediaContinente) {
  const erros = [];
  for (const k of ["gasolina", "gasoleo"]) {
    if (a[k] == null) { erros.push(`sem o preço d${k === "gasolina" ? "a gasolina" : "o gasóleo"}`); continue; }
    if (!(a[k] >= PRECO_MIN && a[k] <= PRECO_MAX)) erros.push(`${k} ${a[k]} fora de ${PRECO_MIN}-${PRECO_MAX}`);
    if (mediaContinente[k] && Math.abs(a[k] - mediaContinente[k]) > MAX_DESVIO) erros.push(`${k} ${a[k]} a mais de ${MAX_DESVIO} €/L da média do continente (${mediaContinente[k]})`);
    if (anterior && anterior[k] && Math.abs(a[k] - anterior[k]) > MAX_VARIACAO[regiao]) erros.push(`${k} ${a[k]} varia mais de ${MAX_VARIACAO[regiao]} €/L face ao despacho anterior (${anterior[k]})`);
  }
  if (!a.desde) erros.push("sem a data de entrada em vigor");
  else if (publicado) {
    const d = diasEntre(publicado, a.desde);
    if (d < 0 || d > 15) erros.push(`entra em vigor a ${a.desde}, ${d} dias depois da publicação (${publicado})`);
  }
  return erros;
}

// junta um despacho à lista da região: o mais recente primeiro; um despacho com a mesma data de entrada em vigor
// substitui o outro (correção), e um despacho já conhecido não se repete
function juntar(lista, novo) {
  const resto = lista.filter((x) => x.ato !== novo.ato && x.desde !== novo.desde);
  return [novo, ...resto].sort((a, b) => b.desde.localeCompare(a.desde) || b.publicado.localeCompare(a.publicado)).slice(0, MAX_PRECOS);
}

// o preço em vigor numa data: o despacho mais recente que já entrou em vigor
const emVigor = (lista, dia) => lista.find((x) => x.desde <= dia) || null;

// Uma região fica atrasada quando o período em curso começou há mais de 1 dia e não há despacho para ele. Madeira: o
// despacho em vigor tem mais de 7 dias, ou seja, é terça e falta o da semana. Açores: o despacho em vigor é de um mês
// anterior e já passaram 2 dias do mês. (A página avisa os leitores mais cedo: na Madeira logo na segunda, nos Açores
// no dia 1.)
function atrasado(regiao, lista) {
  const dia = hoje(regiao === "acores" ? "Atlantic/Azores" : "Atlantic/Madeira");
  const atual = emVigor(lista, dia);
  if (!atual) return `sem nenhum preço em vigor a ${dia}`;
  if (regiao === "madeira" && diasEntre(atual.desde, dia) > 7) return `o preço em vigor é de ${atual.desde} (falta o despacho desta semana)`;
  if (regiao === "acores" && atual.desde.slice(0, 7) !== dia.slice(0, 7) && parseInt(dia.slice(8), 10) > 2) return `o preço em vigor é de ${atual.desde} (falta o despacho deste mês)`;
  return null;
}

// ---------- descoberta ----------
async function descobrirMadeira(estado, encontrados) {
  const vistos = estado.vistos || (estado.vistos = {});
  const dia = hoje("Atlantic/Madeira");
  const anos = [...new Set([dia.slice(0, 4), String(new Date(Date.parse(dia) - DIAS_MADEIRA * 864e5).getUTCFullYear())])];
  for (const ano of anos) {
    const pasta = `${JORAM}Ano%20de%20${ano}/`;
    let lista;
    try { lista = await pedir(pasta); } catch (e) { aviso(`Madeira: não consegui ler a listagem do JORAM (${e.message})`); continue; }
    if (lista.status === 404) continue;
    const nomes = [...new Set([...lista.buf.toString("utf8").matchAll(/href="(IISerie-(\d{3})-(\d{4}-\d{2}-\d{2})([A-Za-z0-9]*)\.pdf)"/g)].map((m) => m[1]))];
    console.log(`Madeira: ${nomes.length} PDFs na listagem de ${ano}`);
    for (const nome of nomes.sort()) {
      const m = nome.match(/^IISerie-(\d{3})-(\d{4}-\d{2}-\d{2})([A-Za-z0-9]*)\.pdf$/);
      const data = m[2];
      if (vistos[nome] || diasEntre(data, dia) > DIAS_MADEIRA || diasEntre(data, dia) < -1) continue;
      let texto;
      try { texto = await textoPDF((await pedir(pasta + nome)).buf); } catch (e) { aviso(`Madeira: não consegui ler ${nome} (${e.message})`); continue; }
      vistos[nome] = data;
      const sup = m[3] ? (m[3].match(/\d+/) ? m[3].match(/\d+/)[0] + ".º suplemento" : "suplemento") : "";
      for (const a of lerMadeira(texto)) {
        console.log(`Madeira: ${nome}: ${a.ato}, em vigor a ${a.desde}, gasóleo ${a.gasoleo}, gasolina ${a.gasolina}`);
        encontrados.push({ regiao: "madeira", ato: a.ato, desde: a.desde, gasoleo: a.gasoleo, gasolina: a.gasolina, publicado: data,
          jornal: `II série, n.º ${parseInt(m[1], 10)}${sup ? ", " + sup : ""}`, url: pasta + nome });
      }
    }
  }
  // esquece os PDFs que já saíram da janela
  for (const [nome, data] of Object.entries(vistos)) if (diasEntre(data, dia) > DIAS_MADEIRA + 2) delete vistos[nome];
}

// Sem estado (primeira corrida ou ficheiro perdido): procura o último número publicado este ano (pesquisa binária com
// pedidos HEAD) e começa uns 20 números antes, que chegam para apanhar o despacho do mês.
async function ultimoNumeroAcores(ano) {
  const existe = async (n) => (await pedir(`${JOA}jornais/I-${ano}-${String(n).padStart(3, "0")}-S0.pdf`, { method: "HEAD" })).status === 200;
  if (!(await existe(1))) return 0;
  let lo = 1, hi = 2;
  while (hi < 999 && await existe(hi)) { lo = hi; hi *= 2; }
  hi = Math.min(hi, 999);
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (await existe(m)) lo = m; else hi = m; }
  return lo;
}

async function descobrirAcores(estado, encontrados) {
  const dia = hoje("Atlantic/Azores");
  if (!estado.ano) {
    estado.ano = parseInt(dia.slice(0, 4), 10);
    const ultimo = await ultimoNumeroAcores(estado.ano).catch(() => 0);
    estado.numero = Math.max(0, ultimo - MAX_JORNAIS_ACORES); estado.suplemento = 0;
    console.log(`Açores: sem estado; último jornal da I série de ${estado.ano} é o n.º ${ultimo}, começo no ${estado.numero + 1}`);
  }
  let feitos = 0;
  async function ver(ano, n, s) {
    const nome = `I-${ano}-${pad(n).padStart(3, "0")}-S${s}.pdf`;
    const r = await pedir(JOA + "jornais/" + nome);
    if (r.status === 404) return false;
    feitos++;
    const texto = await textoPDF(r.buf);
    const cab = texto.replace(/\s+/g, " ").match(/I S[ÉE]RIE\s+N\.?\s*[º°o]\s*(\d+)\s+[A-ZÇÁÉÍÓÚÃÕÂÊÔ-]+,\s*(\d{1,2}) DE ([A-ZÇÃ]+) DE (\d{4})/i);
    const publicado = cab ? dataISO(cab[2], cab[3], cab[4]) : null;
    for (const a of lerAcores(texto)) {
      console.log(`Açores: ${nome}: ${a.ato}, em vigor a ${a.desde}, gasóleo ${a.gasoleo}, gasolina ${a.gasolina}`);
      const pub = publicado || a.assinado;
      // link para o PDF do próprio despacho, se existir com o nome habitual; senão, para o jornal
      let url = JOA + "jornais/" + nome;
      if (pub && /^\d+$/.test(a.num)) {
        const doAto = `${JOA}atos/${a.num}-I-Despacho_Normativo-${pub}.pdf`;
        try { if ((await pedir(doAto, { method: "HEAD" })).status === 200) url = doAto; } catch { /* fica o link do jornal */ }
      }
      encontrados.push({ regiao: "acores", ato: a.ato, desde: a.desde, gasoleo: a.gasoleo, gasolina: a.gasolina, publicado: pub,
        jornal: `I série, n.º ${n}${s ? `, ${s}.º suplemento` : ""}`, url });
    }
    return true;
  }
  try {
    // suplementos novos do último jornal visto, depois os números seguintes até dar 404
    while (feitos < MAX_JORNAIS_ACORES && estado.numero && await ver(estado.ano, estado.numero, estado.suplemento + 1)) estado.suplemento++;
    while (feitos < MAX_JORNAIS_ACORES) {
      if (!(await ver(estado.ano, estado.numero + 1, 0))) {
        // ano novo: quando o ano do calendário já mudou e o ano anterior não tem mais números, passa ao n.º 1 do ano seguinte
        if (parseInt(dia.slice(0, 4), 10) > estado.ano && (await ver(estado.ano + 1, 1, 0))) { estado.ano++; estado.numero = 1; estado.suplemento = 0; continue; }
        break;
      }
      estado.numero++; estado.suplemento = 0;
      while (feitos < MAX_JORNAIS_ACORES && await ver(estado.ano, estado.numero, estado.suplemento + 1)) estado.suplemento++;
    }
  } catch (e) { aviso(`Açores: não consegui ler o Jornal Oficial (${e.message})`); }
  console.log(`Açores: ${feitos} jornais lidos; último visto I-${estado.ano}-${estado.numero}-S${estado.suplemento}`);
}

// ---------- principal ----------
async function principal() {
  const ilhas = await lerJSON(F_ILHAS, {});
  const estado = await lerJSON(F_ESTADO, {});
  const resumo = await lerJSON(F_RESUMO, {});
  const mediaContinente = { gasoleo: resumo.gasoleo?.media, gasolina: resumo.gasolina?.media };
  const antes = JSON.stringify(ilhas.regioes || {});
  const regioes = ilhas.regioes || {};
  for (const r of Object.keys(REGIOES)) regioes[r] = { ...REGIOES[r], precos: regioes[r]?.precos || [] };

  const encontrados = [];
  await descobrirMadeira(estado.madeira || (estado.madeira = {}), encontrados);
  await descobrirAcores(estado.acores || (estado.acores = {}), encontrados);

  encontrados.sort((a, b) => (a.desde || "").localeCompare(b.desde || ""));
  for (const a of encontrados) {
    const lista = regioes[a.regiao].precos;
    if (lista.some((x) => x.ato === a.ato && x.desde === a.desde && x.gasoleo === a.gasoleo && x.gasolina === a.gasolina)) continue;
    const anterior = a.desde ? lista.find((x) => x.desde < a.desde) : null;
    const erros = verificar(a.regiao, a, a.publicado, anterior, mediaContinente);
    if (erros.length) { alerta(`${REGIOES[a.regiao].nome}: ${a.ato} (${a.url}) não entra: ${erros.join("; ")}`); continue; }
    const { regiao, ...linha } = a;
    regioes[regiao].precos = juntar(lista, linha);
    console.log(`${REGIOES[regiao].nome}: novo preço ${a.ato}, desde ${a.desde}: gasóleo ${a.gasoleo}, gasolina ${a.gasolina}`);
  }

  if (JSON.stringify(regioes) !== antes) {
    await writeFile(F_ILHAS, JSON.stringify({
      _nota: "Escrito pelo ilhas-precos.mjs: preços máximos de venda ao público dos combustíveis fixados pelo Governo Regional da Madeira (todas as semanas) e dos Açores (todos os meses), lidos dos jornais oficiais. Os postos não podem vender acima destes preços. O GPL Auto não tem preço fixado nas ilhas.",
      atualizadoEm: new Date().toISOString(),
      regioes,
    }, null, 1) + "\n");
    console.log(`${F_ILHAS} atualizado`);
  } else console.log(`${F_ILHAS} sem alterações`);
  await writeFile(F_ESTADO, JSON.stringify(estado, null, 1) + "\n");

  for (const r of Object.keys(REGIOES)) { const a = atrasado(r, regioes[r].precos); if (a) alerta(`${REGIOES[r].nome}: ${a}`); }
  if (pastaTemp) await rm(pastaTemp, { recursive: true, force: true });
  if (alertas.length) { console.log(`\n${alertas.length} alerta(s):\n- ${alertas.join("\n- ")}`); process.exitCode = 1; }
}

// node ilhas-precos.mjs --pdf madeira|acores ficheiro.pdf ...: mostra o que se lê de cada PDF, sem rede
if (process.argv[2] === "--pdf") {
  const leitor = process.argv[3] === "acores" ? lerAcores : lerMadeira;
  for (const f of process.argv.slice(4)) console.log(f, JSON.stringify(leitor(await textoPDF(await readFile(f)))));
  if (pastaTemp) await rm(pastaTemp, { recursive: true, force: true });
} else if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  await principal();
}
