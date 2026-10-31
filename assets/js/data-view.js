/* ACME study: data viewer for data.html (experimenter only).
   Reads the events the logger writes in this browser: IndexedDB "acme-study", store "events".
   This file never logs anything. It writes to the database only when the experimenter imports
   a JSON file or deletes everything. Sample data lives in memory only and is never stored.
   No network, no libraries. */
(function () {
  'use strict';

  var DB_NAME = 'acme-study';
  var STORE = 'events';

  var COND = {
    obj_cond: { label: 'Objectifying', short: 'Obj', unit: 'orders', total: 33 },
    obj_spi_colleghi: { label: 'Obj + SPI colleagues', short: 'SPI col', unit: 'orders', total: 33 },
    obj_spi_clienti: { label: 'Obj + SPI customers', short: 'SPI cus', unit: 'orders', total: 33 },
    obj_spi_test_cond: { label: 'Obj + SPI test', short: 'SPI test', unit: 'orders', total: 33 },
    not_obj_cond: { label: 'Not objectifying', short: 'Not obj', unit: 'tickets', total: 16 },
    control: { label: 'Control (Arkanoid)', short: 'Control', unit: 'levels', total: 10 }
  };
  var COND_KEYS = Object.keys(COND);
  var TIMED = ['obj_cond', 'obj_spi_colleghi', 'obj_spi_clienti', 'obj_spi_test_cond'];
  var LIMIT = [60, 60, 45, 45, 40]; // seconds per order, 30 s from order 6 on (from the order pages)
  var SPI_ORDERS = [6, 15, 24];
  var NOT_OBJ_PAGES = ['1_quotator', '2_quotator', '3_appointment', '4_request_info', '5_appointment2',
    '6_help_desk', '7_quotator', '8_help_desk', '9_request_info2', '10_request_info3', '11_quotator',
    '12_request_info4', '13_request_info5', '14_request_info6', '15_request_info7', '16_appointment3'];

  var state = {
    real: [],          // events read from IndexedDB
    sample: null,      // generated sample events (memory only)
    useSample: false,
    idb: true,         // IndexedDB available
    sessions: [],
    sort: { key: 'start', dir: -1 },
    query: '',
    cond: '',
    openSid: null
  };

  var $ = function (id) { return document.getElementById(id); };

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function fmtDur(ms) {
    if (ms == null || isNaN(ms)) return '-';
    var s = Math.round(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    s = s % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }

  function fmtRel(ms) {
    var neg = ms < 0; ms = Math.abs(ms);
    var s = Math.floor(ms / 1000), m = Math.floor(s / 60);
    return (neg ? '-' : '+') + pad(m) + ':' + pad(s % 60);
  }

  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(t) {
    if (!t) return '-';
    var d = new Date(t);
    return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function fmtTime(t) {
    var d = new Date(t);
    return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function condLabel(c) { return COND[c] ? COND[c].label : (c || 'unknown'); }

  // Order (timed), ticket (not objectifying) or level (control) number of a page, or null.
  function stepOf(page) {
    if (!page) return null;
    var m = /(?:^|\/)obj_(?:cond|spi_[a-z_]+)\/(\d+)\.html/.exec(page);
    if (m) return +m[1];
    m = /(?:^|\/)not_obj_cond\/(\d+)_[a-z_0-9]+\.html/.exec(page);
    if (m) return +m[1];
    m = /(?:^|\/)control\/level(\d+)\//.exec(page);
    if (m) return +m[1];
    return null;
  }

  function isTimedOrder(page) { return /(?:^|\/)obj_(?:cond|spi_[a-z_]+)\/\d+\.html/.test(page || ''); }

  function detailText(e) {
    var d = e.d || {};
    switch (e.type) {
      case 'page_leave': return d.ms != null ? 'on page ' + fmtDur(d.ms) : '';
      case 'click':
        return [d.tag ? d.tag.toLowerCase() : '', d.id ? '#' + d.id : '', d.text ? '"' + d.text + '"' : ''].filter(Boolean).join(' ');
      case 'spi_shown': return (d.clip || '') + (d.from ? ' from ' + d.from : '') + (d.secondsLeft != null ? ', ' + d.secondsLeft + ' s left' : '');
      case 'spi_ended': return (d.clip || '') + (d.completed === true ? ', watched to the end' : d.completed === false ? ', interrupted' : '');
      case 'session_start': return [d.screen, d.ua].filter(Boolean).join(' · ');
      default:
        var keys = Object.keys(d);
        return keys.length ? JSON.stringify(d).slice(0, 120) : '';
    }
  }

  /* ---------- IndexedDB ---------- */

  function idbAvailable() {
    try { return !!window.indexedDB; } catch (e) { return false; }
  }

  // Open without creating: if the database does not exist yet, the upgrade is aborted so the
  // logger can create it later with its own schema. create=true makes the store (used by import).
  function openDb(create) {
    return new Promise(function (resolve, reject) {
      var req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = function (ev) {
        var db = req.result;
        if (!create && ev.oldVersion === 0) { req.transaction.abort(); return; }
        // same schema as the logger (assets/js/acme-data.js): version 1, store "events", index "sid"
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true }).createIndex('sid', 'sid', { unique: false });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function (ev) { ev.preventDefault && ev.preventDefault(); reject(req.error || new Error('open failed')); };
      req.onblocked = function () { reject(new Error('blocked')); };
    });
  }

  function readAll() {
    if (!state.idb) return Promise.resolve([]);
    return openDb(false).then(function (db) {
      return new Promise(function (resolve, reject) {
        if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve([]); return; }
        var tx = db.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
        tx.oncomplete = function () { db.close(); };
      });
    }, function () { return []; });
  }

  function writeEvents(list) {
    return openDb(true).then(function (db) {
      return new Promise(function (resolve, reject) {
        var store, tx;
        if (!db.objectStoreNames.contains(STORE)) {
          // never bump the version here: the logger opens version 1 and would stop working
          db.close(); reject(new Error('store missing')); return;
        }
        tx = db.transaction(STORE, 'readwrite');
        store = tx.objectStore(STORE);
        list.forEach(function (e) { store.add(e); });
        tx.oncomplete = function () { db.close(); resolve(list.length); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  function clearAll() {
    return openDb(false).then(function (db) {
      return new Promise(function (resolve, reject) {
        if (!db.objectStoreNames.contains(STORE)) { db.close(); resolve(); return; }
        var tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ---------- sample data (memory only) ---------- */

  function makeSample() {
    var seed = 20261031;
    function rnd() { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }
    function between(a, b) { return a + (b - a) * rnd(); }
    function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }
    var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    function code() { var s = 'P-'; for (var i = 0; i < 4; i++) s += letters[Math.floor(rnd() * letters.length)]; return s; }

    var plan = [['obj_cond', 6], ['obj_spi_colleghi', 6], ['obj_spi_clienti', 6], ['obj_spi_test_cond', 2], ['not_obj_cond', 5], ['control', 5]];
    var screens = ['1366x768', '1920x1080', '1536x864', '1440x900'];
    var uas = ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Edg/141.0', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Safari/605.1'];
    var day0 = new Date(2026, 9, 27, 9, 0, 0).getTime();
    var out = [], id = 1, n = 0;

    plan.forEach(function (p) {
      for (var k = 0; k < p[1]; k++) {
        var cond = p[0], sid = code(), t = day0 + Math.floor(n / 6) * 86400000 + (n % 6) * 1500000 + Math.floor(between(0, 600000));
        n++;
        var drop = rnd() < 0.12; // a few sessions stop early
        var push = function (type, page, d, dt) { t += dt || 0; out.push({ id: id++, sid: sid, t: Math.round(t), cond: cond, page: page, type: type, d: d || {} }); };
        var visit = function (page, ms, clicks) {
          push('page_view', page, {}, 400);
          var start = t;
          (clicks || []).forEach(function (c) { t = start + Math.min(c[0], ms - 600); push('click', page, c[1]); });
          t = start + ms;
          push('page_leave', page, { ms: Math.round(ms) });
        };
        push('session_start', 'index.html', { screen: pick(screens), ua: pick(uas) });

        if (TIMED.indexOf(cond) !== -1) {
          visit(cond + '/acme_shop_2.html', between(70, 160) * 1000, [[between(60, 150) * 1000, { tag: 'A', id: '', text: 'Start your day at work!' }]]);
          var last = drop ? Math.floor(between(8, 30)) : 33;
          var used = [];
          var src = cond === 'obj_spi_colleghi' ? 'colleghi' : cond === 'obj_spi_clienti' ? 'clienti' : pick(['colleghi', 'clienti']);
          for (var o = 1; o <= last; o++) {
            var limit = (LIMIT[o - 1] || 30) * 1000 + 1000;
            var speed = Math.max(0.35, Math.min(0.97, between(0.45, 0.85) - (o > 5 ? 0.05 : 0) + (o >= 20 ? between(0, 0.12) : 0)));
            var submit = limit * speed;
            var missed = rnd() < 0.06;
            var clicks = [
              [submit * 0.25, { tag: 'SELECT', id: 'designs', text: '' }],
              [submit * 0.55, { tag: 'INPUT', id: pick(['logoDesign', 'businessCards', 'brochure']), text: '' }]
            ];
            if (!missed) clicks.push([submit, { tag: 'INPUT', id: 'evadi', text: 'Send the order to the sales office for' }]);
            var page = cond + '/' + o + '.html';
            push('page_view', page, {}, 300);
            var s0 = t;
            clicks.forEach(function (c) { t = s0 + c[0]; push('click', page, c[1]); });
            if (cond !== 'obj_cond' && SPI_ORDERS.indexOf(o) !== -1) {
              var pool = src === 'colleghi' ? ['colleghi-1', 'colleghi-2', 'colleghi-3', 'colleghi-4'] : ['clienti-1', 'clienti-2', 'clienti-3', 'clienti-4'];
              var clip = pick(pool.filter(function (c) { return used.indexOf(c) === -1; }));
              used.push(clip);
              var left = Math.min(30, Math.round(limit / 1000) - 1);
              var at = s0 + (limit - left * 1000) + 100;
              out.push({ id: id++, sid: sid, t: Math.round(at), cond: cond, page: page, type: 'spi_shown', d: { clip: clip, from: src, secondsLeft: left } });
              out.push({ id: id++, sid: sid, t: Math.round(at + between(17, 24) * 1000), cond: cond, page: page, type: 'spi_ended', d: { clip: clip, completed: rnd() > 0.1 } });
            }
            t = s0 + limit;
            push('page_leave', page, { ms: Math.round(limit) });
          }
          if (!drop) push('end_task', cond + '/end_task.html', {}, 500);
        } else if (cond === 'not_obj_cond') {
          visit('not_obj_cond/acme_shop_1.html', between(120, 240) * 1000, [[between(100, 220) * 1000, { tag: 'A', id: '', text: 'Start your day at work!' }]]);
          var lastT = drop ? Math.floor(between(5, 14)) : 16;
          for (var q = 1; q <= lastT; q++) {
            var ms = between(45, 110) * 1000;
            visit('not_obj_cond/' + NOT_OBJ_PAGES[q - 1] + '.html', ms, [
              [ms * 0.3, { tag: 'A', id: '', text: pick(['Help desk', 'Calendar', 'Catalogue']) }],
              [ms * 0.92, { tag: 'INPUT', id: 'evadi', text: 'Reply to the customer' }]
            ]);
          }
          if (!drop) push('end_task', 'not_obj_cond/end_task.html', {}, 500);
        } else {
          visit('control/acme_shop_control.html', between(40, 90) * 1000, [[between(30, 80) * 1000, { tag: 'A', id: '', text: 'Start' }]]);
          var lastL = drop ? Math.floor(between(3, 8)) : 10;
          for (var l = 1; l <= lastL; l++) {
            visit('control/level' + l + '/index.html', 121000, [[between(2, 6) * 1000, { tag: 'CANVAS', id: 'breakout', text: '' }]]);
          }
          if (!drop) push('end_task', 'control/end_task.html', {}, 500);
        }
      }
    });
    return out;
  }

  /* ---------- model ---------- */

  function events() { return state.useSample ? (state.sample || []) : state.real; }

  function buildSessions(list) {
    var by = {};
    list.forEach(function (e) {
      if (!e || !e.sid) return;
      (by[e.sid] = by[e.sid] || []).push(e);
    });
    return Object.keys(by).map(function (sid) {
      var ev = by[sid].sort(function (a, b) { return a.t - b.t || (a.id || 0) - (b.id || 0); });
      var start = ev[0].t, end = ev[ev.length - 1].t;
      var cond = '';
      for (var i = 0; i < ev.length && !cond; i++) if (ev[i].cond) cond = ev[i].cond;
      var views = ev.filter(function (e) { return e.type === 'page_view'; });
      var steps = {};
      views.forEach(function (e) { var s = stepOf(e.page); if (s != null) steps[s] = 1; });
      var stepNums = Object.keys(steps).map(Number);
      var ss = ev.filter(function (e) { return e.type === 'session_start'; })[0];
      return {
        sid: sid, cond: cond, events: ev, start: start, end: end, dur: end - start,
        pages: views.length,
        steps: stepNums.length,
        maxStep: stepNums.length ? Math.max.apply(null, stepNums) : 0,
        videos: ev.filter(function (e) { return e.type === 'spi_shown'; }).length,
        videosDone: ev.filter(function (e) { return e.type === 'spi_ended' && e.d && e.d.completed === true; }).length,
        finished: ev.some(function (e) { return e.type === 'end_task'; }),
        screen: ss && ss.d ? ss.d.screen : '',
        ua: ss && ss.d ? ss.d.ua : ''
      };
    });
  }

  // Seconds on each timed order page and seconds to the click on #evadi, across all timed sessions.
  function orderTimes(sessions) {
    var on = [], sub = [];
    for (var i = 0; i < 33; i++) { on.push([]); sub.push([]); }
    sessions.forEach(function (s) {
      if (TIMED.indexOf(s.cond) === -1) return;
      var ev = s.events;
      for (var i = 0; i < ev.length; i++) {
        var e = ev[i];
        if (e.type !== 'page_view' || !isTimedOrder(e.page)) continue;
        var n = stepOf(e.page);
        if (!n || n > 33) continue;
        var ms = null, submitted = null;
        for (var j = i + 1; j < ev.length; j++) {
          var f = ev[j];
          if (f.type === 'click' && f.page === e.page && f.d && f.d.id === 'evadi' && submitted == null) submitted = f.t - e.t;
          if (f.type === 'page_leave' && f.page === e.page) { ms = f.d && f.d.ms != null ? f.d.ms : f.t - e.t; break; }
          if (f.type === 'page_view') { ms = f.t - e.t; break; }
        }
        if (ms != null && ms > 0) on[n - 1].push(ms / 1000);
        if (submitted != null && submitted > 0) sub[n - 1].push(submitted / 1000);
      }
    });
    function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
    return on.map(function (a, i) { return { n: i + 1, on: mean(a), sub: mean(sub[i]), count: a.length }; });
  }

  /* ---------- render ---------- */

  function render() {
    var list = events();
    state.sessions = buildSessions(list);
    var has = list.length > 0;

    document.body.classList.toggle('dv-is-sample', state.useSample);
    $('dv-sample-banner').hidden = !state.useSample;
    $('dv-sample').checked = state.useSample;
    $('dv-source-name').textContent = state.useSample ? 'Sample data (memory)' : 'This browser';
    $('dv-source-meta').textContent = state.useSample ? 'Generated on this page, never saved' : (state.idb ? 'IndexedDB · acme-study · events' : 'IndexedDB not available');
    $('dv-delete').disabled = state.useSample || !state.real.length;
    $('dv-sub').textContent = list.length + ' events · ' + state.sessions.length + ' sessions · read at ' + fmtTime(Date.now());

    $('dv-empty').hidden = has;
    $('dv-content').hidden = !has;
    if (!has) {
      $('dv-empty-title').textContent = state.idb ? 'No data in this browser yet' : 'IndexedDB is not available here';
      $('dv-empty-text').textContent = state.idb
        ? 'Events appear here once a session has been run in this browser. You can import a JSON export from another computer, or look at the page with sample data.'
        : 'This browser does not give the page access to IndexedDB (private window or blocked storage), so there is nothing to read. Sample data still works.';
      closeDrawer();
      return;
    }
    renderKpis(list);
    renderCondChart();
    renderOrderChart();
    renderFilters();
    renderTable();
    if (window.ACME_ANALYSIS) window.ACME_ANALYSIS.render();
    if (state.openSid) openDrawer(state.openSid);
  }

  function renderKpis(list) {
    var s = state.sessions;
    var finished = s.filter(function (x) { return x.finished; });
    var withDur = finished.length ? finished : s;
    var avg = withDur.length ? withDur.reduce(function (a, x) { return a + x.dur; }, 0) / withDur.length : 0;
    var orders = s.filter(function (x) { return TIMED.indexOf(x.cond) !== -1; }).reduce(function (a, x) { return a + x.steps; }, 0);
    var shown = list.filter(function (e) { return e.type === 'spi_shown'; }).length;
    var done = list.filter(function (e) { return e.type === 'spi_ended' && e.d && e.d.completed === true; }).length;
    var tiles = [
      ['Sessions', s.length, 'distinct session codes'],
      ['Participants', finished.length, 'reached the end page'],
      ['Mean duration', fmtDur(avg), finished.length ? 'completed sessions' : 'all sessions'],
      ['Orders completed', orders, 'timed order pages reached'],
      ['SPI videos shown', shown, 'pop-ups opened'],
      ['Videos watched', done, shown ? Math.round(done / shown * 100) + '% to the end' : 'none shown yet']
    ];
    $('dv-kpis').innerHTML = tiles.map(function (t, i) {
      return '<div class="dv-kpi"><span class="dv-kpi-idx">' + pad(i + 1) + '</span><span class="dv-kpi-label">' + esc(t[0]) +
        '</span><strong class="dv-kpi-value">' + esc(t[1]) + '</strong><span class="dv-kpi-hint">' + esc(t[2]) + '</span></div>';
    }).join('');
  }

  function renderCondChart() {
    var counts = COND_KEYS.map(function (k) {
      return { k: k, n: state.sessions.filter(function (s) { return s.cond === k; }).length, f: state.sessions.filter(function (s) { return s.cond === k && s.finished; }).length };
    });
    var max = Math.max.apply(null, counts.map(function (c) { return c.n; }).concat([1]));
    $('dv-cond-chart').innerHTML = counts.map(function (c) {
      var w = c.n / max * 100, wf = c.f / max * 100;
      return '<li class="dv-bar"><span class="dv-bar-label">' + esc(COND[c.k].label) + '</span>' +
        '<span class="dv-bar-track" title="' + c.n + ' sessions, ' + c.f + ' completed"><span class="dv-bar-fill" style="width:' + w + '%"></span>' +
        '<span class="dv-bar-done" style="width:' + wf + '%"></span></span>' +
        '<span class="dv-bar-value">' + c.n + '</span></li>';
    }).join('');
  }

  function renderOrderChart() {
    var data = orderTimes(state.sessions);
    var any = data.some(function (d) { return d.on != null; });
    var box = $('dv-order-chart');
    if (!any) { box.innerHTML = '<p class="dv-chart-empty">No timed order pages in these data.</p>'; return; }
    var W = 660, H = 230, L = 34, R = 8, T = 12, B = 34, ymax = 65;
    var iw = W - L - R, ih = H - T - B, step = iw / 33, bw = Math.max(4, step * 0.62);
    var y = function (v) { return T + ih - v / ymax * ih; };
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Mean seconds per order, orders 1 to 33">';
    [0, 15, 30, 45, 60].forEach(function (v) {
      svg += '<line class="dv-grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="dv-axis" x="' + (L - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    });
    // time limit of each order, as a step line
    var lim = '';
    for (var i = 0; i < 33; i++) {
      var lv = LIMIT[i] || 30, x0 = L + i * step, x1 = x0 + step;
      lim += (i ? 'L' : 'M') + x0 + ' ' + y(lv) + 'L' + x1 + ' ' + y(lv);
    }
    data.forEach(function (d, i) {
      var x = L + i * step + (step - bw) / 2;
      var spi = SPI_ORDERS.indexOf(d.n) !== -1;
      var tip = 'Order ' + d.n + ': ' + (d.on != null ? d.on.toFixed(1) + ' s on page' : 'no data') + (d.sub != null ? ', submitted after ' + d.sub.toFixed(1) + ' s' : '') + ' (n = ' + d.count + ')';
      svg += '<g class="dv-col' + (spi ? ' is-spi' : '') + '"><title>' + esc(tip) + '</title>' +
        '<rect class="dv-hit" x="' + (L + i * step) + '" y="' + T + '" width="' + step + '" height="' + ih + '"/>';
      if (d.on != null) svg += '<rect class="dv-on" x="' + x + '" y="' + y(d.on) + '" width="' + bw + '" height="' + (y(0) - y(d.on)) + '"/>';
      if (d.sub != null) svg += '<rect class="dv-sub" x="' + x + '" y="' + y(d.sub) + '" width="' + bw + '" height="' + (y(0) - y(d.sub)) + '"/>';
      svg += '</g>';
      if (d.n === 1 || d.n % 4 === 0 || spi) {
        svg += '<text class="dv-axis' + (spi ? ' dv-axis-spi' : '') + '" x="' + (L + i * step + step / 2) + '" y="' + (H - B + 16) + '" text-anchor="middle">' + d.n + '</text>';
      }
      if (spi) svg += '<rect class="dv-spi-tick" x="' + (L + i * step + step / 2 - 3) + '" y="' + (H - B + 23) + '" width="6" height="6"/>';
    });
    svg += '<path class="dv-limit" d="' + lim + '"/></svg>';
    box.innerHTML = svg;
  }

  function renderFilters() {
    var sel = $('dv-filter');
    if (sel.options.length > 1) return;
    COND_KEYS.forEach(function (k) {
      var o = document.createElement('option'); o.value = k; o.textContent = COND[k].label; sel.appendChild(o);
    });
  }

  function progressText(s) {
    var c = COND[s.cond];
    if (!c) return s.steps ? String(s.steps) : '-';
    return s.maxStep + ' / ' + c.total;
  }

  function filtered() {
    var q = state.query.trim().toLowerCase();
    var rows = state.sessions.filter(function (s) {
      if (state.cond && s.cond !== state.cond) return false;
      if (!q) return true;
      return (s.sid + ' ' + condLabel(s.cond) + ' ' + s.cond + ' ' + fmtDate(s.start)).toLowerCase().indexOf(q) !== -1;
    });
    var k = state.sort.key, dir = state.sort.dir;
    rows.sort(function (a, b) {
      var va = k === 'cond' ? condLabel(a.cond) : k === 'orders' ? a.maxStep : a[k];
      var vb = k === 'cond' ? condLabel(b.cond) : k === 'orders' ? b.maxStep : b[k];
      if (typeof va === 'string') return va.localeCompare(vb) * dir;
      return ((va || 0) - (vb || 0)) * dir;
    });
    return rows;
  }

  function renderTable() {
    var rows = filtered();
    var ths = document.querySelectorAll('#dv-table thead th[data-key]');
    Array.prototype.forEach.call(ths, function (th) {
      var on = th.getAttribute('data-key') === state.sort.key;
      th.setAttribute('aria-sort', on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    });
    $('dv-count').textContent = rows.length + ' of ' + state.sessions.length;
    var body = $('dv-tbody');
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="8" class="dv-td-empty">No session matches the search.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (s) {
      var c = COND[s.cond];
      return '<tr data-sid="' + esc(s.sid) + '" tabindex="0" class="' + (s.sid === state.openSid ? 'is-open' : '') + '">' +
        '<td class="dv-td-code"><span class="dv-code">' + esc(s.sid) + '</span></td>' +
        '<td><span class="dv-cond dv-cond--' + esc(s.cond) + '">' + esc(c ? c.label : s.cond || 'unknown') + '</span></td>' +
        '<td class="dv-num">' + esc(fmtDate(s.start)) + '</td>' +
        '<td class="dv-num">' + esc(fmtDur(s.dur)) + '</td>' +
        '<td class="dv-num">' + s.pages + '</td>' +
        '<td class="dv-num">' + esc(progressText(s)) + (c ? ' <small>' + c.unit + '</small>' : '') + '</td>' +
        '<td class="dv-num">' + (s.videos ? s.videos + (s.videosDone !== s.videos ? ' <small>' + s.videosDone + ' watched</small>' : '') : '<span class="dv-dim">0</span>') + '</td>' +
        '<td class="dv-td-state">' + (s.finished ? '<span class="dv-state dv-state--done">Completed</span>' : '<span class="dv-state">Stopped</span>') + '</td>' +
        '</tr>';
    }).join('');
  }

  /* ---------- drawer ---------- */

  function openDrawer(sid) {
    var s = state.sessions.filter(function (x) { return x.sid === sid; })[0];
    if (!s) { closeDrawer(); return; }
    state.openSid = sid;
    $('dv-d-code').textContent = s.sid;
    $('dv-d-cond').textContent = condLabel(s.cond);
    $('dv-d-meta').innerHTML =
      '<div><dt>Start</dt><dd>' + esc(fmtDate(s.start)) + '</dd></div>' +
      '<div><dt>Duration</dt><dd>' + esc(fmtDur(s.dur)) + '</dd></div>' +
      '<div><dt>Pages</dt><dd>' + s.pages + '</dd></div>' +
      '<div><dt>Reached</dt><dd>' + esc(progressText(s)) + '</dd></div>' +
      '<div><dt>Videos</dt><dd>' + s.videos + ' shown · ' + s.videosDone + ' watched</dd></div>' +
      '<div><dt>Screen</dt><dd>' + esc(s.screen || '-') + '</dd></div>';
    $('dv-d-list').innerHTML = s.events.map(function (e) {
      return '<li class="dv-ev dv-ev--' + esc(e.type) + '">' +
        '<span class="dv-ev-time">' + fmtRel(e.t - s.start) + '</span>' +
        '<span class="dv-ev-body"><span class="dv-ev-type">' + esc(String(e.type || '').replace(/_/g, ' ')) + '</span>' +
        '<span class="dv-ev-page">' + esc(e.page || '') + '</span>' +
        (detailText(e) ? '<span class="dv-ev-detail">' + esc(detailText(e)) + '</span>' : '') +
        '</span></li>';
    }).join('');
    $('dv-d-count').textContent = s.events.length + ' events';
    var d = $('dv-drawer');
    var wasOpen = d.classList.contains('is-open');
    d.classList.add('is-open');
    d.setAttribute('aria-hidden', 'false');
    $('dv-scrim').classList.add('is-open');
    Array.prototype.forEach.call(document.querySelectorAll('#dv-tbody tr'), function (tr) {
      tr.classList.toggle('is-open', tr.getAttribute('data-sid') === sid);
    });
    if (!wasOpen) $('dv-d-close').focus();
  }

  function closeDrawer() {
    var wasSid = state.openSid;
    state.openSid = null;
    $('dv-drawer').classList.remove('is-open');
    $('dv-drawer').setAttribute('aria-hidden', 'true');
    $('dv-scrim').classList.remove('is-open');
    Array.prototype.forEach.call(document.querySelectorAll('#dv-tbody tr.is-open'), function (tr) { tr.classList.remove('is-open'); });
    if (wasSid) {
      var row = document.querySelector('#dv-tbody tr[data-sid="' + wasSid.replace(/"/g, '') + '"]');
      if (row) row.focus();
    }
  }

  /* ---------- export / import / delete ---------- */

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.parentNode.removeChild(a); }, 500);
  }

  function csvCell(v) {
    if (v == null) return '';
    var s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n\r;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes());
  }

  function prefix() { return (state.useSample ? 'SAMPLE-' : '') + 'acme-study-'; }

  function exportEventsCsv() {
    var head = ['id', 'sid', 'cond', 'page', 'type', 't', 'time_iso', 'rel_ms', 'ms', 'tag', 'el_id', 'text', 'clip', 'from', 'seconds_left', 'completed', 'screen', 'ua', 'd_json'];
    var starts = {};
    state.sessions.forEach(function (s) { starts[s.sid] = s.start; });
    var rows = events().slice().sort(function (a, b) { return (a.sid > b.sid ? 1 : a.sid < b.sid ? -1 : 0) || a.t - b.t; }).map(function (e) {
      var d = e.d || {};
      return [e.id, e.sid, e.cond, e.page, e.type, e.t, e.t ? new Date(e.t).toISOString() : '', e.t - (starts[e.sid] || e.t),
        d.ms, d.tag, d.id, d.text, d.clip, d.from, d.secondsLeft, d.completed, d.screen, d.ua, d].map(csvCell).join(',');
    });
    download(prefix() + 'events-' + stamp() + '.csv', '﻿' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  }

  function exportSessionsCsv() {
    var head = ['sid', 'cond', 'start_iso', 'end_iso', 'duration_s', 'events', 'page_views', 'steps_reached', 'max_step', 'unit', 'spi_shown', 'spi_completed', 'finished', 'screen', 'ua'];
    var rows = state.sessions.slice().sort(function (a, b) { return a.start - b.start; }).map(function (s) {
      return [s.sid, s.cond, new Date(s.start).toISOString(), new Date(s.end).toISOString(), Math.round(s.dur / 1000), s.events.length, s.pages,
        s.steps, s.maxStep, COND[s.cond] ? COND[s.cond].unit : '', s.videos, s.videosDone, s.finished ? 1 : 0, s.screen, s.ua].map(csvCell).join(',');
    });
    download(prefix() + 'sessions-' + stamp() + '.csv', '﻿' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
  }

  function exportJson() {
    var payload = { format: 'acme-study-export', version: 1, sample: state.useSample, exported: new Date().toISOString(), count: events().length, events: events() };
    download(prefix() + stamp() + '.json', JSON.stringify(payload, null, 1), 'application/json');
  }

  function keyOf(e) { return [e.sid, e.t, e.type, e.page, JSON.stringify(e.d || {})].join('|'); }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); } catch (err) { toast('This file is not valid JSON.', true); return; }
      if (data && data.sample === true) { toast('This file contains sample data. It was not imported.', true); return; }
      var list = Array.isArray(data) ? data : data && Array.isArray(data.events) ? data.events : null;
      if (!list) { toast('No events found in this file.', true); return; }
      var seen = {};
      state.real.forEach(function (e) { seen[keyOf(e)] = 1; });
      var fresh = [], skipped = 0, bad = 0;
      list.forEach(function (e) {
        if (!e || typeof e.sid !== 'string' || typeof e.t !== 'number' || typeof e.type !== 'string') { bad++; return; }
        var clean = { sid: e.sid, t: e.t, cond: e.cond || '', page: e.page || '', type: e.type, d: e.d && typeof e.d === 'object' ? e.d : {} };
        var k = keyOf(clean);
        if (seen[k]) { skipped++; return; }
        seen[k] = 1; fresh.push(clean);
      });
      if (!fresh.length) { toast('Nothing new: ' + skipped + ' events were already here' + (bad ? ', ' + bad + ' not valid' : '') + '.', !!bad); return; }
      writeEvents(fresh).then(function (n) {
        state.useSample = false;
        return load().then(function () { toast(n + ' events imported' + (skipped ? ', ' + skipped + ' already here' : '') + (bad ? ', ' + bad + ' not valid' : '') + '.'); });
      }, function () { toast('Import failed: the database could not be written.', true); });
    };
    reader.readAsText(file);
  }

  var toastTimer;
  function toast(msg, warn) {
    var t = $('dv-toast');
    t.textContent = msg;
    t.className = 'dv-toast is-on' + (warn ? ' is-warn' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = 'dv-toast'; }, 4200);
  }

  function askDelete() {
    var n = state.real.length;
    $('dv-confirm-text').textContent = 'This deletes all ' + n + ' events of ' + buildSessions(state.real).length + ' sessions stored in this browser. It cannot be undone: export a JSON copy first.';
    $('dv-confirm-input').value = '';
    $('dv-confirm-ok').disabled = true;
    $('dv-confirm').classList.add('is-open');
    $('dv-confirm').setAttribute('aria-hidden', 'false');
    $('dv-confirm-input').focus();
  }

  function closeConfirm() {
    $('dv-confirm').classList.remove('is-open');
    $('dv-confirm').setAttribute('aria-hidden', 'true');
    $('dv-delete').focus();
  }

  /* ---------- wiring ---------- */

  function load() {
    return readAll().then(function (list) {
      state.real = list.filter(function (e) { return e && e.sid; });
      render();
    });
  }

  function setSample(on) {
    state.useSample = on;
    if (on && !state.sample) state.sample = makeSample();
    state.openSid = null;
    closeDrawer();
    render();
  }

  function init() {
    state.idb = idbAvailable();
    if (window.ACME_ANALYSIS) {
      window.ACME_ANALYSIS.init({
        COND: COND, TIMED: TIMED, stepOf: stepOf, isTimedOrder: isTimedOrder, esc: esc,
        sessions: function () { return state.sessions; }, isSample: function () { return state.useSample; },
        toast: function (m, w) { toast(m, w); }, download: download, csvCell: csvCell, stamp: stamp, prefix: function () { return prefix(); },
        refresh: function () { render(); }
      });
    }

    $('dv-sample').addEventListener('change', function () { setSample(this.checked); });
    $('dv-empty-sample').addEventListener('click', function () { setSample(true); });
    $('dv-empty-import').addEventListener('click', function () { $('dv-file').click(); });
    $('dv-sample-off').addEventListener('click', function () { setSample(false); });
    $('dv-refresh').addEventListener('click', function () { load().then(function () { toast(state.useSample ? 'Showing sample data. Real data reloaded in the background.' : 'Data reloaded.'); }); });
    $('dv-search').addEventListener('input', function () { state.query = this.value; renderTable(); });
    $('dv-filter').addEventListener('change', function () { state.cond = this.value; renderTable(); });

    Array.prototype.forEach.call(document.querySelectorAll('#dv-table thead th[data-key]'), function (th) {
      var btn = th.querySelector('button');
      btn.addEventListener('click', function () {
        var k = th.getAttribute('data-key');
        if (state.sort.key === k) state.sort.dir = -state.sort.dir;
        else { state.sort.key = k; state.sort.dir = (k === 'sid' || k === 'cond') ? 1 : -1; }
        renderTable();
      });
    });

    $('dv-tbody').addEventListener('click', function (ev) {
      var tr = ev.target.closest('tr[data-sid]');
      if (tr) openDrawer(tr.getAttribute('data-sid'));
    });
    $('dv-tbody').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var tr = ev.target.closest('tr[data-sid]');
      if (tr) { ev.preventDefault(); openDrawer(tr.getAttribute('data-sid')); }
    });
    $('dv-d-close').addEventListener('click', closeDrawer);
    $('dv-scrim').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if ($('dv-confirm').classList.contains('is-open')) closeConfirm();
      else if (state.openSid) closeDrawer();
    });

    $('dv-exp-events').addEventListener('click', exportEventsCsv);
    $('dv-exp-sessions').addEventListener('click', exportSessionsCsv);
    $('dv-exp-json').addEventListener('click', exportJson);
    $('dv-import').addEventListener('click', function () {
      if (!state.idb) { toast('IndexedDB is not available in this browser: import is not possible.', true); return; }
      $('dv-file').click();
    });
    $('dv-file').addEventListener('change', function () {
      if (this.files && this.files[0]) importJson(this.files[0]);
      this.value = '';
    });
    $('dv-delete').addEventListener('click', askDelete);
    $('dv-confirm-input').addEventListener('input', function () { $('dv-confirm-ok').disabled = this.value.trim().toUpperCase() !== 'DELETE'; });
    $('dv-confirm-cancel').addEventListener('click', closeConfirm);
    $('dv-confirm').addEventListener('click', function (ev) { if (ev.target === this) closeConfirm(); });
    $('dv-confirm-ok').addEventListener('click', function () {
      clearAll().then(function () { closeConfirm(); return load(); }).then(function () { toast('All events deleted from this browser.'); },
        function () { toast('Delete failed.', true); });
    });

    // export buttons only make sense with data on screen
    var refreshButtons = function () {
      var none = !events().length;
      ['dv-exp-events', 'dv-exp-sessions', 'dv-exp-json'].forEach(function (id) { $(id).disabled = none; });
    };
    var _render = render;
    render = function () { _render(); refreshButtons(); };

    // the logger may write while this page is open in another tab: reload when coming back
    document.addEventListener('visibilitychange', function () { if (!document.hidden && !state.useSample) load(); });

    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // read-only hook for tests and the console
  window.ACME_DATA_VIEW = { reload: function () { return load(); }, sample: setSample, state: state };
})();
