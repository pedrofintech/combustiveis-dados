/* ══════════════════════════════════════════════════════════════════════
   isp-overlay.mjs  -  repo pedrofintech/combustiveis-dados

   Mantem o isp-estado.json atualizado sozinho, para o fiscalidade.mjs
   deixar de depender de alguem editar 4 numeros a mao todas as semanas.

   Corre ANTES do fiscalidade.mjs:
     ... && (node isp-overlay.mjs || true) && (node fiscalidade.mjs || true)

   FONTE A - ENSE, decomposicao de precos oficial.
   Os valores vem no HTML da pagina, dentro de um script:
     var gasolina_dec = { datasets:[{ data:[IVA, ISP, DESCARGA, COTACAO, BIO] }] }
   O ISP da ENSE ja inclui a consignacao rodoviaria E a taxa de carbono,
   por isso o desconto extraordinario sai por diferenca:
     desconto = ispBase + carbono - ispENSE
   A ENSE publica por intervalo de ~2 semanas, logo e uma aproximacao
   (erro tipico de 1 a 3 centimos). Serve de rede, nao de primeira escolha.

   FONTE B - RSS da Serie I do Diario da Republica.
   https://files.diariodarepublica.pt/rss/serie1.xml
   Os PDFs do DR estao encriptados e nao da para os ler sem dependencias,
   mas o feed identifica a portaria do ISP publicada a sexta no Suplemento.
   Serve para carimbar a referencia oficial e para saber que houve
   alteracao (logo, que o valor manual ficou velho). O feed so tem a edicao
   do proprio dia; como a Action corre de hora a hora, a de sexta apanha-a.

   PRECEDENCIA
   1. Valor manual recente no isp-estado.json: ganha sempre, e exato.
   2. Se ficou velho (mais de 8 dias, ou saiu portaria nova depois dele),
      entra a estimativa da ENSE e a pagina passa a dizer que e aproximada.
   3. Se as duas fontes falharem, nao mexe em nada.

   Nunca parte a pipeline: qualquer erro apenas nao altera o ficheiro.
   ══════════════════════════════════════════════════════════════════════ */

import { readFile, writeFile } from "node:fs/promises";

const F = "isp-estado.json";
const URL_ENSE = "https://www.ense-epe.pt/decomposicao-de-preco/";
const URL_RSS = "https://files.diariodarepublica.pt/rss/serie1.xml";

/* Mesmas constantes do fiscalidade.mjs. Se mudarem la, mudam aqui. */
const BASE = {
  gasolina: { ispBase: 0.49752, carbono: 0.15911 },
  gasoleo:  { ispBase: 0.36160, carbono: 0.17334 }
};

const DIAS_ATE_FICAR_VELHO = 8;

function hoje() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Lisbon" });
}
function diasEntre(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000);
}
function segundaSeguinte(iso) {
  const d = new Date(iso + "T12:00:00Z");
  do { d.setUTCDate(d.getUTCDate() + 1); } while (d.getUTCDay() !== 1);
  return d.toISOString().slice(0, 10);
}
async function buscar(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { "User-Agent": "literaciafinanceira-bot" } });
    return r.ok ? await r.text() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

function lerEnse(html) {
  if (!html) return null;
  const mLabels = html.match(/const\s+labels\s*=\s*\[([\s\S]*?)\]/);
  if (!mLabels) return null;
  const labels = [...mLabels[1].matchAll(/'([^']*)'/g)].map(m => m[1].trim().toUpperCase());
  const iIsp = labels.indexOf("ISP");
  if (iIsp < 0) return null;
  const out = {};
  for (const [chave, nome] of [["gasolina", "gasolina_dec"], ["gasoleo", "gasoleo_dec"]]) {
    const m = html.match(new RegExp("var\\s+" + nome + "\\s*=[\\s\\S]*?data:\\s*\\[([^\\]]*)\\]"));
    if (!m) return null;
    const nums = m[1].split(",").map(s => s.trim()).filter(s => s !== "").map(Number);
    const isp = nums[iIsp];
    if (!(isp > 0) || !(isp < 2)) return null;
    out[chave] = isp;
  }
  return out;
}

function lerRss(xml) {
  if (!xml) return null;
  const itens = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => m[1]);
  for (const it of itens) {
    const t = (it.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
    if (!t) continue;
    const titulo = t.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/\s+/g, " ").trim();
    /* A portaria do ISP sai sempre em Suplemento da Serie I, a sexta. */
    if (!/^Portaria/i.test(titulo) || !/Suplemento/i.test(titulo)) continue;
    const data = (titulo.match(/S[ée]rie I de (\d{4}-\d{2}-\d{2})/) || [])[1];
    const num = (titulo.split(" - ")[0] || "").trim();
    if (data && num) return { numero: num, data };
  }
  return null;
}

try {
  const estado = JSON.parse(await readFile(F, "utf8"));
  const agora = hoje();

  const [htmlEnse, xmlRss] = await Promise.all([buscar(URL_ENSE), buscar(URL_RSS)]);
  const ense = lerEnse(htmlEnse);
  const rss = lerRss(xmlRss);

  const idade = estado.desde ? diasEntre(estado.desde, agora) : 999;
  const portariaNova = rss && estado.desde && rss.data > estado.desde;
  const velho = idade > DIAS_ATE_FICAR_VELHO || portariaNova;

  if (!velho) {
    console.log("isp-overlay: valor atual tem " + idade + " dias, fica como esta");
    process.exit(0);
  }
  if (!ense) {
    console.log("isp-overlay: valor com " + idade + " dias mas a ENSE nao respondeu, nada alterado");
    process.exit(0);
  }

  const novo = {};
  for (const f of ["gasolina", "gasoleo"]) {
    const d = (BASE[f].ispBase + BASE[f].carbono - ense[f]) * 1000;
    if (!(d >= 0) || !(d <= 300)) {
      console.log("isp-overlay: desconto implausivel em " + f + " (" + d.toFixed(2) + "), nada alterado");
      process.exit(0);
    }
    novo[f] = Math.round(d * 100) / 100;
  }

  const desde = rss && rss.data > (estado.desde || "") ? segundaSeguinte(rss.data) : agora;

  const saida = {
    portaria: rss ? rss.numero + ", de " + rss.data : (estado.portaria || ""),
    desde: desde,
    gasoleo: novo.gasoleo,
    gasolina: novo.gasolina,
    fonte: "ense",
    aproximado: true,
    verificado: agora
  };

  if (JSON.stringify(saida) === JSON.stringify(estado)) {
    console.log("isp-overlay: sem alteracoes");
    process.exit(0);
  }

  await writeFile(F, JSON.stringify(saida) + "\n");
  console.log("isp-overlay: atualizado pela ENSE (gasoleo " + novo.gasoleo +
    ", gasolina " + novo.gasolina + " por 1000L, desde " + desde +
    (rss ? ", " + rss.numero : "") + ")");
} catch (e) {
  console.log("isp-overlay: falhou sem consequencias - " + e.message);
}

process.exit(0);
