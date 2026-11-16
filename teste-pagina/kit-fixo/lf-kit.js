/* LF kit: JavaScript das pecas que precisam dele, igual as calculadoras live.
   - LFK.selects(root)       transforma <select class="lfk-input"> no dropdown das calculadoras (corre sozinho ao carregar)
   - LFK.menus(root)         menu do grafico (Descarregar grafico / Descarregar tabela / Partilhar resultados) (corre sozinho)
   - LFK.restore(form)       preenche o formulario a partir de um link partilhado; devolve true se havia valores
   - LFK.zones(el, valor)    barra com zonas (taxa de esforco); le data-max e data-zones do elemento
   - LFK.steps(el)           questionario por passos (perfil de investidor); evento "lfk:done" com as respostas
   - LFK.meter(el, valor)    medidor em segmentos
   - [data-lfk-desc]         radios com data-desc mostram o texto do escolhido no elemento indicado (corre sozinho)
   Graficos (Chart.js 4.5.1):
   - LFK.bar(canvas, opts)   barras empilhadas (juros compostos, credito, S&P 500, FIRE)
   - LFK.line(canvas, opts)  linha (S&P 500 historico, evolucao de saldo)
   - LFK.donut(canvas, opts) donut com valor ao centro (depositos a prazo)
   - LFK.views(card)         separadores "Grafico / Tabela" dentro de um cartao
   - LFK.table(el, opts)     tabela com "Mostrar mais" (30 linhas, como no site)
   - LFK.fmt(valor)          valor no formato do pais da pagina (10.182,50€ na Literacia, 102 806,57 zl na EUPF PL...)
   - LFK.num(texto)          le um numero escrito no formato do pais ("10.000" -> 10000)
   - LFK.locale(el)          formato em uso: data-lfk-locale, ou o site e a lingua da pagina
   - .lfk-num                campos de numero com os milhares a aparecer enquanto se escreve (corre sozinho);
                             data-decimals, data-max; LFK.numInputs(root) volta a formatar os valores atuais
   - LFK.toc(nav)             indice do artigo: marca a seccao no ecra (corre sozinho em .lfk-toc[data-lfk-spy])
   - LFK.calc(botao, opts)   comportamento das calculadoras: so calcula no clique, esconde o placeholder, mostra os resultados e faz scroll suave
   Cores e letras vem das variaveis do kit (--lfk-c1..c5, --lfk-font), por isso seguem cada site.
   Se a pagina ainda nao tiver Chart.js, este ficheiro carrega a mesma versao que o site usa. */
