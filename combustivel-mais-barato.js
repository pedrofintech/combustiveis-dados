/* Combustível mais barato: a ferramenta da página /combustivel-mais-barato do literaciafinanceira.pt.
   Mostra os postos mais baratos do país, de um distrito, de um concelho ou à volta do utilizador, para gasóleo simples,
   gasolina simples 95 e GPL Auto, com os preços que os postos comunicam ao portal Preços dos Combustíveis Online da DGEG.

   Dados (escritos pelo dgeg-postos.mjs deste repositório, lidos na API oficial da DGEG às 3h, 13h e 20h):
   - postos-resumo.json  médias nacionais e por distrito (só Portugal continental na média nacional)
   - postos-top.json     os 10 postos mais baratos de cada distrito e a lista de concelhos de cada distrito
   - postos-todos.json   todos os postos com preço recente e coordenadas; só se carrega para o filtro por concelho e para
                         "Perto de mim" (uns 80 KB comprimidos)
   - ilhas.json          preços máximos dos Açores e da Madeira (escrito pelo ilhas-precos.mjs a partir dos jornais oficiais).
                         A DGEG só tem os postos do continente; nas ilhas o preço é um máximo fixado pelo Governo Regional,
                         por isso as duas regiões aparecem no campo Distrito com esse preço em vez de uma lista de postos.
   O HTML da ferramenta está no embed da página (cópia em combustivel-mais-barato.html) e usa o LF kit (lf-site-assets/kit).
   Condições da DGEG: citar a DGEG com a data e a hora da leitura e dizer que a ordenação, as médias e a poupança são
   cálculo nosso. Os textos que o fazem estão em rodape() e no HTML do embed. */
