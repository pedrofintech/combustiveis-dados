// Verificação da página publicada (staging ou produção) num browser a sério: histórico do browser (voltar atrás e
// avançar, com a posição da página) e postos de concelhos vizinhos. Corre num runner do GitHub.
//   URL_BASE=https://www.literaciafinanceira.pt BROWSER=chromium|firefox|webkit node verificar-pagina.cjs
const pw = require('playwright');
const fs = require('fs');
const tipo = process.env.BROWSER || 'chromium';
const BASE = (process.env.URL_BASE || 'https://www.literaciafinanceira.pt').replace(/\/$/, '');
const PAGINA = BASE + '/combustivel-mais-barato';
const PRODUCAO = !/webflow\.io/.test(BASE);
const SAIDA = process.env.SAIDA || '.';
const HASH = process.env.HASH || '794875bf5207a66a0fae701b3e1eb1fd3323e79f'; // commit do script que a página tem de estar a carregar
const RAMO = PRODUCAO ? 'main' : 'exemplo'; // o staging usa o ramo de dados fictícios
let GEO = { latitude: 38.757, longitude: -9.224 }; // Amadora
const erros = [];
function ok(cond, msg) { if (!cond) erros.push(msg); console.log((cond ? '  ok  ' : '  FALHA ') + msg); }
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
function km(a, b, c, d) { const R = 6371, dl = (c - a) * Math.PI / 180, dn = (d - b) * Math.PI / 180; const x = Math.sin(dl / 2) ** 2 + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dn / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); }

