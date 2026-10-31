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

  open();
})();
