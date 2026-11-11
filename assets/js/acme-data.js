/* Passive data logger for the experiment pages. It only records, it never changes the task.
   Events go to IndexedDB "acme-study", store "events": { sid, t, cond, page, type, d }.
   The session code is the ?pid= value of the first page, or a random one (kept for the tab session). */
(function () {
  var CONDS = ['obj_spi_colleghi', 'obj_spi_clienti', 'obj_spi_test_cond', 'obj_cond', 'not_obj_cond', 'control'];
  var parts = location.pathname.split('/');
  var cond = null, page = location.pathname;
  for (var i = 0; i < parts.length; i++) {
    if (CONDS.indexOf(parts[i]) !== -1) { cond = parts[i]; page = parts.slice(i).join('/'); break; }
  }
  if (!cond) return;

  function store(k, v) { try { if (v === undefined) return sessionStorage.getItem(k); sessionStorage.setItem(k, v); } catch (e) {} return null; }

  var sid = store('acme-sid');
  var fromUrl = (location.search.match(/[?&]pid=([^&]+)/) || [])[1];
  if (!sid) {
    sid = fromUrl ? decodeURIComponent(fromUrl).slice(0, 24) : 'P-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    store('acme-sid', sid);
  }

  var db = null, queue = [], opening = false;
  function open() {
    if (db || opening || !window.indexedDB) return;
    opening = true;
    var req = indexedDB.open('acme-study', 1);
    req.onupgradeneeded = function () {
      var s = req.result.createObjectStore('events', { keyPath: 'id', autoIncrement: true });
      s.createIndex('sid', 'sid', { unique: false });
    };
    req.onsuccess = function () { db = req.result; opening = false; flush(); };
    req.onerror = function () { opening = false; };
  }
  function flush() {
    if (!db || !queue.length) return;
    var tx = db.transaction('events', 'readwrite'), s = tx.objectStore('events');
    while (queue.length) s.add(queue.shift());
  }
  function log(type, d, t) {
    queue.push({ sid: sid, t: t || Date.now(), cond: cond, page: page, type: type, d: d || {} });
    open(); flush();
  }

  // The leave event of the previous page was parked in sessionStorage (writing to IndexedDB during unload is not reliable).
  try {
    var parked = sessionStorage.getItem('acme-parked');
    if (parked) { queue.push(JSON.parse(parked)); sessionStorage.removeItem('acme-parked'); }
  } catch (e) {}

  var t0 = Date.now();
  if (!store('acme-started')) {
    store('acme-started', '1');
    log('session_start', { screen: screen.width + 'x' + screen.height, ua: navigator.userAgent.slice(0, 120) }, t0);
  }
  log('page_view', {}, t0);
  if (/end_task\.html$/.test(page)) log('end_task', {}, t0);

  function park() {
    try {
      sessionStorage.setItem('acme-parked', JSON.stringify({ sid: sid, t: Date.now(), cond: cond, page: page, type: 'page_leave', d: { ms: Date.now() - t0 } }));
    } catch (e) {}
  }
  window.addEventListener('pagehide', park);

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('a,button,input,select,label,[onclick]') : null;
    if (!el) return;
    log('click', { tag: el.tagName.toLowerCase(), id: el.id || '', text: (el.value || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40) });
  }, true);

  window.addEventListener('spi:shown', function (e) { log('spi_shown', e.detail || {}); });
  window.addEventListener('spi:ended', function (e) { log('spi_ended', e.detail || {}); });

  /* ---------- Logger version 2: additions only ----------
     Everything above is unchanged: same event types, same fields, same database and store.
     The events below are new types. They only read what is already on the page (form values, the
     video element, the visibility of the tab) and never change what the participant sees or does.
       env           once per session: viewport, pixel ratio, language, logger version
       visibility    the tab was hidden / came back (ms = time hidden)
       focus         the window lost / got back the keyboard focus (ms = time away)
       order_state   the order or ticket form when "send" is pressed (at: submit) and when the page is left (at: leave)
       spi_play      the SPI video really started to play (delay from the pop-up, muted or not)
       spi_exposure  how long the SPI video played, if it ended, how much of the pop-up was on screen
       game_start, game_end   control game trial (sent by control/game/ringcourt.js)
       js_error      a script error on the page
     Events that are only known when the page is left are parked in sessionStorage, like page_leave. */
  var VERSION = 2;
  var leaving = false, extras = [];
  function parkExtra(type, d) { extras.push({ sid: sid, t: Date.now(), cond: cond, page: page, type: type, d: d || {} }); }
  function round1(x) { return Math.round(x * 10) / 10; }

  try {
    var more = sessionStorage.getItem('acme-parked-x');
    if (more) {
      sessionStorage.removeItem('acme-parked-x');
      var list = JSON.parse(more);
      for (var q = 0; q < list.length; q++) queue.push(list[q]);
    }
  } catch (e) {}

  if (!store('acme-env')) {
    store('acme-env', '1');
    log('env', { v: VERSION, vw: window.innerWidth, vh: window.innerHeight, dpr: window.devicePixelRatio || 1, lang: navigator.language || '', tz: new Date().getTimezoneOffset() }, t0);
  }

  // Tab hidden or shown again. The change that comes with leaving the page is not logged (page_leave covers it).
  var hidAt = document.hidden ? t0 : 0, hiddenMs = 0;
  function hiddenTotal() { return hiddenMs + (hidAt ? Date.now() - hidAt : 0); }
  document.addEventListener('visibilitychange', function () {
    if (leaving) return;
    if (document.hidden) { hidAt = Date.now(); log('visibility', { state: 'hidden' }); }
    else { var ms = hidAt ? Date.now() - hidAt : 0; hiddenMs += ms; hidAt = 0; log('visibility', { state: 'visible', ms: ms }); }
  });

  // Window focus. Moving into a frame of the same page (the reply editor) keeps document.hasFocus() true and is not logged.
  var blurAt = 0;
  window.addEventListener('blur', function () {
    setTimeout(function () {
      if (leaving || blurAt || document.hasFocus()) return;
      blurAt = Date.now(); log('focus', { on: false });
    }, 0);
  });
  window.addEventListener('focus', function () {
    if (!blurAt) return;
    log('focus', { on: true, ms: Date.now() - blurAt }); blurAt = 0;
  });

  // Order and ticket pages: what is in the form. Only read, never written.
  var sends = 0;
  function orderState(at) {
    var form = document.getElementById('ordine'), reply = document.getElementById('mytextarea');
    if (!form && !reply) return null;
    var d = { at: at, sends: sends };
    var m = /(\d+)(?:_[a-z_0-9]+)?\.html$/.exec(page);
    if (m) d.n = +m[1];
    var price = document.getElementById('price'), days = document.getElementById('days');
    var left = document.getElementById('countdown'), budget = document.getElementById('budget');
    if (price) d.price = parseFloat(price.textContent) || 0;
    if (days) d.days = parseInt(days.textContent, 10) || 0;
    if (left) { var l = parseInt(left.textContent, 10); d.left = isNaN(l) ? null : l; }
    if (budget) {
      var nums = (budget.textContent.match(/\d+(?:[.,]\d+)?/g) || []).slice(0, 2);
      for (var i = 0; i < nums.length; i++) nums[i] = parseFloat(nums[i].replace(',', '.'));
      if (nums.length) d.budget = nums;
    }
    if (form) {
      d.sel = []; d.chk = [];
      var sel = form.getElementsByTagName('select'), inp = form.getElementsByTagName('input');
      for (var a = 0; a < sel.length; a++) d.sel.push(sel[a].value);
      for (var b = 0; b < inp.length; b++) if (inp[b].type === 'checkbox' && inp[b].checked) d.chk.push(inp[b].id || inp[b].name || '');
    }
    if (reply) {
      try {
        var ed = window.tinyMCE && window.tinyMCE.get('mytextarea');
        var txt = (ed ? ed.getContent({ format: 'text' }) : reply.value || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
        d.chars = txt.length; d.words = txt ? txt.split(' ').length : 0;   // length only: the text itself is never stored
      } catch (e) {}
    }
    return d;
  }
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('#evadi') : null;
    if (!el) return;
    var d = orderState('submit');
    sends++;
    if (d) log('order_state', d);
  }, true);

  // SPI video: did it really play, for how long, and was the pop-up on screen.
  var spi = null;
  function finishSpi(at) {
    if (!spi) return null;
    var s = spi, v = s.v; spi = null;
    return { clip: s.clip, at: at, played: round1(v.currentTime || 0), dur: isFinite(v.duration) ? round1(v.duration) : null,
      ended: !!v.ended, started: s.started, delay: s.delay, muted: !!v.muted, stalls: s.stalls,
      vis: s.vis, w: s.w, h: s.h, hidden: hiddenTotal() - s.hid0 };
  }
  window.addEventListener('spi:shown', function (e) {
    var boxes = document.getElementsByClassName('spi-popup'), box = boxes[boxes.length - 1];
    var v = box && box.getElementsByTagName('video')[0];
    if (!v) return;
    var old = finishSpi('replaced');
    if (old) log('spi_exposure', old);
    var s = spi = { clip: (e.detail || {}).clip || '', v: v, t: Date.now(), started: false, delay: null, stalls: 0, vis: null, w: 0, h: 0, hid0: hiddenTotal() };
    function playing() {
      if (s.started) return;
      s.started = true; s.delay = Date.now() - s.t;
      log('spi_play', { clip: s.clip, delay: s.delay, muted: !!v.muted });
    }
    if (!v.paused && v.currentTime > 0) playing();
    v.addEventListener('playing', playing);
    v.addEventListener('waiting', function () { if (s.started) s.stalls++; });
    v.addEventListener('ended', function () { if (spi === s) log('spi_exposure', finishSpi('end')); });
    v.addEventListener('error', function () { if (spi === s) log('spi_exposure', finishSpi('error')); });
    // after the entrance fade (0.5 s): size of the pop-up and share of it inside the window
    setTimeout(function () {
      if (!box.parentNode) return;
      var r = box.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
      var iw = Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)), ih = Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0));
      s.w = Math.round(r.width); s.h = Math.round(r.height);
      s.vis = r.width && r.height ? Math.round(iw * ih / (r.width * r.height) * 100) / 100 : 0;
    }, 700);
  });

  // Control game trials (control/game/ringcourt.js sends these two events).
  window.addEventListener('ctrl:start', function (e) { log('game_start', e.detail || {}); });
  window.addEventListener('ctrl:end', function (e) { log('game_end', e.detail || {}); });

  var errors = 0;
  window.addEventListener('error', function (e) {
    if (!e || !e.message || errors++ >= 5) return;
    log('js_error', { msg: String(e.message).slice(0, 120), src: String(e.filename || '').split('/').pop().slice(0, 40), line: e.lineno || 0 });
  });

  window.addEventListener('pagehide', function () {
    leaving = true;
    try {
      var st = orderState('leave');
      if (st) parkExtra('order_state', st);
      var sx = finishSpi('leave');
      if (sx) parkExtra('spi_exposure', sx);
      // other scripts of the page (the control game) can add their last event here
      window.dispatchEvent(new CustomEvent('acme:collect', { detail: { push: parkExtra } }));
      if (extras.length) sessionStorage.setItem('acme-parked-x', JSON.stringify(extras));
    } catch (e) {}
  });
  window.addEventListener('pageshow', function (e) { if (e.persisted) { leaving = false; extras = []; } });

  open();
})();
