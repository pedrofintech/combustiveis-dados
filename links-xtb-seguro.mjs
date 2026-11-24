// links-xtb-seguro.mjs (uso único, pedido do Pedro a 24 nov 2026)
// Põe um link para o artigo novo "XTB é seguro?" na análise à XTB e nos 6 artigos "XTB vs" do
// literaciafinanceira.pt e publica só esses artigos (nunca o site). Cada alteração é uma
// substituição exata de texto: se o texto de referência não aparecer exatamente uma vez, ou se o
// artigo já tiver o link, fica como está. Depois de correr, este ficheiro e o workflow são apagados.

const API = 'https://api.webflow.com/v2';
const COLLECTION_ID = '67922c46c9da6bf5d9bfdf76'; // Artigos
const TOKEN = process.env.WEBFLOW_TOKEN || '';
const LINK = '/artigos/xtb-e-seguro';

const REGRAS = [
  {
    "slug": "xtb-portugal",
    "id": "679235ea5e4ee8edee509943",
    "procura": "adicional de segurança.</p>",
    "substitui": "adicional de segurança.</p><p>Para saberes até onde vai a proteção dos teus ativos e que multas a XTB já teve, lê o nosso artigo \"<a href=\"https://www.literaciafinanceira.pt/artigos/xtb-e-seguro\">XTB é seguro?</a>\".</p>"
  },
  {
    "slug": "xtb-vs-degiro",
    "id": "6797984c04c478a11d23b301",
    "procura": "sobre os seus relatórios financeiros.</p>",
    "substitui": "sobre os seus relatórios financeiros.</p><p>Na XTB, vê até onde vai a proteção dos teus ativos e que multas a empresa já teve no nosso artigo \"<a href=\"https://www.literaciafinanceira.pt/artigos/xtb-e-seguro\">XTB é seguro?</a>\".</p>"
  },
  {
    "slug": "xtb-vs-etoro",
    "id": "6a804ba972421534b51bc85c",
    "procura": "pode efetivamente receber é 20.100€.</p>",
    "substitui": "pode efetivamente receber é 20.100€.</p><p>As multas e os incidentes que a XTB já teve estão no nosso artigo \"<a href=\"https://www.literaciafinanceira.pt/artigos/xtb-e-seguro\">XTB é seguro?</a>\".</p>"
  },
  {
    "slug": "xtb-vs-interactive-brokers",
    "id": "684c41e403c4bb6add3a2d28",
    "procura": "em caso de falência do intermediário. </p>",
    "substitui": "em caso de falência do intermediário. </p><p>Mais detalhes sobre a proteção na XTB e as multas que já teve no nosso artigo \"<a href=\"https://www.literaciafinanceira.pt/artigos/xtb-e-seguro\">XTB é seguro?</a>\".</p>"
  },
  {
    "slug": "xtb-vs-revolut",
    "id": "6a5a0985333baef99987b0fc",
    "procura": "\">empresa cotada</a>.</p>",
    "substitui": "\">empresa cotada</a>.</p><p>Vê em detalhe a proteção dos teus ativos na XTB e as multas que a empresa já teve no nosso artigo \"<a href=\"https://www.literaciafinanceira.pt/artigos/xtb-e-seguro\">XTB é seguro?</a>\".</p>"
  },
  {
    "slug": "xtb-vs-trade-republic",
    "id": "69ba65a132c2335c321f962f",
    "procura": "maior escrutínio sobre os seus relatórios financeiros. </p>",
    "substitui": "maior escrutínio sobre os seus relatórios financeiros. </p><p>Para mais detalhes sobre a segurança da XTB, lê o nosso artigo \"<a href=\"https://www.literaciafinanceira.pt/artigos/xtb-e-seguro\">XTB é seguro?</a>\".</p>"
  },
  {
    "slug": "xtb-vs-trading-212",
    "id": "6797ac66be0b251fecb7806f",
    "procura": "<li><a href=\"https://www.literaciafinanceira.pt/artigos/xtb-portugal\" target=\"_blank\">Análise à XTB: comissões, segurança, e mais!</a></li></ul>",
    "substitui": "<li><a href=\"https://www.literaciafinanceira.pt/artigos/xtb-e-seguro\" target=\"_blank\">XTB é seguro? Regulação, proteção e riscos</a></li><li><a href=\"https://www.literaciafinanceira.pt/artigos/xtb-portugal\" target=\"_blank\">Análise à XTB: comissões, segurança, e mais!</a></li></ul>"
  }
];

async function webflow(metodo, caminho, corpo) {
  const res = await fetch(API + caminho, {
    method: metodo,
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json', 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined
  });
  const texto = await res.text();
  let json = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
  return { status: res.status, ok: res.ok, json, texto };
}

async function main() {
  if (!TOKEN) {
    console.log('links-xtb-seguro: sem WEBFLOW_TOKEN, não mexo no Webflow.');
    return;
  }
  const publicar = [];
  for (const r of REGRAS) {
    const item = await webflow('GET', `/collections/${COLLECTION_ID}/items/${r.id}`);
    if (!item.ok) {
      console.error(`links-xtb-seguro: ${r.slug}: erro ao ler (${item.status}) ${item.texto.slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    const fd = item.json.fieldData || {};
    const corpo = fd.artigo || '';
    if (fd.slug !== r.slug) {
      console.log(`::warning::links-xtb-seguro: o item ${r.id} não é o ${r.slug}, não mexo.`);
      continue;
    }
    if (corpo.includes(LINK)) {
      console.log(`links-xtb-seguro: ${r.slug} já tem o link.`);
      continue;
    }
    const vezes = corpo.split(r.procura).length - 1;
    if (vezes !== 1) {
      console.log(`::warning::links-xtb-seguro: ${r.slug}: o texto de referência aparece ${vezes} vezes, não mexo.`);
      continue;
    }
    const novo = corpo.replace(r.procura, () => r.substitui);
    const upd = await webflow('PATCH', `/collections/${COLLECTION_ID}/items/${r.id}`, { fieldData: { artigo: novo } });
    if (!upd.ok) {
      console.error(`links-xtb-seguro: ${r.slug}: erro ao atualizar (${upd.status}) ${upd.texto.slice(0, 200)}`);
      process.exitCode = 1;
      continue;
    }
    publicar.push(r.id);
    console.log(`links-xtb-seguro: ${r.slug}: link posto.`);
  }
  if (!publicar.length) {
    console.log('links-xtb-seguro: nada para publicar.');
    return;
  }
  const pub = await webflow('POST', `/collections/${COLLECTION_ID}/items/publish`, { itemIds: publicar });
  if (!pub.ok) {
    console.error(`links-xtb-seguro: erro ao publicar (${pub.status}) ${pub.texto.slice(0, 300)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`links-xtb-seguro: ${publicar.length} artigos publicados.`);
}

main().catch((e) => { console.error('links-xtb-seguro:', e.message || e); process.exit(1); });
