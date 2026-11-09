/* Combustível mais barato: a ferramenta da página /combustivel-mais-barato do literaciafinanceira.pt.
   Mostra os postos mais baratos do país, de um distrito, de um concelho ou à volta do utilizador, para gasóleo simples,
   gasolina simples 95 e GPL Auto, com os preços que os postos comunicam ao portal Preços dos Combustíveis Online da DGEG.

   Dados (escritos pelo dgeg-postos.mjs deste repositório, lidos na API oficial da DGEG às 13h e às 20h):
   - postos-resumo.json  médias nacionais e por distrito (só Portugal continental na média nacional)
   - postos-top.json     os 10 postos mais baratos de cada distrito e a lista de concelhos de cada distrito
   - postos-todos.json   todos os postos com preço recente e coordenadas; só se carrega para o filtro por concelho e para
                         "Usar a minha localização" (uns 80 KB comprimidos)
   O HTML da ferramenta está no embed da página (cópia em combustivel-mais-barato.html) e usa o LF kit (lf-site-assets/kit).
   Condições da DGEG: citar a DGEG com a data e a hora da leitura e dizer que a ordenação, as médias e a poupança são
   cálculo nosso. Os textos que o fazem estão em rodape() e no HTML do embed. */
(function () {
  'use strict';
  if (window.__lfCombBarato) return;
  window.__lfCombBarato = true;

  var BASE = window.__lfCombBaratoDados || 'https://raw.githubusercontent.com/pedrofintech/combustiveis-dados/main/';
  var RAIO_KM = 15, RAIO_MAX_KM = 40, TOP = 10, DEPOSITO_L = 50;
  var MAX_HORAS_AVISO = 30; /* leitura com mais horas do que isto: aviso de que os preços podem estar desatualizados */
  var COMB = {
    gasoleo: { nome: 'Gasóleo simples', art: 'o gasóleo simples' },
    gasolina: { nome: 'Gasolina 95', art: 'a gasolina 95' },
    gpl: { nome: 'GPL Auto', art: 'o GPL Auto' }
  };
  var CONTINENTE = ['Aveiro', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra', 'Évora', 'Faro', 'Guarda', 'Leiria', 'Lisboa',
    'Portalegre', 'Porto', 'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu'];

  var D = { resumo: null, top: null, todos: null, todosPedido: null };
  var estado = { comb: 'gasoleo', distrito: '', concelho: '', geo: null };
  var el = {};

  /* ---------- utilitários ---------- */
  function $(id) { return document.getElementById(id); }
  function fmt(v, o) { return window.LFK && LFK.fmt ? LFK.fmt(v, o) : String(v); }
  function preco(v) { return fmt(v, { decimals: 3 }); }
  function cents(v) { var c = Math.abs(v) * 100; return fmt(c, { currency: false, decimals: c % 1 === 0 ? 0 : 1 }); }
  function cent(v) { var c = Math.abs(v) * 100; return cents(v) + (Math.round(c * 10) === 10 ? ' cêntimo' : ' cêntimos'); }
  function dif(v) { return (v < 0 ? '-' : '+') + fmt(Math.abs(v) * 100, { currency: false, decimals: 1 }) + ' cênt.'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function slug(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }
  function media(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; }
  function hojeLisboa() {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return new Date().toISOString().slice(0, 10); }
  }
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function diaAnterior(iso) { var d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); }
  /* '2026-11-09T07:12' -> 'hoje, 07:12' | 'ontem, 19:05' | '5 nov, 08:00' */
  function quando(iso) {
    var s = String(iso || ''), data = s.slice(0, 10), hora = s.slice(11, 16), hoje = hojeLisboa();
    if (!data) return '';
    var dia = data === hoje ? 'hoje' : data === diaAnterior(hoje) ? 'ontem' : parseInt(data.slice(8, 10), 10) + ' ' + MESES_CURTOS[parseInt(data.slice(5, 7), 10) - 1];
    return hora ? dia + ', ' + hora : dia;
  }
  /* '2026-11-09 13:05' -> '9 de novembro de 2026, às 13:05' */
  function dataHoraPT(s) {
    var p = String(s || '').split(' '), d = p[0].split('-');
    if (d.length < 3) return '';
    return parseInt(d[2], 10) + ' de ' + MESES[parseInt(d[1], 10) - 1] + ' de ' + d[0] + (p[1] ? ', às ' + p[1] : '');
  }
  function horasDesde(iso) { var t = Date.parse(iso); return isFinite(t) ? (Date.now() - t) / 36e5 : Infinity; }
  function ehIlha(d) { return CONTINENTE.indexOf(d) === -1; }
  function nomeDistrito(d) { return /madeira/i.test(d) ? 'Madeira' : /a[çc]ores/i.test(d) ? 'Açores' : d; }
  function noDistrito(d) { return ehIlha(d) ? 'na ' + nomeDistrito(d) : 'no distrito de ' + d; }
  /* nomes que a API devolve todos em maiúsculas passam a Título */
  function nome(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length > 4 && s === s.toUpperCase() && s !== s.toLowerCase()) {
      s = s.toLowerCase().replace(/(^|[\s\-\/(."'])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }).replace(/\b(De|Da|Do|Das|Dos|E|Em|A|O|Lda)\b/g, function (m) { return m === 'Lda' ? 'Lda' : m.toLowerCase(); });
    }
    return s;
  }
  function mapa(p) {
    if (p.lat != null && p.lon != null) return 'https://www.google.com/maps/dir/?api=1&destination=' + p.lat + ',' + p.lon;
    return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.nome + ', ' + p.municipio);
  }
  function distanciaKm(a, b, c, d) {
    var R = 6371, dLat = (c - a) * Math.PI / 180, dLon = (d - b) * Math.PI / 180;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a * Math.PI / 180) * Math.cos(c * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function rolarAte(node) {
    if (!node) return;
    setTimeout(function () {
      if (window.ScrollTrigger && window.ScrollTrigger.refresh) window.ScrollTrigger.refresh();
      var top = Math.max(0, node.getBoundingClientRect().top + window.pageYOffset - 100);
      if (window.lenis && typeof window.lenis.scrollTo === 'function') window.lenis.scrollTo(top);
      else if (document.documentElement.classList.contains('lenis')) window.scrollTo(0, top);
      else { try { window.scrollTo({ top: top, behavior: 'smooth' }); } catch (e) { window.scrollTo(0, top); } }
    }, 0);
  }

  /* ---------- dados ---------- */
  function pedir(ficheiro, cb) {
    var x = new XMLHttpRequest();
    var h = new Date();
    x.open('GET', BASE + ficheiro + '?v=' + h.getUTCFullYear() + (h.getUTCMonth() + 1) + h.getUTCDate() + '-' + h.getUTCHours(), true);
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status >= 200 && x.status < 300) { try { cb(null, JSON.parse(x.responseText)); return; } catch (e) { cb(e); return; } }
      cb(new Error('HTTP ' + x.status));
    };
    x.onerror = function () { cb(new Error('rede')); };
    x.send();
  }
  function carregarTodos(cb) {
    if (D.todos) return cb(null, D.todos);
    if (D.todosPedido) { D.todosPedido.push(cb); return; }
    D.todosPedido = [cb];
    pedir('postos-todos.json', function (e, j) {
      if (!e) D.todos = j;
      var fila = D.todosPedido; D.todosPedido = null;
      for (var i = 0; i < fila.length; i++) fila[i](e, j);
    });
  }

  /* linha do postos-top.json / postos-todos.json -> objeto; k = índice do combustível no postos-todos (7, 8, 9) */
  function postoTop(linha) {
    return { id: linha[0], nome: nome(linha[1]), marca: linha[2], municipio: linha[3], localidade: linha[4], morada: linha[5], codPostal: linha[6],
      preco: linha[7], atualizado: linha[8], lat: linha[9], lon: linha[10] };
  }
  function postoTodos(linha, k) {
    var pc = linha[k]; if (!pc) return null;
    return { id: linha[0], nome: nome(linha[1]), marca: linha[2], municipio: linha[3], distrito: linha[4], lat: linha[5], lon: linha[6], preco: pc[0], atualizado: pc[1] };
  }
  function indiceComb(c) { return { gasoleo: 7, gasolina: 8, gpl: 9 }[c]; }
  function distritos() {
    var lista = [];
    for (var k in D.top[estado.comb]) if (Object.prototype.hasOwnProperty.call(D.top[estado.comb], k)) lista.push(k);
    lista.sort(function (a, b) { var ia = ehIlha(a), ib = ehIlha(b); return ia !== ib ? (ia ? 1 : -1) : a.localeCompare(b, 'pt'); });
    return lista;
  }
  function resumoDistrito(d) {
    var r = D.resumo[estado.comb].distritos || [];
    for (var i = 0; i < r.length; i++) if (r[i][0] === d) return { postos: r[i][1], media: r[i][2], minimo: r[i][3] };
    return null;
  }
  function ordenar(lista) { lista.sort(function (a, b) { return a.preco - b.preco || String(b.atualizado).localeCompare(String(a.atualizado)); }); return lista; }

  /* ---------- as quatro vistas: país, distrito, concelho, perto de mim ---------- */
  function vistaPais() {
    var lista = [], top = D.top[estado.comb];
    for (var d in top) if (Object.prototype.hasOwnProperty.call(top, d) && !ehIlha(d)) {
      for (var i = 0; i < top[d].length; i++) { var p = postoTop(top[d][i]); p.distrito = d; lista.push(p); }
    }
    var r = D.resumo[estado.comb];
    return { titulo: COMB[estado.comb].nome + ' mais barato em Portugal continental', onde: 'do país', lista: ordenar(lista).slice(0, TOP),
      media: r.media, mediaOnde: 'em Portugal continental', postos: r.postos, mostraDistrito: true };
  }
  function vistaDistrito(d) {
    var top = D.top[estado.comb][d] || [], lista = [];
    for (var i = 0; i < top.length; i++) { var p = postoTop(top[i]); p.distrito = d; lista.push(p); }
    var r = resumoDistrito(d) || {};
    return { titulo: COMB[estado.comb].nome + ' mais barato ' + noDistrito(d), onde: noDistrito(d), lista: lista.slice(0, TOP),
      media: r.media, mediaOnde: noDistrito(d), postos: r.postos, mostraDistrito: false };
  }
  function vistaConcelho(d, c) {
    var k = indiceComb(estado.comb), lista = [], todosConcelho = [];
    for (var i = 0; i < D.todos.postos.length; i++) {
      var l = D.todos.postos[i];
      if (l[4] !== d || l[3] !== c) continue;
      var p = postoTodos(l, k); if (!p) continue;
      lista.push(p); todosConcelho.push(p.preco);
    }
    var rd = resumoDistrito(d) || {};
    var v = { titulo: COMB[estado.comb].nome + ' mais barato em ' + c, onde: 'em ' + c, lista: ordenar(lista).slice(0, TOP), mostraDistrito: false, concelho: c };
    if (todosConcelho.length >= 3) { v.media = media(todosConcelho); v.mediaOnde = 'no concelho de ' + c; v.postos = todosConcelho.length; }
    else { v.media = rd.media; v.mediaOnde = noDistrito(d); v.postos = rd.postos; v.poucos = todosConcelho.length; }
    return v;
  }
  function vistaPerto(lat, lon) {
    var k = indiceComb(estado.comb), perto = [], raio = RAIO_KM;
    for (var i = 0; i < D.todos.postos.length; i++) {
      var l = D.todos.postos[i];
      if (l[5] == null || l[6] == null) continue;
      var p = postoTodos(l, k); if (!p) continue;
      p.km = distanciaKm(lat, lon, l[5], l[6]);
      if (p.km <= RAIO_MAX_KM) perto.push(p);
    }
    var dentro = perto.filter(function (p) { return p.km <= raio; });
    if (dentro.length < 3) { raio = RAIO_MAX_KM; dentro = perto; }
    var precos = dentro.map(function (p) { return p.preco; });
    return { titulo: COMB[estado.comb].nome + ' mais barato num raio de ' + fmt(raio, { currency: false, decimals: 0 }) + ' km', onde: 'à tua volta',
      lista: ordenar(dentro).slice(0, TOP), media: dentro.length >= 3 ? media(precos) : D.resumo[estado.comb].media,
      mediaOnde: dentro.length >= 3 ? 'num raio de ' + fmt(raio, { currency: false, decimals: 0 }) + ' km' : 'em Portugal continental',
      postos: dentro.length >= 3 ? dentro.length : D.resumo[estado.comb].postos, mostraDistrito: true, perto: true, raio: raio };
  }

  /* ---------- render ---------- */
  function rodape() {
    return 'Preços comunicados pelos próprios postos ao <a href="https://precoscombustiveis.dgeg.gov.pt/" target="_blank" rel="noopener">portal Preços dos Combustíveis Online da DGEG</a> (Direção-Geral de Energia e Geologia), lidos pelo Literacia Financeira a <b>' +
      esc(dataHoraPT(D.resumo.lidoEmLisboa)) + '</b>. A ordenação, as médias e a poupança são cálculo nosso, não informação da DGEG. A média é a média simples dos preços afixados, sem descontos de cartões, por isso fica acima do preço médio oficial da DGEG, que pondera as quantidades vendidas e inclui descontos. Só entram postos com preço atualizado nos últimos ' +
      (estado.comb === 'gpl' ? '31' : '8') + ' dias.';
  }
  function render(v) {
    var c = COMB[estado.comb];
    $('lfcmb-titulo').textContent = v.titulo;
    var horas = horasDesde(D.resumo.lidoEm), tag = $('lfcmb-hora');
    tag.textContent = (horas > MAX_HORAS_AVISO ? 'Última leitura na DGEG: ' : 'Lido na DGEG ') + quando(String(D.resumo.lidoEmLisboa).replace(' ', 'T'));
    tag.className = 'lfk-tag is-sm ' + (horas > MAX_HORAS_AVISO ? 'is-warn' : 'is-ok');

    var tb = $('lfcmb-linhas'), aviso = $('lfcmb-sem');
    if (!v.lista.length) {
      $('lfcmb-kpis').hidden = true; $('lfcmb-tabela-wrap').hidden = true; $('lfcmb-frase').hidden = true;
      aviso.hidden = false;
      aviso.textContent = v.perto ? 'Não encontrámos postos com ' + c.art.replace(/^[oa] /, '') + ' num raio de ' + fmt(RAIO_MAX_KM, { currency: false, decimals: 0 }) + ' km. Escolhe um distrito ou um concelho.' :
        'Não há postos com preço recente de ' + c.nome.toLowerCase() + ' ' + v.onde + '.';
      $('lfcmb-fonte').innerHTML = rodape();
      return;
    }
    aviso.hidden = true; $('lfcmb-kpis').hidden = false; $('lfcmb-tabela-wrap').hidden = false; $('lfcmb-frase').hidden = false;
    var min = v.lista[0], temMedia = v.media != null;
    $('lfcmb-k-min').textContent = preco(min.preco);
    $('lfcmb-k-min-s').textContent = 'por litro, ' + (v.perto ? 'a ' + fmt(min.km, { currency: false, decimals: 1 }) + ' km (' + min.municipio + ')' :
      v.concelho ? 'em ' + min.nome : v.mostraDistrito ? 'em ' + min.municipio + ' (' + nomeDistrito(min.distrito) + ')' : 'em ' + min.municipio);
    $('lfcmb-k-media').textContent = temMedia ? preco(v.media) : '-';
    $('lfcmb-k-media-s').textContent = temMedia ? 'em ' + fmt(v.postos, { currency: false, decimals: 0 }) + ' postos, ' + v.mediaOnde : '';
    $('lfcmb-k-poup').textContent = temMedia ? fmt(Math.max(0, v.media - min.preco) * DEPOSITO_L) : '-';
    $('lfcmb-k-poup-s').textContent = temMedia ? 'no mais barato, face à média ' + v.mediaOnde : '';

    $('lfcmb-th-local').textContent = v.perto ? 'Distância' : 'Atualizado';
    tb.innerHTML = v.lista.map(function (p, i) {
      var d = temMedia ? p.preco - v.media : 0;
      var link = '<a class="lfk-link lfcmb-mapa" href="' + esc(mapa(p)) + '" target="_blank" rel="noopener">Como chegar</a>';
      var onde = v.perto ? p.municipio + ' · ' + fmt(p.km, { currency: false, decimals: 1 }) + ' km' : v.concelho ? (p.localidade || p.municipio) : v.mostraDistrito ? p.municipio + ', ' + nomeDistrito(p.distrito) : p.municipio;
      return '<tr' + (i === 0 ? ' class="is-on"' : '') + '><td class="lfcmb-rank lfcmb-esconde">' + (i + 1) + '</td>' +
        '<td><div class="lfcmb-posto"><span class="' + (i === 0 ? 'lfcmb-top' : '') + '"><span class="lfcmb-so-movel">' + (i + 1) + '. </span>' + esc(p.nome) + '</span><small>' + esc(onde) + '</small><small class="lfcmb-so-movel">' + link + '</small></div></td>' +
        '<td class="is-num"><b>' + preco(p.preco) + '</b></td>' +
        '<td class="is-num lfcmb-esconde ' + (d < 0 ? 'lfk-pos' : d > 0 ? 'lfk-neg' : '') + '">' + (temMedia ? dif(d) : '-') + '</td>' +
        '<td class="lfcmb-esconde lfcmb-esconde-m">' + esc(v.perto ? fmt(p.km, { currency: false, decimals: 1 }) + ' km' : quando(p.atualizado)) + '</td>' +
        '<td class="is-num lfcmb-esconde">' + link + '</td></tr>';
    }).join('');

    var caro = v.lista[v.lista.length - 1], frase;
    if (temMedia) {
      frase = (c.art.charAt(0).toUpperCase() + c.art.slice(1)) + ' mais barat' + (estado.comb === 'gasolina' ? 'a' : 'o') + ' ' + v.onde + ' está a <b>' + preco(min.preco) + '</b> por litro' +
        (v.media > min.preco ? ', <b>' + cent(v.media - min.preco) + ' abaixo da média afixada</b> ' + v.mediaOnde : '') + '. Num depósito de ' + DEPOSITO_L + ' litros são <b>' + fmt(Math.max(0, v.media - min.preco) * DEPOSITO_L) + '</b> a menos do que num posto na média' +
        (v.lista.length > 1 && caro.preco > min.preco ? ' e <b>' + fmt((caro.preco - min.preco) * DEPOSITO_L) + '</b> a menos do que no ' + v.lista.length + '.º posto desta lista.' : '.');
      if (v.poucos != null) frase += ' Como o concelho tem ' + (v.poucos ? 'só ' + v.poucos + ' posto' + (v.poucos === 1 ? '' : 's') : 'poucos postos') + ', a comparação é com a média do distrito.';
    } else {
      frase = (c.art.charAt(0).toUpperCase() + c.art.slice(1)) + ' mais barat' + (estado.comb === 'gasolina' ? 'a' : 'o') + ' ' + v.onde + ' está a <b>' + preco(min.preco) + '</b> por litro.';
    }
    $('lfcmb-frase').innerHTML = frase;
    $('lfcmb-fonte').innerHTML = rodape();
  }
  function renderDistritos() {
    var r = D.resumo[estado.comb], nacional = r.media;
    $('lfcmb-d-titulo').textContent = COMB[estado.comb].nome + ': onde é mais barato em cada distrito';
    var linhas = (r.distritos || []).map(function (x) { return { nome: x[0], postos: x[1], media: x[2], minimo: x[3] }; })
      .sort(function (a, b) { return a.media - b.media; });
    $('lfcmb-d-linhas').innerHTML = linhas.map(function (l) {
      var d = nacional != null ? l.media - nacional : 0;
      return '<tr' + (l.nome === estado.distrito && !estado.concelho && !estado.geo ? ' class="is-on"' : '') + '><td><a class="lfk-link" href="#" data-distrito="' + esc(l.nome) + '">' + esc(nomeDistrito(l.nome)) + '</a></td>' +
        '<td class="is-num">' + preco(l.media) + '</td><td class="is-num lfcmb-esconde">' + preco(l.minimo) + '</td>' +
        '<td class="is-num lfcmb-esconde ' + (d < 0 ? 'lfk-pos' : d > 0 ? 'lfk-neg' : '') + '">' + (nacional != null ? dif(d) : '-') + '</td></tr>';
    }).join('');
    $('lfcmb-d-nota').textContent = 'Média simples dos preços afixados nos postos de cada distrito' + (linhas.some(function (l) { return ehIlha(l.nome); }) ? ' e região autónoma (a média nacional é só do continente)' : '') + '. Clica num distrito para veres os postos.';
  }
  function mostrarResultados() {
    $('lfcmb-estado').hidden = true;
    $('lfcmb-resultados').hidden = false;
    if (window.ScrollTrigger && window.ScrollTrigger.refresh) setTimeout(function () { window.ScrollTrigger.refresh(); }, 0);
  }
  function erro(msg) {
    var e = $('lfcmb-estado');
    e.hidden = false;
    e.innerHTML = '<div class="lfk-alert is-err">' + esc(msg) + '</div>';
  }
  function aviso(msg, tipo) {
    var a = $('lfcmb-aviso');
    if (!msg) { a.hidden = true; return; }
    a.className = 'lfk-alert ' + (tipo || 'is-warn'); a.textContent = msg; a.hidden = false;
  }

  /* ---------- formulário ---------- */
  function preencherDistritos() {
    var sel = el.distrito, atual = sel.value, lista = distritos();
    sel.innerHTML = '<option value="">Todo o país</option>' + lista.map(function (d) { return '<option value="' + esc(d) + '">' + esc(nomeDistrito(d)) + '</option>'; }).join('');
    sel.value = lista.indexOf(atual) !== -1 ? atual : '';
    sel.dispatchEvent(new Event('change', { bubbles: true })); /* o dropdown do kit acompanha o select */
  }
  function preencherConcelhos() {
    var d = el.distrito.value, campo = $('lfcmb-campo-concelho'), sel = el.concelho;
    var lista = d && D.top.concelhos ? (D.top.concelhos[d] || []) : [];
    var atual = sel.value;
    sel.innerHTML = '<option value="">Todos os concelhos</option>' + lista.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');
    sel.value = lista.indexOf(atual) !== -1 ? atual : '';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    campo.hidden = !lista.length;
  }
  function lerFormulario() {
    var b = el.comb.querySelector('button[aria-pressed="true"]');
    estado.comb = b ? b.getAttribute('data-comb') : 'gasoleo';
    estado.distrito = el.distrito.value || '';
    estado.concelho = estado.distrito ? (el.concelho.value || '') : '';
  }
  function escreverHash() {
    var h = '#' + estado.comb + (estado.distrito ? '/' + slug(estado.distrito) + (estado.concelho ? '/' + slug(estado.concelho) : '') : '');
    try { history.replaceState(null, '', location.pathname + location.search + (h === '#gasoleo' ? '' : h)); } catch (e) { /* sem history: fica como está */ }
  }
  function lerHash() {
    var p = (location.hash || '').replace(/^#/, '').split('/');
    if (!COMB[p[0]]) return;
    estado.comb = p[0];
    var ds = distritos();
    for (var i = 0; i < ds.length; i++) if (slug(ds[i]) === p[1]) { estado.distrito = ds[i]; break; }
    if (estado.distrito && p[2] && D.top.concelhos && D.top.concelhos[estado.distrito]) {
      var cs = D.top.concelhos[estado.distrito];
      for (var j = 0; j < cs.length; j++) if (slug(cs[j]) === p[2]) { estado.concelho = cs[j]; break; }
    }
  }
  function sincronizarFormulario() {
    el.comb.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-comb') === estado.comb ? 'true' : 'false'); });
    el.distrito.value = estado.distrito;
    el.distrito.dispatchEvent(new Event('change', { bubbles: true }));
    preencherConcelhos();
    el.concelho.value = estado.concelho;
    el.concelho.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* aplica o estado: escolhe a vista, carrega o ficheiro completo se for preciso e desenha */
  function aplicar(rolar) {
    aviso('');
    renderDistritos();
    function pronto(v) { render(v); mostrarResultados(); escreverHash(); if (rolar) rolarAte($('lfcmb-resultados')); }
    if (estado.geo) {
      carregarTodos(function (e) {
        if (e) { aviso('Não conseguimos carregar a lista completa dos postos. Tenta outra vez daqui a pouco.', 'is-err'); return; }
        pronto(vistaPerto(estado.geo.lat, estado.geo.lon));
      });
      return;
    }
    if (estado.distrito && estado.concelho) {
      el.ver.disabled = true;
      carregarTodos(function (e) {
        el.ver.disabled = false;
        if (e) { aviso('Não conseguimos carregar os postos deste concelho. Tenta outra vez daqui a pouco.', 'is-err'); return; }
        pronto(vistaConcelho(estado.distrito, estado.concelho));
      });
      return;
    }
    pronto(estado.distrito ? vistaDistrito(estado.distrito) : vistaPais());
  }

  function localizar() {
    if (!navigator.geolocation) { aviso('O teu browser não permite obter a localização. Escolhe o distrito e o concelho.', 'is-err'); return; }
    el.perto.disabled = true;
    var antes = el.perto.textContent;
    el.perto.textContent = 'A obter a localização...';
    navigator.geolocation.getCurrentPosition(function (pos) {
      el.perto.disabled = false; el.perto.textContent = antes;
      lerFormulario();
      estado.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      estado.distrito = ''; estado.concelho = '';
      el.distrito.value = ''; el.distrito.dispatchEvent(new Event('change', { bubbles: true })); preencherConcelhos();
      aplicar(true);
    }, function (err) {
      el.perto.disabled = false; el.perto.textContent = antes;
      aviso(err && err.code === 1 ? 'Para veres os postos à tua volta, autoriza a localização no browser. A localização não sai do teu telemóvel: a conta é feita aqui na página.' :
        'Não conseguimos obter a tua localização. Escolhe o distrito e o concelho.', 'is-warn');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  }

  /* ---------- arranque ---------- */
  function iniciar() {
    el.comb = $('lfcmb-comb'); el.distrito = $('lfcmb-distrito'); el.concelho = $('lfcmb-concelho'); el.ver = $('lfcmb-ver'); el.perto = $('lfcmb-perto');
    if (!el.comb || !el.distrito || !el.ver) return;
    var faltam = 2;
    function depois(e) {
      if (e) { erro('Não conseguimos carregar os preços dos postos. Tenta outra vez daqui a pouco.'); return; }
      if (--faltam) return;
      if (!D.resumo[estado.comb] || !D.top[estado.comb]) { erro('Ainda não há preços de postos para mostrar.'); return; }
      lerHash();
      preencherDistritos();
      sincronizarFormulario();
      aplicar(false);
    }
    pedir('postos-resumo.json', function (e, j) { if (!e) D.resumo = j; depois(e); });
    pedir('postos-top.json', function (e, j) { if (!e) D.top = j; depois(e); });

    el.distrito.addEventListener('change', preencherConcelhos);
    el.ver.addEventListener('click', function (e) { e.preventDefault(); if (!D.resumo || !D.top) return; estado.geo = null; lerFormulario(); aplicar(true); });
    el.perto.addEventListener('click', function (e) { e.preventDefault(); if (!D.resumo || !D.top) return; localizar(); });
    $('lfcmb-d-linhas').addEventListener('click', function (e) {
      var a = e.target.closest ? e.target.closest('a[data-distrito]') : null; if (!a) return;
      e.preventDefault();
      estado.geo = null; estado.distrito = a.getAttribute('data-distrito'); estado.concelho = '';
      el.distrito.value = estado.distrito; el.distrito.dispatchEvent(new Event('change', { bubbles: true }));
      preencherConcelhos();
      aplicar(true);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
