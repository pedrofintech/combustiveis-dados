// webflow-partilha-artigos.mjs
// Preenche o campo "Imagem de partilha (URL)" dos artigos do literaciafinanceira.pt com a capa em
// JPG ou PNG. O LinkedIn e o X não leem AVIF e as capas do CMS são comprimidas para AVIF de tempos
// a tempos; o template dos Artigos usa este campo na og:image (e a Main Image como segunda opção).
//
// Regras:
// - Só mexe em artigos com o campo vazio: um link posto à mão nunca é substituído.
// - Capa em JPG ou PNG: copia o link da Main Image. Se a capa for comprimida mais tarde, o ficheiro
//   original continua no mesmo endereço, por isso o link guardado continua a funcionar.
// - Capa em AVIF ou WebP: usa o ficheiro original, que o Webflow mantém no mesmo endereço com a
//   extensão antiga. Sem original, uma capa WebP serve tal como está (o LinkedIn lê WebP) e uma
//   capa AVIF fica de fora (aviso no log).
// - Publica só os artigos que já estavam publicados e sem alterações por publicar. Os outros
//   ficam com o campo preenchido e saem na próxima publicação normal. Nunca publica o site.
//
// Uso:
//   WEBFLOW_TOKEN=... node webflow-partilha-artigos.mjs           na Action (token do site com cms:read e cms:write)
//   WEBFLOW_TOKEN=... node webflow-partilha-artigos.mjs --print   só mostra o que faria, não escreve nada

import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const API = process.env.WEBFLOW_API || 'https://api.webflow.com/v2';
// Coleção "Artigos" do site literaciafinanceira.pt (Webflow).
const COLLECTION_ID = process.env.WEBFLOW_ARTIGOS_COLLECTION_ID || '67922c46c9da6bf5d9bfdf76';
const CAMPO = 'imagem-de-partilha-url';
const CAPA = 'main-image';
const TOKEN = process.env.WEBFLOW_TOKEN || '';
const PRINT = process.argv.includes('--print');

const EXT_PARTILHAVEL = /\.(jpe?g|png|gif)$/i;
const EXT_COMPRIMIDA = /^(.*)\.(avif|webp)$/i;
const EXT_ORIGINAIS = ['jpg', 'png', 'jpeg', 'JPG', 'PNG', 'JPEG'];

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- API do Webflow ---- */
async function webflow(metodo, caminho, corpo) {
  for (let tentativa = 1; ; tentativa++) {
    const res = await fetch(API + caminho, {
      method: metodo,
      headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json', 'content-type': 'application/json' },
      body: corpo ? JSON.stringify(corpo) : undefined
    });
    const texto = await res.text();
    if (res.status === 429 && tentativa < 5) {
      await espera(Number(res.headers.get('retry-after') || 20) * 1000);
      continue;
    }
    let json = null;
    try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta sem JSON */ }
    return { status: res.status, ok: res.ok, json, texto };
  }
}

async function todosOsArtigos() {
  const itens = [];
  for (let offset = 0; ; offset += 100) {
    const r = await webflow('GET', `/collections/${COLLECTION_ID}/items?limit=100&offset=${offset}`);
    if (!r.ok) throw new Error(`erro a ler os artigos (${r.status}): ${r.texto.slice(0, 300)}`);
    const lote = (r.json && r.json.items) || [];
    itens.push(...lote);
    const total = r.json && r.json.pagination ? r.json.pagination.total : itens.length;
    if (!lote.length || itens.length >= total) break;
  }
  return itens;
}

/* ---- Ficheiros no CDN do Webflow ---- */
export async function existeImagem(url, fetcher = fetch) {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetcher(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
      if (res.status === 403 || res.status === 404) return false;
      if (res.ok) return /^image\/(jpeg|png|gif)/i.test(res.headers.get('content-type') || '');
    } catch { /* falha de rede: tenta outra vez */ }
    await espera(1500);
  }
  return false;
}

