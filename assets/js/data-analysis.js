/* ACME study: automatic statistical analysis for data.html (experimenter only).
   Uses data-stats.js. Reads the sessions that data-view.js built; it never writes to the event database.
   An imported questionnaire CSV (for example a Qualtrics export) is kept in this browser's localStorage only.
   Sample data get a made-up questionnaire so the page can be previewed; it is never stored. */
(function () {
  'use strict';
  var S = window.ACMEStats;
  if (!S) return;

  var LS_KEY = 'acme-outcomes';
  var host = null;
  var st = { metric: '', group: 'cond', doneOnly: true, outcomes: null, sampleOut: null, last: null };

  var METRICS = [
    { key: 'submitRate', label: 'Orders submitted in time', unit: '%', dec: 1, timed: true },
    { key: 'onpage', label: 'Mean seconds on an order page', unit: 's', dec: 1, timed: true },
    { key: 'submit', label: 'Mean seconds to submit an order', unit: 's', dec: 1, timed: true },
    { key: 'dur', label: 'Session duration', unit: 'min', dec: 1 },
    { key: 'clicks', label: 'Clicks in the session', unit: '', dec: 0 },
    { key: 'vwatch', label: 'SPI videos watched to the end', unit: '%', dec: 0 },
    // from data-task.js (most need logger version 2: older sessions have no value and are left out).
    // check: true = a data-quality or manipulation check: it goes in the dataset and the codebook, not in the family of tests.
    { key: 'gap', label: 'Mean distance of the order cost from the budget', unit: '€', dec: 1, timed: true },
    { key: 'words', label: 'Mean words in the reply to a ticket', unit: '', dec: 1 },
    { key: 'gscore', label: 'Mean score per game trial', unit: '', dec: 0 },
    { key: 'missed', label: 'Orders not sent in time', unit: '', dec: 1, timed: true, check: true },
    { key: 'hidden', label: 'Seconds with the tab hidden', unit: 's', dec: 1, check: true },
    { key: 'vplayed', label: 'Mean seconds of SPI video played', unit: 's', dec: 1, check: true }
  ];

  function groupings() {
    var C = host.COND;
    return {
      cond: {
        label: 'Every condition',
        fn: function (s) { return C[s.cond] ? s.cond : null; },
        keys: Object.keys(C), name: function (k) { return C[k].label; }, short: function (k) { return C[k].short; }
      },
      spi: {
        label: 'SPI (colleagues + customers) against no SPI',
        fn: function (s) { return s.cond === 'obj_cond' ? 'no' : (s.cond === 'obj_spi_colleghi' || s.cond === 'obj_spi_clienti') ? 'spi' : null; },
        keys: ['no', 'spi'], name: function (k) { return k === 'no' ? 'Objectifying, no SPI' : 'Objectifying + SPI'; },
        short: function (k) { return k === 'no' ? 'No SPI' : 'SPI'; }
      },
      source: {
        label: 'SPI from colleagues against customers',
        fn: function (s) { return s.cond === 'obj_spi_colleghi' ? 'col' : s.cond === 'obj_spi_clienti' ? 'cus' : null; },
        keys: ['col', 'cus'], name: function (k) { return k === 'col' ? 'Obj + SPI colleagues' : 'Obj + SPI customers'; },
        short: function (k) { return k === 'col' ? 'Colleagues' : 'Customers'; }
      }
    };
  }

  /* ---------- small formatting helpers ---------- */

  function fnum(x, d) { return isFinite(x) ? x.toFixed(d == null ? 2 : d) : '-'; }
  function fp(p) { return !isFinite(p) ? 'p = -' : p < 0.001 ? 'p < .001' : 'p = ' + p.toFixed(3).replace(/^0/, ''); }
  function pcell(p) { return !isFinite(p) ? '-' : p < 0.001 ? '< .001' : p.toFixed(3).replace(/^0/, ''); }
  function esc(s) { return host.esc(s); }

  /* ---------- per-session measures ---------- */

  function metricsOf(s) {
    if (s._m) return s._m;
    var ev = s.events, m = { dur: s.dur / 60000, clicks: 0 };
    ev.forEach(function (e) { if (e.type === 'click') m.clicks++; });
    if (host.TIMED.indexOf(s.cond) !== -1) {
      var on = [], sub = [], viewed = 0;
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i];
        if (e.type !== 'page_view' || !host.isTimedOrder(e.page)) continue;
        var n = host.stepOf(e.page);
        if (!n || n > 33) continue;
        var ms = null, sent = null;
        for (var j = i + 1; j < ev.length; j++) {
          var f = ev[j];
          if (f.type === 'click' && f.page === e.page && f.d && f.d.id === 'evadi' && sent == null) sent = f.t - e.t;
          if (f.type === 'page_leave' && f.page === e.page) { ms = f.d && f.d.ms != null ? f.d.ms : f.t - e.t; break; }
          if (f.type === 'page_view') { ms = f.t - e.t; break; }
        }
        if (ms == null) continue;          // the page where the session stopped is left out
        viewed++;
        if (ms > 0) on.push(ms / 1000);
        if (sent != null && sent > 0) sub.push(sent / 1000);
      }
      if (viewed) m.submitRate = sub.length / viewed * 100;
      if (on.length) m.onpage = S.mean(on);
      if (sub.length) m.submit = S.mean(sub);
    }
    if (s.videos > 0) m.vwatch = s.videosDone / s.videos * 100;
    if (window.ACME_TASK) { var tm = window.ACME_TASK.metrics(s); Object.keys(tm).forEach(function (k) { m[k] = tm[k]; }); }
    s._m = m;
    return m;
  }

  /* ---------- questionnaire (outcome) columns ---------- */

  var META_COLS = /^(startdate|enddate|status|ipaddress|progress|duration.*|finished|recordeddate|responseid|recipient.*|externalreference|location.*|distributionchannel|userlanguage)$/i;
  var ID_GUESS = /^(pid|participant|participant_?id|prolific_?pid|sid|id|code|codice|subject|responseid)$/i;

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var delim = [',', ';', '\t'].map(function (d) { return [d, first.split(d).length]; }).sort(function (a, b) { return b[1] - a[1]; })[0][0];
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim() !== ''; }); });
  }

  function outcomeColumns() {
    if (window.ACME_STUDY) return window.ACME_STUDY.analysisColumns();   // scale scores and questionnaire columns, built by data-study.js
    if (host.isSample()) return sampleOutcomes();
    var o = st.outcomes;
    if (!o || !o.idCol && o.idCol !== 0) return [];
    var cols = [], idx = o.headers.indexOf(o.idCol);
    if (idx < 0) return [];
    o.headers.forEach(function (h, c) {
      if (c === idx || !h || META_COLS.test(h.trim())) return;
      var vals = {}, num = 0, filled = 0;
      o.rows.forEach(function (r) {
        var raw = (r[c] || '').trim();
        if (raw === '') return;
        filled++;
        var v = Number(raw.replace(',', '.'));
        if (isFinite(v)) { num++; var id = (r[idx] || '').trim().toLowerCase(); if (id) vals[id] = v; }
      });
      if (filled >= 5 && num / filled >= 0.6) cols.push({ key: 'q:' + h, label: 'Questionnaire: ' + h, unit: '', dec: 2, vals: vals });
    });
    return cols;
  }

  function sampleOutcomes() {
    if (!st.sampleOut) st.sampleOut = {};
    var shift = { obj_cond: 0, obj_spi_colleghi: -0.6, obj_spi_clienti: -0.5, obj_spi_test_cond: -0.3, not_obj_cond: -1.0, control: -1.2 };
    var defs = [['Self-objectification (sample, 1-7)', 4.4, 1.0], ['Mood after the task (sample, 1-7)', 4.0, 1.1]];
    return defs.map(function (d, i) {
      var vals = {};
      host.sessions().forEach(function (s) {
        var h = 0, str = s.sid + i;
        for (var k = 0; k < str.length; k++) h = (h * 31 + str.charCodeAt(k)) >>> 0;
        var u1 = ((h % 9973) + 1) / 9974, u2 = (((h >>> 7) % 9967) + 1) / 9968;
        var z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        var sign = i === 0 ? 1 : -1;
        var v = d[1] + sign * (shift[s.cond] || 0) * (i === 0 ? 1 : 0.7) + d[2] * z;
        vals[s.sid.toLowerCase()] = Math.round(Math.max(1, Math.min(7, v)) * 10) / 10;
      });
      return { key: 'q:' + d[0], label: 'Questionnaire: ' + d[0], unit: '', dec: 2, vals: vals };
    });
  }

  function saveOutcomes() {
    try {
      if (st.outcomes) localStorage.setItem(LS_KEY, JSON.stringify(st.outcomes));
      else localStorage.removeItem(LS_KEY);
      return true;
    } catch (e) { return false; }
  }

  function loadOutcomes() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) { var o = JSON.parse(raw); if (o && o.headers && o.rows) st.outcomes = o; }
    } catch (e) {}
  }

  /* ---------- groups and results ---------- */

  function allMetrics() {
    return METRICS.filter(function (m) { return !m.check; }).concat(outcomeColumns());
  }

  function valueOf(metric, s) {
    if (metric.vals) { var v = metric.vals[s.sid.toLowerCase()]; return v == null ? null : v; }
    var x = metricsOf(s)[metric.key];
    return x == null || !isFinite(x) ? null : x;
  }

  function buildGroups(metric) {
    var G = groupings()[st.group], by = {};
    host.sessions().forEach(function (s) {
      if (st.doneOnly && !s.finished) return;
      if (window.ACME_STUDY && window.ACME_STUDY.isExcluded(s)) return;   // exclusion rules of the Questionnaire study section
      var k = G.fn(s);
      if (k == null) return;
      var v = valueOf(metric, s);
      if (v == null) return;
      (by[k] = by[k] || []).push(v);
    });
    return G.keys.filter(function (k) { return by[k]; }).map(function (k) { return { key: k, label: G.name(k), short: G.short(k), values: by[k] }; });
  }

  function omnibus(res) {
    if (res.error) return null;
    if (res.kind === 'two') {
      var w = res.welch;
      return { test: "Welch's t", stat: 't(' + fnum(w.df, 1) + ') = ' + fnum(w.t, 2), p: w.p, eff: 'g = ' + fnum(w.g, 2), effWord: S.effectWord(w.g, 'g'), effVal: w.g };
    }
    var wa = res.welchAnova, a = res.anova;
    if (wa) return { test: "Welch's ANOVA", stat: 'F(' + wa.df1 + ', ' + fnum(wa.df2, 1) + ') = ' + fnum(wa.F, 2), p: wa.p, eff: 'ω² = ' + fnum(a.omega2, 2), effWord: S.effectWord(a.omega2, 'eta'), effVal: a.omega2 };
    return { test: 'ANOVA', stat: 'F(' + a.df1 + ', ' + a.df2 + ') = ' + fnum(a.F, 2), p: a.p, eff: 'ω² = ' + fnum(a.omega2, 2), effWord: S.effectWord(a.omega2, 'eta'), effVal: a.omega2 };
  }

  function analyseAll() {
    var rows = allMetrics().map(function (m) {
      var groups = buildGroups(m), res = S.compare(groups);
      var o = omnibus(res);
      return { m: m, groups: groups, res: res, o: o };
    });
    var valid = rows.filter(function (r) { return r.o && isFinite(r.o.p); });
    var adj = S.holm(valid.map(function (r) { return r.o.p; }));
    valid.forEach(function (r, i) { r.pHolm = adj[i]; });
    return rows;
  }

  /* ---------- rendering ---------- */

  function groupCounts(groups) {
    return groups.map(function (g) { return esc(g.short) + ' ' + g.values.length; }).join(', ');
  }

  function renderSummary(rows) {
    var html = '<table class="dv-table dv-an-table"><thead><tr><th scope="col" class="dv-th-plain">Measure</th><th scope="col" class="dv-th-plain">Groups (n)</th>' +
      '<th scope="col" class="dv-th-plain">Test</th><th scope="col" class="dv-th-plain">Result</th><th scope="col" class="dv-th-plain">p</th>' +
      '<th scope="col" class="dv-th-plain">p Holm</th><th scope="col" class="dv-th-plain">Effect</th><th scope="col" class="dv-th-plain">Reading</th></tr></thead><tbody>';
    rows.forEach(function (r) {
      var sel = r.m.key === st.metric ? ' is-open' : '';
      if (!r.o) {
        html += '<tr data-metric="' + esc(r.m.key) + '" tabindex="0" class="dv-an-off' + sel + '"><td>' + esc(r.m.label) + '</td><td>' + (r.groups.length ? groupCounts(r.groups) : '-') +
          '</td><td colspan="5"><span class="dv-dim">' + esc(r.res.error || 'Not enough data') + '</span></td></tr>';
        return;
      }
      var sig = r.pHolm < 0.05, near = !sig && r.o.p < 0.05;
      html += '<tr data-metric="' + esc(r.m.key) + '" tabindex="0" class="' + sel.trim() + '"><td>' + esc(r.m.label) + '</td><td>' + groupCounts(r.groups) + '</td><td>' + esc(r.o.test) +
        '</td><td class="dv-num">' + esc(r.o.stat) + '</td><td class="dv-num">' + pcell(r.o.p) + '</td><td class="dv-num">' + pcell(r.pHolm) + '</td><td class="dv-num">' + esc(r.o.eff) + ' <small>' + esc(r.o.effWord) + '</small></td>' +
        '<td><span class="dv-an-badge ' + (sig ? 'is-sig' : near ? 'is-near' : '') + '">' + (sig ? 'Difference' : near ? 'Only before correction' : 'No clear difference') + '</span></td></tr>';
    });
    $('dv-an-summary').innerHTML = '<div class="dv-table-wrap">' + html + '</tbody></table></div>';
  }

  function $(id) { return document.getElementById(id); }

  function ciPlot(res) {
    var d = res.desc, lo = Infinity, hi = -Infinity;
    d.forEach(function (x) { lo = Math.min(lo, isFinite(x.ciLo) ? x.ciLo : x.mean); hi = Math.max(hi, isFinite(x.ciHi) ? x.ciHi : x.mean); });
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var W = 620, L = 150, R = 18, rowH = 30, T = 8, H = T + d.length * rowH + 26;
    var x = function (v) { return L + (v - lo) / (hi - lo) * (W - L - R); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Group means with 95% confidence intervals">';
    for (var k = 0; k <= 4; k++) {
      var v = lo + (hi - lo) * k / 4;
      svg += '<line class="dv-grid" x1="' + x(v) + '" x2="' + x(v) + '" y1="' + T + '" y2="' + (H - 22) + '"/><text class="dv-axis" x="' + x(v) + '" y="' + (H - 6) + '" text-anchor="middle">' + fnum(v, Math.abs(hi - lo) < 5 ? 2 : 1) + '</text>';
    }
    d.forEach(function (g, i) {
      var y = T + i * rowH + rowH / 2;
      svg += '<text class="dv-axis dv-an-lab" x="' + (L - 10) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(res.groups[i].short) + '</text>' +
        '<line class="dv-an-ci" x1="' + x(isFinite(g.ciLo) ? g.ciLo : g.mean) + '" x2="' + x(isFinite(g.ciHi) ? g.ciHi : g.mean) + '" y1="' + y + '" y2="' + y + '"/>' +
        '<rect class="dv-an-pt" x="' + (x(g.mean) - 4.5) + '" y="' + (y - 4.5) + '" width="9" height="9"/>';
    });
    return svg + '</svg>';
  }

  function reading(r) {
    var res = r.res, o = r.o, out = [], notes = [];
    var minN = Math.min.apply(null, res.groups.map(function (g) { return g.values.length; }));
    if (res.kind === 'two') {
      var a = res.groups[0].label, b = res.groups[1].label, w = res.welch;
      if (o.p < 0.05) out.push((w.diff > 0 ? a + ' is higher than ' : a + ' is lower than ') + b + ' (' + fp(o.p) + ', ' + o.effWord + ' effect, mean difference ' + fnum(w.diff, 2) + ').');
      else out.push('No clear difference between ' + a + ' and ' + b + ' (' + fp(o.p) + ').');
    } else {
      var sigPairs = res.pairs.filter(function (q) { return q.welchHolm < 0.05; });
      if (o.p < 0.05) {
        out.push('The groups differ overall (' + fp(o.p) + ', ' + o.effWord + ' effect).');
        if (sigPairs.length) out.push('Pairs that stay different after the Holm correction: ' + sigPairs.map(function (q) { return res.groups[q.i].short + ' and ' + res.groups[q.j].short; }).join('; ') + '.');
        else out.push('No single pair stays different after the Holm correction: the test says something differs but cannot say where.');
      } else out.push('No clear difference between the groups (' + fp(o.p) + ').');
    }
    if (o.p >= 0.05) notes.push('With ' + minN + ' in the smallest group, this test only detects effects of about g = ' + fnum(3.96 / Math.sqrt(minN), 2) + ' or larger. No difference here does not mean no effect.');
    if (minN < 10) notes.push('Some groups have fewer than 10 values. Read p-values as a first look, not as a result.');
    if (res.levene && res.levene.p < 0.05) notes.push('The spread differs between groups (Brown-Forsythe ' + fp(res.levene.p) + '). The Welch and rank tests are the safe ones here, not the classic ANOVA.');
    if (res.kind === 'many' && !res.welchAnova) notes.push('One group has no spread at all (all values equal), so Welch\'s ANOVA is not defined and the classic ANOVA is shown.');
    notes.push('For a medium effect (g = 0.5) you need about ' + S.nPerGroup(0.5) + ' per group (two groups, 80% power, alpha .05).');
    return { out: out, notes: notes };
  }

  function descTable(res, m) {
    var dec = m.dec == null ? 2 : m.dec, show = Math.max(dec, 1);
    var h = '<table class="dv-table dv-an-table"><thead><tr><th class="dv-th-plain" scope="col">Group</th><th class="dv-th-plain" scope="col">n</th><th class="dv-th-plain" scope="col">Mean</th>' +
      '<th class="dv-th-plain" scope="col">SD</th><th class="dv-th-plain" scope="col">95% CI of the mean</th><th class="dv-th-plain" scope="col">Median</th><th class="dv-th-plain" scope="col">Min to max</th></tr></thead><tbody>';
    res.desc.forEach(function (d, i) {
      h += '<tr><td>' + esc(res.groups[i].label) + '</td><td class="dv-num">' + d.n + '</td><td class="dv-num">' + fnum(d.mean, show) + '</td><td class="dv-num">' + fnum(d.sd, show) +
        '</td><td class="dv-num">' + fnum(d.ciLo, show) + ' to ' + fnum(d.ciHi, show) + '</td><td class="dv-num">' + fnum(d.median, show) + '</td><td class="dv-num">' + fnum(d.min, show) + ' to ' + fnum(d.max, show) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function testLines(res) {
    var l = [];
    if (res.kind === 'two') {
      var w = res.welch, u = res.mw;
      l.push("Welch's t test: t(" + fnum(w.df, 1) + ') = ' + fnum(w.t, 2) + ', ' + fp(w.p) + ', Hedges g = ' + fnum(w.g, 2) + ', mean difference ' + fnum(w.diff, 2) + ' (95% CI ' + fnum(w.ciLo, 2) + ' to ' + fnum(w.ciHi, 2) + ').');
      l.push('Mann-Whitney U (rank test, no normality needed): U = ' + fnum(u.u1, 1) + ', ' + fp(u.p) + ', rank-biserial r = ' + fnum(u.r, 2) + '.');
    } else {
      var a = res.anova, k = res.kruskal;
      if (res.welchAnova) l.push("Welch's ANOVA: F(" + res.welchAnova.df1 + ', ' + fnum(res.welchAnova.df2, 1) + ') = ' + fnum(res.welchAnova.F, 2) + ', ' + fp(res.welchAnova.p) + '.');
      l.push('Classic ANOVA: F(' + a.df1 + ', ' + a.df2 + ') = ' + fnum(a.F, 2) + ', ' + fp(a.p) + ', eta squared = ' + fnum(a.eta2, 3) + ', omega squared = ' + fnum(a.omega2, 3) + '.');
      l.push('Kruskal-Wallis (rank test): H(' + k.df + ') = ' + fnum(k.H, 2) + ', ' + fp(k.p) + ', epsilon squared = ' + fnum(k.eps2, 3) + '.');
    }
    if (res.levene) l.push('Equal spread (Brown-Forsythe): F(' + res.levene.df1 + ', ' + res.levene.df2 + ') = ' + fnum(res.levene.F, 2) + ', ' + fp(res.levene.p) + '.');
    return l;
  }

  function pairTable(res) {
    var h = '<table class="dv-table dv-an-table"><thead><tr><th class="dv-th-plain" scope="col">Pair</th><th class="dv-th-plain" scope="col">Difference</th><th class="dv-th-plain" scope="col">Welch t</th>' +
      '<th class="dv-th-plain" scope="col">p</th><th class="dv-th-plain" scope="col">p Holm</th><th class="dv-th-plain" scope="col">g</th><th class="dv-th-plain" scope="col">Mann-Whitney p Holm</th></tr></thead><tbody>';
    res.pairs.forEach(function (q) {
      var w = q.welch;
      h += '<tr><td>' + esc(res.groups[q.i].short) + ' vs ' + esc(res.groups[q.j].short) + '</td><td class="dv-num">' + fnum(w.diff, 2) + '</td><td class="dv-num">' + fnum(w.t, 2) + ' (df ' + fnum(w.df, 1) +
        ')</td><td class="dv-num">' + pcell(w.p) + '</td><td class="dv-num">' + pcell(q.welchHolm) + '</td><td class="dv-num">' + fnum(w.g, 2) + '</td><td class="dv-num">' + pcell(q.mwHolm) + '</td></tr>';
    });
    return h + '</tbody></table>';
  }

  function completionBlock() {
    var G = groupings()[st.group], by = {};
    host.sessions().forEach(function (s) {
      var k = G.fn(s);
      if (k == null) return;
      by[k] = by[k] || { yes: 0, n: 0 };
      by[k].n++; if (s.finished) by[k].yes++;
    });
    var gs = G.keys.filter(function (k) { return by[k]; });
    if (!gs.length) return { html: '', text: '' };
    var line = gs.map(function (k) { return G.short(k) + ' ' + by[k].yes + ' of ' + by[k].n + ' (' + Math.round(by[k].yes / by[k].n * 100) + '%)'; }).join(' · ');
    var c = gs.length > 1 ? S.chiSquareRates(gs.map(function (k) { return by[k]; })) : null, extra = '';
    if (c) extra = ' Chi-square test of the completion rates: χ²(' + c.df + ') = ' + fnum(c.chi2, 2) + ', ' + fp(c.p) + ", Cramér's V = " + fnum(c.v, 2) + '.' + (c.lowExpected ? ' Some expected counts are below 5: treat this test as unreliable.' : '');
    else if (gs.length > 1) extra = ' The chi-square test needs both completed and stopped sessions.';
    return { html: esc(line) + '.' + esc(extra), text: line + '.' + extra };
  }

  function renderDetail(rows) {
    var r = rows.filter(function (x) { return x.m.key === st.metric; })[0];
    var box = $('dv-an-detail');
    var comp = completionBlock();
    var html = '';
    if (!r || !r.o) {
      html = '<p class="dv-an-empty">Pick a measure with enough data to see the detail.</p>';
      st.last = { rows: rows, detail: null, completion: comp.text };
    } else {
      var rd = reading(r), lines = testLines(r.res);
      html = '<div class="dv-an-dhead"><h3>' + esc(r.m.label) + '</h3><p class="dv-mono-label">' + esc(groupings()[st.group].label) + (st.doneOnly ? ' · completed sessions' : ' · all sessions') + '</p></div>' +
        '<p class="dv-an-read">' + esc(rd.out.join(' ')) + '</p>' +
        '<div class="dv-an-two"><div class="dv-table-wrap">' + descTable(r.res, r.m) + '</div><figure class="dv-an-plot">' + ciPlot(r.res) + '<figcaption>Mean and 95% confidence interval</figcaption></figure></div>' +
        '<ul class="dv-an-tests">' + lines.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>' +
        (r.res.pairs.length ? '<p class="dv-mono-label">Pairwise comparisons, Holm correction</p><div class="dv-table-wrap">' + pairTable(r.res) + '</div>' : '') +
        '<ul class="dv-an-notes">' + rd.notes.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
      st.last = { rows: rows, detail: { r: r, lines: lines, rd: rd }, completion: comp.text };
    }
    if (comp.html) html += '<p class="dv-mono-label">Completion rate</p><p class="dv-an-comp">' + comp.html + '</p>';
    box.innerHTML = html;
  }

  function renderQuestionnaire() {
    var sample = host.isSample(), o = st.outcomes;
    var meta = $('dv-an-q-meta'), idSel = $('dv-an-q-id'), clear = $('dv-an-q-clear');
    if (sample) {
      meta.textContent = 'Sample questionnaire (made up) shown for the preview.';
      idSel.hidden = true; clear.hidden = true;
      return;
    }
    clear.hidden = !o;
    idSel.hidden = !o;
    if (!o) { meta.textContent = 'None. Import a CSV with one row per participant and the participant code in one column.'; return; }
    idSel.innerHTML = '<option value="">ID column...</option>' + o.headers.map(function (h) { return '<option value="' + esc(h) + '"' + (h === o.idCol ? ' selected' : '') + '>' + esc(h) + '</option>'; }).join('');
    var cols = outcomeColumns(), ids = {};
    host.sessions().forEach(function (s) { ids[s.sid.toLowerCase()] = 1; });
    var idx = o.headers.indexOf(o.idCol), matched = 0;
    if (idx >= 0) o.rows.forEach(function (r) { if (ids[(r[idx] || '').trim().toLowerCase()]) matched++; });
    var usable = window.ACME_STUDY && window.ACME_STUDY.state.M && window.ACME_STUDY.state.M.T && window.ACME_STUDY.state.M.T.idx >= 0 ? window.ACME_STUDY.state.M.T.rows.length : o.rows.length;   // Qualtrics header rows and duplicates left out
    meta.textContent = (o.name || 'questionnaire.csv') + ': ' + usable + ' rows, ' + (idx >= 0 ? matched + ' matched to a session code, ' : 'choose the ID column, ') + cols.length + ' numeric columns found.';
  }

  function render() {
    if (!host) return;
    var rows = analyseAll();
    if (!st.metric || !rows.some(function (r) { return r.m.key === st.metric; })) {
      var first = rows.filter(function (r) { return r.o; })[0];
      st.metric = first ? first.m.key : rows[0].m.key;
    }
    renderSummary(rows);
    renderDetail(rows);
    renderQuestionnaire();
  }

  /* ---------- export and report ---------- */

  function reportText() {
    var last = st.last;
    if (!last) return '';
    var out = ['ACME study: automatic analysis', host.isSample() ? 'SAMPLE DATA, NOT REAL DATA' : '', 'Grouping: ' + groupings()[st.group].label + (st.doneOnly ? ', completed sessions only.' : ', all sessions.'), ''];
    last.rows.forEach(function (r) {
      if (!r.o) { out.push(r.m.label + ': not enough data.'); return; }
      out.push(r.m.label + ' (' + r.groups.map(function (g) { return g.short + ' n = ' + g.values.length + ', M = ' + fnum(S.mean(g.values), 2) + ', SD = ' + fnum(S.sd(g.values), 2); }).join('; ') + '): ' +
        r.o.test + ' ' + r.o.stat + ', ' + fp(r.o.p) + ' (Holm over measures ' + fp(r.pHolm) + '), ' + r.o.eff + '.');
    });
    if (last.detail) {
      out.push('', 'Detail: ' + last.detail.r.m.label);
      last.detail.lines.forEach(function (l) { out.push(l); });
      last.detail.rd.out.forEach(function (l) { out.push(l); });
    }
    if (last.completion) out.push('', 'Completion: ' + last.completion);
    out.push('', 'Exploratory analysis. Welch tests, Holm correction, no assumptions of equal variance. Check the design before reporting.');
    return out.join('\r\n');
  }

  function copyReport() {
    var text = reportText();
    function done() { host.toast('Report copied. Paste it into a document.'); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { host.download(host.prefix() + 'analysis-' + host.stamp() + '.txt', text, 'text/plain;charset=utf-8'); });
    else host.download(host.prefix() + 'analysis-' + host.stamp() + '.txt', text, 'text/plain;charset=utf-8');
  }

  function exportDataset() {
    var oc = outcomeColumns(), sessions = host.sessions().slice().sort(function (a, b) { return a.start - b.start; });
    var head = ['sid', 'cond', 'finished', 'duration_min', 'clicks', 'orders_submitted_pct', 'sec_on_order_page', 'sec_to_submit', 'spi_watched_pct'].concat(oc.map(function (c) { return c.label.replace(/^Questionnaire: /, 'q_'); }));
    var rows = sessions.map(function (s) {
      var m = metricsOf(s);
      return [s.sid, s.cond, s.finished ? 1 : 0, m.dur, m.clicks, m.submitRate, m.onpage, m.submit, m.vwatch].concat(oc.map(function (c) { var v = c.vals[s.sid.toLowerCase()]; return v == null ? '' : v; }))
        .map(function (v) { return typeof v === 'number' ? (Math.round(v * 1000) / 1000) : v; }).map(host.csvCell).join(',');
    });
    host.download(host.prefix() + 'dataset-' + host.stamp() + '.csv', '﻿' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  }

  function importQuestionnaire(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var rows = parseCsv(String(reader.result));
      if (rows.length < 2) { host.toast('This file has no data rows.', true); return; }
      var headers = rows[0].map(function (h) { return h.trim(); });
      // the ID column is the one whose values match the most session codes; failing that, a header that looks like an ID
      var codes = {}, guess = '', best = 0;
      host.sessions().forEach(function (s) { codes[s.sid.toLowerCase()] = 1; });
      headers.forEach(function (h, c) {
        var hits = 0;
        rows.slice(1).forEach(function (r) { if (codes[(r[c] || '').trim().toLowerCase()]) hits++; });
        if (hits > best) { best = hits; guess = h; }
      });
      if (!guess) guess = headers.filter(function (h) { return ID_GUESS.test(h) && !/^responseid$/i.test(h); })[0] || headers.filter(function (h) { return ID_GUESS.test(h); })[0] || '';
      st.outcomes = { name: file.name, headers: headers, rows: rows.slice(1), idCol: guess };
      var saved = saveOutcomes();
      host.refresh();
      host.toast(guess ? 'Questionnaire imported. ID column: ' + guess + '.' : 'Questionnaire imported. Choose the column with the participant code.', !guess);
      if (!saved) host.toast('Imported, but the file is too large to keep in this browser. It will be lost when you close the page.', true);
    };
    reader.readAsText(file);
  }

  function init(h) {
    host = h;
    loadOutcomes();
    var sel = $('dv-an-group');
    var G = groupings();
    sel.innerHTML = Object.keys(G).map(function (k) { return '<option value="' + k + '">' + esc(G[k].label) + '</option>'; }).join('');
    sel.addEventListener('change', function () { st.group = this.value; render(); });
    $('dv-an-done').addEventListener('change', function () { st.doneOnly = this.checked; render(); });
    $('dv-an-summary').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-metric]');
      if (tr) { st.metric = tr.getAttribute('data-metric'); render(); }
    });
    $('dv-an-summary').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var tr = ev.target.closest('tr[data-metric]');
      if (tr) { ev.preventDefault(); st.metric = tr.getAttribute('data-metric'); render(); }
    });
    $('dv-an-copy').addEventListener('click', copyReport);
    $('dv-an-dataset').addEventListener('click', exportDataset);
    $('dv-an-q-import').addEventListener('click', function () {
      if (host.isSample()) { host.toast('Switch off sample data to import a real questionnaire.', true); return; }
      $('dv-an-q-file').click();
    });
    $('dv-an-q-file').addEventListener('change', function () { if (this.files && this.files[0]) importQuestionnaire(this.files[0]); this.value = ''; });
    $('dv-an-q-id').addEventListener('change', function () { if (st.outcomes) { st.outcomes.idCol = this.value; saveOutcomes(); render(); } });
    $('dv-an-q-clear').addEventListener('click', function () { st.outcomes = null; saveOutcomes(); render(); host.toast('Questionnaire removed from this browser.'); });
  }

  window.ACME_ANALYSIS = { init: init, render: render, state: st, parseCsv: parseCsv, taskMetrics: function () { return METRICS; }, valueOf: valueOf };
})();
