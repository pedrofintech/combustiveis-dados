/* Combustiveis: blocos "Preco eficiente" (ERSE) e "Preco medio por marca" (DGEG).
   Carregado pela pagina /precos-combustiveis. Dados no mesmo repositorio (pedrofintech/combustiveis-dados):
   - preco eficiente em extra.json, atualizado pelo atualizar_extra.py (workflow "Atualizar preço eficiente e marcas");
   - precos por marca em postos-resumo.json, lido na API oficial da DGEG pelo dgeg-postos.mjs (workflow "Ler postos DGEG").
   Condicao da DGEG: citar a DGEG com a data e a hora da leitura e dizer que as medias sao calculo nosso. */
(function () {
  'use strict';
  if (window.__lfCombExtra) return;
  window.__lfCombExtra = true;

  var DADOS = window.__lfCombExtraDados || 'https://raw.githubusercontent.com/pedrofintech/combustiveis-dados/main/extra.json';
  var POSTOS = window.__lfCombPostosDados || 'https://raw.githubusercontent.com/pedrofintech/combustiveis-dados/main/postos-resumo.json';
  var ERSE = 'https://www.erse.pt/combustiveis-e-gpl/supervisao-do-mercado/supervisao-dos-precos-de-combustiveis/';
  var DGEG = 'https://precoscombustiveis.dgeg.gov.pt/';
  var MAX_DIAS_MARCAS = 8; /* sem leitura da DGEG ha mais tempo do que isto, o bloco das marcas nao aparece */
  var S = { d: null, m: null, efi: 'gasoleo', mar: 'gasoleo', todas: false };

  var CSS = '.lfc-ext{width:100%;max-width:624px;margin:0 auto;font-family:inherit}' +
    '.lfc-ext-sub{margin:0 0 16px;font-size:14px;color:#4F5969;line-height:1.5}' +
    '.lfc-ext-sub a,.lfc-ext-foot a{color:inherit;text-decoration:underline}' +
    '.lfc-ext-seg{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap}' +
    '.lfc-ext-btn{appearance:none;-webkit-appearance:none;cursor:pointer;padding:0 14px;height:38px;border:1px solid #D0D5DD;border-radius:12px;background:#fff;font-family:inherit;font-size:13px;font-weight:500;color:#4F5969}' +
    '.lfc-ext-btn:hover{border-color:#98A2B3}' +
    '.lfc-ext-btn.is-active{border-color:var(--colors--accent-blue,#2E90FA);color:var(--colors--accent-blue,#2E90FA);background:rgba(46,144,250,.05);font-weight:600}' +
    '.lfc-ext-row{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:14px 0;border-bottom:1px dotted #E9ECF1;font-size:14px;line-height:20px}' +
    '.lfc-ext-row>span:first-child{color:#4F5969}' +
    '.lfc-ext-row>span:last-child{font-weight:600;color:#202432;text-align:right;white-space:nowrap}' +
    '.lfc-ext-row.is-hl>span:first-child{font-size:16px;font-weight:600;color:#202432}' +
    '.lfc-ext-row.is-hl>span:last-child{font-size:20px;font-weight:700}' +
    '.lfc-ext-pos{color:#067647 !important}.lfc-ext-neg{color:#B42318 !important}' +
    '.lfc-ext-resumo{margin:16px 0 0;font-size:14px;color:#3A4454;line-height:1.65}.lfc-ext-resumo strong{color:#202432;font-weight:600}' +
    '.lfc-ext-foot{margin:16px 0 0;padding-top:14px;border-top:1px dotted #E9ECF1;font-size:12px;color:#98A2B3;line-height:1.5}' +
    '.lfc-ext-t{width:100%;border-collapse:collapse;font-size:14px;line-height:20px}' +
    '.lfc-ext-t th{text-align:left;font-size:13px;font-weight:600;color:#4F5969;padding:10px 0;border-bottom:1px solid #E9ECF1}' +
    '.lfc-ext-t td{padding:10px 0;border-bottom:1px solid #E9ECF1;color:#202432;font-weight:500}' +
    '.lfc-ext-t th.num,.lfc-ext-t td.num{text-align:right;padding-left:12px;white-space:nowrap}' +
    '.lfc-ext-t td.pos{color:#4F5969;font-weight:600;width:32px}' +
    '.lfc-ext-t td.n{color:#4F5969;font-weight:400}' +
    '.lfc-ext-more{display:block;margin:16px auto 0}' +
    '@media (max-width:479px){.lfc-ext-btn{flex:1}.lfc-ext-row.is-hl>span:last-child{font-size:18px}.lfc-ext-t{font-size:13px}.lfc-ext-t th.hide-m,.lfc-ext-t td.hide-m{display:none}}';

  function preco(v) { return v.toFixed(3).replace('.', ',') + '€'; }
  function cent(v) { var a = Math.abs(v); return (a % 1 === 0 ? a.toFixed(0) : a.toFixed(1)).replace('.', ',') + (a === 1 ? ' cêntimo' : ' cêntimos'); }
  function pct(v) { return (v > 0 ? '+' : '') + v.toFixed(1).replace('.', ',') + '%'; }
  function nome(f, art) { return f === 'gasoleo' ? (art ? 'o gasóleo simples' : 'Gasóleo simples') : (art ? 'a gasolina 95 simples' : 'Gasolina 95'); }
  function marca(m) {
    var fixo = { 'INTERMARCHÉ': 'Intermarché', 'PINGO DOCE': 'Pingo Doce', 'AUCHAN': 'Auchan', 'ALVES BANDEIRA': 'Alves Bandeira', 'Genérico': 'Sem marca (genérico)', 'FREITAS': 'Freitas', 'GASPE': 'Gaspe', 'E.LECLERC': 'E.Leclerc', 'OZ Energia': 'OZ Energia' };
    if (fixo[m]) return fixo[m];
    return m.length <= 5 ? m : m.charAt(0) + m.slice(1).toLowerCase();
  }
  function dataPT(iso) {
    var M = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    var p = String(iso || '').split('-'); return p.length < 3 ? '' : parseInt(p[2], 10) + ' de ' + M[parseInt(p[1], 10) - 1] + ' de ' + p[0];
  }
  /* '2026-11-06 13:05' (hora de Lisboa) -> '6 de novembro de 2026, às 13:05' */
  function dataHoraPT(s) {
    var p = String(s || '').split(' ');
    return dataPT(p[0]) + (p[1] ? ', às ' + p[1] : '');
  }
  function milhar(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
  function seg(attr, atual) {
    return '<div class="lfc-ext-seg">' + ['gasoleo', 'gasolina'].map(function (f) {
      return '<button type="button" class="lfc-ext-btn' + (atual === f ? ' is-active' : '') + '" ' + attr + '="' + f + '">' + nome(f) + '</button>';
    }).join('') + '</div>';
  }
  function row(a, b, hl, cls) { return '<div class="lfc-ext-row' + (hl ? ' is-hl' : '') + '"><span>' + a + '</span><span' + (cls ? ' class="' + cls + '"' : '') + '>' + b + '</span></div>'; }

  /* Preco medio da pagina (leitura oficial da DGEG a segunda-feira) na semana do preco eficiente. E o mesmo numero do topo da pagina. */
  function precoDaSemana(inicio, f) {
    var D = window.__lfcCombResults, hist = D && D.historicoOficial;
    if (!inicio || !hist) return null;
    for (var i = 0; i < hist.length; i++) if (hist[i].data === inicio && typeof hist[i][f] === 'number') return hist[i][f];
    return null;
  }
  function lado(v) { return v > 0 ? ' acima' : ' abaixo'; }

  function eficiente() {
    var e = S.d.eficiente, f = S.efi, x = e[f], h = '';
    var real = precoDaSemana(e.inicio, f), dif = real === null ? 0 : Math.round((real - x.pvp) * 1000) / 10;
    h += '<p class="lfc-ext-sub">O preço eficiente é quanto o litro devia custar segundo a ERSE, o regulador da energia: soma as cotações internacionais, o transporte, os biocombustíveis, a logística, uma margem de retalho e os impostos. Serve para veres se os postos estão a cobrar mais do que os custos justificam.</p>';
    h += seg('data-efi', f);
    h += row('Preço eficiente (semana de ' + e.semana + ')', preco(x.pvp) + '/L', true);
    if (real !== null) {
      h += row('Preço médio nessa semana (DGEG)', preco(real) + '/L');
      h += row('Diferença para o preço eficiente', dif === 0 ? 'Igual' : cent(dif) + lado(dif), false, dif === 0 ? '' : dif > 0 ? 'lfc-ext-neg' : 'lfc-ext-pos');
    }
    h += row('Preço eficiente antes de impostos', preco(x.semImpostos) + '/L');
    if (typeof x.variacaoPct === 'number') h += row('Variação do preço eficiente face à semana anterior', pct(x.variacaoPct));
    var a = e.anterior && e.anterior[f];
    if (real !== null) {
      /* Com o preco da pagina para a mesma semana, a comparacao principal e essa. A da ERSE (semana anterior) fica numa frase. */
      h += '<p class="lfc-ext-resumo">Na semana de ' + e.semana + ', ' + nome(f, true) + ' custou em média <strong>' + preco(real) + ' por litro</strong>' +
        (dif === 0 ? ', o mesmo que o preço eficiente.' : ', <strong>' + cent(dif) + lado(dif) + '</strong> do preço eficiente.') +
        (a ? ' Na semana anterior (' + e.anterior.semana + '), segundo a ERSE, o preço médio com descontos ficou ' + cent(a.descontosCent) + lado(a.descontosCent) + ' do preço eficiente e o preço anunciado nos postos ' + cent(a.porticoCent) + lado(a.porticoCent) + '.' : '') + '</p>';
    } else if (a) {
      var acima = a.porticoCent > 0, dAcima = a.descontosCent > 0;
      h += row('Preço anunciado nos postos (' + e.anterior.semana + ')', cent(a.porticoCent) + (acima ? ' acima' : ' abaixo'), false, acima ? 'lfc-ext-neg' : 'lfc-ext-pos');
      h += row('Preço com descontos (' + e.anterior.semana + ')', cent(a.descontosCent) + (dAcima ? ' acima' : ' abaixo'), false, dAcima ? 'lfc-ext-neg' : 'lfc-ext-pos');
      h += '<p class="lfc-ext-resumo">Na semana de ' + e.anterior.semana + ', os postos anunciaram ' + nome(f, true) + ' <strong>' + cent(a.porticoCent) + ' por litro ' + (acima ? 'acima' : 'abaixo') + '</strong> do preço eficiente (' + pct(a.porticoPct) + '). Contando com os descontos de cartões e campanhas, o preço pago ficou <strong>' + cent(a.descontosCent) + ' ' + (dAcima ? 'acima' : 'abaixo') + '</strong> (' + pct(a.descontosPct) + ').</p>';
    }
    h += '<p class="lfc-ext-foot">Fonte: <a href="' + e.fonte + '" target="_blank" rel="noopener">relatório semanal de supervisão dos preços de combustíveis da ERSE</a>, o mais recente publicado. O preço médio é a média oficial da DGEG à segunda-feira, a mesma fonte do topo desta página, e já conta com os descontos de cartões e campanhas. O preço anunciado nos postos é o que está afixado, antes desses descontos. Todos os relatórios estão na <a href="' + ERSE + '" target="_blank" rel="noopener">página da ERSE</a>.</p>';
    return h;
  }

  function marcas() {
    var m = S.m, f = S.mar, x = m[f], lista = S.todas ? x.lista : x.lista.slice(0, 8), h = '';
    var barata = x.lista[0], cara = x.lista[x.lista.length - 1];
    h += '<p class="lfc-ext-sub">Preço médio afixado por cada marca em Portugal continental, calculado pelo Literacia Financeira a partir dos preços dos postos publicados pela DGEG. A média nacional está em ' + preco(x.media) + ' por litro.</p>';
    h += seg('data-mar', f);
    h += '<table class="lfc-ext-t"><thead><tr><th></th><th>Marca</th><th class="num">Preço médio</th><th class="num">Face à média</th><th class="num hide-m">Postos</th></tr></thead><tbody>';
    lista.forEach(function (r, i) {
      var dif = (r[2] - x.media) * 100, cls = dif < -0.05 ? 'lfc-ext-pos' : dif > 0.05 ? 'lfc-ext-neg' : '';
      h += '<tr><td class="pos">' + (i + 1) + '</td><td>' + marca(r[0]) + '</td><td class="num">' + preco(r[2]) + '</td><td class="num ' + cls + '">' + (dif > 0 ? '+' : '-') + Math.abs(dif).toFixed(1).replace('.', ',') + ' cênt.</td><td class="num n hide-m">' + r[1] + '</td></tr>';
    });
    h += '</tbody></table>';
    if (x.lista.length > 8) h += '<a href="#" class="button is-secondary is-small w-inline-block lfc-ext-more" data-todas style="width:fit-content"><div>' + (S.todas ? 'Mostrar menos' : 'Mostrar as ' + x.lista.length + ' marcas') + '</div></a>';
    h += '<p class="lfc-ext-resumo">Entre a marca mais barata (' + marca(barata[0]) + ') e a mais cara (' + marca(cara[0]) + ') há <strong>' + cent((cara[2] - barata[2]) * 100) + ' por litro</strong> de diferença: num depósito de 50 litros são <strong>' + ((cara[2] - barata[2]) * 50).toFixed(2).replace('.', ',') + '€</strong>.</p>';
    /* Condições da DGEG (emails de 14 out e 6 nov 2026): fonte DGEG com a data e a hora dos dados, e dizer que a média é cálculo nosso */
    h += '<p class="lfc-ext-foot">Média calculada pelo Literacia Financeira (não é um dado oficial da DGEG) com os preços de ' + milhar(x.postos) + ' postos lidos a ' + dataHoraPT(m.lidoEmLisboa) + ', no <a href="' + DGEG + '" target="_blank" rel="noopener">portal Preços dos Combustíveis Online da DGEG</a> (Direção-Geral de Energia e Geologia). Conta cada posto por igual, sem descontos de cartões, e só entram marcas com ' + m.minPostos + ' ou mais postos e preços atualizados nos últimos ' + (x.diasValidos || MAX_DIAS_MARCAS) + ' dias. O preço de cada posto pode ser muito diferente da média da marca.</p>';
    return h;
  }

  function render() {
    var a = document.getElementById('lfc-ext-efi'), b = document.getElementById('lfc-ext-mar');
    if (a && S.d && S.d.eficiente) a.innerHTML = eficiente();
    if (b && S.m) b.innerHTML = marcas();
  }

  /* Leitura da DGEG com menos de MAX_DIAS_MARCAS dias e listas de marcas nos dois combustíveis; senão o bloco não aparece */
  function marcasValidas(p) {
    if (!p || !p.lidoEm || !p.lidoEmLisboa || !p.gasoleo || !p.gasolina) return null;
    if (!(p.gasoleo.lista && p.gasoleo.lista.length) || !(p.gasolina.lista && p.gasolina.lista.length)) return null;
    var dias = (Date.now() - Date.parse(p.lidoEm)) / 864e5;
    return dias > -1 && dias <= MAX_DIAS_MARCAS ? p : null;
  }

  function cartao(titulo, id) {
    var w = document.createElement('div');
    w.className = 'all-results_wrapper';
    w.style.display = 'block';
    w.innerHTML = '<div class="table-results_padding"><div class="graph_wrapper"><div class="text-weight-medium" style="max-width:624px;margin:0 auto;width:100%"><div class="text-size-extra-large">' + titulo + '</div></div><div class="spacer-2 spacer-mobile-1"></div><div class="lfc-ext" id="' + id + '"></div></div></div>';
    return w;
  }

  function montar(d, p) {
    var fisc = document.getElementById('lfc-fisc');
    var ancora = fisc && fisc.closest('.all-results_wrapper');
    if (!ancora || !ancora.parentNode) return;
    S.d = d && d.eficiente ? d : null;
    S.m = marcasValidas(p);
    if (!S.d && !S.m) return;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var depois = ancora.nextSibling;
    if (S.d) ancora.parentNode.insertBefore(cartao('Preço eficiente: quanto devia custar o litro?', 'lfc-ext-efi'), depois);
    /* As marcas vêm da API oficial da DGEG (duas leituras por dia, às 13h e às 20h). Se a leitura parar,
       o bloco some ao fim de MAX_DIAS_MARCAS dias em vez de mostrar preços antigos. */
    if (S.m) ancora.parentNode.insertBefore(cartao('Que marca tem o combustível mais barato?', 'lfc-ext-mar'), depois);
    render();
  }

  /* O combustivel escolhido vale para a pagina toda: o deposito, a fiscalidade e estes blocos mudam juntos */
  var emSinc = false;
  function sincronizar(f, origem) {
    if (emSinc || (f !== 'gasoleo' && f !== 'gasolina')) return;
    emSinc = true;
    try {
      S.efi = f; S.mar = f;
      if (S.d || S.m) render();
      ['#lfc-comb-seg .lfc-comb-seg-btn', '#lfc-fisc-seg .lfc-fisc-seg-btn'].forEach(function (sel) {
        var b = document.querySelector(sel + '[data-fuel="' + f + '"]');
        if (b && b !== origem && !b.classList.contains('is-active')) b.click();
      });
    } finally { emSinc = false; }
  }
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var a = t.closest('[data-efi]'), b = t.closest('[data-mar]'), c = t.closest('[data-todas]');
    var p = t.closest('#lfc-comb-seg .lfc-comb-seg-btn, #lfc-fisc-seg .lfc-fisc-seg-btn');
    if (a) sincronizar(a.getAttribute('data-efi'), a);
    else if (b) sincronizar(b.getAttribute('data-mar'), b);
    else if (p) sincronizar(p.getAttribute('data-fuel'), p);
    else if (c) { e.preventDefault(); S.todas = !S.todas; render(); }
  });
  /* Os dados da pagina (precos oficiais por semana) podem chegar depois destes blocos */
  document.addEventListener('lfc-comb:updated', function () { if (S.d || S.m) render(); });

  function pedir(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.onload = function () { var j = null; if (x.status === 200) { try { j = JSON.parse(x.responseText); } catch (err) {} } cb(j); };
    x.onerror = function () { cb(null); };
    x.send();
  }
  function arrancar() {
    var d = null, p = null, falta = 2, agora = new Date().toISOString();
    function fim() { if (--falta === 0) montar(d, p); }
    pedir(DADOS + '?d=' + agora.slice(0, 10), function (j) { d = j; fim(); });
    /* a leitura da DGEG muda duas vezes por dia: a cache muda de hora a hora */
    pedir(POSTOS + '?h=' + agora.slice(0, 13), function (j) { p = j; fim(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
