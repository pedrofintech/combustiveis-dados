// Testes do histórico do browser e dos postos de concelhos vizinhos, em qualquer browser do Playwright (BROWSER=chromium|firefox|webkit).
const pw = require('playwright');
const tipo = process.env.BROWSER || 'chromium';
const URL = 'http://127.0.0.1:8792/esboco/real/index.html';
const erros = [];
function ok(cond, msg) { if (!cond) erros.push(msg); console.log((cond ? '  ok  ' : '  FALHA ') + msg); }

(async () => {
  const browser = await pw[tipo].launch();
  console.log('browser:', tipo, browser.version());
  const consola = [];
  console.log('11) Voltar atrás e avançar no browser');
  const BASE = URL.replace('index.html', '');
  async function abrirHist(o) {
    o = o || {};
    const c = await browser.newContext({ viewport: o.viewport || { width: 1280, height: 900 }, geolocation: { latitude: 41.15, longitude: -8.61 }, permissions: ['geolocation'] });
    const p = await c.newPage();
    p.on('pageerror', (e) => consola.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') consola.push(m.text()); });
    /* conta os pedidos de localização que a página faz */
    await p.addInitScript(() => { window.__geo = 0; const g = navigator.geolocation, o = g.getCurrentPosition.bind(g); g.getCurrentPosition = function () { window.__geo++; return o.apply(null, arguments); }; });
    await p.goto(BASE + 'anterior.html');
    if (o.hash) await p.goto(URL + o.hash, { waitUntil: 'load' }); else await p.click('#ir');
    await p.waitForFunction(() => document.getElementById('lfcmb-resultados') && !document.getElementById('lfcmb-resultados').hidden, null, { timeout: 12000 });
    return { c, p };
  }
  const hist = (p) => p.evaluate(() => {
    const t = document.getElementById('lfcmb-titulo'), b = document.querySelector('#lfcmb-comb button[aria-pressed="true"]'), dd = document.querySelector('.lfk-dd:has(#lfcmb-distrito) .lfk-dd-toggle');
    return { url: location.pathname.split('/').pop() + location.hash, n: history.length, titulo: t ? t.textContent : '(fora da página)',
      distrito: (document.getElementById('lfcmb-distrito') || {}).value, concelho: (document.getElementById('lfcmb-concelho') || {}).value, comb: b ? b.getAttribute('data-comb') : '',
      ddDistrito: dd ? dd.textContent.trim() : '', linhas: document.querySelectorAll('#lfcmb-linhas tr:not(.lfcmb-grupo)').length, geo: window.__geo, y: Math.round(window.scrollY) };
  });
  const titulo = (p, re) => p.waitForFunction((src) => new RegExp(src).test((document.getElementById('lfcmb-titulo') || {}).textContent || ''), re.source, { timeout: 8000 });
  {
    const { c, p } = await abrirHist();
    let a = await hist(p); const n0 = a.n;
    ok(a.url === 'index.html' && /em Portugal continental$/.test(a.titulo), 'chegada: ' + a.url + ' (' + a.n + ' entradas no histórico)');
    await p.selectOption('#lfcmb-distrito', 'Lisboa'); await p.click('#lfcmb-ver'); await titulo(p, /no distrito de Lisboa$/);
    a = await hist(p);
    ok(a.n === n0 + 1 && a.url === 'index.html#gasoleo/lisboa', 'pesquisar Lisboa cria uma entrada no histórico: ' + a.url + ' (' + a.n + ')');
    await p.click('#lfcmb-comb button[data-comb="gpl"]'); await p.selectOption('#lfcmb-concelho', 'Lisboa|Amadora'); await p.click('#lfcmb-ver'); await titulo(p, /^GPL Auto mais barato na Amadora$/);
    a = await hist(p);
    ok(a.n === n0 + 2 && a.url === 'index.html#gpl/lisboa/amadora', 'pesquisar GPL na Amadora cria outra: ' + a.url + ' (' + a.n + ')');
    await p.click('#lfcmb-ver'); await p.waitForTimeout(400);
    a = await hist(p);
    ok(a.n === n0 + 2, 'carregar outra vez em "Ver" com a mesma pesquisa não cria entrada (' + a.n + ')');
    await p.goBack(); await titulo(p, /^Gasóleo simples mais barato no distrito de Lisboa$/);
    a = await hist(p);
    ok(a.url === 'index.html#gasoleo/lisboa' && a.distrito === 'Lisboa' && a.concelho === '' && a.comb === 'gasoleo' && a.linhas === 10 && a.n === n0 + 2, 'voltar atrás: lista de Lisboa, formulário acertado (' + [a.distrito, a.concelho || '-', a.comb].join(', ') + ')');
    ok(/Lisboa/.test(a.ddDistrito), 'o dropdown do kit acompanha: ' + a.ddDistrito);
    await p.goBack(); await titulo(p, /em Portugal continental$/);
    a = await hist(p);
    ok(a.url === 'index.html' && a.distrito === '' && a.comb === 'gasoleo', 'voltar atrás outra vez: todo o país (' + a.url + ')');
    await p.goForward(); await titulo(p, /no distrito de Lisboa$/);
    await p.goForward(); await titulo(p, /^GPL Auto mais barato na Amadora$/);
    a = await hist(p);
    ok(a.url === 'index.html#gpl/lisboa/amadora' && a.distrito === 'Lisboa' && a.concelho === 'Lisboa|Amadora' && a.comb === 'gpl', 'avançar duas vezes: GPL na Amadora (' + [a.distrito, a.concelho, a.comb].join(', ') + ')');
    await p.goBack(); await p.goBack(); await titulo(p, /em Portugal continental$/);
    await p.goBack(); await p.waitForFunction(() => /anterior\.html$/.test(location.pathname), null, { timeout: 8000 });
    ok(true, 'à terceira vez para trás sai para a página de onde a pessoa veio');
    await p.goForward(); await p.waitForFunction(() => document.getElementById('lfcmb-resultados') && !document.getElementById('lfcmb-resultados').hidden, null, { timeout: 12000 });
    a = await hist(p);
    ok(/em Portugal continental$/.test(a.titulo) && a.url === 'index.html', 'e ao avançar de novo volta à página, em todo o país');

    /* "Perto de mim": a localização fica na entrada do histórico, não no endereço */
    await p.selectOption('#lfcmb-distrito', '__perto'); await titulo(p, /num raio de \d+ km$/); /* o selectOption já dispara o "input" */
    a = await hist(p); const nPerto = a.n;
    ok(a.url === 'index.html' && a.distrito === '__perto' && a.geo === 1, '"Perto de mim": endereço sem localização (' + a.url + '), 1 pedido de localização');
    const st = await p.evaluate(() => history.state);
    ok(st && st.lfcmb === 1 && st.geo && Math.abs(st.geo.lat - 41.15) < 1e-6 && st.geo.t > 0, 'a localização fica no estado da entrada do histórico');
    await p.goBack(); await titulo(p, /em Portugal continental$/);
    a = await hist(p);
    ok(a.distrito === '' && a.n === nPerto, 'voltar atrás de "Perto de mim": todo o país');
    await p.goForward(); await titulo(p, /num raio de \d+ km$/);
    a = await hist(p);
    ok(a.distrito === '__perto' && a.geo === 1 && a.linhas > 0, 'avançar: "Perto de mim" outra vez, sem voltar a pedir a localização (' + a.geo + ' pedido)');
    await p.click('#lfcmb-comb button[data-comb="gasolina"]'); await p.click('#lfcmb-ver'); await titulo(p, /^Gasolina simples 95 mais barata num raio/);
    a = await hist(p);
    ok(a.n === nPerto + 1 && a.url === 'index.html#gasolina' && a.geo === 1, 'mudar o combustível em "Perto de mim" cria entrada e não volta a pedir a localização: ' + a.url);
    await p.reload(); await p.waitForFunction(() => document.getElementById('lfcmb-resultados') && !document.getElementById('lfcmb-resultados').hidden, null, { timeout: 12000 });
    a = await hist(p);
    ok(/^Gasolina simples 95 mais barata num raio/.test(a.titulo) && a.distrito === '__perto' && a.geo === 0, 'recarregar a página mantém "Perto de mim" sem pedir a localização: ' + a.titulo);
    await p.evaluate(() => { const s = history.state; s.geo.t = Date.now() - 61 * 60000; history.replaceState(s, '', location.href); });
    await p.reload(); await p.waitForFunction(() => document.getElementById('lfcmb-resultados') && !document.getElementById('lfcmb-resultados').hidden, null, { timeout: 12000 });
    a = await hist(p);
    ok(/^Gasolina simples 95 mais barata em Portugal continental$/.test(a.titulo) && a.distrito === '' && a.geo === 0, 'localização guardada há mais de uma hora já não se usa: ' + a.titulo);

    /* âncoras da página e endereços escritos à mão */
    await p.click('#lfcmb-comb button[data-comb="gasoleo"]'); await p.selectOption('#lfcmb-distrito', 'Porto'); await p.click('#lfcmb-ver'); await titulo(p, /no distrito do Porto$/);
    await p.evaluate(() => { location.hash = 'perguntas-frequentes'; }); await p.waitForTimeout(400);
    a = await hist(p);
    ok(/no distrito do Porto$/.test(a.titulo) && a.url === 'index.html#perguntas-frequentes' && a.distrito === 'Porto', 'uma âncora da página não mexe na ferramenta: ' + a.url);
    await p.goBack(); await p.waitForTimeout(400);
    a = await hist(p);
    ok(/no distrito do Porto$/.test(a.titulo) && a.url === 'index.html#gasoleo/porto' && a.distrito === 'Porto', 'voltar da âncora: a mesma lista (' + a.url + ')');
    await p.evaluate(() => { location.hash = 'gasolina/braga'; }); await titulo(p, /^Gasolina simples 95 mais barata no distrito de Braga$/);
    a = await hist(p);
    ok(a.distrito === 'Braga' && a.comb === 'gasolina' && a.url === 'index.html#gasolina/braga', 'endereço escrito à mão (#gasolina/braga) mostra essa lista');
    await p.goBack(); await titulo(p, /^Gasóleo simples mais barato no distrito do Porto$/);
    a = await hist(p);
    ok(a.distrito === 'Porto' && a.comb === 'gasoleo', 'e voltar atrás repõe o Porto');

    /* ilhas */
    await p.selectOption('#lfcmb-distrito', 'Madeira'); await p.click('#lfcmb-ver'); await titulo(p, /^Gasóleo simples na Madeira$/);
    a = await hist(p);
    ok(a.url === 'index.html#gasoleo/madeira', 'Madeira entra no histórico: ' + a.url);
    await p.goBack(); await titulo(p, /no distrito do Porto$/);
    a = await hist(p);
    ok(a.distrito === 'Porto' && a.linhas === 10 && (await p.$eval('#lfcmb-ver', (b) => b.textContent.trim())) === 'Ver os postos mais baratos', 'voltar da Madeira: Porto, com a tabela e o botão normal');
    await p.goForward(); await titulo(p, /^Gasóleo simples na Madeira$/);
    ok((await hist(p)).distrito === 'Madeira', 'avançar: Madeira');
    await c.close();
  }
  {
    /* link partilhado: abrir a página numa vista não cria entradas a mais */
    const { c, p } = await abrirHist({ hash: '#gpl/lisboa/amadora' });
    let a = await hist(p);
    ok(/^GPL Auto mais barato na Amadora$/.test(a.titulo) && a.n === 3, 'link #gpl/lisboa/amadora: abre na Amadora sem criar entradas (' + a.n + ', as mesmas da chegada normal)');
    await p.goBack(); await p.waitForFunction(() => /anterior\.html$/.test(location.pathname), null, { timeout: 8000 });
    ok(true, 'voltar atrás sai logo para a página anterior');
    await c.close();
  }
  {
    /* telemóvel: depois de "Ver" a página desce até à lista; voltar atrás repõe a posição de onde se carregou */
    const { c, p } = await abrirHist({ viewport: { width: 375, height: 700 } });
    await p.selectOption('#lfcmb-distrito', 'Lisboa');
    await p.$eval('#lfcmb-ver', (b) => b.scrollIntoView({ block: 'center' })); await p.waitForTimeout(200);
    const y0 = (await hist(p)).y;
    await p.click('#lfcmb-ver'); await titulo(p, /no distrito de Lisboa$/); await p.waitForTimeout(1200);
    const y1 = (await hist(p)).y;
    await p.goBack(); await titulo(p, /em Portugal continental$/); await p.waitForTimeout(600);
    const y2 = (await hist(p)).y;
    ok(y1 > y0 + 100 && Math.abs(y2 - y0) < 60, 'telemóvel: "Ver" desce até à lista (' + y0 + ' -> ' + y1 + ') e voltar atrás repõe a posição do formulário (' + y2 + ')');
    await p.goForward(); await titulo(p, /no distrito de Lisboa$/); await p.waitForTimeout(600);
    const y3 = (await hist(p)).y;
    ok(Math.abs(y3 - y1) < 60, 'avançar repõe a posição da lista (' + y3 + ')');
    await c.close();
  }

  console.log('12) Concelhos com poucos postos: postos de concelhos vizinhos');
  {
    const fs = require('fs');
    const ESP = JSON.parse(fs.readFileSync('vizinhos-esperado.json', 'utf8'));
    const TODOS = JSON.parse(fs.readFileSync('dados/postos-todos.json', 'utf8')).postos;
    const porId = new Map(TODOS.map((l) => [l[0], l]));
    const slugT = (x) => x.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const eur = (x) => x.toFixed(3).replace('.', ',') + '€';
    const { c, p } = await abrirHist();
    async function verConcelho(comb, dist, conc) {
      await p.click('#lfcmb-comb button[data-comb="' + comb + '"]');
      await p.selectOption('#lfcmb-distrito', dist);
      await p.selectOption('#lfcmb-concelho', dist + '|' + conc);
      await p.click('#lfcmb-ver');
      await p.waitForFunction((h) => location.hash === h, '#' + comb + '/' + slugT(dist) + '/' + slugT(conc), { timeout: 8000 });
      return p.evaluate(() => ({
        linhas: [...document.querySelectorAll('#lfcmb-linhas tr')].map((tr) => tr.classList.contains('lfcmb-grupo') ? { grupo: tr.textContent.trim(), colunas: tr.children.length, colspan: tr.firstElementChild.colSpan } :
          { n: tr.children[0].textContent.trim(), nMovel: (tr.querySelector('.lfcmb-so-movel') || {}).textContent || '', href: tr.querySelector('a').getAttribute('href'), onde: tr.querySelector('small').firstChild.textContent,
            preco: tr.children[2].querySelector('b').textContent, dif: tr.children[3].textContent.trim(), on: tr.classList.contains('is-on') }),
        kpis: !document.getElementById('lfcmb-kpis').hidden, tabela: !document.getElementById('lfcmb-tabela-wrap').hidden, dica: !document.getElementById('lfcmb-tabela-wrap').nextElementSibling.hidden,
        alerta: document.getElementById('lfcmb-sem').hidden ? '' : document.getElementById('lfcmb-sem').textContent,
        frase: document.getElementById('lfcmb-frase').hidden ? '' : document.getElementById('lfcmb-frase').textContent,
        kmin: document.getElementById('lfcmb-k-min').textContent, kminS: document.getElementById('lfcmb-k-min-s').textContent,
        sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      }));
    }
    const coord = (l) => 'destination=' + l[5] + ',' + l[6];
    function confere(r, e, k) {
      const proprias = r.linhas.filter((l) => !l.grupo && l.n !== ''), grupo = r.linhas.filter((l) => l.grupo), viz = r.linhas.filter((l) => !l.grupo && l.n === '');
      const errosC = [];
      if (proprias.length !== Math.min(10, e.proprios.length)) errosC.push('próprios ' + proprias.length + ' vs ' + e.proprios.length);
      e.proprios.slice(0, 10).forEach((x, i) => { const l = porId.get(x[0]), a = proprias[i]; if (!a || a.href.indexOf(coord(l)) === -1 || a.preco !== eur(x[1]) || a.n !== String(i + 1)) errosC.push('próprio ' + (i + 1)); });
      if (viz.length !== e.vizinhos.length) errosC.push('vizinhos ' + viz.length + ' vs ' + e.vizinhos.length);
      e.vizinhos.forEach((x, i) => { const l = porId.get(x[0]), a = viz[i]; if (!a || a.href.indexOf(coord(l)) === -1 || a.preco !== eur(x[2]) || a.onde !== x[1] || a.on || a.nMovel !== '') errosC.push('vizinho ' + (i + 1) + ' ' + JSON.stringify(a) + ' vs ' + JSON.stringify(x)); });
      if ((e.vizinhos.length ? 1 : 0) !== grupo.length) errosC.push('linhas de grupo: ' + grupo.length);
      if (grupo.length && r.linhas.findIndex((l) => l.grupo) !== proprias.length) errosC.push('grupo fora do sítio');
      return errosC;
    }
    let r = await verConcelho('gpl', 'Lisboa', 'Amadora');
    const eA = ESP['gpl|Lisboa|Amadora'];
    ok(confere(r, eA).length === 0, 'Amadora, GPL: 1 posto do concelho e ' + eA.vizinhos.length + ' de concelhos vizinhos, os mesmos do cálculo independente ' + confere(r, eA).join('; '));
    const g = r.linhas.find((l) => l.grupo);
    ok(g && g.grupo === 'Noutros concelhos, a menos de 3 km da Amadora' && g.colunas === 1 && g.colspan === 5, 'linha de separação: ' + (g && g.grupo));
    ok(r.linhas[0].on && r.linhas[0].n === '1' && r.kmin === eur(eA.proprios[0][1]) && /AUCHAN Amadora/i.test(r.kminS), 'o destaque e o indicador "O mais barato" continuam a ser do concelho: ' + r.kmin + ' ' + r.kminS);
    const nomes = await p.$$eval('#lfcmb-linhas tr:not(.lfcmb-grupo)', (t) => t.map((tr) => tr.querySelector('a').textContent + ' (' + tr.querySelector('small').firstChild.textContent + ') ' + tr.children[2].querySelector('b').textContent));
    ok(nomes.some((x) => /^AUCHAN Alfragide \(Oeiras\)/.test(x)), 'o Auchan de Alfragide aparece, com o concelho onde a DGEG o regista: ' + nomes.find((x) => /Alfragide/.test(x)));
    ok(/Como o concelho tem só 1 posto, a comparação é com a média do distrito\. A lista mostra também 7 postos de concelhos vizinhos, a menos de 3 km da Amadora\. O mais barato deles está a 0,979€\.$/.test(r.frase), 'frase: ...' + r.frase.slice(-190));
    ok(r.linhas.filter((l) => !l.grupo).every((l) => /cênt\.$/.test(l.dif)), 'todas as linhas comparam com a mesma média: ' + r.linhas.filter((l) => !l.grupo).map((l) => l.dif).join(' '));
    console.log('   ' + nomes.join('\n   '));
    await p.screenshot({ path: 'vizinhos-desktop.png', clip: { x: 0, y: 0, width: 1280, height: 1700 } }).catch(() => {});
    await (await p.$('#lfcmb-resultados')).screenshot({ path: 'vizinhos-cartao.png' });

    r = await verConcelho('gasoleo', 'Lisboa', 'Amadora');
    ok(r.linhas.length === 10 && !r.linhas.some((l) => l.grupo) && !/concelhos vizinhos/.test(r.frase), 'Amadora, gasóleo (13 postos): só os 10 do concelho, sem vizinhos');

    r = await verConcelho('gpl', 'Leiria', 'Porto de Mós');
    const eP = ESP['gpl|Leiria|Porto de Mós'];
    ok(!r.kpis && r.tabela && r.dica && r.frase === '' && confere(r, eP).length === 0 && r.linhas[0].grupo === 'Noutros concelhos, a menos de 3 km de Porto de Mós', 'concelho sem postos de GPL mas com vizinhos: só a lista dos vizinhos (' + eP.vizinhos.length + ') ' + confere(r, eP).join('; '));
    ok(r.alerta === 'Não há postos com preço recente de GPL Auto em Porto de Mós. Na lista estão os de concelhos vizinhos, a menos de 3 km.', 'aviso: ' + r.alerta);
    ok(r.linhas.filter((l) => !l.grupo).every((l) => l.dif === '-'), 'sem média do concelho, a coluna "Face à média" fica vazia');

    r = await verConcelho('gpl', 'Évora', 'Arraiolos');
    ok(!r.kpis && !r.tabela && !r.dica && r.linhas.length === 0 && r.alerta === 'Não há postos com preço recente de GPL Auto em Arraiolos.', 'concelho sem GPL e sem vizinhos: só o aviso (' + r.alerta + ')');

    r = await verConcelho('gpl', 'Setúbal', 'Alcácer do Sal');
    ok(r.kpis && r.linhas.length === ESP['gpl|Setúbal|Alcácer do Sal'].proprios.length && !r.linhas.some((l) => l.grupo) && !/concelhos vizinhos/.test(r.frase), 'poucos postos e nenhum vizinho a 3 km: lista só do concelho (' + r.linhas.length + ')');

    /* todas as combinações com vizinhos, e uma amostra das que não têm, contra o cálculo independente */
    const chaves = Object.keys(ESP), comViz = chaves.filter((k) => ESP[k].vizinhos.length), semViz = chaves.filter((k) => !ESP[k].vizinhos.length).filter((k, i) => i % 6 === 0);
    let maus = [];
    for (const k of comViz.concat(semViz)) {
      const [comb, dist, conc] = k.split('|');
      const rr = await verConcelho(comb, dist, conc), ee = confere(rr, ESP[k]);
      if (ee.length) maus.push(k + ': ' + ee.join('; '));
      if (rr.linhas.length > 11) maus.push(k + ': ' + rr.linhas.length + ' linhas');
    }
    ok(maus.length === 0, comViz.length + ' concelhos com vizinhos e ' + semViz.length + ' sem vizinhos iguais ao cálculo independente ' + maus.slice(0, 5).join(' | '));
    await c.close();

    const m = await abrirHist({ viewport: { width: 375, height: 700 }, hash: '#gpl/lisboa/amadora' });
    await m.p.waitForFunction(() => document.querySelectorAll('#lfcmb-linhas tr').length > 1, null, { timeout: 8000 });
    const mm = await m.p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, g: document.querySelector('#lfcmb-linhas tr.lfcmb-grupo td').getBoundingClientRect().width, t: document.getElementById('lfcmb-tabela').getBoundingClientRect().width,
      num: [...document.querySelectorAll('#lfcmb-linhas .lfcmb-so-movel')].map((e) => e.textContent) }));
    ok(mm.sw <= mm.iw && mm.g <= mm.t + 1 && mm.num.join('|') === '1. ', 'telemóvel: a linha de separação cabe na tabela, sem scroll horizontal (' + mm.sw + ' vs ' + mm.iw + '), só o posto do concelho tem número');
    await (await m.p.$('#lfcmb-resultados')).screenshot({ path: 'vizinhos-movel.png' });
    await m.c.close();
  }

  console.log('consola:', consola);
  console.log(erros.length ? '\nFALHAS: ' + erros.length : '\nTudo ok');
  await browser.close();
  process.exit(erros.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
