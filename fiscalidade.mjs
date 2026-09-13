/* ══════════════════════════════════════════════════════════════════════
   fiscalidade.mjs  -  repo pedrofintech/combustiveis-dados

   Escreve o bloco "fiscalidade" no combustiveis.json em cada corrida.
   O cartao "Quanto do preco e imposto?" da pagina /precos-combustiveis le
   este bloco. Se ele faltar, o cartao usa a reserva que tem no proprio
   embed do Webflow.

   Correr SEMPRE em ultimo lugar, no mesmo passo da Action:
     node update-combustiveis.mjs && (node previsao-propria.mjs || true) \
       && node posprocessar-isp.mjs && (node fiscalidade.mjs || true)

   De onde vem cada numero:

   - ispBase: taxa unitaria do ISP ANTES do desconto extraordinario, em
     euros/litro, ja com a consignacao de servico rodoviario incluida.
     Sai de cruzar as portarias: a taxa publicada mais o desconto da
     sempre o mesmo valor.
       gasolina: 470,53+26,99 = 451,68+45,84 = 462,39+35,13 = 497,52
       gasoleo:  311,63+49,97 = 278,17+83,43 = 331,26+30,34 = 361,60
     So muda se o Orcamento do Estado ou uma portaria alterar a base.

   - carbono: adicionamento sobre as emissoes de CO2, fixado para todo o
     ano. Valores de 2026 (DGEG). ATUALIZAR EM JANEIRO DE 2027.

   - desconto extraordinario: vem do isp-estado.json, em euros/1000 litros,
     a atualizar a cada portaria (sexta-feira, Diario da Republica).
     E o mesmo ficheiro que o isp-overlay.mjs vai escrever quando a
     deteccao automatica das portarias ficar pronta.

   Nunca parte a pipeline: qualquer erro apenas nao escreve o bloco.
   ══════════════════════════════════════════════════════════════════════ */

import { readFile, writeFile } from "node:fs/promises";

const F = "combustiveis.json";
const IVA = 0.23;
const TAXAS = {
  gasolina: { ispBase: 0.49752, csr: 0.087, carbono: 0.15911 },
  gasoleo:  { ispBase: 0.36160, csr: 0.111, carbono: 0.17334 }
};

try {
  const dados = JSON.parse(await readFile(F, "utf8"));

  let fiscalidade = null;

  /* O override manda sempre, para dar para corrigir sem tocar em codigo. */
  try {
    const ov = JSON.parse(await readFile("override.json", "utf8"));
    if (ov && ov.fiscalidade) {
      fiscalidade = ov.fiscalidade;
      console.log("fiscalidade: a usar o bloco do override.json");
    }
  } catch { /* sem override: segue para o isp-estado.json */ }

  if (!fiscalidade) {
    const isp = JSON.parse(await readFile("isp-estado.json", "utf8"));
    fiscalidade = {
      iva: IVA,
      emVigor: isp.aproximado ? new Date(isp.desde + "T12:00:00Z").toLocaleDateString("pt-PT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) + " (estimativa a partir da decomposicao oficial da ENSE, a aguardar a portaria)" : isp.desde,
      portaria: isp.portaria || "",
      gasolina: { ...TAXAS.gasolina, desconto: (isp.gasolina || 0) / 1000 },
      gasoleo:  { ...TAXAS.gasoleo,  desconto: (isp.gasoleo  || 0) / 1000 }
    };
  }

  /* Sanidade: o que sobra para produto e margens tem de ser positivo.
     Se nao for, e sinal de taxa errada e e melhor nao escrever nada -
     o cartao esconde-se sozinho em vez de mostrar disparates. */
  for (const f of ["gasolina", "gasoleo"]) {
    const c = fiscalidade[f];
    const pvp = dados[f] && dados[f].atual;
    if (!c || typeof pvp !== "number") continue;
    const iva = (pvp * fiscalidade.iva) / (1 + fiscalidade.iva);
    const isp = Math.max(c.ispBase - (c.desconto || 0), 0);
    const produto = pvp - iva - isp - c.carbono;
    if (!(produto > 0)) {
      console.log("fiscalidade: valores incoerentes em " + f + " (produto " + produto.toFixed(3) + "), bloco nao escrito");
      process.exit(0);
    }
  }

  dados.fiscalidade = fiscalidade;
  await writeFile(F, JSON.stringify(dados, null, 2) + "\n");
  console.log("fiscalidade escrita: em vigor desde " + fiscalidade.emVigor +
    " (desconto gasoleo " + (fiscalidade.gasoleo.desconto * 100).toFixed(2) +
    " cts/L, gasolina " + (fiscalidade.gasolina.desconto * 100).toFixed(2) + " cts/L)");
} catch (e) {
  console.log("fiscalidade: falhou sem consequencias - " + e.message);
}
