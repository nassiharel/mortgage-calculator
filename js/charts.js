/* Minimal dependency-free SVG charts (line & stacked bars). Colors come from CSS variables. */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function niceMax(v) {
    if (v <= 0) return 1;
    var p = Math.pow(10, Math.floor(Math.log10(v)));
    var n = v / p;
    var m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
    return m * p;
  }

  function shortMoney(v) {
    var a = Math.abs(v);
    if (a >= 1e6) return (v / 1e6).toLocaleString('he-IL', { maximumFractionDigits: 1 }) + 'M';
    if (a >= 1e3) return (v / 1e3).toLocaleString('he-IL', { maximumFractionDigits: 0 }) + 'K';
    return Math.round(v).toLocaleString('he-IL');
  }

  /**
   * Line chart.
   * opts: { series: [{name, color, points:[{x,y}]}], xLabel, yFormat, xFormat, height, tooltip(x) }
   * x axis is drawn right→left for RTL readers? No: time axes conventionally run left→right even in Hebrew
   * financial charts; we keep left→right and mirror labels' text direction only.
   */
  function line(container, opts) {
    container.innerHTML = '';
    var W = Math.max(container.clientWidth || 600, 280), H = opts.height || 260;
    var pad = { l: 52, r: 12, t: 12, b: 30 };
    var series = opts.series.filter(function (s) { return s.points.length; });
    if (!series.length) return;
    var xMax = 0, yMax = 0;
    series.forEach(function (s) { s.points.forEach(function (p) { if (p.x > xMax) xMax = p.x; if (p.y > yMax) yMax = p.y; }); });
    var xMin = opts.xMin !== undefined ? opts.xMin : 1;
    yMax = niceMax(yMax * 1.05);
    var sx = function (x) { return pad.l + (x - xMin) / Math.max(xMax - xMin, 1) * (W - pad.l - pad.r); };
    var sy = function (y) { return H - pad.b - y / yMax * (H - pad.t - pad.b); };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: '100%', height: H, role: 'img', 'aria-label': opts.label || '', direction: 'ltr' });
    var g = el('g', { class: 'axis' });
    for (var i = 0; i <= 4; i++) {
      var yv = yMax * i / 4, yy = sy(yv);
      g.appendChild(el('line', { x1: pad.l, x2: W - pad.r, y1: yy, y2: yy, class: 'grid' }));
      g.appendChild(el('text', { x: pad.l - 6, y: yy + 4, 'text-anchor': 'end' }, (opts.yFormat || shortMoney)(yv)));
    }
    var step = Math.max(1, Math.ceil((xMax - xMin) / Math.max(4, Math.floor(W / 70))));
    for (var x = xMin; x <= xMax; x += step) {
      g.appendChild(el('text', { x: sx(x), y: H - 10, 'text-anchor': 'middle' }, (opts.xFormat || String)(x)));
    }
    svg.appendChild(g);

    series.forEach(function (s) {
      var d = s.points.map(function (p, idx) { return (idx ? 'L' : 'M') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1); }).join(' ');
      svg.appendChild(el('path', { d: d, fill: 'none', stroke: s.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-dasharray': s.dash }));
    });

    // hover crosshair + tooltip
    var cross = el('line', { y1: pad.t, y2: H - pad.b, class: 'cross', visibility: 'hidden' });
    svg.appendChild(cross);
    var dots = series.map(function (s) { var c = el('circle', { r: 4, fill: s.color, visibility: 'hidden' }); svg.appendChild(c); return c; });
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    container.style.position = 'relative';
    container.appendChild(svg);
    container.appendChild(tip);

    function move(ev) {
      var rect = svg.getBoundingClientRect();
      var px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      px = px * W / rect.width;
      var xv = Math.round(xMin + (px - pad.l) / (W - pad.l - pad.r) * (xMax - xMin));
      xv = Math.max(xMin, Math.min(xMax, xv));
      cross.setAttribute('x1', sx(xv)); cross.setAttribute('x2', sx(xv)); cross.setAttribute('visibility', 'visible');
      var lines = [];
      series.forEach(function (s, i) {
        var p = s.points[xv - xMin] || s.points.filter(function (q) { return q.x === xv; })[0];
        if (p) {
          dots[i].setAttribute('cx', sx(p.x)); dots[i].setAttribute('cy', sy(p.y)); dots[i].setAttribute('visibility', 'visible');
          lines.push('<div><i style="background:' + s.color + '"></i>' + escapeHtml(s.name) + ': <b>' + (opts.tipFormat || shortMoney)(p.y) + '</b></div>');
        } else dots[i].setAttribute('visibility', 'hidden');
      });
      tip.innerHTML = '<div class="tip-h">' + (opts.xTip || String)(xv) + '</div>' + lines.join('');
      tip.hidden = false;
      var left = sx(xv) / W * rect.width;
      tip.style.left = Math.min(Math.max(left - tip.offsetWidth / 2, 0), rect.width - tip.offsetWidth) + 'px';
      tip.style.top = '0px';
    }
    function leave() { cross.setAttribute('visibility', 'hidden'); dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); }); tip.hidden = true; }
    svg.addEventListener('mousemove', move);
    svg.addEventListener('touchmove', move, { passive: true });
    svg.addEventListener('mouseleave', leave);
    svg.addEventListener('touchend', leave);
  }

  /**
   * Horizontal stacked bars – one bar per item, segments per component.
   * opts: { items: [{name, color, parts:[{label, value, cls}]}], format }
   */
  function stacked(container, opts) {
    container.innerHTML = '';
    var max = 0;
    opts.items.forEach(function (it) { var s = it.parts.reduce(function (a, p) { return a + Math.max(p.value, 0); }, 0); if (s > max) max = s; });
    if (!max) return;
    var wrap = document.createElement('div');
    wrap.className = 'stack-chart';
    opts.items.forEach(function (it) {
      var row = document.createElement('div');
      row.className = 'stack-row';
      var total = it.parts.reduce(function (a, p) { return a + Math.max(p.value, 0); }, 0);
      var segs = it.parts.map(function (p) {
        var w = Math.max(p.value, 0) / max * 100;
        return '<span class="seg ' + p.cls + '" style="width:' + w + '%" title="' + escapeHtml(p.label) + ': ' + opts.format(p.value) + '"></span>';
      }).join('');
      row.innerHTML = '<div class="stack-name"><i style="background:' + it.color + '"></i>' + escapeHtml(it.name) + '</div>' +
        '<div class="stack-bar" role="img" aria-label="' + escapeHtml(it.name + ' – ' + opts.format(total)) + '">' + segs + '</div>' +
        '<div class="stack-total">' + opts.format(total) + '</div>';
      wrap.appendChild(row);
    });
    var legend = document.createElement('div');
    legend.className = 'legend';
    legend.innerHTML = opts.items[0].parts.map(function (p) { return '<span><i class="seg ' + p.cls + '"></i>' + escapeHtml(p.label) + '</span>'; }).join('');
    container.appendChild(wrap);
    container.appendChild(legend);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  root.MortgageCharts = { line: line, stacked: stacked, escapeHtml: escapeHtml };
})(typeof self !== 'undefined' ? self : this);