// Nomes onde pode estar o ficheiro original de uma capa comprimida. Uma capa copiada de outro
// artigo tem dois IDs no nome (novo_antigo_nome) e às vezes um "-2" no fim: o original fica no
// ficheiro de onde foi copiada. Nomes com %25 (codificados duas vezes) também se tentam com %.
export function nomesDoOriginal(nome) {
  const nomes = [nome];
  const interior = nome.replace(/^[0-9a-f]{24}_/i, '');
  if (/^[0-9a-f]{24}_/i.test(interior)) {
    nomes.push(interior, interior.replace(/-\d+$/, ''));
    if (interior.includes('%25')) {
      const umaVez = interior.replace(/%25/g, '%');
      nomes.push(umaVez, umaVez.replace(/-\d+$/, ''));
    }
  }
  return [...new Set(nomes)];
}

// Link a guardar no campo para uma capa, ou null se não houver versão que o LinkedIn leia.
export async function linkDePartilha(capa, fetcher = fetch) {
  const caminho = String(capa || '').split('?')[0];
  if (!caminho) return null;
  if (EXT_PARTILHAVEL.test(caminho)) return capa;
  const m = caminho.match(EXT_COMPRIMIDA);
  if (!m) return null;
  const pasta = m[1].slice(0, m[1].lastIndexOf('/') + 1);
  const nome = m[1].slice(m[1].lastIndexOf('/') + 1);
  for (const n of nomesDoOriginal(nome)) {
    for (const ext of EXT_ORIGINAIS) {
      const candidato = `${pasta}${n}.${ext}`;
      if (await existeImagem(candidato, fetcher)) return candidato;
    }
  }
  return m[2].toLowerCase() === 'webp' ? capa : null;
}

async function emParalelo(lista, n, fn) {
  const out = new Array(lista.length);
  let proximo = 0;
  await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => {
    while (proximo < lista.length) {
      const k = proximo++;
      out[k] = await fn(lista[k]);
    }
  }));
  return out;
}

const podePublicar = (it) => !it.isDraft && !it.isArchived && Boolean(it.lastPublished) &&
  String(it.lastPublished) >= String(it.lastUpdated || '');

async function main() {
  if (!TOKEN) {
    console.log('webflow-partilha: sem WEBFLOW_TOKEN, não mexo no Webflow.');
    return;
  }
  const artigos = await todosOsArtigos();
  const vazios = artigos.filter((it) => {
    const f = it.fieldData || {};
    return !String(f[CAMPO] || '').trim() && f[CAPA] && f[CAPA].url;
  });
  console.log(`webflow-partilha: ${artigos.length} artigos, ${vazios.length} com o campo vazio.`);
  if (!vazios.length) return;

  const resultados = await emParalelo(vazios, 8, async (it) => ({ it, link: await linkDePartilha(it.fieldData[CAPA].url) }));
  const preencher = resultados.filter((r) => r.link);
  const semVersao = resultados.filter((r) => !r.link).map((r) => r.it.fieldData.slug);
  if (semVersao.length) {
    console.log(`::warning::webflow-partilha: sem capa em JPG ou PNG para ${semVersao.join(', ')}`);
  }
  if (PRINT) {
    for (const { it, link } of preencher) console.log(`${it.fieldData.slug} -> ${link}`);
    return;
  }

  // Decide o que publicar antes de atualizar: depois do PATCH todos ficam com alterações por publicar.
  const publicar = preencher.filter(({ it }) => podePublicar(it)).map(({ it }) => it.id);

  for (let k = 0; k < preencher.length; k += 100) {
    const lote = preencher.slice(k, k + 100).map(({ it, link }) => ({ id: it.id, fieldData: { [CAMPO]: link } }));
    const r = await webflow('PATCH', `/collections/${COLLECTION_ID}/items`, { items: lote });
    if (!r.ok) throw new Error(`erro a atualizar os artigos (${r.status}): ${r.texto.slice(0, 300)}`);
  }
  for (let k = 0; k < publicar.length; k += 100) {
    const r = await webflow('POST', `/collections/${COLLECTION_ID}/items/publish`, { itemIds: publicar.slice(k, k + 100) });
    if (!r.ok) throw new Error(`erro a publicar os artigos (${r.status}): ${r.texto.slice(0, 300)}`);
  }

  const resumo = `webflow-partilha: ${preencher.length} preenchidos, ${publicar.length} publicados, ` +
    `${preencher.length - publicar.length} saem na próxima publicação, ${semVersao.length} sem capa em JPG ou PNG.`;
  console.log(resumo);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${resumo}\n`);
}

// Corre só quando é chamado diretamente; importado como módulo expõe linkDePartilha().
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('webflow-partilha:', e.message || e); process.exit(1); });
}
