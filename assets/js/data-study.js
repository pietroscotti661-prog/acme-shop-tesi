/* ACME study: tools for the questionnaire (correlational) study, for data.html (experimenter only).
   Uses data-stats.js and the questionnaire CSV that data-analysis.js keeps in this browser.
   Recruitment counters, data-quality rules and exclusions, scales (alpha and omega), correlation matrix,
   regression with moderation, APA table, Methods/Results draft, codebook, export for R and SPSS, decision log.
   It never writes to the event database. Scale definitions, rules and the log stay in this browser's localStorage
   (real data only). With sample data the page builds a made-up questionnaire in memory so everything can be previewed. */
(function () {
  'use strict';
  var S = window.ACMEStats;
  if (!S) return;

  var LS_PLAN = 'acme-study-plan', LS_LOG = 'acme-study-log';
  var META_COLS = /^(startdate|enddate|status|ipaddress|progress|finished|recordeddate|responseid|recipient.*|externalreference|location.*|distributionchannel|userlanguage)$/i;
  var host = null, A = null;

  var RULES = [
    { key: 'unfinished', label: 'Task not finished', hint: 'The session never reached the end page.', on: true },
    { key: 'nomatch', label: 'No questionnaire matched', hint: 'No row of the imported questionnaire has this session code.', on: true },
    { key: 'speed', label: 'Questionnaire too fast', hint: 'Duration below a share of the median duration.', on: true, param: { key: 'speedPct', label: '% of median', val: 40 } },
    { key: 'straight', label: 'Straight-lining', hint: 'The same answer on every item of a scale (4 items or more), in at least half of the scales.', on: true },
    { key: 'attention', label: 'Attention check failed', hint: 'The answer is not the correct one. Choose the column and the correct answer below.', on: true },
    { key: 'missing', label: 'Too many missing items', hint: 'Share of unanswered scale items above the limit.', on: true, param: { key: 'missingPct', label: 'max % missing', val: 20 } },
    { key: 'progress', label: 'Stopped early', hint: 'Reached less than a share of the orders, tickets or levels.', on: false, param: { key: 'progressPct', label: 'min % reached', val: 50 } },
    { key: 'outlier', label: 'Extreme values', hint: 'Any scale or task measure further than 3.29 SD from the mean (listed, not excluded unless switched on).', on: false },
    { key: 'manual', label: 'Excluded by hand', hint: 'Sessions added to the list below.', on: true }
  ];
  var RULE_LABEL = {};
  RULES.forEach(function (r) { RULE_LABEL[r.key] = r.label; });
  var RULE_IT = { unfinished: 'compito non concluso', nomatch: 'questionario non abbinato', speed: 'questionario compilato troppo in fretta', straight: 'risposte sempre uguali',
    attention: 'controllo di attenzione fallito', missing: 'troppi item mancanti', progress: 'compito interrotto presto', outlier: 'valori estremi', manual: 'esclusione manuale' };
  var COND_IT = { obj_cond: 'Oggettivante', obj_spi_colleghi: 'Oggettivante + SPI colleghi', obj_spi_clienti: 'Oggettivante + SPI clienti', obj_spi_test_cond: 'Oggettivante + SPI (prova)', not_obj_cond: 'Non oggettivante', control: 'Controllo (Arkanoid)' };
  var VAR_IT = { 'd:spi': 'SPI ricevute (0 no, 1 sì)', 'd:src': 'Fonte delle SPI (0 colleghi, 1 clienti)', 'd:obj': 'Compito oggettivante (1) o non oggettivante (0)', 't:submitRate': 'Ordini inviati in tempo (%)',
    't:onpage': "Secondi medi su una pagina d'ordine", 't:submit': 'Secondi medi per inviare un ordine', 't:dur': 'Durata della sessione (min)', 't:clicks': 'Click nella sessione', 't:vwatch': 'Video SPI guardati fino alla fine (%)' };

  var TABS = [['recruit', 'Recruitment'], ['quality', 'Data quality'], ['scales', 'Scales'], ['corr', 'Correlations'], ['model', 'Models'], ['report', 'Write-up'], ['book', 'Codebook and export'], ['log', 'Decision log']];

  var st = {
    tab: 'recruit', lang: 'it',
    scope: { cond: '', done: true, excl: true },
    planReal: null, planSample: null,
    log: [], M: null,
    corr: { vars: null, method: 'pearson', adj: 'holm', pick: null },
    model: { dv: '', preds: [], focal: '', mod: '', center: true, last: null },
    openScale: ''
  };

  function $(id) { return document.getElementById(id); }
  function esc(s) { return host.esc(s); }
  function num(x, d) { return isFinite(x) ? x.toFixed(d == null ? 2 : d) : '-'; }
  function fr(r, d) { if (!isFinite(r)) return '-'; var s = Math.abs(r).toFixed(d == null ? 2 : d).replace(/^0/, ''); return (r < 0 && +s !== 0 ? '-' : '') + s; }   // APA: no leading zero
  function fpv(p) { return !isFinite(p) ? 'p = -' : p < 0.001 ? 'p < .001' : 'p = ' + p.toFixed(3).replace(/^0/, ''); }
  function pcell(p) { return !isFinite(p) ? '-' : p < 0.001 ? '< .001' : p.toFixed(3).replace(/^0/, ''); }
  function stars(p) { return p < 0.001 ? '***' : p < 0.01 ? '**' : p < 0.05 ? '*' : ''; }
  function T2(it, en) { return st.lang === 'it' ? it : en; }
  function vlab(v) { return st.lang === 'it' && VAR_IT[v.key] ? VAR_IT[v.key] : v.label; }
  function clab(k) { return st.lang === 'it' && COND_IT[k] ? COND_IT[k] : (host.COND[k] ? host.COND[k].label : k); }
  function rlab(k) { return st.lang === 'it' && RULE_IT[k] ? RULE_IT[k] : RULE_LABEL[k]; }
  function plan() { return host.isSample() ? st.planSample : st.planReal; }
  function vname(v) {   // name of a variable in the exported files
    if (v.scale) return 'scale_' + safeName(v.scale.name);
    if (v.group === 'Task behaviour') return 'task_' + v.key.slice(2);
    if (v.group === 'Condition codes') return 'cond_' + v.key.slice(2);
    return safeName(v.key.slice(2));
  }
  function safeName(h) { var s = String(h).replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, ''); return /^[A-Za-z]/.test(s) ? s : 'v_' + s; }

  /* ---------- plan, log (localStorage, real data only) ---------- */

  function defaultPlan() {
    var rules = {};
    RULES.forEach(function (r) { rules[r.key] = { on: r.on }; if (r.param) rules[r.key][r.param.key] = r.param.val; });
    return { scales: [], rules: rules, att: { col: '', ok: '' }, durCol: '', manual: [], targets: {}, scaleFrac: 0.8 };
  }

  function mergePlan(p) {
    var d = defaultPlan();
    if (!p || typeof p !== 'object') return d;
    ['scales', 'att', 'durCol', 'manual', 'targets', 'scaleFrac'].forEach(function (k) { if (p[k] != null) d[k] = p[k]; });
    if (p.rules) Object.keys(d.rules).forEach(function (k) { if (p.rules[k]) Object.keys(p.rules[k]).forEach(function (q) { d.rules[k][q] = p.rules[k][q]; }); });
    return d;
  }

  function samplePlan() {
    var p = defaultPlan();
    p.scales = [
      { id: 'so', name: 'Self-objectification', items: ['SO_1', 'SO_2', 'SO_3', 'SO_4', 'SO_5'], rev: ['SO_4'], min: 1, max: 7 },
      { id: 'mood', name: 'Mood after the task', items: ['MOOD_1', 'MOOD_2', 'MOOD_3'], rev: [], min: 1, max: 7 }
    ];
    p.att = { col: 'ATT', ok: '3' };
    return p;
  }

  function loadStore() {
    try { var raw = localStorage.getItem(LS_PLAN); st.planReal = mergePlan(raw ? JSON.parse(raw) : null); } catch (e) { st.planReal = defaultPlan(); }
    try { var l = localStorage.getItem(LS_LOG); st.log = l ? JSON.parse(l) : []; if (!Array.isArray(st.log)) st.log = []; } catch (e) { st.log = []; }
    st.planSample = samplePlan();
  }

  function savePlan() { if (host.isSample()) return; try { localStorage.setItem(LS_PLAN, JSON.stringify(st.planReal)); } catch (e) {} }
  function saveLog() { try { localStorage.setItem(LS_LOG, JSON.stringify(st.log)); } catch (e) {} }

  function logAdd(kind, text) {
    if (host.isSample()) return;
    st.log.push({ t: Date.now(), kind: kind, text: text });
    saveLog();
  }

  /* ---------- the questionnaire as a table ---------- */

  function hz(str) {   // deterministic standard normal from a string, for the sample questionnaire
    var h = 2166136261;
    for (var k = 0; k < str.length; k++) { h ^= str.charCodeAt(k); h = Math.imul(h, 16777619) >>> 0; }
    var u1 = ((h % 9973) + 1) / 9974, u2 = (((h >>> 7) % 9967) + 1) / 9968;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function hu(str) { var z = hz(str); return S.normCdf(z); }

  function sampleTable() {
    if (st.sampleT && st.sampleT.key === host.sessions().length + '|' + (host.sessions()[0] ? host.sessions()[0].sid : '')) return st.sampleT.t;
    var shift = { obj_cond: 0, obj_spi_colleghi: -0.6, obj_spi_clienti: -0.5, obj_spi_test_cond: -0.3, not_obj_cond: -1.0, control: -1.2 };
    var headers = ['pid', 'Duration (in seconds)', 'age', 'gender', 'SO_1', 'SO_2', 'SO_3', 'SO_4', 'SO_5', 'MOOD_1', 'MOOD_2', 'MOOD_3', 'ATT'];
    var rows = [];
    function clip(v) { return Math.max(1, Math.min(7, Math.round(v))); }
    host.sessions().forEach(function (s) {
      if (!s.finished && hu(s.sid + 'q') < 0.7) return;
      var sid = s.sid, L = 4.3 + (shift[s.cond] || 0) + 0.9 * hz(sid + 'L');
      var Mo = 4.1 - 0.35 * (L - 4.3) + 0.8 * hz(sid + 'M');
      var straight = hu(sid + 'st') < 0.1, speed = hu(sid + 'sp') < 0.06, fail = hu(sid + 'at') > 0.93;
      var so = [1, 2, 3, 4, 5].map(function (i) { var v = clip(L + 0.75 * hz(sid + 'so' + i)); return straight ? 3 : (i === 4 ? 8 - v : v); });
      var mo = [1, 2, 3].map(function (i) { return clip(Mo + 0.75 * hz(sid + 'mo' + i)); });
      var all = so.concat(mo).map(function (v, i) { return hu(sid + 'ms' + i) < 0.025 ? '' : String(v); });
      var g = hu(sid + 'g'), dur = speed ? 90 + 40 * hu(sid + 'd') : Math.max(150, 420 + 130 * hz(sid + 'd'));
      rows.push([sid, String(Math.round(dur)), String(Math.round(20 + 3 * Math.abs(hz(sid + 'a')) + 1)), g < 0.6 ? 'F' : g < 0.96 ? 'M' : 'O'].concat(all, [fail ? String(1 + Math.floor(hu(sid + 'f') * 2)) : '3']));
    });
    var first = rows[0];
    if (first) {
      rows.push(first.slice());                                     // a duplicate row
      rows.push(['P-ZZZ1', '400', '23', 'F', '4', '4', '3', '4', '4', '5', '4', '4', '3']);   // rows that match no session
      rows.push(['P-ZZZ2', '380', '25', 'M', '2', '3', '3', '5', '2', '4', '4', '3', '3']);
    }
    var t = makeTable(headers, rows, 'pid', 'sample-questionnaire.csv');
    st.sampleT = { key: host.sessions().length + '|' + (host.sessions()[0] ? host.sessions()[0].sid : ''), t: t };
    return t;
  }

  function makeTable(headers, rowsIn, idCol, name) {
    var idx = headers.indexOf(idCol);
    var T = { headers: headers, name: name || 'questionnaire.csv', idx: idx, rows: [], byId: {}, dupIds: [], idCol: idCol };
    if (idx < 0) return T;
    rowsIn.forEach(function (r) {
      var id = String(r[idx] == null ? '' : r[idx]).trim();
      if (!id || /^\{.*importid/i.test(id) || id.toLowerCase() === String(headers[idx]).toLowerCase() || id === 'Response ID') return;   // Qualtrics header rows
      var key = id.toLowerCase();
      if (T.byId[key] != null) { T.dupIds.push(id); return; }
      T.byId[key] = T.rows.length;
      T.rows.push(r);
    });
    return T;
  }

  function table() {
    if (host.isSample()) return sampleTable();
    var o = A.state.outcomes;
    if (!o || !o.idCol) return null;
    return makeTable(o.headers, o.rows, o.idCol, o.name);
  }

  /* ---------- building the model of the study ---------- */

  function median(a) { return S.median(a); }

  function scaleRange(sc, colNum) {
    var mn = Infinity, mx = -Infinity;
    sc.items.forEach(function (h) { (colNum[h] || []).forEach(function (v) { if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }); });
    return { min: isFinite(+sc.min) && sc.min !== '' && sc.min != null ? +sc.min : mn, max: isFinite(+sc.max) && sc.max !== '' && sc.max != null ? +sc.max : mx, auto: !(sc.min !== '' && sc.min != null) };
  }

  function build() {
    var P = plan(), T = table(), sessions = host.sessions(), C = host.COND;
    var M = { P: P, T: T, recs: [], cols: [], colNum: {}, text: {}, scaleInfo: {}, flow: [], flagged: {}, excl: {}, hasQ: !!(T && T.idx >= 0), durCol: '' };

    if (M.hasQ) {
      T.headers.forEach(function (h, c) {
        if (c === T.idx || !h || META_COLS.test(String(h).trim())) return;
        var nums = [], filled = 0, numc = 0, mn = Infinity, mx = -Infinity;
        T.rows.forEach(function (r) {
          var raw = (r[c] == null ? '' : String(r[c])).trim(), v = NaN;
          if (raw !== '') { filled++; v = Number(raw.replace(',', '.')); if (isFinite(v)) { numc++; mn = Math.min(mn, v); mx = Math.max(mx, v); } else v = NaN; }
          nums.push(v);
        });
        if (filled >= 3 && numc / filled >= 0.6) { M.cols.push({ h: h, c: c, filled: filled, min: mn, max: mx }); M.colNum[h] = nums; }
        else if (filled >= 1) {
          var lv = {};
          T.rows.forEach(function (r) { var raw = (r[c] == null ? '' : String(r[c])).trim(); if (raw !== '') lv[raw] = (lv[raw] || 0) + 1; });
          M.text[h] = { c: c, filled: filled, levels: lv };
        }
      });
      M.durCol = P.durCol === 'none' ? '' : (P.durCol && M.colNum[P.durCol] ? P.durCol : (function () {
        var f = M.cols.filter(function (x) { return /duration|durata/i.test(x.h) && !/minute|minut/i.test(x.h); })[0];
        return f ? f.h : '';
      })());
    }

    sessions.forEach(function (s) {
      var key = s.sid.toLowerCase(), ri = M.hasQ && T.byId[key] != null ? T.byId[key] : -1;
      M.recs.push({ s: s, key: key, ri: ri, scale: {}, reasons: [], reasonsOff: [], excluded: false, miss: 0 });
    });

    // scale scores
    P.scales.forEach(function (sc) {
      var items = sc.items.filter(function (h) { return M.colNum[h]; }), rg = scaleRange(sc, M.colNum);
      M.scaleInfo[sc.id] = { sc: sc, items: items, min: rg.min, max: rg.max, auto: rg.auto, missingItems: sc.items.length - items.length };
      M.recs.forEach(function (rec) {
        if (rec.ri < 0) return;
        var vals = items.map(function (h) { var v = M.colNum[h][rec.ri]; return !isFinite(v) ? NaN : sc.rev.indexOf(h) >= 0 ? rg.min + rg.max - v : v; });
        var ans = vals.filter(isFinite);
        rec.scale[sc.id] = ans.length && ans.length >= Math.ceil((P.scaleFrac || 0.8) * items.length) ? S.mean(ans) : null;
      });
    });

    // flags
    var scaleItemsAll = [];
    P.scales.forEach(function (sc) { sc.items.forEach(function (h) { if (M.colNum[h] && scaleItemsAll.indexOf(h) < 0) scaleItemsAll.push(h); }); });
    var durMed = NaN;
    if (M.durCol) durMed = median(M.recs.filter(function (r) { return r.ri >= 0; }).map(function (r) { return M.colNum[M.durCol][r.ri]; }).filter(isFinite));
    var okAtt = (P.att.ok || '').split(/[;,|]/).map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean);
    var manual = {};
    P.manual.forEach(function (m) { manual[String(m.sid).toLowerCase()] = m; });
    var outl = {};
    {
      var zv = {};
      M.recs.forEach(function (rec) {
        A.taskMetrics().forEach(function (m) { var v = A.valueOf(m, rec.s); if (v != null) (zv['t' + m.key] = zv['t' + m.key] || []).push([rec.key, v]); });
        P.scales.forEach(function (sc) { var v = rec.scale[sc.id]; if (v != null) (zv['s' + sc.id] = zv['s' + sc.id] || []).push([rec.key, v]); });
      });
      Object.keys(zv).forEach(function (k) {
        var vs = zv[k].map(function (x) { return x[1]; }), m = S.mean(vs), sd = S.sd(vs);
        if (!(sd > 0) || vs.length < 8) return;
        zv[k].forEach(function (x) { if (Math.abs(x[1] - m) / sd > 3.29) outl[x[0]] = 1; });
      });
    }

    M.recs.forEach(function (rec) {
      var s = rec.s, hit = {}, tot = C[s.cond] ? C[s.cond].total : 0;
      if (!s.finished) hit.unfinished = 1;
      if (M.hasQ && rec.ri < 0) hit.nomatch = 1;
      if (rec.ri >= 0) {
        if (M.durCol && isFinite(durMed)) { var d = M.colNum[M.durCol][rec.ri]; if (isFinite(d) && d < (P.rules.speed.speedPct || 40) / 100 * durMed) hit.speed = 1; }
        var elig = 0, strg = 0, miss = 0, tot2 = 0;
        P.scales.forEach(function (sc) {
          var raw = sc.items.filter(function (h) { return M.colNum[h]; }).map(function (h) { return M.colNum[h][rec.ri]; });
          miss += raw.filter(function (v) { return !isFinite(v); }).length; tot2 += raw.length;
          var ans = raw.filter(isFinite);
          if (raw.length >= 4) { elig++; if (ans.length >= 4 && ans.every(function (v) { return v === ans[0]; })) strg++; }
        });
        if (elig && strg >= Math.max(1, Math.ceil(elig / 2))) hit.straight = 1;
        rec.miss = tot2 ? miss / tot2 : 0;
        if (tot2 && rec.miss > (P.rules.missing.missingPct == null ? 20 : P.rules.missing.missingPct) / 100) hit.missing = 1;
        if (P.att.col && okAtt.length) {
          var ci = M.hasQ ? T.headers.indexOf(P.att.col) : -1;
          if (ci >= 0) { var raw2 = String(T.rows[rec.ri][ci] == null ? '' : T.rows[rec.ri][ci]).trim().toLowerCase(); if (okAtt.indexOf(raw2) < 0) hit.attention = 1; }
        }
      }
      if (tot && (P.rules.progress.progressPct || 0) > 0 && s.maxStep / tot < P.rules.progress.progressPct / 100) hit.progress = 1;
      if (outl[rec.key]) hit.outlier = 1;
      if (manual[rec.key]) hit.manual = 1;
      Object.keys(hit).forEach(function (k) { (P.rules[k].on ? rec.reasons : rec.reasonsOff).push(k); M.flagged[k] = (M.flagged[k] || 0) + 1; });
    });

    // exclusion flow, rule by rule
    var left = {};
    M.recs.forEach(function (rec) { left[rec.key] = 1; });
    var condKeys = Object.keys(C);
    M.flow.push({ label: 'All sessions', n: M.recs.length, by: countBy(M.recs, condKeys), out: 0 });
    RULES.forEach(function (R) {
      if (!P.rules[R.key].on) return;
      var drop = M.recs.filter(function (rec) { return left[rec.key] && rec.reasons.indexOf(R.key) >= 0; });
      if (!drop.length) return;
      drop.forEach(function (rec) { delete left[rec.key]; });
      var rest = M.recs.filter(function (rec) { return left[rec.key]; });
      M.flow.push({ key: R.key, label: R.label, n: rest.length, by: countBy(rest, condKeys), out: drop.length });
    });
    M.recs.forEach(function (rec) { rec.excluded = rec.reasons.length > 0; M.excl[rec.s.sid] = rec.excluded; });

    // reliability on the sample that stays after the exclusions
    P.scales.forEach(function (sc) {
      var inf = M.scaleInfo[sc.id], rows = [];
      M.recs.forEach(function (rec) {
        if (rec.ri < 0 || rec.excluded) return;
        var vals = inf.items.map(function (h) { var v = M.colNum[h][rec.ri]; return !isFinite(v) ? NaN : sc.rev.indexOf(h) >= 0 ? inf.min + inf.max - v : v; });
        if (vals.length && vals.every(isFinite)) rows.push(vals);
      });
      inf.rows = rows;
      inf.rel = inf.items.length >= 2 ? S.cronbach(rows) : null;
      inf.omega = inf.items.length >= 3 ? S.omega(rows) : NaN;
    });

    M.vars = buildVars(M);
    return M;
  }

  function countBy(recs, keys) {
    var o = {};
    keys.forEach(function (k) { o[k] = 0; });
    recs.forEach(function (r) { if (o[r.s.cond] != null) o[r.s.cond]++; });
    return o;
  }

  /* ---------- variables ---------- */

  function buildVars(M) {
    var v = [], P = M.P;
    P.scales.filter(function (sc) { return sc.items.length; }).forEach(function (sc) { v.push({ key: 's:' + sc.id, label: sc.name, group: 'Scales', get: function (rec) { var x = rec.scale[sc.id]; return x == null ? null : x; }, scale: sc }); });
    v.push({ key: 'd:spi', label: 'SPI received (0 no, 1 yes)', group: 'Condition codes', get: function (rec) { var c = rec.s.cond; return c === 'obj_cond' ? 0 : (c === 'obj_spi_colleghi' || c === 'obj_spi_clienti') ? 1 : null; } });
    v.push({ key: 'd:src', label: 'SPI source (0 colleagues, 1 customers)', group: 'Condition codes', get: function (rec) { var c = rec.s.cond; return c === 'obj_spi_colleghi' ? 0 : c === 'obj_spi_clienti' ? 1 : null; } });
    v.push({ key: 'd:obj', label: 'Objectifying task (1) or not objectifying (0)', group: 'Condition codes', get: function (rec) { var c = rec.s.cond; return /^obj_/.test(c) ? 1 : c === 'not_obj_cond' ? 0 : null; } });
    A.taskMetrics().forEach(function (m) { v.push({ key: 't:' + m.key, label: m.label, group: 'Task behaviour', get: function (rec) { return A.valueOf(m, rec.s); } }); });
    var inScale = {};
    P.scales.forEach(function (sc) { sc.items.forEach(function (h) { inScale[h] = 1; }); });
    M.cols.forEach(function (c) {
      if (c.h === M.durCol) { v.push({ key: 'q:' + c.h, label: c.h, group: 'Questionnaire columns', get: qget(M, c.h) }); return; }
      v.push({ key: 'q:' + c.h, label: c.h, group: inScale[c.h] ? 'Scale items' : 'Questionnaire columns', get: qget(M, c.h) });
    });
    return v;
  }

  function qget(M, h) { return function (rec) { if (rec.ri < 0) return null; var x = M.colNum[h][rec.ri]; return isFinite(x) ? x : null; }; }
  function varByKey(k) { return (st.M.vars || []).filter(function (v) { return v.key === k; })[0]; }

  function pool() {
    var M = st.M;
    return M.recs.filter(function (r) {
      if (st.scope.done && !r.s.finished) return false;
      if (st.scope.excl && r.excluded) return false;
      if (st.scope.cond && r.s.cond !== st.scope.cond) return false;
      return true;
    });
  }

  function pairData(a, b, recs) {
    var x = [], y = [], ids = [];
    recs.forEach(function (r) { var u = a.get(r), w = b.get(r); if (u != null && w != null) { x.push(u); y.push(w); ids.push(r.s.sid); } });
    return { x: x, y: y, ids: ids };
  }

  /* ---------- hooks for the analysis module ---------- */

  function isExcluded(s) { return !!(st.M && st.scope.excl && st.M.excl[s.sid]); }

  function analysisColumns() {
    var M = st.M;
    if (!M || !M.hasQ) return [];
    var out = [], P = M.P, inScale = {};
    P.scales.forEach(function (sc) {
      sc.items.forEach(function (h) { inScale[h] = 1; });
      if (!sc.items.length) return;
      var vals = {};
      M.recs.forEach(function (r) { var x = r.scale[sc.id]; if (x != null) vals[r.key] = x; });
      out.push({ key: 'q:scale:' + sc.id, label: 'Questionnaire: ' + sc.name + ' (scale mean)', unit: '', dec: 2, vals: vals });
    });
    M.cols.forEach(function (c) {
      if (inScale[c.h] || c.h === M.durCol || c.h === P.att.col || /^(age|et[aà]|anni)$/i.test(c.h)) return;
      var vals = {};
      M.recs.forEach(function (r) { if (r.ri >= 0) { var x = M.colNum[c.h][r.ri]; if (isFinite(x)) vals[r.key] = x; } });
      out.push({ key: 'q:' + c.h, label: 'Questionnaire: ' + c.h, unit: '', dec: 2, vals: vals });
    });
    return out;
  }

  /* ---------- small html helpers ---------- */

  function tbl(head, rows, cls) {
    return '<div class="dv-table-wrap"><table class="dv-table dv-an-table ' + (cls || '') + '"><thead><tr>' + head.map(function (h) { return '<th class="dv-th-plain" scope="col">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function tr(cells, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cells.map(function (c) { return typeof c === 'object' ? '<td class="dv-num">' + c.n + '</td>' : '<td>' + c + '</td>'; }).join('') + '</tr>'; }
  function N(x) { return { n: x }; }
  function hdr(text) { return '<p class="dv-mono-label dv-st-label">' + esc(text) + '</p>'; }
  function note(text) { return '<p class="dv-st-note">' + esc(text) + '</p>'; }
  function btn(act, text, extra) { return '<button type="button" class="dv-btn dv-btn--ghost" data-act="' + act + '"' + (extra || '') + '>' + esc(text) + '</button>'; }
  function opts(list, cur, blank) {
    return (blank != null ? '<option value="">' + esc(blank) + '</option>' : '') + list.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(l) + '</option>'; }).join('');
  }
  function noQ() {
    return '<p class="dv-an-empty">No questionnaire yet. Import its CSV in the Analysis section above (one row per participant, with the participant code in one column). ' +
      'You can also switch on the sample data to see how this section works.</p>';
  }

  /* ---------- tab: recruitment ---------- */

  function tabRecruit() {
    var M = st.M, C = host.COND, P = M.P, rows = [], tot = { s: 0, d: 0, q: 0, v: 0 };
    Object.keys(C).forEach(function (k) {
      var rs = M.recs.filter(function (r) { return r.s.cond === k; });
      if (!rs.length && !(P.targets[k] > 0)) return;
      var d = rs.filter(function (r) { return r.s.finished; }).length, q = rs.filter(function (r) { return r.ri >= 0; }).length;
      var v = rs.filter(function (r) { return r.s.finished && !r.excluded && (!M.hasQ || r.ri >= 0); }).length, tg = +P.targets[k] || 0;
      tot.s += rs.length; tot.d += d; tot.q += q; tot.v += v;
      var pct = tg ? Math.min(100, v / tg * 100) : 0;
      rows.push(tr([esc(C[k].label), N(rs.length), N(d), N(M.hasQ ? q : '-'), N('<strong>' + v + '</strong>'),
        '<input type="number" min="0" step="1" class="dv-st-in dv-st-in--n" data-act="target" data-k="' + k + '" value="' + (tg || '') + '" placeholder="-" aria-label="Target for ' + esc(C[k].label) + '">',
        tg ? '<span class="dv-st-bar" title="' + v + ' of ' + tg + '"><span style="width:' + pct + '%"></span></span> <small>' + (v >= tg ? 'reached' : tg - v + ' to go') + '</small>' : '<span class="dv-dim">no target</span>']));
    });
    var obj = ['obj_cond', 'obj_spi_colleghi', 'obj_spi_clienti'].map(function (k) { return M.recs.filter(function (r) { return r.s.cond === k && r.s.finished && !r.excluded && (!M.hasQ || r.ri >= 0); }).length; });
    var warn = '';
    var mx = Math.max.apply(null, obj), mn = Math.min.apply(null, obj);
    if (mx > 0 && (mn === 0 || mx / mn > 1.5) && mx >= 6) warn = '<p class="dv-st-warn">The three objectifying conditions are not balanced yet (' + obj.join(', ') + '). Assign the next participants to the smallest one.</p>';
    return '<p class="dv-an-intro">Counts of participants per condition. "Valid" means the task was finished, no exclusion rule applies' + (M.hasQ ? ' and a questionnaire row matches the session code' : '') + '. Set a target to see how far each condition is.</p>' +
      tbl(['Condition', 'Sessions', 'Finished', 'With questionnaire', 'Valid', 'Target', 'Progress'], rows.concat([tr(['<strong>Total</strong>', N(tot.s), N(tot.d), N(M.hasQ ? tot.q : '-'), N('<strong>' + tot.v + '</strong>'), '', ''], 'dv-st-total')])) + warn;
  }

  /* ---------- tab: data quality and missing data ---------- */

  function tabQuality() {
    var M = st.M, P = M.P, C = host.COND, h = '';
    if (!M.hasQ) h += noQ();
    var rows = RULES.map(function (R) {
      var cfg = P.rules[R.key], inactive = (R.key === 'nomatch' && !M.hasQ) || (R.key === 'speed' && !M.durCol) || (R.key === 'attention' && !(P.att.col && P.att.ok)) || ((R.key === 'straight' || R.key === 'missing') && !P.scales.length);
      var par = R.param ? '<input type="number" min="0" max="100" class="dv-st-in dv-st-in--n" data-act="rule-param" data-k="' + R.key + '" data-p="' + R.param.key + '" value="' + (cfg[R.param.key] == null ? R.param.val : cfg[R.param.key]) + '" aria-label="' + esc(R.param.label) + '"> <small>' + esc(R.param.label) + '</small>' : '';
      return tr(['<label class="dv-an-check"><input type="checkbox" data-act="rule-on" data-k="' + R.key + '"' + (cfg.on ? ' checked' : '') + '><span>' + esc(R.label) + '</span></label>' + (inactive ? ' <small class="dv-dim">needs setup</small>' : '') + '<span class="dv-st-hint">' + esc(R.hint) + '</span>',
        N(M.flagged[R.key] || 0), par]);
    });
    h += hdr('Rules') + tbl(['Rule (tick to exclude)', 'Flagged', 'Setting'], rows);

    var qcols = M.hasQ ? M.cols.map(function (c) { return c.h; }).concat(Object.keys(M.text)) : [];
    h += '<div class="dv-st-row">' +
      '<label class="dv-st-field"><span>Attention check column</span><select data-act="att-col">' + opts(qcols, P.att.col, 'none') + '</select></label>' +
      '<label class="dv-st-field"><span>Correct answer (several: separate with commas)</span><input type="text" class="dv-st-in" data-act="att-ok" value="' + esc(P.att.ok) + '"></label>' +
      '<label class="dv-st-field"><span>Duration column (seconds)</span><select data-act="dur-col">' + opts(M.cols.map(function (c) { return c.h; }), P.durCol || M.durCol, 'automatic') + '</select></label></div>';

    h += hdr('Exclusion flow') + tbl(['Step', 'Left', 'Removed'].concat(Object.keys(C).map(function (k) { return esc(C[k].short); })), M.flow.map(function (f, i) {
      return tr([esc(i ? 'minus: ' + f.label : f.label), N(f.n), N(i ? '-' + f.out : '')].concat(Object.keys(C).map(function (k) { return N(f.by[k]); })));
    }));

    var flaggedRecs = M.recs.filter(function (r) { return r.reasons.length || r.reasonsOff.length; });
    h += hdr('Flagged sessions (' + flaggedRecs.length + ')');
    if (flaggedRecs.length) {
      h += tbl(['Code', 'Condition', 'Rules that apply', 'Result'], flaggedRecs.slice(0, 60).map(function (r) {
        var chips = r.reasons.map(function (k) { return '<span class="dv-an-badge is-sig">' + esc(RULE_LABEL[k]) + '</span>'; }).concat(r.reasonsOff.map(function (k) { return '<span class="dv-an-badge">' + esc(RULE_LABEL[k]) + ' (off)</span>'; })).join(' ');
        return tr(['<span class="dv-code">' + esc(r.s.sid) + '</span>', esc(C[r.s.cond] ? C[r.s.cond].short : r.s.cond), chips, r.excluded ? 'Excluded' : 'Kept']);
      })) + (flaggedRecs.length > 60 ? note('Only the first 60 are shown.') : '');
    } else h += '<p class="dv-an-empty">No session is flagged.</p>';

    if (M.hasQ) {
      var ids = {};
      M.recs.forEach(function (r) { ids[r.key] = 1; });
      var orphan = M.T.rows.map(function (r) { return String(r[M.T.idx]).trim(); }).filter(function (id) { return !ids[id.toLowerCase()]; });
      h += hdr('Questionnaire rows and sessions');
      h += '<ul class="dv-an-notes"><li>' + M.T.rows.length + ' questionnaire rows are usable; ' + M.recs.filter(function (r) { return r.ri >= 0; }).length + ' match a session.</li>' +
        '<li>' + orphan.length + ' rows have a code that matches no session' + (orphan.length ? ': ' + esc(orphan.slice(0, 12).join(', ')) + (orphan.length > 12 ? ', ...' : '') : '') + '. Check the spelling of the code, or the questionnaire was filled without the task.</li>' +
        '<li>' + M.T.dupIds.length + ' duplicate rows were ignored (the first row of a code is kept)' + (M.T.dupIds.length ? ': ' + esc(M.T.dupIds.slice(0, 12).join(', ')) : '') + '.</li></ul>';
    }

    h += hdr('Excluded by hand') + '<div class="dv-st-row"><label class="dv-st-field"><span>Session code</span><input type="text" class="dv-st-in" id="dv-st-man-sid" placeholder="P-XXXX"></label>' +
      '<label class="dv-st-field dv-st-field--wide"><span>Reason (goes in the log)</span><input type="text" class="dv-st-in" id="dv-st-man-why" placeholder="for example: the participant said they knew the aim"></label>' +
      btn('manual-add', 'Add') + '</div>';
    if (P.manual.length) h += tbl(['Code', 'Reason', ''], P.manual.map(function (m, i) { return tr([esc(m.sid), esc(m.why || ''), '<button type="button" class="dv-btn dv-btn--ghost" data-act="manual-del" data-i="' + i + '">Remove</button>']); }));

    // missing data
    h += hdr('Missing data');
    var vars = M.vars.filter(function (v) { return /^(s:|q:)/.test(v.key); });
    var recsQ = M.recs.filter(function (r) { return r.ri >= 0 && !r.excluded; });
    if (!vars.length || !recsQ.length) h += '<p class="dv-an-empty">Nothing to show until a questionnaire is matched to sessions.</p>';
    else {
      h += tbl(['Variable', 'Valid', 'Missing', '% missing', ''], vars.slice(0, 40).map(function (v) {
        var miss = recsQ.filter(function (r) { return v.get(r) == null; }).length, pc = miss / recsQ.length * 100;
        return tr([esc(v.label), N(recsQ.length - miss), N(miss), N(pc.toFixed(1)), '<span class="dv-st-bar' + (pc > 10 ? ' is-warn' : '') + '"><span style="width:' + Math.min(100, pc * 2) + '%"></span></span>']);
      }));
      var worst = M.recs.filter(function (r) { return r.ri >= 0 && r.miss > 0; }).sort(function (a, b) { return b.miss - a.miss; }).slice(0, 8);
      if (worst.length) h += note('Participants with the most missing scale items: ' + worst.map(function (r) { return r.s.sid + ' (' + Math.round(r.miss * 100) + '%)'; }).join(', ') + '.');
      if (P.scales.length) h += note('A scale score is computed when at least ' + Math.round((P.scaleFrac || 0.8) * 100) + '% of its items are answered (mean of the answered items); otherwise it is missing.');
    }
    return h;
  }

  /* ---------- tab: scales ---------- */

  function suggestScales(M) {
    var groups = {};
    M.cols.forEach(function (c) {
      var m = /^(.*?)[_\s.-]*(\d+)$/.exec(String(c.h));
      if (m && m[1]) (groups[m[1]] = groups[m[1]] || []).push(c.h);
    });
    var used = {};
    M.P.scales.forEach(function (sc) { sc.items.forEach(function (h) { used[h] = 1; }); });
    return Object.keys(groups).filter(function (k) { return groups[k].length >= 3 && groups[k].every(function (h) { return !used[h]; }); })
      .map(function (k) { return { name: k, items: groups[k] }; });
  }

  function tabScales() {
    var M = st.M, P = M.P, h = '';
    if (!M.hasQ) return noQ();
    h += '<p class="dv-an-intro">A scale score is the mean of its items, after reversing the items marked as reversed. Reliability (alpha and omega) uses the participants who stay after the exclusions and answered every item.</p>';
    var sug = suggestScales(M);
    h += '<div class="dv-st-row">' + (sug.length ? '<span class="dv-st-note">Columns that look like scales: ' + sug.map(function (x) { return '<button type="button" class="dv-st-chip" data-act="scale-suggest" data-name="' + esc(x.name) + '">' + esc(x.name) + ' (' + x.items.length + ')</button>'; }).join(' ') + '</span>' : '<span class="dv-st-note">No more groups of numbered columns found.</span>') +
      btn('scale-new', 'New scale') + '</div>';
    P.scales.forEach(function (sc) {
      var inf = M.scaleInfo[sc.id], rel = inf.rel, open = st.openScale === sc.id;
      var verdict = !rel || !isFinite(rel.alpha) ? 'not enough complete cases' : rel.alpha >= 0.8 ? 'good' : rel.alpha >= 0.7 ? 'acceptable' : rel.alpha >= 0.6 ? 'questionable' : 'poor';
      h += '<div class="dv-st-card"><div class="dv-st-card-head"><div><input type="text" class="dv-st-in dv-st-in--title" data-act="scale-name" data-id="' + sc.id + '" value="' + esc(sc.name) + '" aria-label="Scale name"> ' +
        '<span class="dv-an-badge ' + (rel && rel.alpha >= 0.7 ? 'is-sig' : rel && rel.alpha >= 0.6 ? 'is-near' : '') + '">alpha ' + (rel ? num(rel.alpha, 2) : '-') + (isFinite(inf.omega) ? ' · omega ' + num(inf.omega, 2) : '') + ' · ' + esc(verdict) + '</span></div>' +
        '<div>' + btn('scale-edit', open ? 'Close' : 'Edit items', ' data-id="' + sc.id + '"') + ' ' + btn('scale-del', 'Delete', ' data-id="' + sc.id + '"') + '</div></div>';
      h += '<p class="dv-st-note">' + inf.items.length + ' items · ' + (rel ? rel.n : 0) + ' complete cases · range ' + num(inf.min, 0) + ' to ' + num(inf.max, 0) + (inf.auto ? ' (read from the data)' : '') + (rel && isFinite(rel.rbar) ? ' · mean inter-item r = ' + fr(rel.rbar) : '') +
        (inf.missingItems ? ' · <strong>' + inf.missingItems + ' item(s) of this scale are not in the questionnaire</strong>' : '') + '</p>';
      if (rel && rel.items.length) {
        h += tbl(['Item', 'Reversed', 'M', 'SD', 'r with the rest', 'Alpha if deleted', 'Hint'], rel.items.map(function (it, i) {
          var name = inf.items[i], hint = it.rDrop < 0 && sc.rev.indexOf(name) < 0 ? 'Negative: maybe a reversed item' : it.rDrop < 0.3 ? 'Weak link with the rest' : (isFinite(it.alphaDrop) && it.alphaDrop > rel.alpha + 0.02) ? 'Alpha rises without it' : '';
          return tr([esc(name), sc.rev.indexOf(name) >= 0 ? 'yes' : '', N(num(it.mean, 2)), N(num(it.sd, 2)), N(fr(it.rDrop)), N(isFinite(it.alphaDrop) ? fr(it.alphaDrop) : '-'), '<span class="dv-dim">' + esc(hint) + '</span>']);
        }));
      }
      if (open) {
        var used = {};
        P.scales.forEach(function (o) { if (o.id !== sc.id) o.items.forEach(function (x) { used[x] = 1; }); });
        h += '<div class="dv-st-edit"><p class="dv-mono-label">Items (tick the columns that belong to the scale; tick R when reversed)</p><div class="dv-st-items">' +
          M.cols.filter(function (c) { return !used[c.h] && c.h !== M.durCol; }).map(function (c) {
            var on = sc.items.indexOf(c.h) >= 0;
            return '<span class="dv-st-item"><label><input type="checkbox" data-act="scale-item" data-id="' + sc.id + '" data-h="' + esc(c.h) + '"' + (on ? ' checked' : '') + '> ' + esc(c.h) + '</label>' +
              '<label class="dv-st-rev"><input type="checkbox" data-act="scale-rev" data-id="' + sc.id + '" data-h="' + esc(c.h) + '"' + (sc.rev.indexOf(c.h) >= 0 ? ' checked' : '') + (on ? '' : ' disabled') + '> R</label></span>';
          }).join('') + '</div><div class="dv-st-row"><label class="dv-st-field"><span>Lowest answer</span><input type="number" class="dv-st-in dv-st-in--n" data-act="scale-min" data-id="' + sc.id + '" value="' + (sc.min == null ? '' : sc.min) + '" placeholder="auto"></label>' +
          '<label class="dv-st-field"><span>Highest answer</span><input type="number" class="dv-st-in dv-st-in--n" data-act="scale-max" data-id="' + sc.id + '" value="' + (sc.max == null ? '' : sc.max) + '" placeholder="auto"></label></div></div>';
      }
      h += '</div>';
    });
    if (!P.scales.length) h += '<p class="dv-an-empty">No scale yet. Use a suggestion above or "New scale".</p>';
    return h;
  }

  /* ---------- tab: correlations ---------- */

  function corrVars() {
    var M = st.M;
    if (!st.corr.vars) {
      var pri = M.vars.filter(function (v) { return v.group === 'Scales'; }).concat(M.vars.filter(function (v) { return v.key === 'd:spi'; }), M.vars.filter(function (v) { return v.group === 'Task behaviour'; }).slice(0, 4));
      st.corr.vars = pri.slice(0, 9).map(function (v) { return v.key; });
    }
    return st.corr.vars.map(varByKey).filter(Boolean);
  }

  function corrMatrixData(vars, recs) {
    var method = st.corr.method, cells = [], ps = [], k = vars.length;
    for (var i = 0; i < k; i++) { cells.push([]); for (var j = 0; j < k; j++) cells[i].push(null); }
    for (i = 0; i < k; i++) for (j = i + 1; j < k; j++) {
      var d = pairData(vars[i], vars[j], recs), res = method === 'spearman' ? S.spearman(d.x, d.y) : S.pearson(d.x, d.y);
      cells[i][j] = cells[j][i] = res; ps.push(res.p);
    }
    var okIdx = [], list = [];
    for (i = 0; i < k; i++) for (j = i + 1; j < k; j++) if (isFinite(cells[i][j].p)) { okIdx.push([i, j]); list.push(cells[i][j].p); }
    var adj = st.corr.adj === 'holm' ? S.holm(list) : st.corr.adj === 'fdr' ? S.bh(list) : list.slice();
    okIdx.forEach(function (ij, q) { cells[ij[0]][ij[1]].padj = cells[ij[1]][ij[0]].padj = adj[q]; });
    return cells;
  }

  function heat(r) {
    if (!isFinite(r)) return '';
    var a = Math.min(1, Math.abs(r)) * 62;
    return ' style="background:color-mix(in srgb, ' + (r >= 0 ? 'var(--accent)' : 'var(--ochre-line)') + ' ' + a.toFixed(0) + '%, var(--surface))"';
  }

  function varPicker(selected, act, all) {
    var groups = {}, order = [];
    all.forEach(function (v) { if (!groups[v.group]) { groups[v.group] = []; order.push(v.group); } groups[v.group].push(v); });
    return '<details class="dv-st-pick"><summary>Variables (' + selected.length + ' selected)</summary>' + order.map(function (g) {
      return '<div class="dv-st-pickgroup"><p class="dv-mono-label">' + esc(g) + '</p>' + groups[g].map(function (v) {
        return '<label class="dv-an-check"><input type="checkbox" data-act="' + act + '" data-k="' + esc(v.key) + '"' + (selected.indexOf(v.key) >= 0 ? ' checked' : '') + '><span>' + esc(v.label) + '</span></label>';
      }).join('') + '</div>';
    }).join('') + '</details>';
  }

  function scatter(a, b, recs) {
    var d = pairData(a, b, recs);
    if (d.x.length < 3) return '<p class="dv-an-empty">Not enough pairs.</p>';
    var W = 560, H = 330, L = 52, R = 14, T = 12, B = 40;
    var xmin = Math.min.apply(null, d.x), xmax = Math.max.apply(null, d.x), ymin = Math.min.apply(null, d.y), ymax = Math.max.apply(null, d.y);
    if (xmax === xmin) { xmin -= 1; xmax += 1; } if (ymax === ymin) { ymin -= 1; ymax += 1; }
    var px = (xmax - xmin) * 0.06, py = (ymax - ymin) * 0.06; xmin -= px; xmax += px; ymin -= py; ymax += py;
    var X = function (v) { return L + (v - xmin) / (xmax - xmin) * (W - L - R); }, Y = function (v) { return T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Scatter plot of ' + esc(a.label) + ' against ' + esc(b.label) + '">';
    for (var k = 0; k <= 4; k++) {
      var xv = xmin + (xmax - xmin) * k / 4, yv = ymin + (ymax - ymin) * k / 4;
      svg += '<line class="dv-grid" x1="' + X(xv) + '" x2="' + X(xv) + '" y1="' + T + '" y2="' + (H - B) + '"/><text class="dv-axis" x="' + X(xv) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + num(xv, Math.abs(xmax - xmin) < 6 ? 1 : 0) + '</text>' +
        '<line class="dv-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(yv) + '" y2="' + Y(yv) + '"/><text class="dv-axis" x="' + (L - 8) + '" y="' + (Y(yv) + 4) + '" text-anchor="end">' + num(yv, Math.abs(ymax - ymin) < 6 ? 1 : 0) + '</text>';
    }
    d.x.forEach(function (x, i) { svg += '<circle class="dv-st-pt" cx="' + X(x) + '" cy="' + Y(d.y[i]) + '" r="3.6"><title>' + esc(d.ids[i]) + ': ' + num(x, 2) + ', ' + num(d.y[i], 2) + '</title></circle>'; });
    var ln = S.line(d.x, d.y);
    if (isFinite(ln.b)) svg += '<line class="dv-st-fit" x1="' + X(xmin) + '" y1="' + Y(ln.a + ln.b * xmin) + '" x2="' + X(xmax) + '" y2="' + Y(ln.a + ln.b * xmax) + '"/>';
    svg += '<text class="dv-axis" x="' + ((L + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(a.label) + '</text>' +
      '<text class="dv-axis" transform="translate(12 ' + ((T + H - B) / 2) + ') rotate(-90)" text-anchor="middle">' + esc(b.label) + '</text></svg>';
    var pe = S.pearson(d.x, d.y), sp = S.spearman(d.x, d.y);
    return '<figure class="dv-an-plot">' + svg + '<figcaption>n = ' + d.x.length + ' · Pearson r(' + pe.df + ') = ' + fr(pe.r) + ', 95% CI [' + fr(pe.ciLo) + ', ' + fr(pe.ciHi) + '], ' + fpv(pe.p) + ' · Spearman rho = ' + fr(sp.r) + ', ' + fpv(sp.p) + '</figcaption></figure>';
  }

  function powerBlock(n) {
    var rows = [0.1, 0.2, 0.3, 0.4, 0.5].map(function (r) { return tr(['|r| = ' + fr(r), N(S.nForR(r, 0.8)), N(S.nForR(r, 0.9))]); });
    return '<div class="dv-st-two"><div>' + hdr('Sensitivity for this sample') +
      '<p class="dv-an-comp">With n = ' + n + ' complete pairs, a correlation needs |r| of about <strong>' + fr(S.minR(n, 0.8)) + '</strong> to be found with 80% power (<strong>' + fr(S.minR(n, 0.9)) + '</strong> with 90%), two-sided, alpha .05. Smaller correlations can exist and be missed.</p></div>' +
      '<div>' + hdr('Participants needed') + tbl(['True correlation', 'Power 80%', 'Power 90%'], rows) + '</div></div>';
  }

  function tabCorr() {
    var M = st.M;
    if (!M.hasQ && !M.vars.some(function (v) { return v.group === 'Task behaviour'; })) return noQ();
    var vars = corrVars(), recs = pool(), k = vars.length, h = '';
    h += '<div class="dv-st-row">' + varPicker(st.corr.vars, 'corr-var', M.vars) +
      '<label class="dv-select"><span class="dv-visually-hidden">Method</span><select data-act="corr-method">' + opts([['pearson', 'Pearson r'], ['spearman', 'Spearman rho (ranks)']], st.corr.method) + '</select></label>' +
      '<label class="dv-select"><span class="dv-visually-hidden">Correction</span><select data-act="corr-adj">' + opts([['none', 'No correction'], ['holm', 'Holm correction'], ['fdr', 'False discovery rate (BH)']], st.corr.adj) + '</select></label></div>';
    if (k < 2) return h + '<p class="dv-an-empty">Pick at least two variables.</p>';
    var cells = corrMatrixData(vars, recs);
    var head = [''].concat(vars.map(function (v, i) { return '<span class="dv-st-col">' + (i + 1) + '</span>'; }));
    var rows = vars.map(function (a, i) {
      return '<tr><th scope="row" class="dv-st-rowh">' + (i + 1) + '. ' + esc(a.label) + '</th>' + vars.map(function (b, j) {
        if (i === j) return '<td class="dv-st-diag">-</td>';
        var c = cells[i][j], sig = isFinite(c.padj) && c.padj < 0.05;
        if (!isFinite(c.r)) return '<td class="dv-st-na" title="n = ' + c.n + '">n/a</td>';
        var tip = 'n = ' + c.n + ', 95% CI [' + fr(c.ciLo) + ', ' + fr(c.ciHi) + '], p = ' + pcell(c.p) + (st.corr.adj !== 'none' ? ', adjusted p = ' + pcell(c.padj) : '');
        return '<td class="dv-st-cell' + (sig ? ' is-sig' : '') + (st.corr.pick && st.corr.pick[0] === a.key && st.corr.pick[1] === b.key ? ' is-pick' : '') + '"' + heat(c.r) + ' data-act="corr-pick" data-a="' + esc(a.key) + '" data-b="' + esc(b.key) + '" tabindex="0" title="' + esc(tip) + '">' + fr(c.r) + (sig ? '<sup>' + stars(c.padj) + '</sup>' : '') + '</td>';
      }).join('') + '</tr>';
    }).join('');
    h += '<div class="dv-table-wrap"><table class="dv-table dv-st-matrix"><thead><tr>' + head.map(function (x) { return '<th class="dv-th-plain" scope="col">' + x + '</th>'; }).join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    h += note('Stars use ' + (st.corr.adj === 'none' ? 'the p-values as they are' : st.corr.adj === 'holm' ? 'Holm-adjusted p-values' : 'false-discovery-rate adjusted p-values') + ' over all ' + (k * (k - 1) / 2) + ' pairs: * < .05, ** < .01, *** < .001. Pairwise deletion. Sessions in scope: ' + recs.length + '. Click a cell for the scatter plot.');
    if (st.corr.pick) {
      var a = varByKey(st.corr.pick[0]), b = varByKey(st.corr.pick[1]);
      if (a && b) h += hdr(a.label + ' and ' + b.label) + scatter(a, b, recs);
    }
    var ns = [];
    for (var i = 0; i < k; i++) for (var j = i + 1; j < k; j++) if (cells[i][j].n >= 4) ns.push(cells[i][j].n);
    if (ns.length) h += powerBlock(Math.round(median(ns)));
    return h;
  }

  /* ---------- tab: models ---------- */

  function runModel() {
    var m = st.model, M = st.M;
    var dv = varByKey(m.dv), preds = m.preds.map(varByKey).filter(Boolean);
    if (!dv || !preds.length) { m.last = null; return; }
    var recs = pool(), rows = [], y = [], ids = [];
    var focal = m.focal && preds.some(function (p) { return p.key === m.focal; }) ? varByKey(m.focal) : null, mod = m.mod && m.mod !== m.focal && preds.some(function (p) { return p.key === m.mod; }) ? varByKey(m.mod) : null;
    recs.forEach(function (r) {
      var row = preds.map(function (p) { return p.get(r); }), yv = dv.get(r);
      if (yv == null || row.some(function (x) { return x == null; })) return;
      rows.push(row); y.push(yv); ids.push(r.s.sid);
    });
    var names = preds.map(function (p) { return p.label; }), means = preds.map(function (p, j) { return S.mean(rows.map(function (r) { return r[j]; })); }), sds = preds.map(function (p, j) { return S.sd(rows.map(function (r) { return r[j]; })); });
    var X = rows.map(function (r) { return r.map(function (v, j) { return m.center ? v - means[j] : v; }); });
    var fi = focal ? preds.indexOf(focal) : -1, mi = mod ? preds.indexOf(mod) : -1;
    if (fi >= 0 && mi >= 0) { X = X.map(function (r) { return r.concat([r[fi] * r[mi]]); }); names = names.concat([focal.label + ' x ' + mod.label]); }
    var fit = S.ols(X, y);
    if (fit.error) { m.last = { error: fit.error }; return; }
    var vf = preds.length > 1 ? S.vif(X.map(function (r) { return r.slice(0, preds.length); })) : [];
    var sdy = S.sd(y);
    m.last = { fit: fit, names: names, preds: preds, dv: dv, vif: vf, n: y.length, sdy: sdy, sds: sds, means: means, fi: fi, mi: mi, inter: fi >= 0 && mi >= 0, centered: m.center, X: X, y: y };
  }

  function modelPlot(L) {
    var fit = L.fit, k = L.preds.length, bf = fit.coef[1 + L.fi], bm = fit.coef[1 + L.mi], bi = fit.coef[1 + k], b0 = fit.coef[0].b;
    var xs = L.X.map(function (r) { return r[L.fi]; }), ms = L.X.map(function (r) { return r[L.mi]; });
    var sdm = S.sd(ms), mm = S.mean(ms), lo = Math.min.apply(null, xs), hi = Math.max.apply(null, xs);
    var others = 0;   // other predictors held at their mean
    L.preds.forEach(function (p, j) { if (j !== L.fi && j !== L.mi) others += fit.coef[1 + j].b * S.mean(L.X.map(function (r) { return r[j]; })); });
    var uniq = []; ms.forEach(function (x) { var r = Math.round(x * 1e6) / 1e6; if (uniq.indexOf(r) < 0) uniq.push(r); });
    var binary = uniq.length === 2, shiftBack = L.centered ? L.means[L.mi] : 0;
    var spec = binary ? uniq.sort(function (a, b) { return a - b; }).map(function (u) { return [u, 'Moderator = ' + String(+(u + shiftBack).toFixed(2))]; }) : [[mm - sdm, 'Moderator -1 SD'], [mm, 'Moderator at the mean'], [mm + sdm, 'Moderator +1 SD']];
    var levels = spec.map(function (q) {
      var mv = q[0];
      return { name: q[1], mv: mv, slope: bf.b + bi.b * mv, int: b0 + bm.b * mv + others, se: Math.sqrt(fit.cov[1 + L.fi][1 + L.fi] + mv * mv * fit.cov[1 + k][1 + k] + 2 * mv * fit.cov[1 + L.fi][1 + k]) };
    });
    levels.forEach(function (q) { q.t = q.slope / q.se; q.p = S.pT2(q.t, fit.df); });
    var allY = []; levels.forEach(function (q) { allY.push(q.int + q.slope * lo, q.int + q.slope * hi); });
    var ymin = Math.min.apply(null, allY), ymax = Math.max.apply(null, allY), pad = (ymax - ymin) * 0.12 || 1; ymin -= pad; ymax += pad;
    var W = 560, H = 300, Lm = 52, R = 16, T = 12, B = 38;
    var X = function (v) { return Lm + (v - lo) / ((hi - lo) || 1) * (W - Lm - R); }, Y = function (v) { return T + (1 - (v - ymin) / (ymax - ymin)) * (H - T - B); };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Simple slopes">';
    for (var g = 0; g <= 4; g++) { var yv = ymin + (ymax - ymin) * g / 4; svg += '<line class="dv-grid" x1="' + Lm + '" x2="' + (W - R) + '" y1="' + Y(yv) + '" y2="' + Y(yv) + '"/><text class="dv-axis" x="' + (Lm - 8) + '" y="' + (Y(yv) + 4) + '" text-anchor="end">' + num(yv, 1) + '</text>'; }
    var dash = binary ? ['4 4', ''] : ['4 4', '', '1 4'];
    levels.forEach(function (q, i) {
      svg += '<line class="dv-st-slope" ' + (dash[i] ? 'stroke-dasharray="' + dash[i] + '" ' : '') + 'x1="' + X(lo) + '" y1="' + Y(q.int + q.slope * lo) + '" x2="' + X(hi) + '" y2="' + Y(q.int + q.slope * hi) + '"/>' +
        '';
    });
    svg += '<text class="dv-axis" x="' + ((Lm + W - R) / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(L.preds[L.fi].label) + (L.centered ? ' (centered)' : '') + '</text></svg>';
    var rows = levels.map(function (q) { return tr([esc(q.name), N(num(q.slope, 3)), N(num(q.se, 3)), N(num(q.t, 2)), N(pcell(q.p))]); });
    return '<div class="dv-an-two"><figure class="dv-an-plot">' + svg + '<figcaption>Predicted ' + esc(L.dv.label) + ' by ' + esc(L.preds[L.fi].label) + ', at three levels of ' + esc(L.preds[L.mi].label) + '. ' + (binary ? 'Dashed line: ' + esc(levels[0].name.toLowerCase()) + '; solid: ' + esc(levels[1].name.toLowerCase()) + '.' : 'Dashed line: moderator at -1 SD; solid: at the mean; dotted: at +1 SD.') + ' Other predictors held at their mean.</figcaption></figure>' +
      '<div>' + hdr('Simple slopes of ' + L.preds[L.fi].label) + tbl(['Level', 'Slope', 'SE', 't', 'p'], rows) + '</div></div>';
  }

  function tabModel() {
    var M = st.M, m = st.model;
    if (!M.vars.length) return noQ();
    var all = M.vars;
    if (!m.dv) { var s0 = M.vars.filter(function (v) { return v.group === 'Scales'; }); if (s0.length) { m.dv = s0[0].key; m.preds = M.vars.filter(function (v) { return v.key === 'd:spi'; }).map(function (v) { return v.key; }).concat(s0.slice(1, 2).map(function (v) { return v.key; })); } }
    var h = '<p class="dv-an-intro">Ordinary least squares regression on the sessions in scope, listwise deletion. Choose the outcome and the predictors. To test a moderation, choose a focal predictor and a moderator among the predictors: their product is added (the predictors are centered first, so the main effects stay readable).</p>';
    h += '<div class="dv-st-row"><label class="dv-st-field"><span>Outcome</span><select data-act="model-dv">' + opts(all.map(function (v) { return [v.key, v.label]; }), m.dv, 'choose') + '</select></label>' +
      '<div class="dv-st-field"><span>Predictors</span>' + varPicker(m.preds, 'model-pred', all.filter(function (v) { return v.key !== m.dv; })) + '</div></div>';
    var pv = m.preds.map(varByKey).filter(Boolean);
    h += '<div class="dv-st-row"><label class="dv-st-field"><span>Focal predictor (optional)</span><select data-act="model-focal">' + opts(pv.map(function (v) { return [v.key, v.label]; }), m.focal, 'none') + '</select></label>' +
      '<label class="dv-st-field"><span>Moderator (optional)</span><select data-act="model-mod">' + opts(pv.map(function (v) { return [v.key, v.label]; }), m.mod, 'none') + '</select></label>' +
      '<label class="dv-an-check"><input type="checkbox" data-act="model-center"' + (m.center ? ' checked' : '') + '><span>Center the predictors</span></label></div>';
    runModel();
    var L = m.last;
    if (!L) return h + '<p class="dv-an-empty">Choose an outcome and at least one predictor.</p>';
    if (L.error) return h + '<p class="dv-st-warn">' + esc(L.error) + '</p>';
    var f = L.fit, k = L.preds.length;
    var head = ['Predictor', 'B', 'SE', 'Beta', 't', 'p', '95% CI of B'];
    var rows = f.coef.map(function (c, i) {
      var name = i === 0 ? '(Intercept)' : L.names[i - 1], beta = '-';
      if (i >= 1 && i <= k) beta = fr(c.b * L.sds[i - 1] / L.sdy);
      return tr([esc(name), N(num(c.b, 3)), N(num(c.se, 3)), N(beta), N(num(c.t, 2)), N(pcell(c.p)), N('[' + num(c.ciLo, 3) + ', ' + num(c.ciHi, 3) + ']')], c.p < 0.05 && i > 0 ? 'dv-st-sigrow' : '');
    });
    h += hdr('Outcome: ' + L.dv.label) + tbl(head, rows);
    h += '<p class="dv-an-comp">n = ' + L.n + ' · R² = ' + fr(f.r2) + ' · adjusted R² = ' + fr(f.adjR2) + ' · F(' + f.dfm + ', ' + f.df + ') = ' + num(f.F, 2) + ', ' + fpv(f.pF) + (L.inter ? ' · the last row is the interaction.' : '') + '</p>';
    var maxV = L.vif.length ? Math.max.apply(null, L.vif) : 1;
    if (maxV > 5) h += '<p class="dv-st-warn">The predictors overlap a lot (largest VIF ' + num(maxV, 1) + '). Coefficients may be unstable.</p>';
    else if (L.vif.length) h += note('Largest VIF ' + num(maxV, 2) + ': no worrying overlap between predictors.');
    if (L.n < 10 * k) h += '<p class="dv-st-warn">Only ' + L.n + ' complete cases for ' + k + ' predictors. Treat this as a first look.</p>';
    if (L.inter) h += modelPlot(L);
    return h;
  }

  /* ---------- write-up ---------- */

  function sampleFacts() {
    var M = st.M, valid = M.recs.filter(function (r) { return !r.excluded && r.s.finished && (!M.hasQ || r.ri >= 0); });
    var f = { all: M.recs.length, done: M.recs.filter(function (r) { return r.s.finished; }).length, valid: valid.length, flow: M.flow, byCond: {} };
    valid.forEach(function (r) { f.byCond[r.s.cond] = (f.byCond[r.s.cond] || 0) + 1; });
    var ageCol = M.cols.filter(function (c) { return /^(age|et[aà]|anni)$/i.test(c.h); })[0];
    if (ageCol) { var a = valid.map(function (r) { return r.ri >= 0 ? M.colNum[ageCol.h][r.ri] : NaN; }).filter(isFinite); if (a.length > 2) f.age = { m: S.mean(a), sd: S.sd(a), min: Math.min.apply(null, a), max: Math.max.apply(null, a), n: a.length }; }
    var gKey = Object.keys(M.text).filter(function (h) { return /^(gender|genere|sesso|sex)$/i.test(h); })[0];
    if (gKey) { var c = {}; valid.forEach(function (r) { if (r.ri >= 0) { var v = String(M.T.rows[r.ri][M.text[gKey].c] || '').trim(); if (v) c[v] = (c[v] || 0) + 1; } }); f.gender = c; }
    return f;
  }

  function methodsText() {
    var M = st.M, f = sampleFacts(), C = host.COND, P = M.P, out = [];
    var steps = f.flow.slice(1).map(function (s) { return s.out + ' ' + T2('per ', 'for ') + (st.lang === 'it' ? RULE_IT[s.key] : s.label.toLowerCase()); });
    out.push(T2('Partecipanti. ', 'Participants. ') + T2('Sono state registrate ', 'We recorded ') + f.all + T2(' sessioni, di cui ', ' sessions, of which ') + f.done + T2(' concluse. ', ' were completed. ') +
      (steps.length ? T2('Sono stati esclusi i partecipanti secondo i criteri indicati (', 'Participants were excluded according to the rules below (') + steps.join('; ') + '). ' : T2('Nessun partecipante è stato escluso. ', 'No participant was excluded. ')) +
      T2('Il campione finale è composto da N = ', 'The final sample consists of N = ') + f.valid + T2(' partecipanti (', ' participants (') + Object.keys(f.byCond).map(function (k) { return clab(k) + ' n = ' + f.byCond[k]; }).join('; ') + '). ' +
      (f.age ? T2('L\'età media era M = ', 'Mean age was M = ') + num(f.age.m, 1) + ', ' + T2('DS', 'SD') + ' = ' + num(f.age.sd, 1) + T2(' (range ', ' (range ') + f.age.min + '-' + f.age.max + '). ' : '') +
      (f.gender ? T2('Genere: ', 'Gender: ') + Object.keys(f.gender).map(function (k) { return k + ' ' + f.gender[k]; }).join(', ') + '. ' : ''));
    if (P.scales.length) out.push(T2('Misure. ', 'Measures. ') + P.scales.map(function (sc) {
      var inf = M.scaleInfo[sc.id], rel = inf.rel;
      return sc.name + T2(' (', ' (') + inf.items.length + T2(' item, scala da ', ' items, scale from ') + num(inf.min, 0) + T2(' a ', ' to ') + num(inf.max, 0) + (sc.rev.length ? T2('; ', '; ') + sc.rev.length + T2(' item a punteggio inverso', ' reverse-scored') : '') +
        (rel && isFinite(rel.alpha) ? '; ' + T2('α', 'α') + ' = ' + fr(rel.alpha) + (isFinite(inf.omega) ? ', ω = ' + fr(inf.omega) : '') : '') + ')';
    }).join('; ') + T2('. Il punteggio di ciascuna scala è la media degli item.', '. Each scale score is the mean of its items.'));
    return out.join('\n\n');
  }

  function resultsText() {
    var M = st.M, vars = corrVars(), recs = pool(), out = [], k = vars.length;
    if (st.model.dv) runModel();
    if (k >= 2) {
      var cells = corrMatrixData(vars, recs), sig = [], ns = [];
      for (var i = 0; i < k; i++) for (var j = i + 1; j < k; j++) { var c = cells[i][j]; if (c.n >= 4) ns.push(c.n); if (isFinite(c.padj) && c.padj < 0.05) sig.push({ a: vars[i], b: vars[j], c: c }); }
      var adjTxt = st.corr.adj === 'holm' ? T2(' (p corretto con Holm)', ' (Holm-adjusted p)') : st.corr.adj === 'fdr' ? T2(' (p corretto con FDR)', ' (FDR-adjusted p)') : '';
      var sym = st.corr.method === 'spearman' ? 'rs' : 'r';
      out.push(T2('Correlazioni. Statistiche descrittive e correlazioni sono nella Tabella 1. ', 'Correlations. Descriptive statistics and correlations are in Table 1. ') +
        (sig.length ? sig.map(function (q) {
          return vlab(q.a) + T2(' e ', ' and ') + vlab(q.b) + T2(q.c.r > 0 ? ' erano correlate positivamente' : ' erano correlate negativamente', q.c.r > 0 ? ' were positively correlated' : ' were negatively correlated') +
            ', ' + sym + '(' + q.c.df + ') = ' + fr(q.c.r) + ', ' + T2('IC 95% [', '95% CI [') + fr(q.c.ciLo) + ', ' + fr(q.c.ciHi) + '], ' + fpv(q.c.padj) + adjTxt + '.';
        }).join(' ') + ' ' + T2('Le altre correlazioni non erano significative.', 'The other correlations were not significant.') : T2('Nessuna correlazione è risultata significativa', 'No correlation was significant') + (adjTxt ? adjTxt : '') + '.') +
        (ns.length ? ' ' + T2('Con n = ' + Math.round(median(ns)) + ' coppie, la correlazione minima rilevabile (potenza .80, α = .05, bilaterale) era |r| = ' + fr(S.minR(Math.round(median(ns)), 0.8)) + '.',
          'With n = ' + Math.round(median(ns)) + ' pairs, the smallest detectable correlation (80% power, α = .05, two-sided) was |r| = ' + fr(S.minR(Math.round(median(ns)), 0.8)) + '.') : ''));
    }
    var L = st.model.last;
    if (L && !L.error && L.fit) {
      var f = L.fit, parts = f.coef.slice(1).map(function (c, i) { return (L.preds[i] ? vlab(L.preds[i]) : L.names[i]) + ': B = ' + num(c.b, 2) + ', SE = ' + num(c.se, 2) + ', t(' + f.df + ') = ' + num(c.t, 2) + ', ' + fpv(c.p); });
      out.push(T2('Regressione. Il modello su ', 'Regression. The model for ') + vlab(L.dv) + T2(' ha spiegato R² = ', ' explained R² = ') + fr(f.r2) + T2(' (R² corretto = ', ' (adjusted R² = ') + fr(f.adjR2) + '), F(' + f.dfm + ', ' + f.df + ') = ' + num(f.F, 2) + ', ' + fpv(f.pF) + ', n = ' + L.n + '. ' + parts.join('; ') + '.');
    }
    return out.join('\n\n');
  }

  function apaTable(vars, recs) {
    var k = vars.length, cells = corrMatrixData(vars, recs);
    var head = ['Variable', 'M', 'SD', 'α'].concat(vars.slice(0, k - 1).map(function (v, i) { return String(i + 1); }));
    var rowsHtml = [], rowsTsv = [head.join('\t')];
    vars.forEach(function (v, i) {
      var vals = recs.map(function (r) { return v.get(r); }).filter(function (x) { return x != null; }), inf = v.scale ? st.M.scaleInfo[v.scale.id] : null;
      var cols = [(i + 1) + '. ' + vlab(v), vals.length ? num(S.mean(vals), 2) : '-', vals.length > 1 ? num(S.sd(vals), 2) : '-', inf && inf.rel && isFinite(inf.rel.alpha) ? fr(inf.rel.alpha) : '-'];
      for (var j = 0; j < k - 1; j++) {
        if (j > i) cols.push(''); else if (j === i) cols.push('-');
        else { var c = cells[i][j]; cols.push(isFinite(c.r) ? fr(c.r) + (isFinite(c.padj) ? stars(c.padj) : '') : '-'); }
      }
      rowsHtml.push('<tr>' + cols.map(function (x, q) { return q ? '<td class="dv-num">' + esc(x) + '</td>' : '<td>' + esc(x) + '</td>'; }).join('') + '</tr>');
      rowsTsv.push(cols.join('\t'));
    });
    var ns = [];
    for (var a = 0; a < k; a++) for (var b = a + 1; b < k; b++) if (cells[a][b].n >= 4) ns.push(cells[a][b].n);
    var noteTxt = 'N = ' + (ns.length ? Math.min.apply(null, ns) + (Math.max.apply(null, ns) !== Math.min.apply(null, ns) ? '-' + Math.max.apply(null, ns) : '') : '-') + '. ' + (st.corr.method === 'spearman' ? 'Spearman rho. ' : 'Pearson r. ') +
      '* p < .05, ** p < .01, *** p < .001' + (st.corr.adj === 'none' ? '.' : st.corr.adj === 'holm' ? ' (Holm-adjusted).' : ' (false-discovery-rate adjusted).');
    var htmlTbl = '<table><thead><tr>' + head.map(function (x) { return '<th>' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + rowsHtml.join('') + '</tbody></table><p><em>Note.</em> ' + esc(noteTxt) + '</p>';
    return { html: htmlTbl, tsv: rowsTsv.join('\n') + '\n' + 'Note. ' + noteTxt, head: head, note: noteTxt, rows: rowsHtml };
  }

  function tabReport() {
    var M = st.M, vars = corrVars(), recs = pool(), h = '';
    if (!M.hasQ && !M.P.scales.length) h += noQ();
    h += '<div class="dv-st-row"><label class="dv-select"><span class="dv-visually-hidden">Language</span><select data-act="lang">' + opts([['it', 'Text in Italian'], ['en', 'Text in English']], st.lang) + '</select></label>' +
      '<span class="dv-st-note">Uses the sessions in scope, the variables and the correction chosen in the Correlations tab, and the last model of the Models tab.</span></div>';
    if (vars.length >= 2) {
      var ap = apaTable(vars, recs);
      h += hdr('Table 1. Descriptive statistics and correlations') + '<div class="dv-table-wrap"><table class="dv-table dv-an-table"><thead><tr>' + ap.head.map(function (x) { return '<th class="dv-th-plain">' + esc(x) + '</th>'; }).join('') + '</tr></thead><tbody>' + ap.rows.join('') + '</tbody></table></div>' + note('Note. ' + ap.note);
      h += '<div class="dv-st-row">' + btn('copy-table', 'Copy table (for Word)') + btn('copy-tsv', 'Copy as plain text') + '</div>';
    } else h += '<p class="dv-an-empty">Choose at least two variables in the Correlations tab to build Table 1.</p>';
    h += hdr('Methods') + '<textarea class="dv-st-text" id="dv-st-methods" rows="9" spellcheck="false">' + esc(methodsText()) + '</textarea><div class="dv-st-row">' + btn('copy-text', 'Copy', ' data-t="dv-st-methods"') + '</div>';
    h += hdr('Results') + '<textarea class="dv-st-text" id="dv-st-results" rows="9" spellcheck="false">' + esc(resultsText()) + '</textarea><div class="dv-st-row">' + btn('copy-text', 'Copy', ' data-t="dv-st-results"') + '</div>';
    h += note('This is a draft written from the data. Check every number and adapt the wording to the thesis. Exclusion rules and the log are in the Data quality and Decision log tabs.');
    return h;
  }

  /* ---------- codebook and export ---------- */

  function codebookRows() {
    var M = st.M, recs = M.recs.filter(function (r) { return !r.excluded; }), rows = [];
    function numRow(name, label, src, v, extra) {
      var vals = recs.map(function (r) { return v.get(r); }).filter(function (x) { return x != null; }), n = recs.length;
      rows.push({ name: name, label: label, src: src, type: 'numeric', n: vals.length, miss: n ? (n - vals.length) / n * 100 : 0, m: vals.length ? S.mean(vals) : NaN, sd: vals.length > 1 ? S.sd(vals) : NaN,
        min: vals.length ? Math.min.apply(null, vals) : NaN, max: vals.length ? Math.max.apply(null, vals) : NaN, skew: S.skew(vals), kurt: S.kurtosis(vals), note: extra || '' });
    }
    rows.push({ name: 'sid', label: 'Session code', src: 'task', type: 'text', n: M.recs.length, miss: 0, note: '' });
    rows.push({ name: 'cond', label: 'Condition (key)', src: 'task', type: 'text', n: M.recs.length, miss: 0, note: Object.keys(host.COND).map(function (k) { return k + ' = ' + host.COND[k].label; }).join('; ') });
    M.vars.forEach(function (v) {
      var src = v.group === 'Scales' ? 'computed scale' : v.group === 'Task behaviour' ? 'task' : v.group === 'Condition codes' ? 'condition' : 'questionnaire';
      var ex = '';
      if (v.scale) { var inf = M.scaleInfo[v.scale.id]; ex = 'mean of ' + inf.items.join(', ') + (v.scale.rev.length ? '; reversed: ' + v.scale.rev.join(', ') : '') + '; range ' + num(inf.min, 0) + '-' + num(inf.max, 0) + (inf.rel ? '; alpha ' + fr(inf.rel.alpha) : '') + (isFinite(inf.omega) ? ', omega ' + fr(inf.omega) : ''); }
      numRow(vname(v), v.label, src, v, ex);
    });
    Object.keys(M.text).forEach(function (h) {
      var lv = M.text[h].levels, keys = Object.keys(lv).sort(function (a, b) { return lv[b] - lv[a]; });
      rows.push({ name: safeName(h), label: h, src: 'questionnaire', type: 'text', n: M.text[h].filled, miss: M.T.rows.length ? (M.T.rows.length - M.text[h].filled) / M.T.rows.length * 100 : 0, note: keys.length <= 12 ? keys.map(function (k) { return k + ' (' + lv[k] + ')'; }).join('; ') : keys.length + ' different values' });
    });
    return rows;
  }

  function tabBook() {
    var M = st.M, h = '', rows = codebookRows();
    h += '<p class="dv-an-intro">The codebook describes every variable of the clean dataset (task measures, condition codes, scale scores, questionnaire columns). Statistics are on the sessions that stay after the exclusions. The export buttons give files ready for R, SPSS and JASP.</p>';
    h += '<div class="dv-st-row">' + btn('exp-data', 'Clean dataset CSV') + btn('exp-book', 'Codebook CSV') + btn('exp-r', 'R script') + btn('exp-spss', 'SPSS syntax') + '</div>';
    h += note('JASP and jamovi open the dataset CSV directly. In R, run the script next to the CSV. In SPSS, put the CSV in the folder named in the first line of the syntax.');
    h += tbl(['Variable', 'Label', 'Source', 'n', '% missing', 'M', 'SD', 'Min', 'Max', 'Skew', 'Kurt.', 'Note'], rows.map(function (r) {
      return tr([esc(r.name), esc(r.label), esc(r.src), N(r.n), N(num(r.miss, 1)), N(r.type === 'numeric' ? num(r.m, 2) : ''), N(r.type === 'numeric' ? num(r.sd, 2) : ''), N(r.type === 'numeric' ? num(r.min, 2) : ''), N(r.type === 'numeric' ? num(r.max, 2) : ''),
        N(r.type === 'numeric' ? num(r.skew, 2) : ''), N(r.type === 'numeric' ? num(r.kurt, 2) : ''), '<span class="dv-dim">' + esc(r.note) + '</span>']);
    }));
    return h;
  }

  function datasetColumns() {
    var M = st.M, cols = [];
    cols.push({ name: 'sid', label: 'Session code', get: function (r) { return r.s.sid; } });
    cols.push({ name: 'cond', label: 'Condition (key)', get: function (r) { return r.s.cond; } });
    cols.push({ name: 'cond_code', label: 'Condition (1 to 6)', num: true, get: function (r) { var i = Object.keys(host.COND).indexOf(r.s.cond); return i < 0 ? null : i + 1; } });
    cols.push({ name: 'finished', label: 'Task finished (0/1)', num: true, get: function (r) { return r.s.finished ? 1 : 0; } });
    cols.push({ name: 'excluded', label: 'Excluded by the rules (0/1)', num: true, get: function (r) { return r.excluded ? 1 : 0; } });
    cols.push({ name: 'excluded_why', label: 'Rules that excluded the session', get: function (r) { return r.reasons.map(function (k) { return RULE_LABEL[k]; }).join('; '); } });
    M.vars.forEach(function (v) {
      cols.push({ name: vname(v), label: v.label, num: true, get: v.get, decimals: 4 });
    });
    Object.keys(M.text).forEach(function (h) { cols.push({ name: safeName(h), label: h, get: function (r) { return r.ri < 0 ? '' : String(M.T.rows[r.ri][M.text[h].c] == null ? '' : M.T.rows[r.ri][M.text[h].c]).trim(); } }); });
    var seen = {};
    cols.forEach(function (c) { var n = c.name, i = 2; while (seen[c.name]) c.name = n + '_' + (i++); seen[c.name] = 1; });
    return cols;
  }

  function exportData() {
    var cols = datasetColumns(), recs = st.M.recs.slice().sort(function (a, b) { return a.s.start - b.s.start; });
    var lines = [cols.map(function (c) { return host.csvCell(c.name); }).join(',')];
    recs.forEach(function (r) { lines.push(cols.map(function (c) { var v = c.get(r); return host.csvCell(v == null ? '' : typeof v === 'number' ? Math.round(v * 10000) / 10000 : v); }).join(',')); });
    var name = host.prefix() + 'clean-dataset-' + host.stamp() + '.csv';
    host.download(name, '﻿' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
    return name;
  }

  function exportBook() {
    var rows = codebookRows(), head = ['variable', 'label', 'source', 'type', 'n', 'percent_missing', 'mean', 'sd', 'min', 'max', 'skew', 'excess_kurtosis', 'note'];
    var lines = [head.join(',')].concat(rows.map(function (r) {
      return [r.name, r.label, r.src, r.type, r.n, r.miss != null ? Math.round(r.miss * 10) / 10 : '', r.m, r.sd, r.min, r.max, r.skew, r.kurt, r.note].map(function (v) { return host.csvCell(typeof v === 'number' ? (isFinite(v) ? Math.round(v * 1000) / 1000 : '') : v); }).join(',');
    }));
    host.download(host.prefix() + 'codebook-' + host.stamp() + '.csv', '﻿' + lines.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  }

  function exportR(file) {
    var cols = datasetColumns(), C = host.COND;
    var L = ['# ACME study: read the clean dataset in R. Put this script next to the CSV.', '# Written ' + new Date().toISOString().slice(0, 10) + (host.isSample() ? ' from SAMPLE data' : ''), '',
      'd <- read.csv("' + file + '", na.strings = c("", "NA"), fileEncoding = "UTF-8-BOM", stringsAsFactors = FALSE)',
      'd$cond <- factor(d$cond, levels = c(' + Object.keys(C).map(function (k) { return '"' + k + '"'; }).join(', ') + '),', '  labels = c(' + Object.keys(C).map(function (k) { return '"' + C[k].label + '"'; }).join(', ') + '))', ''];
    cols.forEach(function (c) { if (c.name === 'cond') return; L.push('attr(d$' + c.name + ', "label") <- "' + c.label.replace(/"/g, '\\"') + '"'); });
    L.push('', '# sessions that stay after the exclusion rules, task finished', 'dv <- subset(d, excluded == 0 & finished == 1)', 'nrow(dv)', '',
      '# examples: cor.test(dv$scale_so, dv$scale_mood); summary(lm(scale_mood ~ cond_spi * scale_so, data = dv))');
    host.download(host.prefix() + 'import-' + host.stamp() + '.R', L.join('\n') + '\n', 'text/plain;charset=utf-8');
  }

  function exportSpss(file) {
    var cols = datasetColumns(), C = host.COND;
    var L = ['* ACME study: read the clean dataset in SPSS. Change the folder in the next line.', 'GET DATA /TYPE=TXT /FILE="C:\\folder\\' + file + '" /ENCODING="UTF8" /DELIMITERS="," /QUALIFIER=\'"\' /ARRANGEMENT=DELIMITED /FIRSTCASE=2',
      '  /VARIABLES=' + cols.map(function (c) { return '\n  ' + c.name + ' ' + (c.num ? 'F10.4' : 'A120'); }).join('') + '.', 'EXECUTE.', '',
      'VARIABLE LABELS' + cols.map(function (c) { return '\n  ' + c.name + ' "' + c.label.replace(/"/g, "'") + '"'; }).join('') + '.', '',
      'VALUE LABELS cond_code' + Object.keys(C).map(function (k, i) { return '\n  ' + (i + 1) + ' "' + C[k].label + '"'; }).join('') + '.',
      'VALUE LABELS finished 0 "No" 1 "Yes" / excluded 0 "Kept" 1 "Excluded".', '', '* Keep only the finished sessions that pass the exclusion rules.', 'COMPUTE keep = (excluded = 0 AND finished = 1).', 'VARIABLE LABELS keep "Kept for the analysis".', 'FILTER BY keep.', 'EXECUTE.'];
    host.download(host.prefix() + 'import-' + host.stamp() + '.sps', L.join('\r\n') + '\r\n', 'text/plain;charset=utf-8');
  }

  /* ---------- decision log ---------- */

  function fmtStamp(t) { var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); }

  function tabLog() {
    var h = '<p class="dv-an-intro">A dated record of what was decided and why: exclusions, recoding, analyses added after seeing the data. Entries marked auto are written by this page (questionnaire import, scales, rules). Useful for transparency and for a pre-registration.</p>';
    if (host.isSample()) h += '<p class="dv-st-warn">Sample data are on: the log is not saved while you preview.</p>';
    h += '<div class="dv-st-row"><label class="dv-select"><span class="dv-visually-hidden">Type</span><select id="dv-st-log-kind">' + opts([['exclusion', 'Exclusion'], ['recoding', 'Recoding'], ['analysis', 'Analysis choice'], ['note', 'Note']], 'note') + '</select></label>' +
      '<label class="dv-st-field dv-st-field--wide"><span class="dv-visually-hidden">Entry</span><input type="text" class="dv-st-in" id="dv-st-log-text" placeholder="What was decided, and why"></label>' + btn('log-add', 'Add') + '</div>';
    var rows = st.log.slice().reverse().map(function (e, i) {
      return tr([esc(fmtStamp(e.t)), '<span class="dv-an-badge' + (e.kind === 'auto' ? '' : ' is-sig') + '">' + esc(e.kind) + '</span>', esc(e.text), e.kind === 'auto' ? '' : '<button type="button" class="dv-btn dv-btn--ghost" data-act="log-del" data-t="' + e.t + '">Delete</button>']);
    });
    h += rows.length ? tbl(['When', 'Type', 'Entry', ''], rows) : '<p class="dv-an-empty">Nothing recorded yet.</p>';
    h += '<div class="dv-st-row">' + btn('log-txt', 'Download as text') + btn('log-json', 'Download as JSON') + '</div>';
    return h;
  }

  /* ---------- drawer ---------- */

  function drawerHtml(s) {
    var M = st.M;
    if (!M) return '';
    var rec = M.recs.filter(function (r) { return r.s.sid === s.sid; })[0];
    if (!rec) return '';
    var rows = [];
    M.P.scales.forEach(function (sc) { var x = rec.scale[sc.id]; rows.push('<div><dt>' + esc(sc.name) + '</dt><dd>' + (x == null ? '-' : num(x, 2)) + '</dd></div>'); });
    var extra = '';
    if (rec.ri >= 0) {
      Object.keys(M.text).forEach(function (h) { var v = String(M.T.rows[rec.ri][M.text[h].c] || '').trim(); if (v && /^(gender|genere|sesso|sex)$/i.test(h)) rows.push('<div><dt>' + esc(h) + '</dt><dd>' + esc(v) + '</dd></div>'); });
      M.cols.forEach(function (c) { if (/^(age|et[aà]|anni)$/i.test(c.h) && isFinite(M.colNum[c.h][rec.ri])) rows.push('<div><dt>' + esc(c.h) + '</dt><dd>' + M.colNum[c.h][rec.ri] + '</dd></div>'); });
      extra = '<details class="dv-st-dd"><summary>All questionnaire answers</summary><dl class="dv-d-meta">' + M.T.headers.map(function (h, c) { var v = M.T.rows[rec.ri][c]; return v == null || String(v).trim() === '' ? '' : '<div><dt>' + esc(h) + '</dt><dd>' + esc(String(v).trim()) + '</dd></div>'; }).join('') + '</dl></details>';
    }
    var flags = rec.reasons.map(function (k) { return '<span class="dv-an-badge is-sig">' + esc(RULE_LABEL[k]) + '</span>'; }).concat(rec.reasonsOff.map(function (k) { return '<span class="dv-an-badge">' + esc(RULE_LABEL[k]) + ' (off)</span>'; })).join(' ');
    return '<div class="dv-d-study"><p class="dv-mono-label">Questionnaire and checks</p>' +
      (M.hasQ ? (rec.ri < 0 ? '<p class="dv-st-note">No questionnaire row matches this code.</p>' : '<dl class="dv-d-meta">' + rows.join('') + '</dl>' + extra) : '<p class="dv-st-note">No questionnaire imported.</p>') +
      '<p class="dv-st-flags">' + (flags || '<span class="dv-dim">No rule flags this session.</span>') + (rec.excluded ? ' <strong>Excluded.</strong>' : '') + '</p></div>';
  }

  /* ---------- rendering and events ---------- */

  function renderScope() {
    var C = host.COND, M = st.M, inScope = pool().length;
    $('dv-st-scope').innerHTML = '<label class="dv-select"><span class="dv-visually-hidden">Condition</span><select data-act="scope-cond">' + opts(Object.keys(C).map(function (k) { return [k, C[k].label]; }), st.scope.cond, 'All conditions') + '</select></label>' +
      '<label class="dv-an-check"><input type="checkbox" data-act="scope-done"' + (st.scope.done ? ' checked' : '') + '><span>Finished sessions only</span></label>' +
      '<label class="dv-an-check"><input type="checkbox" data-act="scope-excl"' + (st.scope.excl ? ' checked' : '') + '><span>Apply the exclusion rules</span></label>' +
      '<span class="dv-st-count">' + inScope + ' of ' + M.recs.length + ' sessions in scope</span>';
    $('dv-st-tabs').innerHTML = TABS.map(function (t) { return '<button type="button" role="tab" class="dv-st-tab' + (t[0] === st.tab ? ' is-on' : '') + '" data-act="tab" data-t="' + t[0] + '" aria-selected="' + (t[0] === st.tab) + '">' + esc(t[1]) + '</button>'; }).join('');
  }

  function renderBody() {
    if (!st.M) return;
    renderScope();
    var fn = { recruit: tabRecruit, quality: tabQuality, scales: tabScales, corr: tabCorr, model: tabModel, report: tabReport, book: tabBook, log: tabLog }[st.tab];
    var box = $('dv-st-body'), y = window.pageYOffset;
    box.innerHTML = fn();
    window.scrollTo(window.pageXOffset, y);
  }

  function refresh() {
    if (!host) return;
    if (!host.sessions().length) { st.M = null; return; }
    st.M = build();
    if (st.corr.vars) st.corr.vars = st.corr.vars.filter(function (k) { return varByKey(k); });
    renderBody();
  }

  function changed(msg, kind) {
    savePlan();
    if (msg) logAdd(kind || 'auto', msg);
    host.refresh();
  }

  function newId(P) { var i = 1; while (P.scales.some(function (s) { return s.id === 's' + i; })) i++; return 's' + i; }

  function toggle(list, v, on) { var i = list.indexOf(v); if (on && i < 0) list.push(v); if (!on && i >= 0) list.splice(i, 1); }

  function copyText(text, okMsg) {
    function ok() { host.toast(okMsg); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, function () { host.toast('Copy was blocked by the browser. Select the text and copy it by hand.', true); });
    else host.toast('Copy is not available here. Select the text and copy it by hand.', true);
  }

  function onAct(el, ev) {
    var act = el.getAttribute('data-act'), P = plan(), M = st.M, v = el.type === 'checkbox' ? el.checked : el.value;
    switch (act) {
      case 'tab': st.tab = el.getAttribute('data-t'); renderBody(); return;
      case 'scope-cond': st.scope.cond = v; host.refresh(); return;
      case 'scope-done': st.scope.done = v; host.refresh(); return;
      case 'scope-excl': st.scope.excl = v; host.refresh(); return;
      case 'lang': st.lang = v; renderBody(); return;
      case 'target': P.targets[el.getAttribute('data-k')] = +v || 0; savePlan(); renderBody(); return;
      case 'rule-on': P.rules[el.getAttribute('data-k')].on = v; changed('Rule "' + RULE_LABEL[el.getAttribute('data-k')] + '" ' + (v ? 'switched on' : 'switched off') + '.'); return;
      case 'rule-param': P.rules[el.getAttribute('data-k')][el.getAttribute('data-p')] = +v; changed('Rule "' + RULE_LABEL[el.getAttribute('data-k')] + '": setting changed to ' + v + '.'); return;
      case 'att-col': P.att.col = v; changed(v ? 'Attention check column set to ' + v + '.' : 'Attention check removed.'); return;
      case 'att-ok': P.att.ok = v; changed('Attention check: correct answer set to "' + v + '".'); return;
      case 'dur-col': P.durCol = v; changed('Duration column set to ' + (v || 'automatic') + '.'); return;
      case 'manual-add': {
        var sid = ($('dv-st-man-sid').value || '').trim(), why = ($('dv-st-man-why').value || '').trim();
        if (!sid) { host.toast('Type the session code.', true); return; }
        if (!M.recs.some(function (r) { return r.key === sid.toLowerCase(); })) { host.toast('No session has this code.', true); return; }
        if (P.manual.some(function (m) { return String(m.sid).toLowerCase() === sid.toLowerCase(); })) { host.toast('Already in the list.', true); return; }
        P.manual.push({ sid: sid, why: why });
        changed('Session ' + sid + ' excluded by hand' + (why ? ': ' + why : '') + '.', 'exclusion'); return;
      }
      case 'manual-del': { var m = P.manual.splice(+el.getAttribute('data-i'), 1)[0]; changed('Session ' + (m ? m.sid : '') + ' put back in the sample.', 'exclusion'); return; }
      case 'scale-suggest': {
        var name = el.getAttribute('data-name'), sug = suggestScales(M).filter(function (x) { return x.name === name; })[0];
        if (!sug) return;
        var id = newId(P);
        P.scales.push({ id: id, name: sug.name, items: sug.items.slice(), rev: [], min: null, max: null });
        st.openScale = id;
        changed('Scale "' + sug.name + '" created from ' + sug.items.length + ' columns (' + sug.items.join(', ') + ').'); return;
      }
      case 'scale-new': { var nid = newId(P); P.scales.push({ id: nid, name: 'New scale', items: [], rev: [], min: null, max: null }); st.openScale = nid; changed('A new scale was added.'); return; }
      case 'scale-edit': { var sid2 = el.getAttribute('data-id'); st.openScale = st.openScale === sid2 ? '' : sid2; renderBody(); return; }
      case 'scale-del': {
        var di = el.getAttribute('data-id'), sc = P.scales.filter(function (x) { return x.id === di; })[0];
        P.scales = P.scales.filter(function (x) { return x.id !== di; });
        changed('Scale "' + (sc ? sc.name : '') + '" deleted.'); return;
      }
      case 'scale-name': { var s1 = P.scales.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0]; if (s1 && v.trim()) { var old = s1.name; s1.name = v.trim(); changed('Scale "' + old + '" renamed "' + s1.name + '".'); } return; }
      case 'scale-item': case 'scale-rev': {
        var s2 = P.scales.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0], hh = el.getAttribute('data-h');
        if (!s2) return;
        if (act === 'scale-item') { toggle(s2.items, hh, v); if (!v) toggle(s2.rev, hh, false); } else toggle(s2.rev, hh, v);
        changed('Scale "' + s2.name + '": ' + (act === 'scale-item' ? (v ? 'item ' + hh + ' added' : 'item ' + hh + ' removed') : 'item ' + hh + (v ? ' marked as reversed' : ' no longer reversed')) + '.'); return;
      }
      case 'scale-min': case 'scale-max': {
        var s3 = P.scales.filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (!s3) return;
        s3[act === 'scale-min' ? 'min' : 'max'] = v === '' ? null : +v;
        changed('Scale "' + s3.name + '": ' + (act === 'scale-min' ? 'lowest' : 'highest') + ' answer set to ' + (v === '' ? 'automatic' : v) + '.'); return;
      }
      case 'corr-var': toggle(st.corr.vars, el.getAttribute('data-k'), v); renderBody(); return;
      case 'corr-method': st.corr.method = v; renderBody(); return;
      case 'corr-adj': st.corr.adj = v; renderBody(); return;
      case 'corr-pick': st.corr.pick = [el.getAttribute('data-a'), el.getAttribute('data-b')]; renderBody(); return;
      case 'model-dv': st.model.dv = v; st.model.preds = st.model.preds.filter(function (k) { return k !== v; }); renderBody(); return;
      case 'model-pred': toggle(st.model.preds, el.getAttribute('data-k'), v); if (!v) { if (st.model.focal === el.getAttribute('data-k')) st.model.focal = ''; if (st.model.mod === el.getAttribute('data-k')) st.model.mod = ''; } renderBody(); return;
      case 'model-focal': st.model.focal = v; renderBody(); return;
      case 'model-mod': st.model.mod = v; renderBody(); return;
      case 'model-center': st.model.center = v; renderBody(); return;
      case 'copy-text': copyText($(el.getAttribute('data-t')).value, 'Copied.'); return;
      case 'copy-tsv': { var ap = apaTable(corrVars(), pool()); copyText(ap.tsv, 'Table copied as plain text.'); return; }
      case 'copy-table': {
        var ap2 = apaTable(corrVars(), pool());
        if (navigator.clipboard && window.ClipboardItem) {
          navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([ap2.html], { type: 'text/html' }), 'text/plain': new Blob([ap2.tsv], { type: 'text/plain' }) })]).then(function () { host.toast('Table copied. Paste it into Word.'); }, function () { copyText(ap2.tsv, 'Table copied as plain text.'); });
        } else copyText(ap2.tsv, 'Table copied as plain text.');
        return;
      }
      case 'exp-data': exportData(); return;
      case 'exp-book': exportBook(); return;
      case 'exp-r': exportR(exportData()); host.toast('Dataset and R script downloaded.'); return;
      case 'exp-spss': exportSpss(exportData()); host.toast('Dataset and SPSS syntax downloaded.'); return;
      case 'log-add': {
        var tx = ($('dv-st-log-text').value || '').trim();
        if (!tx) { host.toast('Write the entry first.', true); return; }
        if (host.isSample()) { host.toast('The log is not saved while sample data are on.', true); return; }
        st.log.push({ t: Date.now(), kind: $('dv-st-log-kind').value, text: tx }); saveLog(); renderBody(); return;
      }
      case 'log-del': { var t = +el.getAttribute('data-t'); st.log = st.log.filter(function (e) { return e.t !== t; }); saveLog(); renderBody(); return; }
      case 'log-txt': host.download(host.prefix() + 'decision-log-' + host.stamp() + '.txt', st.log.map(function (e) { return fmtStamp(e.t) + '  [' + e.kind + ']  ' + e.text; }).join('\r\n') + '\r\n', 'text/plain;charset=utf-8'); return;
      case 'log-json': host.download(host.prefix() + 'decision-log-' + host.stamp() + '.json', JSON.stringify(st.log, null, 1), 'application/json'); return;
    }
  }

  function init(h, analysis) {
    host = h; A = analysis;
    loadStore();
    var body = $('dv-st-body'), root = $('study');
    if (!body) return;
    root.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-act]');
      if (!el) return;
      var tag = el.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;    // those act on change
      onAct(el, ev);
    });
    root.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var el = ev.target.closest('td[data-act="corr-pick"]');
      if (el) { ev.preventDefault(); onAct(el, ev); }
    });
    root.addEventListener('change', function (ev) {
      var el = ev.target.closest('[data-act]');
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT')) onAct(el, ev);
    });
  }

  window.ACME_STUDY = { init: init, refresh: refresh, isExcluded: isExcluded, analysisColumns: analysisColumns, drawerHtml: drawerHtml, state: st, build: function () { return build(); },
    _t: { sampleTable: sampleTable, methodsText: methodsText, resultsText: resultsText, codebookRows: codebookRows, datasetColumns: datasetColumns, runModel: runModel, pool: pool, tabs: { recruit: tabRecruit, quality: tabQuality, scales: tabScales, corr: tabCorr, model: tabModel, report: tabReport, book: tabBook, log: tabLog } } };
})();