(function () {
  var CHART_SRC = "https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js";
  var loading = null;
  function ready() {
    if (window.Chart) return Promise.resolve(window.Chart);
    if (!loading) loading = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = CHART_SRC; s.onload = function () { res(window.Chart); }; s.onerror = rej;
      document.head.appendChild(s);
    });
    return loading;
  }
  function css(el, name, fallback) {
    var root = (el && el.closest && el.closest(".lfk")) || document.documentElement;
    var v = getComputedStyle(root).getPropertyValue(name).trim();
    return v || fallback;
  }
  function fontFamily(el) { return (css(el, "--lfk-font", "Inter").split(",")[0] || "Inter").replace(/["']/g, "").trim(); }
  function palette(el) {
    return [css(el, "--lfk-c1", "#FD8D2B"), css(el, "--lfk-c2", "#2970FF"), css(el, "--lfk-c3", "#31AF89"), css(el, "--lfk-c4", "#FEC84B"), css(el, "--lfk-c5", "#9B8AFB")];
  }

  /* Formato de cada pais. g = separador de milhares, d = decimal, c = moeda,
     p = moeda antes do numero. Os espacos sao inseparaveis para nao partirem a linha. */
  var NBSP = "\u00a0";
  var LOCALES = {
    "pt-PT": { g: ".", d: ",", c: "€", p: false, sp: "" },      /* Literacia: 10.182,50€ */
    "pt-BR": { g: ".", d: ",", c: "R$", p: true, sp: NBSP },    /* Educacao Financeira: R$ 10.182,50 */
    "en-EU": { g: ",", d: ".", c: "€", p: true, sp: "" },       /* EUPF ingles: €10,182.50 */
    "nl-NL": { g: ".", d: ",", c: "€", p: true, sp: "" },       /* EUPF holandes: €10.182,50 */
    "pl-PL": { g: NBSP, d: ",", c: "zł", p: false, sp: NBSP },  /* EUPF polaco: 10 182,50 zł */
    "et-EE": { g: NBSP, d: ",", c: "€", p: false, sp: NBSP },   /* Rahatarkus: 10 182,50 € */
    "en-AE": { g: ",", d: ".", c: "AED", p: true, sp: NBSP },   /* BrokerMatch (ingles e arabe): AED 10,182.50 */
    "ar-AE": { g: ",", d: ".", c: "AED", p: true, sp: NBSP }
  };
  function locale(el) {
    var tagged = el && el.closest && el.closest("[data-lfk-locale]");
    if (!tagged) tagged = document.querySelector("[data-lfk-locale]");
    if (tagged && LOCALES[tagged.getAttribute("data-lfk-locale")]) return tagged.getAttribute("data-lfk-locale");
    var host = location.hostname, lang = (document.documentElement.lang || "").toLowerCase();
    if (/educacaofinanceira/.test(host)) return "pt-BR";
    if (/rahatarkus/.test(host)) return "et-EE";
    if (/brokermatch/.test(host)) return lang.indexOf("ar") === 0 ? "ar-AE" : "en-AE";
    if (/eupersonalfinance/.test(host)) return lang.indexOf("pl") === 0 ? "pl-PL" : lang.indexOf("nl") === 0 ? "nl-NL" : "en-EU";
    if (LOCALES[document.documentElement.lang]) return document.documentElement.lang;
    return "pt-PT";
  }
  function group(intPart, g) { return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, g); }
  /* 10182.5 -> "10.182,50€" (Literacia), "€10,182.50" (EUPF EN)...
     opcoes: {decimals:2, locale:"pl-PL", currency:false (so o numero), el (elemento para detetar o formato)}
     Compatibilidade: {suffix, prefix} continuam a funcionar e substituem a moeda. */
  function fmt(v, o) {
    o = o || {};
    var L = LOCALES[o.locale] || LOCALES[locale(o.el)];
    var d = o.decimals == null ? 2 : o.decimals;
    var n = Number(v) || 0, neg = n < 0;
    var parts = Math.abs(n).toFixed(d).split(".");
    var num = group(parts[0], L.g) + (parts[1] ? L.d + parts[1] : "");
    var out;
    if (o.suffix != null || o.prefix != null) out = (o.prefix || "") + num + (o.suffix || "");
    else if (o.currency === false) out = num;
    else out = L.p ? L.c + L.sp + num : num + L.sp + L.c;
    return (neg ? "-" : "") + out;
  }
  /* "10.000" -> 10000 ; "2,5" -> 2.5 ; "5,000" na EUPF EN -> 5000 */
  function num(text, o) {
    o = o || {};
    var L = LOCALES[o.locale] || LOCALES[locale(o.el)];
    var s = String(text == null ? "" : text).replace(/[^\d.,\-]/g, "");
    s = s.split(L.g === NBSP ? " " : L.g).join("");
    if (L.d === ",") s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }
  /* Campos de numero (<input class="lfk-input lfk-num">): os milhares aparecem enquanto se escreve,
     como no calculadora-inputs.js das calculadoras live (1600 -> 1.600 na Literacia, 1,600 na EUPF EN).
     - casas decimais: data-decimals="2"; sem o atributo, 2 com inputmode="decimal" e 0 nos outros
     - maximo: data-max (ou max-value / max, como nas calculadoras live)
     - nos sites com virgula decimal, "." e "," escritos pelo utilizador viram a virgula, como no site
     Corre sozinho em todos os .lfk-num, tambem nos que forem acrescentados depois. */
  function inputDecimals(el) {
    var d = el.getAttribute("data-decimals");
    if (d != null && d !== "") return Math.max(0, parseInt(d, 10) || 0);
    return el.getAttribute("inputmode") === "decimal" ? 2 : 0;
  }
  function inputMax(el) {
    var m = el.getAttribute("data-max") || el.getAttribute("max-value") || el.getAttribute("max");
    var n = m == null || m === "" ? NaN : parseFloat(m);
    return isNaN(n) ? null : n;
  }
  /* Formata o texto v do campo el. typed = caracter acabado de escrever, pos = cursor.
     Devolve o texto formatado e onde fica o cursor. */
  function formatField(el, v, typed, pos) {
    var L = LOCALES[locale(el)], dec = inputDecimals(el), mark = -1;
    var decChars = L.d === "," ? ",." : ".";
    if (dec > 0) {
      if (typed && typed.length === 1 && decChars.indexOf(typed) >= 0 && pos > 0 && v.charAt(pos - 1) === typed) mark = pos - 1;
      else mark = v.indexOf(L.d);
    }
    /* posicao do cursor contada em digitos (mais 1 se o separador decimal estiver antes dele) */
    var key = 0;
    for (var k = 0; k < pos && k < v.length; k++) if (/\d/.test(v.charAt(k)) || k === mark) key++;
    var intPart = "", decPart = null;
    for (k = 0; k < v.length; k++) {
      var ch = v.charAt(k);
      if (k === mark) { if (decPart == null) decPart = ""; continue; }
      if (!/\d/.test(ch)) continue;
      if (decPart == null) intPart += ch; else if (decPart.length < dec) decPart += ch;
    }
    intPart = intPart.replace(/^0+(?=\d)/, "");
    var max = inputMax(el);
    if (max != null && intPart !== "" && parseFloat(intPart + (decPart ? "." + decPart : "")) > max) {
      intPart = String(Math.floor(max)); decPart = null;
    }
    if (intPart === "" && decPart != null) intPart = "0";
    var out = group(intPart, L.g) + (decPart != null ? L.d + decPart : "");
    var c = 0, at = 0;
    if (key > 0) for (at = 0; at < out.length; at++) { if (/\d/.test(out.charAt(at)) || out.charAt(at) === L.d) c++; if (c >= key) { at++; break; } }
    return { text: out, caret: Math.min(at, out.length) };
  }
  function onNumInput(e) {
    var el = e.target;
    if (!el || !el.matches || !el.matches(".lfk input.lfk-num") || e.isComposing) return;
    var pos = el.selectionStart == null ? el.value.length : el.selectionStart;
    var v = el.value, r = formatField(el, v, e.data, pos);
    /* backspace/delete em cima de um separador de milhares: apaga tambem o digito ao lado */
    if (/^delete/.test(e.inputType || "") && r.text === el.__lfkPrev) {
      var back = e.inputType === "deleteContentBackward";
      var k = back ? pos - 1 : pos;
      while (k >= 0 && k < v.length && !/\d/.test(v.charAt(k))) k += back ? -1 : 1;
      if (k >= 0 && k < v.length) { v = v.slice(0, k) + v.slice(k + 1); pos = back ? k : pos; r = formatField(el, v, null, pos); }
    }
    el.__lfkPrev = r.text;
    if (r.text === el.value) return;
    el.value = r.text;
    if (document.activeElement === el && el.setSelectionRange) { try { el.setSelectionRange(r.caret, r.caret); } catch (err) {} }
  }
  function numInputs(root) {
    (root || document).querySelectorAll(".lfk input.lfk-num").forEach(function (el) {
      if (el.value) el.value = formatField(el, el.value, null, el.value.length).text;
      el.__lfkPrev = el.value;
    });
  }
  document.addEventListener("input", onNumInput, true);
  document.addEventListener("focusin", function (e) { if (e.target && e.target.matches && e.target.matches(".lfk input.lfk-num")) e.target.__lfkPrev = e.target.value; }, true);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { numInputs(); });
  else numInputs();

  /* eixo: 12500 -> "12,5k", 1200000 -> "1,2M" (decimal do pais) */
  function short(v, o) {
    var L = LOCALES[(o && o.locale) || locale(o && o.el)];
    function f(x) { return x.toFixed(1).replace(".0", "").replace(".", L.d); }
    if (v >= 1e6) return f(v / 1e6) + "M";
    if (v >= 1e3) return f(v / 1e3) + "k";
    return String(v);
  }

  function tooltip(el, extra) {
    var f = fontFamily(el);
    var t = {
      backgroundColor: css(el, "--lfk-tooltip", "#121721"),
      cornerRadius: 8, padding: 12, displayColors: true, usePointStyle: true, bodySpacing: 5, boxPadding: 3,
      titleColor: css(el, "--lfk-tooltip-text", "#CED5DF"),
      bodyColor: "#E6E6E6",
      titleFont: { family: f, size: 11, weight: "500" },
      bodyFont: { family: f, size: 11, weight: "500" },
      callbacks: {
        labelColor: function (c) {
          var bg = c.element && c.element.options ? c.element.options.backgroundColor : c.dataset.backgroundColor;
          return { backgroundColor: bg, borderColor: bg, borderWidth: 0, borderRadius: 50 };
        }
      }
    };
    return Object.assign(t, extra || {});
  }
  function make(canvas, cfg) {
    return ready().then(function (Chart) {
      if (canvas.__lfkChart) canvas.__lfkChart.destroy();
      var chart = new Chart(canvas.getContext("2d"), cfg);
      canvas.__lfkChart = chart;
      /* redesenhar quando a Inter acabar de carregar, para nao ficar com a letra de reserva */
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { chart.update("none"); });
      return chart;
    });
  }

  /* opts: {labels, datasets:[{label, data, color?}], title?, xTitle?, money?, tooltipTitle?(i,label)} */
  function bar(canvas, o) {
    var f = fontFamily(canvas), pal = palette(canvas), money = o.money || fmt;
    var axisFont = { family: f, size: 10, weight: "500", letterSpacing: "-0.0125em" };
    var labelFont = { family: f, size: 13, weight: "500", letterSpacing: "-0.0125em" };
    var text2 = css(canvas, "--lfk-text-2", "#3A4454"), text3 = css(canvas, "--lfk-text-3", "#4F5969");
    return make(canvas, {
      type: "bar",
      data: {
        labels: o.labels,
        datasets: o.datasets.map(function (d, i) {
          return { label: d.label, data: d.data, backgroundColor: d.color || pal[i % pal.length], stack: "Stack 0", borderSkipped: false };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, resizeDelay: 200,
        layout: { padding: { top: 20 } },
        interaction: { mode: "index", intersect: false },
        plugins: {
          title: { display: !!o.title, text: o.title || "", align: "start", color: text2, font: labelFont, padding: { top: 0, bottom: 25 } },
          legend: {
            position: "bottom",
            labels: { usePointStyle: true, pointStyle: "circle", padding: 20, color: text2, font: { family: f, size: 12, weight: "500", letterSpacing: "-0.0125em" } },
            onHover: function (e) { e.chart.canvas.style.cursor = "pointer"; },
            onLeave: function (e) { e.chart.canvas.style.cursor = "default"; }
          },
          tooltip: tooltip(canvas, {
            position: "nearest",
            callbacks: Object.assign(tooltip(canvas).callbacks, {
              title: function (t) { return o.tooltipTitle ? o.tooltipTitle(t[0].dataIndex, t[0].label) : t[0].label; },
              label: function (c) { return c.dataset.label + ": " + money(c.raw); }
            })
          })
        },
        scales: {
          x: {
            stacked: true, grid: { drawOnChartArea: false },
            ticks: { color: text3, font: axisFont },
            title: { display: !!o.xTitle, text: o.xTitle || "", align: "end", color: text2, font: labelFont, padding: { top: 10 } }
          },
          y: {
            stacked: true, beginAtZero: true,
            ticks: { color: text3, font: axisFont, callback: function (v) { return short(v); } }
          }
        }
      }
    });
  }

  /* opts: {labels, datasets:[{label, data, color?}], money?, maxTicks?} */
  function line(canvas, o) {
    var f = fontFamily(canvas), pal = palette(canvas), money = o.money || fmt;
    var tick = { color: css(canvas, "--lfk-text-3", "#4F5969"), font: { family: f, size: 11 } };
    return make(canvas, {
      type: "line",
      data: {
        labels: o.labels,
        datasets: o.datasets.map(function (d, i) {
          var c = d.color || pal[(i + 1) % pal.length];
          return { label: d.label, data: d.data, borderColor: c, backgroundColor: c, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.1, fill: false };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: o.datasets.length > 1, position: "bottom", labels: { usePointStyle: true, pointStyle: "circle", padding: 20, color: css(canvas, "--lfk-text-2", "#3A4454"), font: { family: f, size: 12, weight: "500" } } },
          tooltip: tooltip(canvas, {
            padding: 10, boxWidth: 8, boxHeight: 8, boxPadding: 6,
            titleFont: { family: f, size: 11, weight: "600" },
            callbacks: Object.assign(tooltip(canvas).callbacks, {
              label: function (c) { return c.dataset.label + ": " + money(c.raw); }
            })
          })
        },
        scales: {
          x: { grid: { display: false }, ticks: Object.assign({ maxTicksLimit: o.maxTicks || 20 }, tick) },
          y: { grid: { color: css(canvas, "--lfk-border-2", "#E9ECF1") }, ticks: Object.assign({ callback: function (v) { return short(v); } }, tick) }
        }
      }
    });
  }

  /* opts: {labels, data, colors?, money?} ; o valor do centro e a legenda sao HTML (lfk-donut-center, lfk-legend) */
  function donut(canvas, o) {
    var pal = palette(canvas), money = o.money || fmt;
    var colors = o.colors || ["#F79009", pal[1], pal[2], pal[0], pal[4]];
    return make(canvas, {
      type: "doughnut",
      data: { labels: o.labels, datasets: [{ data: o.data, backgroundColor: colors.slice(0, o.data.length), borderWidth: 0, cutout: "80%" }] },
      options: {
        responsive: true, maintainAspectRatio: true, animation: false, resizeDelay: 200,
        plugins: {
          legend: { display: false },
          tooltip: tooltip(canvas, { callbacks: Object.assign(tooltip(canvas).callbacks, { label: function (c) { return c.label + ": " + money(c.raw); } }) })
        }
      }
    });
  }

  /* Separadores dentro de um cartao: botoes [data-lfk-tab="x"] mostram [data-lfk-view="x"] */
  function views(card) {
    card.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lfk-tab]");
      if (!b || !card.contains(b)) return;
      var v = b.getAttribute("data-lfk-tab");
      card.querySelectorAll("[data-lfk-tab]").forEach(function (x) {
        var on = x === b; x.classList.toggle("is-active", on); x.setAttribute("aria-selected", on ? "true" : "false");
      });
      card.querySelectorAll("[data-lfk-view]").forEach(function (p) { p.hidden = p.getAttribute("data-lfk-view") !== v; });
      if (window.Chart) card.querySelectorAll("canvas").forEach(function (c) { if (c.__lfkChart) c.__lfkChart.resize(); });
    });
  }

  /* Tabela: opts {head:["Ano", ...], rows:[[...], ...], num:[false,true,...], limit:30, more:"Mostrar mais", less:"Mostrar menos"} */
  function table(el, o) {
    var limit = o.limit || 30, open = false;
    function cell(tag, v, i) { return "<" + tag + (o.num && o.num[i] ? ' class="is-num"' : "") + ">" + v + "</" + tag + ">"; }
    var ARROW_DOWN = '<span class="lfk-btn-icon"><svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="1.67" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    var ARROW_UP = '<span class="lfk-btn-icon"><svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M15 12.5L10 7.5L5 12.5" stroke="currentColor" stroke-width="1.67" stroke-linecap="round" stroke-linejoin="round"/></svg></span>';
    function draw() {
      var rows = open ? o.rows : o.rows.slice(0, limit);
      var h = '<div class="lfk-table-wrap"><table class="lfk-table"><thead><tr>' + o.head.map(function (v, i) { return cell("th", v, i); }).join("") + "</tr></thead><tbody>" +
        rows.map(function (r) { return "<tr>" + r.map(function (v, i) { return cell("td", v, i); }).join("") + "</tr>"; }).join("") + "</tbody></table></div>";
      if (o.rows.length > limit) h += '<div class="lfk-table-more"><button type="button" class="lfk-btn is-secondary is-sm">' + (open ? (o.less || "Mostrar menos") + ARROW_UP : (o.more || "Mostrar mais") + ARROW_DOWN) + "</button></div>";
      el.innerHTML = h;
      var btn = el.querySelector(".lfk-table-more button");
      if (btn) btn.onclick = function () {
        open = !open; draw();
        /* como no site: ao fechar, voltar ao inicio da tabela */
        if (!open) window.scrollTo({ top: el.getBoundingClientRect().top + window.pageYOffset - 100, behavior: "smooth" });
        /* a altura da pagina mudou: recalcular as animacoes de scroll do site */
        if (window.ScrollTrigger && window.ScrollTrigger.refresh) window.ScrollTrigger.refresh();
      };
    }
    draw();
  }

  /* ---------- Dropdown das calculadoras (dropdown-general-calculadora) ----------
     O <select> fica escondido e sincronizado (valor e evento "change"), por isso o resto do codigo le-o como sempre. */
  var ARROW = '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5 7.5L10 12.5L15 7.5" stroke="#697386" stroke-width="1.67" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
  var uid = 0;
  function closeAll(except) {
    document.querySelectorAll(".lfk-dd.is-open").forEach(function (d) { if (d !== except) d.__lfkClose(); });
  }
  function select(sel) {
    if (sel.__lfkDd) return sel.__lfkDd;
    var id = "lfk-dd-" + (++uid);
    var dd = document.createElement("div");
    dd.className = "lfk-dd" + (sel.classList.contains("is-sm") ? " is-sm" : "");
    var t = document.createElement("div");
    t.className = "lfk-dd-toggle"; t.tabIndex = sel.disabled ? -1 : 0;
    t.setAttribute("role", "button"); t.setAttribute("aria-haspopup", "listbox"); t.setAttribute("aria-expanded", "false"); t.setAttribute("aria-controls", id);
    if (sel.id) { var lab = document.querySelector('label[for="' + sel.id + '"]'); if (lab) { lab.id = lab.id || sel.id + "-label"; t.setAttribute("aria-labelledby", lab.id); lab.addEventListener("click", function (e) { e.preventDefault(); t.focus(); }); } }
    var txt = document.createElement("div");
    var arrow = document.createElement("div"); arrow.className = "lfk-dd-arrow"; arrow.innerHTML = ARROW;
    t.appendChild(txt); t.appendChild(arrow);
    var list = document.createElement("nav");
    list.className = "lfk-dd-list"; list.id = id; list.setAttribute("role", "listbox");
    /* O site usa o Lenis (scroll suave), que apanha a roda do rato: sem isto nao da para fazer scroll dentro da lista aberta */
    list.setAttribute("data-lenis-prevent", "");
    var active = -1;
    function items() { return Array.prototype.slice.call(list.querySelectorAll(".lfk-dd-item")); }
    function render() {
      list.innerHTML = "";
      Array.prototype.forEach.call(sel.options, function (o, i) {
        var a = document.createElement("a");
        a.href = "#"; a.className = "lfk-dd-item"; a.tabIndex = -1; a.textContent = o.text;
        a.setAttribute("role", "option"); a.setAttribute("aria-selected", i === sel.selectedIndex ? "true" : "false");
        if (i === sel.selectedIndex) a.classList.add("is-current");
        if (o.disabled) a.setAttribute("aria-disabled", "true");
        a.addEventListener("click", function (e) { e.preventDefault(); if (!o.disabled) pick(i); });
        list.appendChild(a);
      });
      txt.textContent = sel.selectedIndex >= 0 ? sel.options[sel.selectedIndex].text : "";
    }
    function setActive(i) {
      var all = items(); if (!all.length) return;
      active = (i + all.length) % all.length;
      all.forEach(function (a, k) { a.classList.toggle("is-focus", k === active); });
      all[active].scrollIntoView({ block: "nearest" });
    }
    function open() {
      if (sel.disabled) return;
      closeAll(dd); dd.classList.add("is-open"); t.setAttribute("aria-expanded", "true");
      setActive(Math.max(0, sel.selectedIndex));
    }
    function close() { dd.classList.remove("is-open"); t.setAttribute("aria-expanded", "false"); items().forEach(function (a) { a.classList.remove("is-focus"); }); }
    function pick(i) {
      if (i !== sel.selectedIndex) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      render(); close(); t.focus();
    }
    dd.__lfkClose = close;
    t.addEventListener("click", function () { dd.classList.contains("is-open") ? close() : open(); });
    t.addEventListener("keydown", function (e) {
      var isOpen = dd.classList.contains("is-open");
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); if (!isOpen) open(); else setActive(active + (e.key === "ArrowDown" ? 1 : -1)); }
      else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (isOpen && active >= 0) pick(active); else open(); }
      else if (e.key === "Escape" || e.key === "Tab") { if (isOpen) close(); }
      else if (e.key === "Home" && isOpen) { e.preventDefault(); setActive(0); }
      else if (e.key === "End" && isOpen) { e.preventDefault(); setActive(-1); }
    });
    sel.addEventListener("change", render);
    sel.classList.add("lfk-dd-native");
    sel.tabIndex = -1; sel.setAttribute("aria-hidden", "true");
    sel.parentNode.insertBefore(dd, sel);
    dd.appendChild(t); dd.appendChild(list); dd.appendChild(sel);
    if (sel.disabled) dd.classList.add("is-disabled");
    render();
    sel.__lfkDd = dd;
    return dd;
  }
  function selects(root) {
    (root || document).querySelectorAll(".lfk select.lfk-input:not([multiple]):not([size]):not(.lfk-native)").forEach(select);
  }
  document.addEventListener("click", function (e) { if (!e.target.closest(".lfk-dd")) closeAll(null); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { selects(); });
  else selects();


  /* ---------- Menu do grafico (graph-settings-dropdown), icones do site ---------- */
  var ICON = {
    dots: '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.99996 10.8333C10.4602 10.8333 10.8333 10.4602 10.8333 9.99999C10.8333 9.53976 10.4602 9.16666 9.99996 9.16666C9.53972 9.16666 9.16663 9.53976 9.16663 9.99999C9.16663 10.4602 9.53972 10.8333 9.99996 10.8333Z" stroke="currentColor" stroke-width="1.66667" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.99996 4.99999C10.4602 4.99999 10.8333 4.6269 10.8333 4.16666C10.8333 3.70642 10.4602 3.33333 9.99996 3.33333C9.53972 3.33333 9.16663 3.70642 9.16663 4.16666C9.16663 4.6269 9.53972 4.99999 9.99996 4.99999Z" stroke="currentColor" stroke-width="1.66667" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.99996 16.6667C10.4602 16.6667 10.8333 16.2936 10.8333 15.8333C10.8333 15.3731 10.4602 15 9.99996 15C9.53972 15 9.16663 15.3731 9.16663 15.8333C9.16663 16.2936 9.53972 16.6667 9.99996 16.6667Z" stroke="currentColor" stroke-width="1.66667" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    chart: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M5.33333 10V11.3333M8 7.33333V11.3333M10.6667 4.66667V11.3333M5.2 14H10.8C11.9201 14 12.4802 14 12.908 13.782C13.2843 13.5903 13.5903 13.2843 13.782 12.908C14 12.4802 14 11.9201 14 10.8V5.2C14 4.0799 14 3.51984 13.782 3.09202C13.5903 2.71569 13.2843 2.40973 12.908 2.21799C12.4802 2 11.9201 2 10.8 2H5.2C4.0799 2 3.51984 2 3.09202 2.21799C2.71569 2.40973 2.40973 2.71569 2.21799 3.09202C2 3.51984 2 4.0799 2 5.2V10.8C2 11.9201 2 12.4802 2.21799 12.908C2.40973 13.2843 2.71569 13.5903 3.09202 13.782C3.51984 14 4.0799 14 5.2 14Z" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    table: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 6L14 6M6 2L6 14M5.2 2H10.8C11.9201 2 12.4802 2 12.908 2.21799C13.2843 2.40973 13.5903 2.71569 13.782 3.09202C14 3.51984 14 4.0799 14 5.2V10.8C14 11.9201 14 12.4802 13.782 12.908C13.5903 13.2843 13.2843 13.5903 12.908 13.782C12.4802 14 11.9201 14 10.8 14H5.2C4.07989 14 3.51984 14 3.09202 13.782C2.71569 13.5903 2.40973 13.2843 2.21799 12.908C2 12.4802 2 11.9201 2 10.8V5.2C2 4.07989 2 3.51984 2.21799 3.09202C2.40973 2.71569 2.71569 2.40973 3.09202 2.21799C3.51984 2 4.0799 2 5.2 2Z" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    share: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 8V10.8C14 11.9201 14 12.4802 13.782 12.908C13.5903 13.2843 13.2843 13.5903 12.908 13.782C12.4802 14 11.9201 14 10.8 14H5.2C4.07989 14 3.51984 14 3.09202 13.782C2.71569 13.5903 2.40973 13.2843 2.21799 12.908C2 12.4802 2 11.9201 2 10.8V8M10.6667 4.66667L8 2M8 2L5.33333 4.66667M8 2V10" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    done: '<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M13.3327 4L5.99935 11.3333L2.66602 8" stroke="currentColor" stroke-width="1.33" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };
  var TEXT = { chart: "Descarregar gráfico", table: "Descarregar tabela", share: "Partilhar resultados", copied: "Link copiado", menu: "Opções" };

  function q(sel, from) { return !sel ? null : (typeof sel === "string" ? (from || document).querySelector(sel) : sel); }
  function slug(s) { return String(s || "resultados").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  /* O download tem de arrancar no mesmo toque (iPhone), por isso tudo e sincrono: toDataURL e nao toBlob */
  function save(canvas, name) {
    var a = document.createElement("a");
    a.href = canvas.toDataURL("image/png"); a.download = slug(name) + ".png";
    document.body.appendChild(a); a.click(); a.remove();
  }
  function chartImage(canvas) {
    var pad = 24 * 2, out = document.createElement("canvas");
    out.width = canvas.width + pad * 2; out.height = canvas.height + pad * 2;
    var c = out.getContext("2d");
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, out.width, out.height);
    c.drawImage(canvas, pad, pad);
    return out;
  }
  /* Desenha a tabela numa imagem com o estilo do kit (cabecalho cinzento, linhas #e9ecf1, Inter 14px) */
  function tableImage(table) {
    var el = table.tagName === "TABLE" ? table : table.querySelector("table");
    var rows = Array.prototype.map.call(el.rows, function (r) { return Array.prototype.map.call(r.cells, function (c) { return c.textContent.trim(); }); });
    var head = el.tHead ? el.tHead.rows.length : 1;
    var f = fontFamily(el), S = 2, P = 12, LH = 20, pad = 24;
    var probe = document.createElement("canvas").getContext("2d");
    var widths = [];
    rows.forEach(function (r, ri) {
      probe.font = (ri < head ? "500 " : "400 ") + "14px " + f;
      r.forEach(function (v, i) { widths[i] = Math.max(widths[i] || 0, Math.ceil(probe.measureText(v).width) + P * 2); });
    });
    var W = widths.reduce(function (a, b) { return a + b; }, 0) + pad * 2, H = rows.length * (LH + P * 2) + pad * 2;
    var out = document.createElement("canvas"); out.width = W * S; out.height = H * S;
    var c = out.getContext("2d"); c.scale(S, S);
    c.fillStyle = "#ffffff"; c.fillRect(0, 0, W, H);
    c.textBaseline = "middle";
    var y = pad, line = css(el, "--lfk-border-2", "#e9ecf1");
    rows.forEach(function (r, ri) {
      var x = pad, h = LH + P * 2;
      c.font = (ri < head ? "500 " : "400 ") + "14px " + f;
      c.fillStyle = ri < head ? css(el, "--lfk-text-3", "#4f5969") : css(el, "--lfk-text", "#202432");
      r.forEach(function (v, i) { c.fillText(v, x + P, y + h / 2); x += widths[i]; });
      if (ri >= head) { c.fillStyle = line; c.fillRect(pad, y + h - 1, W - pad * 2, 1); }
      y += h;
    });
    return out;
  }
  function formFields(form) {
    return Array.prototype.filter.call(form.elements, function (e) {
      return (e.name || e.id || e.getAttribute("data-type")) && !/^(button|submit|reset|file|password)$/.test(e.type);
    });
  }
  function key(e) { return e.getAttribute("data-type") || e.name || e.id; }
  function shareUrl(form) {
    var p = new URLSearchParams();
    formFields(form).forEach(function (e) {
      if ((e.type === "radio" || e.type === "checkbox") && !e.checked) return;
      if (e.value !== "") p.set(key(e), e.value);
    });
    return location.origin + location.pathname + "?" + p.toString();
  }
  function restore(form) {
    form = q(form); if (!form) return false;
    var p = new URLSearchParams(location.search), any = false;
    formFields(form).forEach(function (e) {
      var v = p.get(key(e)); if (v === null) return;
      if (e.type === "radio" || e.type === "checkbox") e.checked = e.value === v || (e.type === "checkbox" && v === "on");
      else e.value = v;
      e.dispatchEvent(new Event("change", { bubbles: true }));
      any = true;
    });
    return any;
  }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    var t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select(); try { document.execCommand("copy"); } catch (e) {} t.remove();
    return Promise.resolve();
  }
  function item(action, icon, text) {
    return '<button type="button" class="lfk-menu-item" data-lfk-action="' + action + '"><span class="lfk-menu-icon">' + ICON[icon] + '</span><span>' + text + "</span></button>";
  }
  /* <div class="lfk-menu" data-chart="#canvas" data-table="#tabela" data-form="#formulario" data-file="nome"></div>
     Cada data-* e opcional: so aparecem as acoes que tiverem alvo. Textos: data-text-chart, data-text-table, data-text-share, data-text-copied. */
  function menu(m) {
    if (m.__lfkMenu) return m;
    var d = m.dataset, T = {
      chart: d.textChart || TEXT.chart, table: d.textTable || TEXT.table, share: d.textShare || TEXT.share, copied: d.textCopied || TEXT.copied
    };
    if (!m.querySelector(".lfk-menu-list")) {
      var h = '<button type="button" class="lfk-menu-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="' + (d.textMenu || TEXT.menu) + '">' + ICON.dots + '</button><div class="lfk-menu-list" role="menu">';
      if (d.chart) h += item("download-chart", "chart", T.chart);
      if (d.table) h += item("download-table", "table", T.table);
      if (d.form) h += ((d.chart || d.table) ? '<hr class="lfk-menu-line">' : "") + item("share", "share", T.share);
      m.innerHTML = h + "</div>";
    }
    var tog = m.querySelector(".lfk-menu-toggle");
    function close() { m.classList.remove("is-open"); tog.setAttribute("aria-expanded", "false"); }
    m.__lfkClose = close;
    tog.addEventListener("click", function () {
      var open = !m.classList.contains("is-open");
      document.querySelectorAll(".lfk-menu.is-open").forEach(function (o) { if (o !== m) o.__lfkClose(); });
      m.classList.toggle("is-open", open); tog.setAttribute("aria-expanded", open ? "true" : "false");
    });
    m.addEventListener("keydown", function (e) { if (e.key === "Escape") { close(); tog.focus(); } });
    m.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lfk-action]"); if (!b) return;
      var a = b.getAttribute("data-lfk-action"), name = d.file || document.title;
      if (a === "download-chart") { var cv = q(d.chart); if (cv) save(chartImage(cv), name + "-grafico"); close(); }
      else if (a === "download-table") { var tb = q(d.table); if (tb && tb.querySelector ? (tb.tagName === "TABLE" || tb.querySelector("table")) : false) save(tableImage(tb), name + "-tabela"); close(); }
      else if (a === "share") {
        var f = q(d.form); if (!f) return;
        copy(shareUrl(f)).then(function () {
          var ic = b.querySelector(".lfk-menu-icon"), tx = b.querySelector("span:last-child");
          b.classList.add("is-done"); ic.innerHTML = ICON.done; tx.textContent = T.copied;
          setTimeout(function () { b.classList.remove("is-done"); ic.innerHTML = ICON.share; tx.textContent = T.share; }, 1500);
        });
      }
    });
    m.__lfkMenu = true;
    return m;
  }
  function menus(root) { (root || document).querySelectorAll(".lfk .lfk-menu").forEach(menu); }
  document.addEventListener("click", function (e) { if (!e.target.closest(".lfk-menu")) document.querySelectorAll(".lfk-menu.is-open").forEach(function (o) { o.__lfkClose(); }); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { menus(); });
  else menus();

  /* ---------- Barra com zonas ----------
     <div class="lfk-zones" data-max="100" data-zones="35:Saudável:ok,45:Aceitável:warn,100:Preocupante:err" data-format="%"></div>
     LFK.zones(el, 60) desenha e devolve a zona {label, tone}. */
  function zones(el, value) {
    el = q(el); if (!el) return null;
    var max = parseFloat(el.dataset.max) || 100, unit = el.dataset.format == null ? "%" : el.dataset.format;
    var list = (el.dataset.zones || "").split(",").map(function (z) { var p = z.split(":"); return { to: parseFloat(p[0]), label: p[1] || "", tone: p[2] || "ok" }; });
    if (!el.__lfkZones) {
      var from = 0, bar = '<div class="lfk-zones-bar">';
      list.forEach(function (z) { bar += '<div class="lfk-zones-seg is-' + z.tone + '" style="flex:' + Math.max(0, z.to - from) + ' 1 0"></div>'; from = z.to; });
      el.innerHTML = '<div class="lfk-zones-tip"></div><div class="lfk-zones-dot"></div>' + bar + "</div>";
      el.__lfkZones = true;
    }
    var v = Math.max(0, Math.min(max, Number(value) || 0)), pct = v / max * 100;
    var zone = list.filter(function (z) { return v <= z.to; })[0] || list[list.length - 1];
    var dot = el.querySelector(".lfk-zones-dot"), tip = el.querySelector(".lfk-zones-tip");
    /* nao deixar a etiqueta sair da barra nas pontas */
    dot.style.left = "clamp(11px, " + pct + "%, calc(100% - 11px))";
    tip.style.left = "clamp(32px, " + pct + "%, calc(100% - 32px))";
    dot.className = "lfk-zones-dot is-" + zone.tone;
    tip.textContent = String(Math.round(v)).replace(".", ",") + unit;
    return zone;
  }

  /* ---------- Medidor em segmentos ---------- */
  function meter(el, value) {
    el = q(el); if (!el) return;
    var max = parseInt(el.dataset.max, 10) || 5, v = value == null ? parseInt(el.dataset.value, 10) || 0 : value;
    var h = ""; for (var i = 1; i <= max; i++) h += '<span class="' + (i <= v ? "is-on" : "") + '"></span>';
    el.innerHTML = h;
  }

  /* ---------- Questionario por passos ----------
     Cada .lfk-step tem um titulo e .lfk-option com data-value. Escolher uma opcao avanca sozinho.
     As respostas ficam em el.__lfkAnswers e no evento "lfk:done" (detail = respostas). Textos: data-text-of, data-text-back, data-text-next. */
  function steps(el) {
    el = q(el); if (!el || el.__lfkSteps) return el;
    var all = Array.prototype.slice.call(el.querySelectorAll(".lfk-step"));
    if (!all.length) return el;
    var d = el.dataset, cur = 0, answers = {};
    var stage = document.createElement("div"); stage.className = "lfk-steps-stage";
    all[0].parentNode.insertBefore(stage, all[0]); all.forEach(function (s) { stage.appendChild(s); });
    var top = document.createElement("div"); top.className = "lfk-steps-top";
    var bar = document.createElement("div"); bar.className = "lfk-steps-bar"; bar.innerHTML = '<div class="lfk-steps-fill"></div>';
    var nav = document.createElement("div"); nav.className = "lfk-steps-nav";
    nav.innerHTML = '<button type="button" class="is-back">' + (d.textBack || "← Anterior") + '</button><button type="button" class="is-next">' + (d.textNext || "Seguinte →") + "</button>";
    el.insertBefore(bar, stage); el.insertBefore(top, bar); el.appendChild(nav);
    var back = nav.querySelector(".is-back"), next = nav.querySelector(".is-next");
    function key(i) { return all[i].dataset.name || "p" + (i + 1); }
    function show(i) {
      cur = Math.max(0, Math.min(all.length - 1, i));
      all.forEach(function (s, k) { s.classList.toggle("is-current", k === cur); s.setAttribute("aria-hidden", k === cur ? "false" : "true"); });
      top.innerHTML = "<span>" + (d.textStep || "Pergunta") + " <strong>" + (cur + 1) + "</strong> " + (d.textOf || "de") + " " + all.length + "</span><span>" + Math.round(Object.keys(answers).length / all.length * 100) + "%</span>";
      bar.firstChild.style.width = (Object.keys(answers).length / all.length * 100) + "%";
      back.hidden = cur === 0;
      next.hidden = !(key(cur) in answers) || cur === all.length - 1;
    }
    el.addEventListener("click", function (e) {
      var o = e.target.closest(".lfk-option"); if (!o || !el.contains(o)) return;
      var step = o.closest(".lfk-step"), i = all.indexOf(step);
      step.querySelectorAll(".lfk-option").forEach(function (x) { var on = x === o; x.classList.toggle("is-active", on); x.setAttribute("aria-pressed", on ? "true" : "false"); });
      answers[key(i)] = o.dataset.value != null ? o.dataset.value : o.textContent.trim();
      el.__lfkAnswers = answers;
      if (Object.keys(answers).length === all.length && i === all.length - 1) {
        show(i);
        el.dispatchEvent(new CustomEvent("lfk:done", { bubbles: true, detail: Object.assign({}, answers) }));
      } else setTimeout(function () { show(i + 1); }, 250);
    });
    back.addEventListener("click", function () { show(cur - 1); });
    next.addEventListener("click", function () { show(cur + 1); });
    el.classList.add("is-ready");
    show(0);
    el.__lfkSteps = true;
    return el;
  }

  /* ---------- Texto por baixo das opcoes: <div class="lfk-radios" data-lfk-desc="#descricao"> e cada input com data-desc ---------- */
  function descs(root) {
    (root || document).querySelectorAll(".lfk [data-lfk-desc]").forEach(function (g) {
      if (g.__lfkDesc) return; g.__lfkDesc = true;
      var out = q(g.getAttribute("data-lfk-desc"));
      function upd() { var c = g.querySelector("input:checked"); if (out) out.textContent = c && c.dataset.desc ? c.dataset.desc : ""; }
      g.addEventListener("change", upd); upd();
    });
  }
  function autoInit() {
    document.querySelectorAll(".lfk .lfk-steps").forEach(steps);
    document.querySelectorAll(".lfk .lfk-meter[data-value]").forEach(function (m) { meter(m); });
    document.querySelectorAll(".lfk .lfk-zones[data-value]").forEach(function (z) { zones(z, z.dataset.value); });
    descs();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoInit);
  else autoInit();
  /* ---------- Calcular: comportamento igual ao das calculadoras do site ----------
     LFK.calc(document.getElementById("calcular"), {
       results: "#resultados",      // bloco dos resultados (fica hidden ate ao primeiro calculo)
       empty: ".lfk-empty",         // placeholder "Preenche os campos..." (some depois do clique)
       run: function () { ... }     // faz as contas e preenche os resultados; devolve false se os dados forem invalidos
     });
     - So calcula ao clicar em Calcular. Mudar um campo ou uma lista NUNCA recalcula.
     - Depois do clique o placeholder desaparece e os resultados aparecem.
     - Scroll suave ate aos resultados (100px acima), pelo Lenis em desktop e nativo em telemovel.
     - No fim chama ScrollTrigger.refresh() porque a altura da pagina mudou. */
  function calc(button, o) {
    if (!button) return;
    o = o || {};
    function el(x) { return typeof x === "string" ? document.querySelector(x) : x; }
    button.addEventListener("click", function (e) {
      e.preventDefault();
      if (o.run && o.run() === false) return;
      var res = el(o.results), empty = el(o.empty);
      if (empty) empty.hidden = true;
      if (res) res.hidden = false;
      setTimeout(function () {
        if (window.ScrollTrigger && window.ScrollTrigger.refresh) window.ScrollTrigger.refresh();
        if (!res || o.scroll === false) return;
        var top = Math.max(0, res.getBoundingClientRect().top + window.pageYOffset - 100);
        if (window.lenis && typeof window.lenis.scrollTo === "function") window.lenis.scrollTo(top);
        else if (document.documentElement.classList.contains("lenis")) window.scrollTo(0, top);
        else { try { window.scrollTo({ top: top, behavior: "smooth" }); } catch (err) { window.scrollTo(0, top); } }
      }, 0);
    });
  }

  /* ---------- Hover do botao principal: se sair igual ao botao (EUPF), usa o cinzento do site, como no "Calcular" live ---------- */
  function theme(root) {
    (root ? [root] : document.querySelectorAll(".lfk")).forEach(function (el) {
      el.style.removeProperty("--lfk-brand-hover");
      var cs = getComputedStyle(el);
      var probe = document.createElement("span");
      probe.style.cssText = "position:absolute;visibility:hidden;color:var(--lfk-brand);background:var(--lfk-brand-hover)";
      el.appendChild(probe);
      var p = getComputedStyle(probe), same = p.color === p.backgroundColor;
      el.removeChild(probe);
      if (same) el.style.setProperty("--lfk-brand-hover", "var(--colors--grey-700, #3a4454)");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { theme(); });
  else theme();

  /* ---------- Escolha em segmentos: <div class="lfk-segment"> so um botao carregado; evento "change" no grupo ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest && e.target.closest(".lfk .lfk-segment > button");
    if (!b) return;
    var g = b.parentElement;
    g.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); x.classList.remove("is-on"); });
    g.dispatchEvent(new CustomEvent("change", { bubbles: true, detail: { value: b.value || b.textContent.trim() } }));
  });

  /* ---------- Tooltip: nao sair do ecra (a seta continua a apontar para o icone) ---------- */
  function tipFit(wrap) {
    var box = wrap.querySelector(".lfk-help-box");
    if (!box || wrap.matches(".is-left,.is-right")) return;
    box.style.setProperty("--lfk-tip-dx", "0px");
    var r = box.getBoundingClientRect(), m = 8, dx = 0;
    if (r.left < m) dx = m - r.left;
    else if (r.right > window.innerWidth - m) dx = window.innerWidth - m - r.right;
    if (dx) box.style.setProperty("--lfk-tip-dx", Math.round(dx) + "px");
  }
  ["mouseover", "focusin"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      var w = e.target && e.target.closest && e.target.closest(".lfk .lfk-help-wrap");
      if (w) tipFit(w);
    });
  });

  /* ---------- Indice do artigo: <nav class="lfk-toc" data-lfk-spy> marca a seccao que esta no ecra ---------- */
  function toc(nav) {
    var items = Array.prototype.slice.call(nav.querySelectorAll(".lfk-toc-item[href^='#']"));
    var secs = items.map(function (a) { return document.getElementById(decodeURIComponent(a.getAttribute("href").slice(1))); });
    var offset = parseInt(nav.getAttribute("data-lfk-spy"), 10) || 120, last = -1;
    function spy() {
      var cur = 0;
      secs.forEach(function (sec, i) { if (sec && sec.getBoundingClientRect().top <= offset) cur = i; });
      if (cur === last) return; last = cur;
      items.forEach(function (a, i) {
        a.classList.toggle("is-current", i === cur);
        if (i === cur) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current");
      });
      var list = items[cur] && items[cur].parentElement;
      if (list && list.scrollWidth > list.clientWidth) list.scrollTo({ left: items[cur].offsetLeft - 16, behavior: "smooth" });
    }
    window.addEventListener("scroll", spy, { passive: true }); spy();
  }
  function tocs(root) { (root || document).querySelectorAll(".lfk .lfk-toc[data-lfk-spy]").forEach(toc); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { tocs(); });
  else tocs();

  window.LFK = Object.assign(window.LFK || {}, { ready: ready, bar: bar, line: line, donut: donut, views: views, table: table, fmt: fmt, num: num, locale: locale, calc: calc, numInputs: numInputs, toc: toc, tocs: tocs, theme: theme, short: short, select: select, selects: selects, menu: menu, menus: menus, restore: restore, shareUrl: shareUrl, zones: zones, steps: steps, meter: meter, descs: descs });
})();