(async () => {
  const browser = await pw[tipo].launch();
  console.log('browser:', tipo, browser.version(), '| página:', PAGINA);
  const consola = [];
  const todos = await (await fetch('https://raw.githubusercontent.com/pedrofintech/combustiveis-dados/' + RAMO + '/postos-todos.json?x=' + Date.now())).json();
  if (!PRODUCAO) { // dados fictícios, com coordenadas ao acaso: escolher um ponto com postos de gasóleo à volta
    const cont = todos.postos.filter((l) => l[5] != null && l[6] != null && l[7] && !/^Região Autónoma/.test(l[4] || '') && l[4]);
    let melhor = null, mv = -1;
    for (let i = 0; i < cont.length; i += 5) { const a = cont[i]; let n = 0; for (const b of cont) if (Math.abs(a[5] - b[5]) < 0.15 && km(a[5], a[6], b[5], b[6]) <= 15) n++; if (n > mv) { mv = n; melhor = a; } }
    GEO = { latitude: melhor[5], longitude: melhor[6] };
    console.log('localização de teste (dados fictícios):', JSON.stringify(GEO), '|', mv, 'postos de gasóleo a 15 km');
  }
  async function clicar(p, sel) { // clique a sério; se alguma coisa tapar o botão (aviso de cookies, por exemplo), diz e clica diretamente
    try { await p.click(sel, { timeout: 8000 }); } catch (e) { console.log('   (clique direto em ' + sel + ': ' + String(e.message).split('\n')[0].slice(0, 160) + ')'); await p.$eval(sel, (b) => b.click()); }
  }
  async function abrir(o) {
    o = o || {};
    const c = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 900 }, locale: 'pt-PT', timezoneId: 'Europe/Lisbon', geolocation: GEO, permissions: ['geolocation'] });
    const p = await c.newPage();
    p.on('pageerror', (e) => consola.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (/combustivel-mais-barato\]/.test(m.text())) consola.push(m.type() + ': ' + m.text()); });
    await p.addInitScript(() => { window.__geo = 0; try { const g = navigator.geolocation, f = g.getCurrentPosition.bind(g); g.getCurrentPosition = function () { window.__geo++; return f.apply(null, arguments); }; } catch (e) {} });
    await p.goto(BASE + '/precos-combustiveis', { waitUntil: 'domcontentloaded', timeout: 60000 }); // a página de onde a pessoa vem
    await p.goto(PAGINA + (o.hash || ''), { waitUntil: 'load', timeout: 60000 });
    await p.waitForFunction(() => document.getElementById('lfcmb-resultados') && !document.getElementById('lfcmb-resultados').hidden, null, { timeout: 40000 });
    await espera(1500);
    return { c, p };
  }
  const hist = (p) => p.evaluate(() => {
    const t = document.getElementById('lfcmb-titulo'), b = document.querySelector('#lfcmb-comb button[aria-pressed="true"]');
    return { url: location.pathname + location.hash, n: history.length, titulo: t ? t.textContent : '(fora da página)',
      distrito: (document.getElementById('lfcmb-distrito') || {}).value, concelho: (document.getElementById('lfcmb-concelho') || {}).value, comb: b ? b.getAttribute('data-comb') : '',
      linhas: document.querySelectorAll('#lfcmb-linhas tr:not(.lfcmb-grupo)').length, geo: window.__geo, y: Math.round(window.scrollY), lenis: typeof window.lenis,
      script: [...document.scripts].map((s) => s.src).filter((s) => /combustivel-mais-barato/.test(s)).join(' ') };
  });
  const titulo = (p, re) => p.waitForFunction((src) => new RegExp(src).test((document.getElementById('lfcmb-titulo') || {}).textContent || ''), re.source, { timeout: 15000 });
  const distritoDoTitulo = (d) => new RegExp('no distrito d[eo] ' + d + '$');

  console.log('1) histórico do browser (computador)');
  {
    const { c, p } = await abrir();
    let a = await hist(p); const n0 = a.n;
    console.log('   script:', a.script, '| lenis:', a.lenis);
    ok(a.script.indexOf('@' + HASH + '/') !== -1, 'a página carrega o script do commit ' + HASH.slice(0, 7));
    ok(/em Portugal continental$/.test(a.titulo), 'chegada: ' + a.titulo + ' (' + a.n + ' entradas)');
    await p.selectOption('#lfcmb-distrito', 'Lisboa');
    await p.$eval('#lfcmb-ver', (b) => b.scrollIntoView({ block: 'center' })); await espera(1200);
    const y0 = (await hist(p)).y;
    await clicar(p, '#lfcmb-ver'); await titulo(p, distritoDoTitulo('Lisboa')); await espera(2500);
    a = await hist(p); const y1 = a.y;
    ok(a.n === n0 + 1 && a.url === '/combustivel-mais-barato#gasoleo/lisboa', 'pesquisar Lisboa cria uma entrada: ' + a.url + ' (' + a.n + ')');
    const conc = await p.$$eval('#lfcmb-concelho option', (o) => o.map((x) => x.value).filter(Boolean));
    const alvo = conc.indexOf('Lisboa|Amadora') !== -1 ? 'Lisboa|Amadora' : conc[0];
    await clicar(p, '#lfcmb-comb button[data-comb="gpl"]'); await p.selectOption('#lfcmb-concelho', alvo); await clicar(p, '#lfcmb-ver');
    await p.waitForFunction(() => /^#gpl\/lisboa\/./.test(location.hash), null, { timeout: 15000 }); await espera(2500);
    a = await hist(p);
    ok(a.n === n0 + 2 && a.comb === 'gpl' && a.concelho === alvo, 'pesquisar GPL em ' + alvo.split('|')[1] + ' cria outra: ' + a.url + ' (' + a.n + ')');
    await p.goBack(); await titulo(p, distritoDoTitulo('Lisboa')); await espera(1500);
    a = await hist(p);
    ok(a.url === '/combustivel-mais-barato#gasoleo/lisboa' && a.distrito === 'Lisboa' && a.concelho === '' && a.comb === 'gasoleo' && a.linhas === 10, 'voltar atrás: lista de Lisboa e formulário acertado (' + [a.distrito, a.concelho || '-', a.comb, a.linhas].join(', ') + ')');
    await p.goBack(); await titulo(p, /em Portugal continental$/); await espera(1500);
    a = await hist(p);
    ok(a.url === '/combustivel-mais-barato' && a.distrito === '' && Math.abs(a.y - y0) < 80, 'voltar atrás outra vez: todo o país, na posição do formulário (' + y0 + ' -> ' + y1 + ' -> ' + a.y + ')');
    await p.goForward(); await titulo(p, distritoDoTitulo('Lisboa')); await espera(1500);
    a = await hist(p);
    ok(a.distrito === 'Lisboa' && Math.abs(a.y - y1) < 80, 'avançar: Lisboa, na posição da lista (' + a.y + ' vs ' + y1 + ')');
    await p.goForward(); await p.waitForFunction(() => /^#gpl\/lisboa\/./.test(location.hash), null, { timeout: 15000 }); await espera(800);
    a = await hist(p);
    ok(a.comb === 'gpl' && a.concelho === alvo, 'avançar outra vez: GPL em ' + alvo.split('|')[1]);
    await p.goBack(); await espera(500); await p.goBack(); await titulo(p, /em Portugal continental$/); await espera(500);
    await p.goBack(); await p.waitForFunction(() => /precos-combustiveis$/.test(location.pathname), null, { timeout: 20000 });
    ok(true, 'à terceira vez para trás sai para a página anterior (/precos-combustiveis)');
    await p.goForward(); await p.waitForFunction(() => document.getElementById('lfcmb-resultados') && !document.getElementById('lfcmb-resultados').hidden, null, { timeout: 40000 }); await espera(1500);
    a = await hist(p);
    ok(/em Portugal continental$/.test(a.titulo), 'e avançar volta à página, em todo o país');

    await p.selectOption('#lfcmb-distrito', '__perto'); await titulo(p, /num raio de \d+ km$|^.* n[ao]s? (Madeira|Açores)$/); await espera(2500);
    a = await hist(p); const nP = a.n, gP = a.geo;
    ok(a.url === '/combustivel-mais-barato' && a.distrito === '__perto' && gP >= 1, '"Perto de mim": ' + a.titulo + ' (endereço ' + a.url + ', ' + gP + ' pedido(s) de localização)');
    await p.goBack(); await titulo(p, /em Portugal continental$/); await espera(800);
    ok((await hist(p)).distrito === '', 'voltar atrás de "Perto de mim": todo o país');
    await p.goForward(); await titulo(p, /num raio de \d+ km$/); await espera(800);
    a = await hist(p);
    ok(a.distrito === '__perto' && a.geo === gP && a.linhas > 0, 'avançar: "Perto de mim" sem voltar a pedir a localização (' + a.geo + ')');
    await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => document.getElementById('lfcmb-resultados') && !document.getElementById('lfcmb-resultados').hidden, null, { timeout: 40000 }); await espera(1000);
    a = await hist(p);
    ok(/num raio de \d+ km$/.test(a.titulo) && a.distrito === '__perto' && a.geo === 0, 'recarregar mantém "Perto de mim" sem pedir a localização: ' + a.titulo);
    await c.close();
  }

  console.log('2) histórico do browser (telemóvel, 375 px)');
  {
    const { c, p } = await abrir({ viewport: { width: 375, height: 700 } });
    await p.selectOption('#lfcmb-distrito', 'Porto');
    await p.$eval('#lfcmb-ver', (b) => b.scrollIntoView({ block: 'center' })); await espera(1200);
    const y0 = (await hist(p)).y;
    await clicar(p, '#lfcmb-ver'); await titulo(p, distritoDoTitulo('Porto')); await espera(2500);
    const y1 = (await hist(p)).y;
    await p.goBack(); await titulo(p, /em Portugal continental$/); await espera(1500);
    let a = await hist(p);
    ok(y1 > y0 + 100 && Math.abs(a.y - y0) < 80 && a.distrito === '', '"Ver" desce até à lista (' + y0 + ' -> ' + y1 + ') e voltar atrás repõe o formulário (' + a.y + ')');
    await p.goForward(); await titulo(p, distritoDoTitulo('Porto')); await espera(1500);
    a = await hist(p);
    ok(Math.abs(a.y - y1) < 80 && a.distrito === 'Porto', 'avançar repõe a lista (' + a.y + ')');
    await c.close();
  }

  if (PRODUCAO) {
    console.log('3) GPL na Amadora: postos de concelhos vizinhos, contra os dados da DGEG no repositório');
    const ps = todos.postos, K = 9;
    const base = ps.filter((l) => l[4] === 'Lisboa' && l[3] === 'Amadora');
    const proprios = base.filter((l) => l[K]);
    let viz = ps.filter((l) => l[K] && !(l[4] === 'Lisboa' && l[3] === 'Amadora') && base.some((b) => km(l[5], l[6], b[5], b[6]) <= 3));
    viz = viz.map((l, i) => ({ l, i })).sort((a, b) => a.l[K][0] - b.l[K][0] || String(b.l[K][1]).localeCompare(String(a.l[K][1])) || a.i - b.i).map((x) => x.l).slice(0, 10 - proprios.length);
    const eur = (x) => x.toFixed(3).replace('.', ',') + '€';
    for (const vp of [{ width: 1280, height: 900 }, { width: 375, height: 700 }]) {
      const { c, p } = await abrir({ viewport: vp, hash: '#gpl/lisboa/amadora' });
      await p.waitForFunction(() => document.querySelectorAll('#lfcmb-linhas tr').length > 0, null, { timeout: 20000 }); await espera(800);
      const r = await p.evaluate(() => ({
        lido: document.getElementById('lfcmb-fonte').textContent.match(/lidos pelo Literacia Financeira a ([^.]*)\./)[1],
        linhas: [...document.querySelectorAll('#lfcmb-linhas tr')].map((tr) => tr.classList.contains('lfcmb-grupo') ? { grupo: tr.textContent.trim() } :
          { n: tr.children[0].textContent.trim(), nome: tr.querySelector('a').textContent, href: tr.querySelector('a').getAttribute('href'), onde: tr.querySelector('small').firstChild.textContent, preco: tr.children[2].querySelector('b').textContent }),
        frase: document.getElementById('lfcmb-frase').textContent, kmin: document.getElementById('lfcmb-k-min').textContent, kminS: document.getElementById('lfcmb-k-min-s').textContent,
        sw: document.documentElement.scrollWidth, iw: window.innerWidth,
        grupoEstilo: (() => { const td = document.querySelector('#lfcmb-linhas tr.lfcmb-grupo td'); if (!td) return null; const s = getComputedStyle(td); return [s.fontSize, s.whiteSpace, s.backgroundColor, s.color].join(' | '); })(),
      }));
      console.log('   leitura na página:', r.lido, '| no repositório:', todos.lidoEmLisboa);
      const pr = r.linhas.filter((l) => !l.grupo && l.n !== ''), gr = r.linhas.filter((l) => l.grupo), vz = r.linhas.filter((l) => !l.grupo && l.n === '');
      const igual = (a, l) => a && a.href.indexOf('destination=' + l[5] + ',' + l[6]) !== -1 && a.preco === eur(l[K][0]);
      ok(pr.length === proprios.length && proprios.every((l) => pr.some((a) => igual(a, l))), vp.width + ' px: ' + pr.length + ' posto(s) da Amadora, como nos dados (' + proprios.map((l) => l[1]).join(', ') + ')');
      ok(vz.length === viz.length && viz.every((l, i) => igual(vz[i], l) && vz[i].onde === l[3]), vp.width + ' px: ' + vz.length + ' postos de concelhos vizinhos iguais ao cálculo independente');
      ok(gr.length === 1 && gr[0].grupo === 'Noutros concelhos, a menos de 3 km da Amadora', 'linha de separação: ' + (gr[0] && gr[0].grupo) + ' [' + r.grupoEstilo + ']');
      ok(!!r.grupoEstilo && / \| normal \| /.test(r.grupoEstilo) && !/rgba\(0, 0, 0, 0\) \|/.test(r.grupoEstilo), vp.width + ' px: a linha de separação tem o estilo do embed (fundo e texto que quebra)');
      ok(new RegExp('A lista mostra também ' + viz.length + ' postos de concelhos vizinhos, a menos de 3 km da Amadora\\.').test(r.frase), 'frase: ...' + r.frase.slice(-170));
      ok(r.sw <= r.iw, vp.width + ' px: sem scroll horizontal (' + r.sw + ' vs ' + r.iw + ')');
      r.linhas.forEach((l) => console.log('      ' + (l.grupo ? '-- ' + l.grupo : (l.n || ' ') + ' ' + l.nome + ' (' + l.onde + ') ' + l.preco)));
      await (await p.$('#lfcmb-resultados')).screenshot({ path: SAIDA + '/amadora-gpl-' + tipo + '-' + vp.width + '.png' });
      await c.close();
    }
  }

  console.log('4) perguntas frequentes e estilos do embed');
  {
    const { c, p } = await abrir();
    const faq = await p.evaluate(() => { const h = [...document.querySelectorAll('h3.faq-calculators-h3')].find((x) => /filtro por concelho/.test(x.textContent)); return h ? h.closest('.text-weight-semibold').nextElementSibling.nextElementSibling.textContent.trim() : ''; });
    ok(/a lista mostra também os postos de concelhos vizinhos a menos de 3 km/.test(faq) && /há postos de Alfragide registados em Oeiras e não na Amadora/.test(faq), 'FAQ do filtro por concelho explica os concelhos vizinhos');
    const css = await p.evaluate(() => [...document.querySelectorAll('style')].some((x) => /tr\.lfcmb-grupo td/.test(x.textContent)));
    ok(css, 'o embed da ferramenta tem o estilo da linha de separação');
    await c.close();
  }

  console.log('consola:', JSON.stringify(consola));
  ok(consola.filter((x) => /pageerror/.test(x)).length === 0, 'sem erros de JavaScript na página');
  console.log(erros.length ? '\nFALHAS: ' + erros.length : '\nTudo ok');
  await browser.close();
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
