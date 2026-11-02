// Research timeline (/timeline): time-scaled Gantt view (desktop) + list view (mobile / toggle).
// Data comes from _data/timeline.yml via window.TIMELINE.
(function () {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function init() {
    var T = window.TIMELINE;
    var root = document.getElementById('tl-root');
    if (!T || !root) return;
    var P = T.projects, threads = T.threads || [], byId = {};
    P.forEach(function (p) { byId[p.id] = p; });

    var chips = root.querySelectorAll('.tl-chip');
    var desc = document.getElementById('tl-thread-desc');
    var descDefault = desc ? desc.innerHTML : '';
    var state = null; // {type: 'thread'|'project', key}

    // ---------- shared helpers ----------
    function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
    function svgEl(tag, attrs, parent) { var e = document.createElementNS(NS, tag); for (var k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); }
    function stateText(o) { if (o.state_label) return o.state_label; return o.state === 'review' ? 'under review' : (o.state === 'prep' ? 'in prep' : ''); }
    function mkClass(o, lane) { return 'tl-mk mk-' + o.type + (o.role === 'lead' ? ' is-lead lane-' + lane : '') + (o.state !== 'published' ? ' st-' + o.state : ''); }
    function arrowDefs(svg, prefix) {
      var defs = svgEl('defs', {}, svg);
      var list = threads.map(function (t) { return [t.key, t.color]; }).concat([['link', '#868e96']]);
      list.forEach(function (kc) {
        var m = svgEl('marker', {id: prefix + kc[0], viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse'}, defs);
        svgEl('path', {d: 'M2 1L8 5L2 9', fill: 'none', stroke: kc[1], 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'}, m);
      });
    }
    function edgesFor(test) {
      var out = [];
      threads.forEach(function (t, k) {
        (t.edges || []).forEach(function (e) {
          if (test(t, e)) out.push({t: t, k: k, a: e[0], b: e[1], tentative: e[2] === 'tentative'});
        });
      });
      return out;
    }
    function selected(t, e) {
      if (!state) return false;
      return state.type === 'thread' ? t.key === state.key : (e[0] === state.key || e[1] === state.key);
    }

    // ---------- Gantt view ----------
    var G = document.getElementById('tlg'), GH = document.getElementById('tlg-head');
    var MPX = 18, AXW = 56, LGAP = 16, CGAP = 10;
    function mi(s) { var a = String(s).split('-'); return (+a[0]) * 12 + (+a[1]) - 1; }
    var A0 = mi(T.axis.start), A1 = mi(T.axis.end), H = (A1 - A0 + 1) * MPX;
    function yTop(s) { return Math.max(0, Math.min(mi(s) - A0, A1 - A0 + 1)) * MPX; }
    function yEnd(s) { return Math.min(mi(s) - A0 + 1, A1 - A0 + 1) * MPX; }
    // Flatten lanes -> columns -> sub-columns.
    var cols = [], weightSum = 0;
    T.lanes.forEach(function (l) {
      (l.columns || []).forEach(function (c) {
        for (var s = 0; s < (c.span || 1); s++) { cols.push({lane: l.key, col: c.key, sub: s, wt: c.width || 1}); weightSum += c.width || 1; }
      });
    });
    function colKey(lane, col, sub) { return lane + '/' + col + '/' + (sub || 0); }
    var rects = {}, boxEls = {}, gThreads = null, openPop = null;
    function jq() { return window.jQuery && window.jQuery.fn && window.jQuery.fn.popover ? window.jQuery : null; }
    function closePop() { var $ = jq(); if (openPop && $) $(openPop).popover('dispose'); openPop = null; }

    function popContent(p) {
      var h = '<div class="tlg-pop">';
      h += '<div class="tlg-pop-meta">' + esc(p.period) + (p.tag ? ' · ' + esc(p.tag) : '') + (p.phd ? ' · Ph.D. research' : '') + '</div>';
      h += '<div class="tlg-pop-mot">' + esc(p.motivation) + '</div>';
      if (p.partners) h += '<div class="tlg-pop-partners">' + esc(p.partners) + '</div>';
      if (p.outputs && p.outputs.length) {
        h += '<ul class="tl-outputs tlg-pop-out">';
        p.outputs.forEach(function (o) {
          var st = stateText(o);
          h += '<li><span class="' + mkClass(o, p.lane) + '"></span><span class="tl-out-text">' +
            (o.url ? '<a href="' + esc(o.url) + '" target="_blank" rel="noopener">' + esc(o.name) + '</a>' : '<span class="tl-out-name">' + esc(o.name) + '</span>') +
            (o.venue ? '<span class="tl-venue"> · ' + esc(o.venue) + '</span>' : '') +
            (st ? '<span class="tl-state"> · ' + esc(st) + '</span>' : '') + '</span></li>';
        });
        h += '</ul>';
      } else if (p.note) {
        h += '<div class="tl-note small mt-1">' + esc(p.note) + '</div>';
      }
      if (p.url) h += '<div class="small mt-1"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">Project page ↗</a></div>';
      return h + '</div>';
    }

    // Path between two box rects {x, y, w, h}.
    function connect(a, b, k, forceSide) {
      var off = (k || 0) * 7;
      if (Math.abs(a.x - b.x) < 1) {
        if (!forceSide && a.y + a.h <= b.y + 1) {
          var x = a.x + 11.5;
          return 'M' + x + ' ' + (a.y + a.h) + ' V' + (b.y - 1);
        }
        var sx = a.x + a.w, sy = a.y + a.h - 46 - off * 2, ty = b.y + 18 + off, bx = sx + 22 + off * 1.4;
        return 'M' + sx + ' ' + sy + ' C' + bx + ' ' + sy + ' ' + bx + ' ' + ty + ' ' + (sx + 1) + ' ' + ty;
      }
      var right = a.x < b.x;
      var sx2 = right ? a.x + a.w : a.x, tx = right ? b.x : b.x + b.w;
      var ty2 = b.y + 18 + off;
      if (ty2 > b.y + b.h - 6) ty2 = b.y + b.h / 2;
      var sy2 = Math.max(a.y + 12, Math.min(ty2, a.y + a.h - 12 - off));
      var mx = (sx2 + tx) / 2;
      return 'M' + sx2 + ' ' + sy2 + ' C' + mx + ' ' + sy2 + ' ' + mx + ' ' + ty2 + ' ' + (right ? tx - 2 : tx + 2) + ' ' + ty2;
    }

    function layoutGantt() {
      if (!G || !G.offsetParent) return;
      var W = G.clientWidth;
      if (!W) return;
      closePop();
      G.innerHTML = ''; GH.innerHTML = ''; rects = {}; boxEls = {};
      G.style.height = (H + (T.phd ? 40 : 8)) + 'px';
      var unit = (W - AXW - LGAP * (T.lanes.length - 1) - CGAP * (cols.length - T.lanes.length)) / weightSum;
      var pos = {}, x = AXW, prevLane = null;
      cols.forEach(function (c) {
        if (prevLane !== null) x += (c.lane === prevLane ? CGAP : LGAP);
        var w = unit * c.wt;
        pos[colKey(c.lane, c.col, c.sub)] = {x: x, w: w};
        x += w; prevLane = c.lane;
      });
      T.lanes.forEach(function (l) {
        var first = pos[colKey(l.key, l.columns[0].key, 0)];
        var lc = l.columns[l.columns.length - 1];
        var last = pos[colKey(l.key, lc.key, (lc.span || 1) - 1)];
        var lx = first.x, lw = last.x + last.w - first.x;
        var hd = el('div', 'tlg-lanehead lane-' + l.key, GH);
        hd.style.left = lx + 'px'; hd.style.width = lw + 'px'; hd.textContent = l.label;
        var band = el('div', 'tlg-laneband lane-' + l.key, G);
        band.style.left = lx + 'px'; band.style.width = lw + 'px'; band.style.height = H + 'px';
        l.columns.forEach(function (c) {
          var c0 = pos[colKey(l.key, c.key, 0)], c1 = pos[colKey(l.key, c.key, (c.span || 1) - 1)];
          var ch = el('div', 'tlg-colhead lane-' + l.key, GH);
          ch.style.left = c0.x + 'px'; ch.style.width = (c1.x + c1.w - c0.x) + 'px'; ch.textContent = c.label;
        });
      });
      function colX(p) { return pos[colKey(p.lane, p.column, p.sub)].x; }
      function colWOf(p) { return pos[colKey(p.lane, p.column, p.sub)].w; }

      // Axis: years and quarters.
      for (var m = A0; m <= A1; m++) {
        var y = (m - A0) * MPX, mon = m % 12;
        if (mon === 0 || m === A0) {
          var g = el('div', 'tlg-grid' + (mon === 0 ? ' is-year' : ''), G);
          g.style.top = y + 'px'; g.style.left = (AXW - 6) + 'px';
          var lab = el('div', 'tlg-ylab', G);
          lab.style.top = y + 'px';
          lab.textContent = Math.floor(m / 12) + (mon !== 0 ? '.' + ('0' + (mon + 1)).slice(-2) : '');
        } else if (mon % 3 === 0) {
          var t = el('div', 'tlg-tick', G); t.style.top = y + 'px';
          var ql = el('div', 'tlg-qlab', G); ql.style.top = y + 'px'; ql.textContent = ('0' + (mon + 1)).slice(-2);
        }
      }
      var ny = yTop(T.axis.now) + MPX / 2;
      var now = el('div', 'tlg-now', G); now.style.top = ny + 'px'; now.style.left = (AXW - 6) + 'px';
      var nl = el('div', 'tlg-nowlab', G); nl.style.top = ny + 'px'; nl.textContent = 'now';

      var gsvg = svgEl('svg', {'class': 'tlg-svg', width: W, height: H + 8, viewBox: '0 0 ' + W + ' ' + (H + 8)}, null);
      arrowDefs(gsvg, 'tlg-a-');
      var gLinks = svgEl('g', {'class': 'tlg-links'}, gsvg);

      // Boxes: height = duration.
      P.forEach(function (p) {
        var bx = colX(p), colW = colWOf(p), top = yTop(p.start) + 2;
        var bottom = p.end ? yEnd(p.end) - 2 : H;
        var open = !p.end || mi(p.end) > A1;
        var b = el('div', 'tlg-box lane-' + p.lane + (p.status === 'ongoing' ? ' is-ongoing' : '') + (open ? ' is-open' : ''), G);
        b.style.left = bx + 'px'; b.style.top = top + 'px'; b.style.width = colW + 'px'; b.style.height = (bottom - top) + 'px';
        b.setAttribute('data-id', p.id); b.setAttribute('tabindex', '0'); b.setAttribute('role', 'button');
        b.setAttribute('aria-label', p.title + ', ' + p.period);
        var txt = el('div', 'tlg-box-text', b);
        el('div', 'tlg-title', txt).textContent = p.title;
        el('div', 'tlg-period', txt).textContent = p.period + (p.end && mi(p.end) > A1 ? ' →' : '');
        if (txt.offsetHeight > bottom - top - 8) b.classList.add('is-compact');
        boxEls[p.id] = b;
        rects[p.id] = {x: bx, y: top, w: colW, h: bottom - top, textH: Math.min(txt.offsetHeight, bottom - top - 8), key: colKey(p.lane, p.column, p.sub)};
      });

      // Outputs: marker at publication month (unpublished at "now").
      var placed = [];
      P.slice().sort(function (p1, p2) { return rects[p2.id].x - rects[p1.id].x; }).forEach(function (p) {
        var r = rects[p.id];
        var nextTop = H + 6;
        P.forEach(function (q) { var rq = rects[q.id]; if (q !== p && rq.key === r.key && rq.y > r.y && rq.y < nextTop) nextTop = rq.y; });
        var outs = (p.outputs || []).map(function (o) {
          var yy = (o.date ? yTop(o.date) : yTop(T.axis.now)) + MPX / 2;
          return {o: o, y: Math.min(yy, H - 9)};
        }).sort(function (a, b) { return a.y - b.y; });
        var minY = r.y + r.textH + 18, last = -1e9, i;
        outs.forEach(function (q) { q.y = Math.max(q.y, minY, last + 17); last = q.y; });
        for (i = outs.length - 1; i >= 0; i--) {
          var cap = (i === outs.length - 1 ? nextTop - 11 : outs[i + 1].y - 17);
          if (outs[i].y > cap) outs[i].y = cap;
        }
        if (outs.length) {
          var lastY = outs[outs.length - 1].y, bottom = r.y + r.h;
          if (lastY > bottom) {
            var st = el('div', 'tlg-stem lane-' + p.lane, G);
            st.style.left = (r.x + 10.5) + 'px'; st.style.top = bottom + 'px'; st.style.height = (lastY - bottom) + 'px';
          }
        }
        outs.forEach(function (q) {
          var o = q.o, d = el('div', 'tlg-out' + (q.y > r.y + r.h ? ' is-after' : ''), G);
          var lx = r.x + 5;
          d.style.left = lx + 'px'; d.style.top = (q.y - 8) + 'px';
          var stx = stateText(o);
          d.title = o.name + (o.venue ? ' · ' + o.venue : '') + (stx ? ' · ' + stx : '');
          el('span', mkClass(o, p.lane), d);
          var lbl = o.url ? el('a', 'tlg-out-label', d) : el('span', 'tlg-out-label', d);
          if (o.url) { lbl.href = o.url; lbl.target = '_blank'; lbl.rel = 'noopener'; }
          lbl.textContent = o.short || o.name;
          // Let the label run into free space on the right; stop before other boxes or labels.
          var natural = d.scrollWidth + 3, limit = W - lx - 2;
          P.forEach(function (q2) {
            if (q2 === p) return;
            var b2 = rects[q2.id];
            if (b2.x > lx + 2 && b2.y < q.y + 9 && b2.y + b2.h > q.y - 9) limit = Math.min(limit, b2.x - 4 - lx);
          });
          placed.forEach(function (pl) {
            if (pl.x > lx + 2 && Math.abs(pl.y - q.y) < 17) limit = Math.min(limit, pl.x - 4 - lx);
          });
          d.style.maxWidth = Math.max(Math.min(natural, limit), r.w - 6) + 'px';
          if (natural > r.w - 6 && limit > r.w - 6) d.classList.add('is-wide');
        });
        outs.forEach(function (q) { placed.push({x: r.x + 5, y: q.y}); });
      });

      // Ph.D. bracket: stepped outline that hugs each member column from its own start.
      if (T.phd && T.phd.members) {
        var mem = T.phd.members.map(function (id) { return rects[id]; }).filter(Boolean).sort(function (a, b) { return a.x - b.x; });
        if (mem.length) {
          var yb = H + 8, dd = '', i2;
          var x0s = mem.map(function (r) { return r.x - 5; }), x1s = mem.map(function (r) { return r.x + r.w + 5; });
          var tops = mem.map(function (r) { return r.y - 4; });
          dd = 'M' + x0s[0] + ' ' + yb + ' V' + tops[0];
          for (i2 = 0; i2 < mem.length - 1; i2++) {
            var bnd = (x1s[i2] + x0s[i2 + 1]) / 2;
            dd += ' H' + bnd + ' V' + tops[i2 + 1];
          }
          dd += ' H' + x1s[mem.length - 1] + ' V' + yb;
          svgEl('path', {d: dd, 'class': 'tlg-phd-line'}, gLinks);
          var tab = el('div', 'tlg-phd-tab', G);
          tab.style.left = x0s[0] + 'px'; tab.style.width = (x1s[mem.length - 1] - x0s[0]) + 'px'; tab.style.top = yb + 'px';
          tab.innerHTML = '<span class="tl-mk mk-data is-lead lane-mm st-prep"></span><span><b>' + esc(T.phd.label) + '</b> · thesis defense ' + esc(T.phd.defense) + '</span>';
          tab.title = T.phd.thesis || '';
        }
      }

      // "Builds on" links.
      P.forEach(function (p) {
        if (!p.builds_on || !rects[p.builds_on]) return;
        svgEl('path', {d: connect(rects[p.builds_on], rects[p.id], 0, false), 'class': 'tlg-link', 'marker-end': 'url(#tlg-a-link)'}, gLinks);
      });
      gThreads = svgEl('g', {'class': 'tlg-threads'}, gsvg);
      G.appendChild(gsvg);

      // Click: select project, show details.
      P.forEach(function (p) {
        var b = boxEls[p.id];
        b.addEventListener('click', function (ev) {
          if (ev.target.closest('a')) return;
          ev.stopPropagation();
          var same = state && state.type === 'project' && state.key === p.id;
          state = same ? null : {type: 'project', key: p.id};
          var wasOpen = openPop === b;
          closePop();
          apply();
          var $ = jq();
          if (!$ || same || wasOpen) return;
          $(b).popover({
            trigger: 'manual', html: true, sanitize: false, container: 'body', placement: 'auto', boundary: 'viewport',
            title: esc(p.title), content: popContent(p),
            template: '<div class="popover tlg-popover" role="tooltip"><div class="arrow"></div><h3 class="popover-header"></h3><div class="popover-body"></div></div>'
          });
          $(b).popover('show');
          openPop = b;
        });
        b.addEventListener('keydown', function (ev) {
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); b.click(); }
        });
      });
      drawGanttThreads();
    }

    function drawGanttThreads() {
      if (!gThreads) return;
      while (gThreads.firstChild) gThreads.removeChild(gThreads.firstChild);
      if (!state) return;
      var seen = {};
      edgesFor(selected).forEach(function (e) {
        var a = rects[e.a], b = rects[e.b];
        if (!a || !b) return;
        var k = seen[e.b] = (seen[e.b] === undefined ? 0 : seen[e.b] + 1);
        var d = connect(a, b, k, true);
        svgEl('path', {d: d, 'class': 'tlg-thread-halo'}, gThreads);
        var at = {d: d, 'class': 'tlg-thread', stroke: e.t.color, 'marker-end': 'url(#tlg-a-' + e.t.key + ')'};
        if (e.tentative) at['stroke-dasharray'] = '5 4';
        svgEl('path', at, gThreads);
        var mm = /^M([\d.\-]+) ([\d.\-]+)/.exec(d);
        if (mm) svgEl('circle', {cx: mm[1], cy: mm[2], r: 3.5, fill: e.t.color}, gThreads);
      });
    }

    // ---------- List view ----------
    var L = document.getElementById('tl'), LS = document.getElementById('tl-threads');
    function listBox(id) { var row = L && L.querySelector('.tl-row[data-id="' + id + '"]'); return row ? row.querySelector('.tl-box') : null; }
    function drawList() {
      if (!L || !LS || !L.offsetParent) return;
      while (LS.firstChild) LS.removeChild(LS.firstChild);
      var base = L.getBoundingClientRect();
      LS.setAttribute('width', base.width); LS.setAttribute('height', base.height);
      LS.setAttribute('viewBox', '0 0 ' + base.width + ' ' + base.height);
      arrowDefs(LS, 'tl-a-');
      var narrow = window.innerWidth < 768;
      var spacing = narrow ? 8 : 13, inset = narrow ? 9 : 14, yStep = narrow ? 6 : 8, r = narrow ? 3 : 5, n = threads.length;
      edgesFor(function () { return true; }).forEach(function (e) {
        var a = listBox(e.a), b = listBox(e.b);
        if (!a || !b) return;
        var ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        var off = (e.k - (n - 1) / 2) * yStep;
        var xa = ra.left - base.left, xb = rb.left - base.left;
        var ya = ra.top - base.top + ra.height / 2 + off, yb = rb.top - base.top + rb.height / 2 + off;
        var x = Math.min(xa, xb) - inset - (n - 1 - e.k) * spacing;
        var d = 'M' + xa + ' ' + ya + ' H' + (x + r) + ' Q' + x + ' ' + ya + ' ' + x + ' ' + (ya + r) +
                ' V' + (yb - r) + ' Q' + x + ' ' + yb + ' ' + (x + r) + ' ' + yb + ' H' + (xb - 2);
        var at = {d: d, 'class': 'tl-thread', stroke: e.t.color, 'data-thread': e.t.key, 'data-a': e.a, 'data-b': e.b, 'marker-end': 'url(#tl-a-' + e.t.key + ')'};
        if (e.tentative) at['stroke-dasharray'] = '4 3';
        svgEl('path', at, LS);
        svgEl('circle', {cx: xa, cy: ya, r: narrow ? 2.5 : 3.2, fill: e.t.color, 'class': 'tl-thread', 'data-thread': e.t.key, 'data-a': e.a, 'data-b': e.b}, LS);
      });
    }
    if (L) {
      L.querySelectorAll('.tl-row').forEach(function (row) {
        row.querySelector('.tl-box').addEventListener('click', function (ev) {
          if (ev.target.closest('a')) return;
          var id = row.dataset.id;
          state = (state && state.type === 'project' && state.key === id) ? null : {type: 'project', key: id};
          apply();
        });
      });
    }

    // ---------- state ----------
    function apply() {
      chips.forEach(function (c) {
        c.classList.toggle('is-on', state ? (state.type === 'thread' && c.dataset.thread === state.key) : c.dataset.thread === 'all');
      });
      var involved = {};
      if (state) {
        edgesFor(selected).forEach(function (e) { involved[e.a] = 1; involved[e.b] = 1; });
        if (state.type === 'project') involved[state.key] = 1;
      }
      if (G) {
        G.classList.toggle('is-dim', !!state);
        Object.keys(boxEls).forEach(function (id) { boxEls[id].classList.toggle('is-hi', !!involved[id]); });
        drawGanttThreads();
      }
      if (L && LS) {
        LS.querySelectorAll('.tl-thread').forEach(function (e) {
          var hit = !!state && (state.type === 'thread' ? e.getAttribute('data-thread') === state.key
            : (e.getAttribute('data-a') === state.key || e.getAttribute('data-b') === state.key));
          e.classList.toggle('is-hi', hit);
        });
        L.classList.toggle('is-dim', !!state);
        L.querySelectorAll('.tl-row').forEach(function (row) { row.classList.toggle('is-hi', !!involved[row.dataset.id]); });
      }
      if (desc) {
        if (state && state.type === 'thread') {
          var t = threads.filter(function (x) { return x.key === state.key; })[0];
          desc.textContent = t ? t.label + ' — ' + t.desc : '';
        } else if (state) {
          var p = byId[state.key];
          desc.textContent = (p ? p.title + ': ' : '') +
            (Object.keys(involved).length > 1 ? 'threads into and out of this project are highlighted.' : 'no motivation thread starts or ends here.');
        } else {
          desc.innerHTML = descDefault;
        }
      }
    }
    chips.forEach(function (c) {
      c.addEventListener('click', function () {
        var k = c.dataset.thread;
        state = (k === 'all' || (state && state.type === 'thread' && state.key === k)) ? null : {type: 'thread', key: k};
        closePop();
        apply();
      });
    });
    document.addEventListener('click', function (ev) {
      if (!openPop) return;
      if (ev.target.closest('.popover') || ev.target.closest('.tlg-box')) return;
      closePop();
    });

    // ---------- view toggle ----------
    root.querySelectorAll('.tl-viewtoggle .btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        root.setAttribute('data-view', btn.dataset.view);
        root.querySelectorAll('.tl-viewtoggle .btn').forEach(function (x) { x.classList.toggle('active', x === btn); });
        closePop();
        schedule();
      });
    });

    var raf = null, lastW = -1;
    function redraw() { layoutGantt(); drawList(); apply(); }
    function schedule() { if (raf) cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); }
    window.addEventListener('resize', function () { if (window.innerWidth !== lastW) { lastW = window.innerWidth; schedule(); } });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(schedule);
    window.addEventListener('load', schedule);
    redraw();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
