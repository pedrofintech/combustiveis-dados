/* Combustiveis: blocos "Preco eficiente" (ERSE) e "Preco medio por marca" (DGEG).
   Carregado pela pagina /precos-combustiveis. Dados em extra.json, no mesmo repositorio (pedrofintech/combustiveis-dados),
   atualizado pelo atualizar_extra.py (workflow "Atualizar preço eficiente e marcas"). */
(function () {
  'use strict';
  if (window.__lfCombExtra) return;
  window.__lfCombExtra = true;

  var DADOS = window.__lfCombExtraDados || 'https://raw.githubusercontent.com/pedrofintech/combustiveis-dados/main/extra.json';
  var ERSE = 'https://www.erse.pt/combustiveis-e-gpl/supervisao-do-mercado/supervisao-dos-precos-de-combustiveis/';
  var DGEG = 'https://precoscombustiveis.dgeg.gov.pt/';
  var S = { d: null, efi: 'gasoleo', mar: 'gasoleo', todas: false };

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
    var fixo = { 'INTERMARCHÉ': 'Intermarché', 'PINGO DOCE': 'Pingo Doce', 'AUCHAN': 'Auchan', 'ALVES BANDEIRA': 'Alves Bandeira', 'Genérico': 'Sem marca (genérico)', 'FREITAS': 'Freitas', 'GASPE': 'Gaspe', 'E.LECLERC': 'E.Leclerc' };
    if (fixo[m]) return fixo[m];
    return m.length <= 5 ? m : m.charAt(0) + m.slice(1).toLowerCase();
  }
  function dataPT(iso) {
    var M = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    var p = String(iso || '').split('-'); return p.length < 3 ? '' : parseInt(p[2], 10) + ' de ' + M[parseInt(p[1], 10) - 1] + ' de ' + p[0];
  }
  function seg(attr, atual) {
    return '<div class="lfc-ext-seg">' + ['gasoleo', 'gasolina'].map(function (f) {
      return '<button type="button" class="lfc-ext-btn' + (atual === f ? ' is-active' : '') + '" ' + attr + '="' + f + '">' + nome(f) + '</button>';
    }).join('') + '</div>';
  }
  function row(a, b, hl, cls) { return '<div class="lfc-ext-row' + (hl ? ' is-hl' : '') + '"><span>' + a + '</span><span' + (cls ? ' class="' + cls + '"' : '') + '>' + b + '</span></div>'; }

  function eficiente() {
    var e = S.d.eficiente, f = S.efi, x = e[f], h = '';
    h += '<p class="lfc-ext-sub">O preço eficiente é quanto o litro devia custar segundo a ERSE, o regulador da energia: soma as cotações internacionais, o transporte, os biocombustíveis, a logística, uma margem de retalho e os impostos. Serve para veres se os postos estão a cobrar mais do que os custos justificam.</p>';
    h += seg('data-efi', f);
    h += row('Preço eficiente (semana de ' + e.semana + ')', preco(x.pvp) + '/L', true);
    h += row('Preço eficiente antes de impostos', preco(x.semImpostos) + '/L');
    if (typeof x.variacaoPct === 'number') h += row('Variação face à semana anterior', pct(x.variacaoPct));
    var a = e.anterior && e.anterior[f];
    if (a) {
      var acima = a.porticoCent > 0, dAcima = a.descontosCent > 0;
      h += row('Preço anunciado nos postos (' + e.anterior.semana + ')', cent(a.porticoCent) + (acima ? ' acima' : ' abaixo'), false, acima ? 'lfc-ext-neg' : 'lfc-ext-pos');
      h += row('Preço com descontos (' + e.anterior.semana + ')', cent(a.descontosCent) + (dAcima ? ' acima' : ' abaixo'), false, dAcima ? 'lfc-ext-neg' : 'lfc-ext-pos');
      h += '<p class="lfc-ext-resumo">Na semana de ' + e.anterior.semana + ', os postos anunciaram ' + nome(f, true) + ' <strong>' + cent(a.porticoCent) + ' por litro ' + (acima ? 'acima' : 'abaixo') + '</strong> do preço eficiente (' + pct(a.porticoPct) + '). Contando com os descontos de cartões e campanhas, o preço pago ficou <strong>' + cent(a.descontosCent) + ' ' + (dAcima ? 'acima' : 'abaixo') + '</strong> (' + pct(a.descontosPct) + ').</p>';
    }
    h += '<p class="lfc-ext-foot">Fonte: <a href="' + e.fonte + '" target="_blank" rel="noopener">relatório semanal de supervisão dos preços de combustíveis da ERSE</a>. A ERSE publica o preço eficiente de cada semana e compara-o com os preços da semana anterior. Todos os relatórios estão na <a href="' + ERSE + '" target="_blank" rel="noopener">página da ERSE</a>.</p>';
    return h;
  }

  function marcas() {
    var m = S.d.marcas, f = S.mar, x = m[f], lista = S.todas ? x.lista : x.lista.slice(0, 8), h = '';
    var barata = x.lista[0], cara = x.lista[x.lista.length - 1];
    h += '<p class="lfc-ext-sub">Preço médio afixado por cada marca em Portugal continental, calculado com os preços de todos os postos registados na DGEG. A média nacional está em ' + preco(x.media) + ' por litro.</p>';
    h += seg('data-mar', f);
    h += '<table class="lfc-ext-t"><thead><tr><th></th><th>Marca</th><th class="num">Preço médio</th><th class="num">Face à média</th><th class="num hide-m">Postos</th></tr></thead><tbody>';
    lista.forEach(function (r, i) {
      var dif = (r[2] - x.media) * 100, cls = dif < -0.05 ? 'lfc-ext-pos' : dif > 0.05 ? 'lfc-ext-neg' : '';
      h += '<tr><td class="pos">' + (i + 1) + '</td><td>' + marca(r[0]) + '</td><td class="num">' + preco(r[2]) + '</td><td class="num ' + cls + '">' + (dif > 0 ? '+' : '-') + Math.abs(dif).toFixed(1).replace('.', ',') + ' cênt.</td><td class="num n hide-m">' + r[1] + '</td></tr>';
    });
    h += '</tbody></table>';
    if (x.lista.length > 8) h += '<a href="#" class="button is-secondary is-small w-inline-block lfc-ext-more" data-todas style="width:fit-content"><div>' + (S.todas ? 'Mostrar menos' : 'Mostrar as ' + x.lista.length + ' marcas') + '</div></a>';
    h += '<p class="lfc-ext-resumo">Entre a marca mais barata (' + marca(barata[0]) + ') e a mais cara (' + marca(cara[0]) + ') há <strong>' + cent((cara[2] - barata[2]) * 100) + ' por litro</strong> de diferença: num depósito de 50 litros são <strong>' + ((cara[2] - barata[2]) * 50).toFixed(2).replace('.', ',') + '€</strong>.</p>';
    h += '<p class="lfc-ext-foot">Fonte: <a href="' + DGEG + '" target="_blank" rel="noopener">portal Preços de Combustíveis Online da DGEG</a>, preços afixados a ' + dataPT(m.data) + ' em ' + String(x.postos).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' postos. Média simples por posto, sem descontos de cartões, para marcas com ' + m.minPostos + ' ou mais postos. O preço de cada posto pode ser muito diferente da média da marca.</p>';
    return h;
  }

  function render() {
    var a = document.getElementById('lfc-ext-efi'), b = document.getElementById('lfc-ext-mar');
    if (a) a.innerHTML = eficiente();
    if (b) b.innerHTML = marcas();
  }

  function cartao(titulo, id) {
    var w = document.createElement('div');
    w.className = 'all-results_wrapper';
    w.style.display = 'block';
    w.innerHTML = '<div class="table-results_padding"><div class="graph_wrapper"><div class="text-weight-medium" style="max-width:624px;margin:0 auto;width:100%"><div class="text-size-extra-large">' + titulo + '</div></div><div class="spacer-2 spacer-mobile-1"></div><div class="lfc-ext" id="' + id + '"></div></div></div>';
    return w;
  }

  function montar(d) {
    var fisc = document.getElementById('lfc-fisc');
    var ancora = fisc && fisc.closest('.all-results_wrapper');
    if (!ancora || !ancora.parentNode) return;
    S.d = d;
    var st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
    var depois = ancora.nextSibling;
    ancora.parentNode.insertBefore(cartao('Preço eficiente: quanto devia custar o litro?', 'lfc-ext-efi'), depois);
    /* O bloco das marcas so aparece com precos lidos na ultima atualizacao (marcas.data igual a atualizado).
       Com a leitura da DGEG desligada no workflow (LF_SEM_DGEG), os precos ficam com data antiga e o bloco nao e mostrado. */
    if (d.marcas && d.marcas.data === d.atualizado) ancora.parentNode.insertBefore(cartao('Que marca tem o combustível mais barato?', 'lfc-ext-mar'), depois);
    render();
  }

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.closest) return;
    var a = t.closest('[data-efi]'), b = t.closest('[data-mar]'), c = t.closest('[data-todas]');
    if (a) { S.efi = a.getAttribute('data-efi'); render(); }
    else if (b) { S.mar = b.getAttribute('data-mar'); render(); }
    else if (c) { e.preventDefault(); S.todas = !S.todas; render(); }
  });

  function arrancar() {
    var x = new XMLHttpRequest();
    x.open('GET', DADOS + '?d=' + new Date().toISOString().slice(0, 10));
    x.onload = function () { try { var d = JSON.parse(x.responseText); if (d && d.eficiente) montar(d); } catch (err) {} };
    x.send();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar); else arrancar();
})();