(function () {
  'use strict';
  if (window.__lfCombBarato) return;
  window.__lfCombBarato = true;

  /* Fontes dos dados, por ordem. O raw.githubusercontent.com tem a versão mais recente (5 minutos de cache), mas o GitHub
     limita os pedidos anónimos por IP e às vezes responde com erro (429) ou nem responde. Quando falha, a página vai buscar
     os mesmos ficheiros ao jsDelivr, a CDN que já serve o kit e este ficheiro; o workflow "Ler postos DGEG" manda o jsDelivr
     atualizar a cópia a seguir a cada leitura. window.__lfCombBaratoDados troca as fontes (texto ou lista): usa-se no staging. */
  var FONTES = window.__lfCombBaratoDados ? [].concat(window.__lfCombBaratoDados) : [
    'https://raw.githubusercontent.com/pedrofintech/combustiveis-dados/main/',
    'https://cdn.jsdelivr.net/gh/pedrofintech/combustiveis-dados@main/'
  ];
  var ESPERA_MS = 6000;     /* fonte que não começa a responder neste tempo conta como falhada e passa-se à seguinte */
  var ESPERA_TOTAL_MS = 30000; /* limite para o pedido inteiro (ligações muito lentas) */
  var NOVA_VOLTA_MS = 1200; /* pausa antes de voltar a tentar todas as fontes (faz-se uma segunda volta antes de mostrar o erro) */
  var RAIO_KM = 15, RAIO_MAX_KM = 40, TOP = 10, DEPOSITO_L = 50;
  var MAX_HORAS_AVISO = 30; /* leitura com mais horas do que isto: aviso de que os preços podem estar desatualizados */
  var PERTO = '__perto'; /* valor da opção "Perto de mim" no select do distrito: usa a localização do browser */
  var COMB = {
    gasoleo: { nome: 'Gasóleo simples', art: 'o gasóleo simples' },
    gasolina: { nome: 'Gasolina simples 95', art: 'a gasolina simples 95' },
    gpl: { nome: 'GPL Auto', art: 'o GPL Auto' }
  };
  var CONTINENTE = ['Aveiro', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra', 'Évora', 'Faro', 'Guarda', 'Leiria', 'Lisboa',
    'Portalegre', 'Porto', 'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu'];
  /* Açores e Madeira: preço máximo fixado pelo Governo Regional (Madeira todas as semanas, Açores todos os meses).
     lat/lon: caixa à volta de cada arquipélago, para "Perto de mim" (as Selvagens contam como Madeira). */
  var ILHAS = {
    acores: { nome: 'Açores', em: 'nos Açores', Em: 'Nos Açores', fuso: 'Atlantic/Azores', quando: 'todos os meses', periodo: 'deste mês',
      jornal: 'Jornal Oficial da Região Autónoma dos Açores', link: 'https://jo.azores.gov.pt/', lat: [36.5, 40.2], lon: [-31.7, -24.2] },
    madeira: { nome: 'Madeira', em: 'na Madeira', Em: 'Na Madeira', fuso: 'Atlantic/Madeira', quando: 'todas as semanas', periodo: 'desta semana',
      jornal: 'Jornal Oficial da Região Autónoma da Madeira', link: 'https://joram.madeira.gov.pt/joram/2serie/', lat: [29.8, 33.4], lon: [-17.7, -15.5] }
  };
  var ESPERA_ILHAS_MS = 1500; /* a ferramenta não espera mais do que isto pelo ilhas.json; se chegar depois, as ilhas entram nessa altura */

  var D = { resumo: null, top: null, todos: null, todosPedido: null, ilhas: null, ilhasPronto: false };
  var estado = { comb: 'gasoleo', distrito: '', concelho: '', geo: null };
  var el = {};

  /* ---------- utilitários ---------- */
  function $(id) { return document.getElementById(id); }
  function fmt(v, o) { return window.LFK && LFK.fmt ? LFK.fmt(v, o) : String(v); }
  function preco(v) { return fmt(v, { decimals: 3 }); }
  function cents(v) { var c = Math.abs(v) * 100; return fmt(c, { currency: false, decimals: c % 1 === 0 ? 0 : 1 }); }
  function cent(v) { var c = Math.abs(v) * 100; return cents(v) + (Math.round(c * 10) === 10 ? ' cêntimo' : ' cêntimos'); }
  /* diferença face à média; arredondada a zero fica "0,0 cênt." sem sinal (nunca "-0,0") */
  function dif(v) { var c = Math.round(Math.abs(v) * 1000) / 10; return (c === 0 ? '' : v < 0 ? '-' : '+') + fmt(c, { currency: false, decimals: 1 }) + ' cênt.'; }
  /* "mais barata" para a gasolina, "mais barato" para o gasóleo e o GPL */
  function maisBarato() { return estado.comb === 'gasolina' ? 'mais barata' : 'mais barato'; }
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
  /* o Porto e a Guarda levam artigo: "distrito do Porto", "distrito da Guarda" */
  function deDistrito(d) { return d === 'Porto' ? 'do Porto' : d === 'Guarda' ? 'da Guarda' : 'de ' + d; }
  /* concelhos que levam artigo: "na Maia", "no Porto", "nas Caldas da Rainha"; os outros levam "em": "em Lisboa" */
  var ARTIGO = {
    'Porto': 'o', 'Barreiro': 'o', 'Seixal': 'o', 'Montijo': 'o', 'Cadaval': 'o', 'Bombarral': 'o', 'Cartaxo': 'o', 'Entroncamento': 'o',
    'Sardoal': 'o', 'Crato': 'o', 'Gavião': 'o', 'Sabugal': 'o', 'Redondo': 'o', 'Alandroal': 'o', 'Fundão': 'o', 'Marco de Canaveses': 'o',
    'Peso da Régua': 'o',
    'Maia': 'a', 'Trofa': 'a', 'Póvoa de Varzim': 'a', 'Póvoa de Lanhoso': 'a', 'Amadora': 'a', 'Azambuja': 'a', 'Lourinhã': 'a', 'Moita': 'a',
    'Nazaré': 'a', 'Batalha': 'a', 'Marinha Grande': 'a', 'Figueira da Foz': 'a', 'Lousã': 'a', 'Pampilhosa da Serra': 'a', 'Mealhada': 'a',
    'Murtosa': 'a', 'Covilhã': 'a', 'Sertã': 'a', 'Guarda': 'a', 'Golegã': 'a', 'Chamusca': 'a', 'Vidigueira': 'a',
    'Caldas da Rainha': 'as'
  };
  function emLocal(c) { var a = ARTIGO[c]; return (a ? 'n' + a + ' ' : 'em ') + c; }
  function deLocal(c) { var a = ARTIGO[c]; return (a ? 'd' + a + ' ' : 'de ') + c; }
  function noDistrito(d) { return ehIlha(d) ? (regiaoIlha(d) ? ILHAS[regiaoIlha(d)].em : 'em ' + d) : 'no distrito ' + deDistrito(d); }
  /* nomes que a API devolve todos em maiúsculas passam a Título */
  function nome(s) {
    s = String(s || '').replace(/\s+/g, ' ').trim();
    if (s.length > 4 && s === s.toUpperCase() && s !== s.toLowerCase()) {
      s = s.toLowerCase().replace(/(^|[\s\-\/(."'])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); })
        .replace(/(\s)(De|Da|Do|Das|Dos|E|Em|A|O)(?=\s)/g, function (m, a, b) { return a + b.toLowerCase(); }) /* "de", "e" no meio do nome */
        .replace(/\b(Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, function (m) { return m.toUpperCase(); }) /* numeração romana: "Gaia III" */
        .replace(/\bS\.a\./g, 'S.A.').replace(/\bE\.p\./g, 'E.P.');
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

  /* ---------- ilhas ---------- */
  function regiaoIlha(d) { return /madeira/i.test(d || '') ? 'madeira' : /a[çc]ores/i.test(d || '') ? 'acores' : null; }
  function regiaoDaPosicao(lat, lon) {
    for (var r in ILHAS) if (Object.prototype.hasOwnProperty.call(ILHAS, r) && lat >= ILHAS[r].lat[0] && lat <= ILHAS[r].lat[1] && lon >= ILHAS[r].lon[0] && lon <= ILHAS[r].lon[1]) return r;
    return null;
  }
  function despachoValido(p) { return !!p && /^\d{4}-\d{2}-\d{2}$/.test(p.desde) && p.gasoleo > 0 && p.gasolina > 0 && !!p.ato; }
  function despachosIlha(r) {
    var reg = D.ilhas && D.ilhas.regioes && D.ilhas.regioes[r];
    return reg && reg.precos && reg.precos.filter ? reg.precos.filter(despachoValido) : [];
  }
  function ilhasComPrecos() { return ['acores', 'madeira'].filter(function (r) { return despachosIlha(r).length > 0; }); }
  function hojeEm(fuso) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); } catch (e) { return hojeLisboa(); }
  }
  function diasEntre(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5); }
  function mesesEntre(a, b) { return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7)); }
  /* O despacho em vigor hoje (o mais recente que já entrou em vigor) e o seguinte, se já foi publicado. O preço pode estar
     desatualizado quando falta o despacho do período em curso: na Madeira, o que está em vigor tem 7 dias ou mais; nos
     Açores, é de um mês anterior. Com duas semanas ou dois meses de atraso deixa de se mostrar o preço. */
  function situacaoIlha(r) {
    var dia = hojeEm(ILHAS[r].fuso), lista = despachosIlha(r).slice().sort(function (a, b) { return a.desde < b.desde ? 1 : a.desde > b.desde ? -1 : 0; });
    var s = { dia: dia, atual: null, proximo: null, atrasado: false, semPreco: true };
    for (var i = 0; i < lista.length; i++) { if (lista[i].desde <= dia) { s.atual = lista[i]; break; } s.proximo = lista[i]; }
    if (s.atual) {
      if (r === 'madeira') { var d = diasEntre(s.atual.desde, dia); s.atrasado = d >= 7; s.semPreco = d >= 14; }
      else { var m = mesesEntre(s.atual.desde, dia); s.atrasado = m >= 1; s.semPreco = m >= 2; }
    }
    return s;
  }
  function dataCurta(iso) { return parseInt(iso.slice(8, 10), 10) + ' ' + MESES_CURTOS[parseInt(iso.slice(5, 7), 10) - 1]; }
  function dataLonga(iso, comAno) { return parseInt(iso.slice(8, 10), 10) + ' de ' + MESES[parseInt(iso.slice(5, 7), 10) - 1] + (comAno ? ' de ' + iso.slice(0, 4) : ''); }
  var DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
  function diaSemana(iso) { return DIAS_SEMANA[new Date(iso + 'T12:00:00Z').getUTCDay()]; }
  /* só se segue um link para um jornal oficial das regiões */
  function linkOficial(u) { return /^https:\/\/(joram\.madeira\.gov\.pt|jo\.azores\.gov\.pt)\//.test(u || '') ? u : null; }

  /* ---------- dados ---------- */
  function pedirUrl(url, cb) {
    var x = new XMLHttpRequest(), feito = false, relogio;
    function fim(e, j) { if (feito) return; feito = true; clearTimeout(relogio); cb(e, j); }
    x.open('GET', url, true);
    x.timeout = ESPERA_TOTAL_MS;
    x.onreadystatechange = function () {
      if (x.readyState >= 2) clearTimeout(relogio); /* o servidor já respondeu: uma ligação lenta não conta como falha */
      if (x.readyState !== 4) return;
      if (x.status >= 200 && x.status < 300) {
        var j;
        try { j = JSON.parse(x.responseText); } catch (e) { fim(new Error('resposta inválida')); return; } /* inclui a resposta vazia */
        fim(null, j); return;
      }
      var e = new Error(x.status ? 'HTTP ' + x.status : 'sem resposta'); e.status = x.status; fim(e);
    };
    x.onerror = function () { fim(new Error('sem resposta')); };
    x.ontimeout = function () { fim(new Error('demorou demasiado')); };
    relogio = setTimeout(function () { if (x.readyState < 2) { fim(new Error('sem resposta em ' + ESPERA_MS / 1000 + ' s')); try { x.abort(); } catch (e) {} } }, ESPERA_MS);
    x.send();
  }
  /* Pede um ficheiro de dados: tenta as fontes por ordem, a começar pela que respondeu da última vez, e dá duas voltas antes
     de desistir. cb(erro, dados, índice da fonte). Com soFonte, tenta só essa fonte, uma vez. */
  var fonte = 0;
  function pedir(ficheiro, cb, soFonte) {
    var h = new Date();
    var v = '?v=' + h.getUTCFullYear() + (h.getUTCMonth() + 1) + h.getUTCDate() + '-' + h.getUTCHours();
    var ordem = [], volta, i, n = 0, so404 = true;
    if (soFonte != null) ordem.push(soFonte);
    else for (volta = 0; volta < 2; volta++) for (i = 0; i < FONTES.length; i++) ordem.push((fonte + i) % FONTES.length);
    (function tentar() {
      var f = ordem[n], segundaVolta = n >= FONTES.length;
      pedirUrl(FONTES[f] + ficheiro + v + (segundaVolta ? '&r=1' : ''), function (e, j) {
        if (!e) { if (soFonte == null) fonte = f; cb(null, j, f); return; }
        if (e.status !== 404) so404 = false;
        if (window.console && console.warn) console.warn('[combustivel-mais-barato] ' + ficheiro + ' falhou em ' + String(FONTES[f]).split('/')[2] + ': ' + e.message);
        n++;
        if (n >= ordem.length) { var fim = new Error('sem dados'); if (so404) fim.status = 404; cb(fim); return; }
        if (n === FONTES.length) setTimeout(tentar, NOVA_VOLTA_MS); else tentar();
      });
    })();
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
  /* os distritos do continente (com postos na leitura da DGEG) e, no fim, os Açores e a Madeira, se o ilhas.json tiver preços */
  function distritos() {
    var lista = [], ilhas = ilhasComPrecos().map(function (r) { return ILHAS[r].nome; });
    for (var k in D.top[estado.comb]) if (Object.prototype.hasOwnProperty.call(D.top[estado.comb], k)) {
      if (ehIlha(k) && ilhas.indexOf(nomeDistrito(k)) !== -1) continue; /* a região já entra com o preço máximo */
      lista.push(k);
    }
    lista.sort(function (a, b) { var ia = ehIlha(a), ib = ehIlha(b); return ia !== ib ? (ia ? 1 : -1) : a.localeCompare(b, 'pt'); });
    return lista.concat(ilhas);
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
    return { titulo: COMB[estado.comb].nome + ' ' + maisBarato() + ' em Portugal continental', onde: 'do país', lista: ordenar(lista).slice(0, TOP),
      media: r.media, mediaOnde: 'em Portugal continental', postos: r.postos, mostraDistrito: true, pais: true };
  }
  /* Açores ou Madeira: o preço máximo em vigor em vez da lista de postos (perto: escolhido por "Perto de mim") */
  function vistaIlha(r, perto) {
    return { ilha: r, perto: !!perto, situacao: situacaoIlha(r), titulo: COMB[estado.comb].nome + ' ' + ILHAS[r].em, lista: [] };
  }
  function vistaDistrito(d) {
    var top = D.top[estado.comb][d] || [], lista = [];
    for (var i = 0; i < top.length; i++) { var p = postoTop(top[i]); p.distrito = d; lista.push(p); }
    var r = resumoDistrito(d) || {};
    return { titulo: COMB[estado.comb].nome + ' ' + maisBarato() + ' ' + noDistrito(d), onde: noDistrito(d), lista: lista.slice(0, TOP),
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
    var v = { titulo: COMB[estado.comb].nome + ' ' + maisBarato() + ' ' + emLocal(c), onde: emLocal(c), lista: ordenar(lista).slice(0, TOP), mostraDistrito: false, concelho: c };
    if (todosConcelho.length >= 3) { v.media = media(todosConcelho); v.mediaOnde = 'no concelho ' + deLocal(c); v.postos = todosConcelho.length; }
    else { v.media = rd.media; v.mediaOnde = noDistrito(d); v.postos = rd.postos; v.poucos = todosConcelho.length; v.mediaFora = 'do distrito'; }
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
    return { titulo: COMB[estado.comb].nome + ' ' + maisBarato() + ' num raio de ' + fmt(raio, { currency: false, decimals: 0 }) + ' km', onde: 'à tua volta',
      lista: ordenar(dentro).slice(0, TOP), media: dentro.length >= 3 ? media(precos) : D.resumo[estado.comb].media,
      mediaOnde: dentro.length >= 3 ? 'num raio de ' + fmt(raio, { currency: false, decimals: 0 }) + ' km' : 'em Portugal continental',
      postos: dentro.length >= 3 ? dentro.length : D.resumo[estado.comb].postos, mostraDistrito: true, perto: true, raio: raio,
      mediaFora: dentro.length >= 3 ? '' : 'nacional' };
  }

  /* ---------- render ---------- */
  /* Leitura a mostrar: a mais antiga entre os ficheiros que a vista usa. Em condições normais são todos da mesma leitura;
     se uma das cópias de reserva estiver atrasada, a página nunca diz que os preços são mais recentes do que são. */
  function leitura(v) {
    var fs = [D.resumo, D.top], i, m = D.resumo;
    if (v && (v.concelho || v.perto) && D.todos) fs.push(D.todos);
    for (i = 0; i < fs.length; i++) if (fs[i] && fs[i].lidoEm && Date.parse(fs[i].lidoEm) < Date.parse(m.lidoEm)) m = fs[i];
    return m;
  }
  function rodape(v) {
    var l = leitura(v);
    return 'Preços comunicados pelos próprios postos ao <a href="https://precoscombustiveis.dgeg.gov.pt/" target="_blank" rel="noopener">portal Preços dos Combustíveis Online da DGEG</a> (Direção-Geral de Energia e Geologia), lidos pelo Literacia Financeira a <b>' +
      esc(dataHoraPT(l.lidoEmLisboa)) + '</b>. A ordenação, as médias e a poupança são cálculo nosso, não informação da DGEG. A média é a média simples dos preços afixados, sem descontos de cartões, por isso fica acima do preço médio oficial da DGEG, que pondera as quantidades vendidas e inclui descontos. Só entram postos com preço atualizado nos últimos ' +
      (estado.comb === 'gpl' ? '31' : '8') + ' dias.';
  }
  /* textos curtos por baixo dos indicadores, numa linha em computador (classe lfcmb-1l): o sítio já está no título.
     O texto completo fica no title, para os nomes de posto compridos que o ecrã corta com reticências. */
  function sub(id, txt) { var e = $(id); e.textContent = txt; e.title = txt; e.classList.add('lfcmb-1l'); }
  /* A vista das ilhas troca os rótulos dos indicadores, a cor do primeiro e esconde a dica da tabela; as outras vistas repõem. */
  var ROTULOS = null;
  function rotulos(lista) {
    var ls = document.querySelectorAll('#lfcmb-kpis .lfk-stat-l'), i;
    if (!ROTULOS) { ROTULOS = []; for (i = 0; i < ls.length; i++) ROTULOS.push(ls[i].textContent); }
    for (i = 0; i < ls.length; i++) ls[i].textContent = (lista || ROTULOS)[i];
  }
  function dicaTabela() { return $('lfcmb-tabela-wrap').nextElementSibling; } /* "Clica no nome do posto para veres o caminho no Google Maps." */
  function render(v) {
    if (v.ilha) { renderIlha(v); return; }
    var c = COMB[estado.comb], stats = document.querySelectorAll('#lfcmb-kpis .lfk-stat');
    rotulos(null);
    if (stats[0]) stats[0].classList.add('lfcmb-ok');
    if (stats[1]) stats[1].classList.remove('lfcmb-ok');
    $('lfcmb-titulo').textContent = v.titulo;
    var lida = leitura(v), horas = horasDesde(lida.lidoEm), tag = $('lfcmb-hora');
    tag.hidden = false;
    tag.textContent = (horas > MAX_HORAS_AVISO ? 'Última leitura na DGEG: ' : 'Lido na DGEG ') + quando(String(lida.lidoEmLisboa).replace(' ', 'T'));
    tag.className = 'lfk-tag is-sm ' + (horas > MAX_HORAS_AVISO ? 'is-warn' : 'is-ok');

    var tb = $('lfcmb-linhas'), aviso = $('lfcmb-sem'), dica = dicaTabela();
    if (dica) dica.hidden = !v.lista.length;
    if (!v.lista.length) {
      $('lfcmb-kpis').hidden = true; $('lfcmb-tabela-wrap').hidden = true; $('lfcmb-frase').hidden = true;
      aviso.hidden = false; aviso.className = 'lfk-alert';
      aviso.textContent = v.perto ? 'Não encontrámos postos com ' + c.art.replace(/^[oa] /, '') + ' num raio de ' + fmt(RAIO_MAX_KM, { currency: false, decimals: 0 }) + ' km. Escolhe um distrito ou um concelho.' :
        'Não há postos com preço recente de ' + c.nome.toLowerCase() + ' ' + v.onde + '.';
      $('lfcmb-fonte').innerHTML = rodape(v);
      return;
    }
    aviso.hidden = true; $('lfcmb-kpis').hidden = false; $('lfcmb-tabela-wrap').hidden = false; $('lfcmb-frase').hidden = false;
    var min = v.lista[0], temMedia = v.media != null;
    $('lfcmb-k-min').textContent = preco(min.preco);
    sub('lfcmb-k-min-s', v.perto ? 'a ' + fmt(min.km, { currency: false, decimals: 1 }) + ' km, ' + emLocal(min.municipio) :
      v.concelho ? 'em ' + min.nome : emLocal(min.municipio));
    $('lfcmb-k-media').textContent = temMedia ? preco(v.media) : '-';
    sub('lfcmb-k-media-s', !temMedia ? '' : v.mediaFora ? 'média ' + v.mediaFora : 'em ' + fmt(v.postos, { currency: false, decimals: 0 }) + ' postos');
    $('lfcmb-k-poup').textContent = temMedia ? fmt(Math.max(0, v.media - min.preco) * DEPOSITO_L) : '-';
    sub('lfcmb-k-poup-s', temMedia ? 'face à média' + (v.mediaFora ? ' ' + v.mediaFora : '') : '');

    $('lfcmb-th-local').textContent = v.perto ? 'Distância' : 'Atualizado';
    tb.innerHTML = v.lista.map(function (p, i) {
      var d = temMedia ? p.preco - v.media : 0;
      /* o nome do posto é o link para o caminho no Google Maps (abre noutro separador) */
      var nomeLink = '<a class="lfk-link" href="' + esc(mapa(p)) + '" target="_blank" rel="noopener" title="Como chegar (Google Maps)">' + esc(p.nome) + '</a>';
      var onde = v.concelho ? (p.localidade || p.municipio) : v.mostraDistrito && !v.perto ? p.municipio + ', ' + nomeDistrito(p.distrito) : p.municipio;
      /* em ecrãs estreitos a última coluna (distância ou hora de atualização) esconde-se e passa para ao lado do concelho */
      var km = '<span class="lfcmb-so-estreito"> · ' + (v.perto ? fmt(p.km, { currency: false, decimals: 1 }) + ' km' : 'atualizado ' + esc(quando(p.atualizado))) + '</span>';
      var corDif = d < 0 ? 'lfk-pos' : d > 0 ? 'lfk-neg' : '';
      return '<tr' + (i === 0 ? ' class="is-on"' : '') + '><td class="lfcmb-rank lfcmb-esconde">' + (i + 1) + '</td>' +
        '<td><div class="lfcmb-posto"><span class="' + (i === 0 ? 'lfcmb-top' : '') + '"><span class="lfcmb-so-movel">' + (i + 1) + '. </span>' + nomeLink + '</span><small>' + esc(onde) + km + '</small></div></td>' +
        '<td class="is-num"><b>' + preco(p.preco) + '</b>' + (temMedia ? '<small class="lfcmb-dif-movel ' + corDif + '">' + dif(d) + '</small>' : '') + '</td>' +
        '<td class="is-num lfcmb-esconde ' + corDif + '">' + (temMedia ? dif(d) : '-') + '</td>' +
        '<td class="lfcmb-esconde lfcmb-esconde-m">' + esc(v.perto ? fmt(p.km, { currency: false, decimals: 1 }) + ' km' : quando(p.atualizado)) + '</td></tr>';
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
    if (v.pais && ilhasComPrecos().length) frase += ' Nos Açores e na Madeira o preço é um máximo fixado pelo Governo Regional: escolhe a região no campo Distrito.';
    $('lfcmb-frase').innerHTML = frase;
    $('lfcmb-fonte').innerHTML = rodape(v);
  }

  /* Açores ou Madeira: preço máximo em vigor, diferença para a média dos postos do continente, custo de 50 litros e, se já
     foi publicado, o preço seguinte. Sem lista de postos (a DGEG não os tem) e sem GPL Auto (não tem preço fixado). */
  function renderIlha(v) {
    var c = COMB[estado.comb], r = v.ilha, I = ILHAS[r], s = v.situacao, a = s.atual, k = estado.comb;
    var kpis = $('lfcmb-kpis'), stats = kpis.querySelectorAll('.lfk-stat'), aviso = $('lfcmb-sem'), tag = $('lfcmb-hora'), dica = dicaTabela();
    var l = leitura(v), med = D.resumo[k] ? D.resumo[k].media : null;
    $('lfcmb-titulo').textContent = v.titulo;
    $('lfcmb-tabela-wrap').hidden = true;
    if (dica) dica.hidden = true;
    function despacho(p) {
      var u = linkOficial(p.url), nomeAto = esc(p.ato);
      return (u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + nomeAto + '</a>' : nomeAto) +
        ' (' + esc(I.jornal) + (p.jornal ? ', ' + esc(p.jornal) : '') + (p.publicado ? ', de ' + esc(dataLonga(p.publicado, true)) : '') + ')';
    }
    var dgeg = 'A média do continente é a média simples dos preços afixados nos postos, comunicados ao <a href="https://precoscombustiveis.dgeg.gov.pt/" target="_blank" rel="noopener">portal Preços dos Combustíveis Online da DGEG</a> e lidos pelo Literacia Financeira a <b>' +
      esc(dataHoraPT(l.lidoEmLisboa)) + '</b>. A diferença e o custo do depósito são cálculo nosso, não informação da DGEG nem do Governo Regional.';
    var jornalLink = '<a href="' + esc(I.link) + '" target="_blank" rel="noopener">' + esc(I.jornal) + '</a>';

    if (k === 'gpl' || s.semPreco) {
      kpis.hidden = true; $('lfcmb-frase').hidden = true; tag.hidden = true;
      aviso.hidden = false;
      if (k === 'gpl') {
        aviso.className = 'lfk-alert';
        aviso.textContent = I.Em + ' o GPL Auto não tem preço máximo fixado pelo Governo Regional, e a DGEG só tem os preços dos postos de Portugal continental. Por isso não temos preços de GPL Auto ' + I.em + '.';
        $('lfcmb-fonte').innerHTML = 'Os preços máximos dos Açores e da Madeira são fixados pelos Governos Regionais e publicados nos jornais oficiais. Abrangem a gasolina 95 e o gasóleo, mas não o GPL Auto.';
      } else {
        aviso.className = 'lfk-alert is-warn';
        aviso.innerHTML = 'Ainda não encontrámos o preço máximo ' + I.periodo + ' ' + I.em + '. Confirma no ' + jornalLink + '.';
        $('lfcmb-fonte').innerHTML = I.Em + ' o preço dos combustíveis é um máximo fixado ' + I.quando + ' pelo Governo Regional e publicado no ' + esc(I.jornal) + '.';
      }
      return;
    }

    kpis.hidden = false; aviso.hidden = true; $('lfcmb-frase').hidden = false; tag.hidden = false;
    rotulos(['Preço máximo', 'Face à média do continente', 'Atestar ' + DEPOSITO_L + ' litros']);
    var p = a[k], d = med != null ? p - med : null;
    if (stats[0]) stats[0].classList.remove('lfcmb-ok');
    if (stats[1]) stats[1].classList.toggle('lfcmb-ok', d != null && Math.round(d * 1000) < 0); /* a verde quando fica mais barato */
    $('lfcmb-k-min').textContent = preco(p);
    sub('lfcmb-k-min-s', 'fixado pelo Governo Regional');
    $('lfcmb-k-media').textContent = d == null ? '-' : dif(d);
    sub('lfcmb-k-media-s', med != null ? 'média afixada: ' + preco(med) : '');
    $('lfcmb-k-poup').textContent = fmt(p * DEPOSITO_L);
    sub('lfcmb-k-poup-s', 'ao preço máximo');
    tag.textContent = (s.atrasado ? 'Último preço encontrado: ' : 'Em vigor desde ') + dataCurta(a.desde);
    tag.className = 'lfk-tag is-sm ' + (s.atrasado ? 'is-warn' : 'is-ok');

    var frase = (v.perto ? 'Pela tua localização, estás ' + I.em + '. Aqui' : I.Em) + ' não há lista de postos: o preço é o máximo fixado ' + I.quando +
      ' pelo Governo Regional, e a DGEG só tem os postos de Portugal continental. Os postos podem vender abaixo deste preço, mas não acima.';
    if (d != null && Math.round(Math.abs(d) * 1000) > 0) frase += ' ' + c.art.charAt(0).toUpperCase() + c.art.slice(1) + ' fica <b>' + cent(d) + (d < 0 ? ' abaixo' : ' acima') + '</b> da média afixada nos postos do continente.';
    if (s.atrasado) frase += ' Ainda não encontrámos o preço ' + I.periodo + ' no ' + jornalLink + ': este entrou em vigor a ' + dataLonga(a.desde) + ' e pode já ter mudado.';
    if (s.proximo) {
      var q = s.proximo[k], dq = q - p, quandoMuda = r === 'madeira' ? diaSemana(s.proximo.desde) + ', ' + dataLonga(s.proximo.desde) : dataLonga(s.proximo.desde);
      frase += ' <b>A partir de ' + quandoMuda + ', ' + (Math.round(Math.abs(dq) * 1000) === 0 ? 'mantém-se em ' + preco(q) + '</b>.' :
        'passa a ' + preco(q) + '</b> (' + (dq < 0 ? 'menos ' : 'mais ') + cent(dq) + ').');
    }
    $('lfcmb-frase').innerHTML = frase;
    $('lfcmb-fonte').innerHTML = 'Preço máximo de venda ao público fixado pelo ' + despacho(a) + (s.proximo ? '. O preço seguinte é do ' + despacho(s.proximo) : '') + '. ' + dgeg;
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
    a.className = 'lfk-alert ' + (tipo == null ? 'is-warn' : tipo); a.textContent = msg; a.hidden = false; /* tipo '' = informativo (azul) */
  }

  /* ---------- formulário ---------- */
  /* O select do distrito tem "Todo o país", "Perto de mim" (localização do browser) e os distritos. */
  function preencherDistritos() {
    var sel = el.distrito, atual = sel.value, lista = distritos();
    sel.innerHTML = '<option value="">Todo o país</option><option value="' + PERTO + '">Perto de mim</option>' +
      lista.map(function (d) { return '<option value="' + esc(d) + '">' + esc(nomeDistrito(d)) + '</option>'; }).join('');
    sel.value = atual === PERTO || lista.indexOf(atual) !== -1 ? atual : '';
    sel.dispatchEvent(new Event('change', { bubbles: true })); /* o dropdown do kit acompanha o select */
  }
  /* O select dos concelhos está sempre à vista. Com um distrito escolhido lista só os concelhos desse distrito; com
     "Todo o país" ou "Perto de mim" lista os concelhos todos (valor "Distrito|Concelho"), e escolher um deles preenche o distrito. */
  function opcaoConcelho(d, c, comNomeDistrito) {
    return '<option value="' + esc(d + '|' + c) + '">' + esc(comNomeDistrito ? c + ' (' + nomeDistrito(d) + ')' : c) + '</option>';
  }
  function preencherConcelhos() {
    var d = el.distrito.value === PERTO ? '' : el.distrito.value, sel = el.concelho, mapa = D.top.concelhos || {}, atual = sel.value, html;
    if (d) {
      html = (mapa[d] || []).map(function (c) { return opcaoConcelho(d, c, false); }).join('');
    } else {
      var todos = [], vezes = {};
      Object.keys(mapa).forEach(function (dd) { mapa[dd].forEach(function (c) { todos.push([dd, c]); vezes[c] = (vezes[c] || 0) + 1; }); });
      todos.sort(function (a, b) { return a[1].localeCompare(b[1], 'pt') || a[0].localeCompare(b[0], 'pt'); });
      html = todos.map(function (x) { return opcaoConcelho(x[0], x[1], vezes[x[1]] > 1); }).join('');
    }
    sel.innerHTML = '<option value="">Todos os concelhos</option>' + html;
    /* mantém o concelho só se continuar a pertencer ao distrito escolhido; voltar a "Todo o país" limpa-o */
    sel.value = d && atual.indexOf(d + '|') === 0 && sel.querySelector('option[value="' + atual.replace(/"/g, '&quot;') + '"]') ? atual : '';
    sel.dispatchEvent(new Event('change', { bubbles: true })); /* o dropdown do kit acompanha o select */
  }
  function concelhoEscolhido() { var v = el.concelho.value || ''; var i = v.indexOf('|'); return i < 0 ? { d: '', c: '' } : { d: v.slice(0, i), c: v.slice(i + 1) }; }
  /* escolher um concelho na lista de todo o país preenche o distrito (e desliga "Perto de mim") e encurta a lista; não calcula nada */
  function aoMudarConcelho() {
    var x = concelhoEscolhido();
    if (!x.c || el.distrito.value === x.d) return;
    estado.geo = null;
    el.distrito.value = x.d;
    el.distrito.dispatchEvent(new Event('change', { bubbles: true })); /* dispara preencherConcelhos, que mantém o valor */
  }
  /* só o utilizador dispara "input" (o kit e o select nativo disparam-no antes do "change"; o nosso código só dispara "change") */
  function aoEscolherDistrito() {
    if (el.distrito.value === PERTO) { if (D.resumo && D.top) localizar(); }
    else { estado.geo = null; aviso(''); }
  }
  function lerFormulario() {
    var b = el.comb.querySelector('button[aria-pressed="true"]');
    estado.comb = b ? b.getAttribute('data-comb') : 'gasoleo';
    var x = concelhoEscolhido(), d = el.distrito.value;
    if (d !== PERTO) estado.geo = null; /* a localização só conta enquanto "Perto de mim" estiver escolhido */
    estado.distrito = (d === PERTO ? '' : d) || x.d || '';
    estado.concelho = x.c && (x.d === estado.distrito) ? x.c : '';
  }
  function escreverHash() {
    var h = '#' + estado.comb + (estado.distrito ? '/' + slug(estado.distrito) + (estado.concelho ? '/' + slug(estado.concelho) : '') : '');
    try { history.replaceState(null, '', location.pathname + location.search + (h === '#gasoleo' ? '' : h)); } catch (e) { /* sem history: fica como está */ }
  }
  function lerHash(h) {
    var p = (h == null ? location.hash || '' : h).replace(/^#/, '').split('/');
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
    el.concelho.value = estado.concelho ? estado.distrito + '|' + estado.concelho : '';
    el.concelho.dispatchEvent(new Event('change', { bubbles: true }));
  }

  /* aplica o estado: escolhe a vista, carrega o ficheiro completo se for preciso e desenha */
  function aplicar(rolar) {
    aviso('');
    /* rola até ao cartão (não até ao bloco que o envolve, que tem margem em cima): o cartão do formulário fica
       escondido debaixo do menu, como nas outras calculadoras */
    function pronto(v) { render(v); mostrarResultados(); escreverHash(); if (rolar) rolarAte($('lfcmb-resultados').firstElementChild || $('lfcmb-resultados')); }
    if (estado.geo) {
      /* nos Açores e na Madeira não há postos na lista da DGEG: mostra o preço máximo da região */
      var rg = regiaoDaPosicao(estado.geo.lat, estado.geo.lon);
      if (rg && despachosIlha(rg).length) { pronto(vistaIlha(rg, true)); return; }
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
    var ri = regiaoIlha(estado.distrito);
    if (ri && despachosIlha(ri).length) { pronto(vistaIlha(ri)); return; }
    pronto(estado.distrito ? vistaDistrito(estado.distrito) : vistaPais());
  }

  /* "Perto de mim": pede a localização ao browser e mostra logo os postos à volta; se falhar, volta a "Todo o país" e explica */
  var aLocalizar = false;
  function semLocalizacao(msg) {
    estado.geo = null;
    if (el.distrito.value === PERTO) { el.distrito.value = ''; el.distrito.dispatchEvent(new Event('change', { bubbles: true })); }
    aviso(msg, 'is-warn');
  }
  function localizar() {
    if (!navigator.geolocation) { semLocalizacao('O teu browser não permite obter a localização. Escolhe o distrito e o concelho.'); return; }
    if (aLocalizar) return;
    aLocalizar = true; el.ver.disabled = true;
    aviso('A obter a tua localização...', '');
    navigator.geolocation.getCurrentPosition(function (pos) {
      aLocalizar = false; el.ver.disabled = false;
      if (el.distrito.value !== PERTO) { aviso(''); return; } /* entretanto escolheu outra coisa */
      estado.geo = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      lerFormulario();
      aplicar(true);
    }, function (err) {
      aLocalizar = false; el.ver.disabled = false;
      semLocalizacao(err && err.code === 1 ? 'Para veres os postos à tua volta, autoriza a localização no browser. A localização não sai do teu dispositivo: a conta é feita aqui na página.' :
        'Não conseguimos obter a tua localização. Escolhe o distrito e o concelho.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 600000 });
  }

  /* ---------- arranque ---------- */
  function iniciar() {
    el.comb = $('lfcmb-comb'); el.distrito = $('lfcmb-distrito'); el.concelho = $('lfcmb-concelho'); el.ver = $('lfcmb-ver');
    if (!el.comb || !el.distrito || !el.ver) return;
    var faltam = 2, origem = {}, falhou = false, arrancou = false, esperaIlhas = null, mexeu = false, hashInicial = location.hash || '';
    /* O resumo e o top têm de ser da mesma leitura. Se vieram de fontes diferentes e uma das cópias está atrasada,
       pedem-se os dois outra vez à fonte que está a responder; se nem assim baterem certo, segue-se com o que há. */
    function mesmaLeitura(cb) {
      if (D.resumo.lidoEm === D.top.lidoEm || FONTES.length < 2) { cb(); return; }
      /* vieram de fontes diferentes: pede-se à que está a responder; vieram da mesma: pede-se à outra */
      var falta = 2, r = null, t = null, f = origem.resumo === origem.top ? (origem.top + 1) % FONTES.length : fonte;
      function junta() { if (--falta) return; if (r && t && r.lidoEm === t.lidoEm) { D.resumo = r; D.top = t; } cb(); }
      pedir('postos-resumo.json', function (e, j) { if (!e) r = j; junta(); }, f);
      pedir('postos-top.json', function (e, j) { if (!e) t = j; junta(); }, f);
    }
    function arrancar() {
      if (arrancou) return;
      arrancou = true;
      if (!D.resumo[estado.comb] || !D.top[estado.comb]) { erro('Ainda não há preços de postos para mostrar.'); return; }
      lerHash();
      preencherDistritos();
      sincronizarFormulario();
      aplicar(false);
    }
    /* o resumo e o top chegaram: arranca já se o ilhas.json também chegou; senão espera por ele, no máximo ESPERA_ILHAS_MS */
    function seguir() {
      if (D.ilhasPronto) { mesmaLeitura(arrancar); return; }
      esperaIlhas = setTimeout(function () { esperaIlhas = null; mesmaLeitura(arrancar); }, ESPERA_ILHAS_MS);
    }
    function depois(e) {
      /* 404: a DGEG ainda não deu a primeira leitura (o ficheiro só existe depois dela). A API abre às 3h, 13h e 20h. */
      if (e) { falhou = true; erro(e.status === 404 ? 'Ainda não temos os preços dos postos. A DGEG dá acesso aos dados às 3h, às 13h e às 20h. A lista aparece aqui logo a seguir à próxima leitura.' : 'Não conseguimos carregar os preços dos postos. Tenta outra vez daqui a pouco.'); return; }
      if (--faltam || falhou) return;
      seguir();
    }
    pedir('postos-resumo.json', function (e, j, f) { if (!e) { D.resumo = j; origem.resumo = f; } depois(e); });
    pedir('postos-top.json', function (e, j, f) { if (!e) { D.top = j; origem.top = f; } depois(e); });
    /* Açores e Madeira: se o ficheiro falhar, a ferramenta funciona na mesma, só sem as ilhas */
    pedir('ilhas.json', function (e, j) {
      D.ilhas = !e && j && j.regioes ? j : null;
      D.ilhasPronto = true;
      if (esperaIlhas) { clearTimeout(esperaIlhas); esperaIlhas = null; mesmaLeitura(arrancar); return; }
      if (!arrancou || falhou || !D.ilhas || !D.resumo || !D.top) return;
      /* chegou depois de a ferramenta arrancar: junta as ilhas ao campo Distrito e, se o link pedia uma delas e ainda
         ninguém mexeu no formulário, mostra-a */
      preencherDistritos();
      var p = hashInicial.replace(/^#/, '').split('/');
      if (!mexeu && COMB[p[0]] && regiaoIlha(p[1])) { lerHash(hashInicial); sincronizarFormulario(); aplicar(false); }
    });

    function marcar() { mexeu = true; }
    el.distrito.addEventListener('input', marcar);
    el.concelho.addEventListener('input', marcar);
    el.comb.addEventListener('click', marcar);
    el.ver.addEventListener('click', marcar);
    el.distrito.addEventListener('input', aoEscolherDistrito);
    el.distrito.addEventListener('change', preencherConcelhos);
    el.concelho.addEventListener('change', aoMudarConcelho);
    el.ver.addEventListener('click', function (e) {
      e.preventDefault(); if (!D.resumo || !D.top) return;
      lerFormulario();
      if (el.distrito.value === PERTO && !estado.geo) { localizar(); return; } /* ainda sem localização: pede-a e mostra quando chegar */
      aplicar(true);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
