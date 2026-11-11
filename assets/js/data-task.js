/* ACME study: task checks for data.html (experimenter only).
   Turns the events of each session into one row per order, ticket or game trial, and checks what a thesis
   analysis needs to know before trusting a session: did every timed page last what it should, which orders
   were not sent, did each SPI video really play and for how long, was the tab hidden, was the game played.
   Reads the sessions built by data-view.js. It never writes to the event database. No network, no libraries.

   Sessions recorded before logger version 2 (assets/js/acme-data.js) have no order_state, spi_play,
   spi_exposure, visibility, focus and game_end events: for them the new columns are simply empty. */
(function () {
  'use strict';

  var host = null;
  var st = { tab: 'flags', group: '' };
  var TOL = 2;            // seconds of difference from the planned length of a timed page before it is reported
  var HIDDEN_FLAG = 5;    // seconds with the tab hidden before a session is reported
  var VIS_MIN = 0.9;      // share of the SPI pop-up that must be inside the window

  var FLAGS = [
    { key: 'merged', label: 'Two runs under one code', hint: 'More than one start, more than one condition, or the instructions opened again after the task had begun. The code was probably reused in the same browser tab: the data of two people may be mixed.' },
    { key: 'reload', label: 'Page loaded twice', hint: 'An order, ticket or level page was opened more than once (reload or back button). In the timed conditions this restarts the countdown of that order.' },
    { key: 'sequence', label: 'Pages out of order', hint: 'The steps were not visited one after the other (a step is missing or was visited in another order).' },
    { key: 'timing', label: 'Timed page off schedule', hint: 'A timed order or a game trial lasted over ' + TOL + ' s more or less than planned. Typical cause: the tab was in the background and the browser slowed the timers down.' },
    { key: 'hidden', label: 'Tab hidden during the task', hint: 'The tab was hidden for more than ' + HIDDEN_FLAG + ' s in total (other tab, minimised window, locked screen). Needs logger version 2.' },
    { key: 'spi', label: 'SPI exposure incomplete', hint: 'SPI condition where a planned video was not shown, did not start, did not play to the end, played without sound, or the pop-up was partly outside the window.' },
    { key: 'small', label: 'Window under 900 px', hint: 'The window was narrower than 900 px: the task is stacked in one column and the SPI video is shown as a slim bar at the bottom instead of the card in the side area.' },
    { key: 'idle', label: 'Task not worked', hint: 'Timed condition with no order sent at all, or control condition with one or more trials without any input.' },
    { key: 'error', label: 'Script error', hint: 'The browser reported a script error on a task page. Needs logger version 2.' }
  ];
  var FLAG_LABEL = {};
  FLAGS.forEach(function (f) { FLAG_LABEL[f.key] = f.label; });

  function esc(s) { return host.esc(s); }
  function mean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : null; }
  function sd(a) { if (a.length < 2) return null; var m = mean(a); return Math.sqrt(a.reduce(function (x, y) { return x + (y - m) * (y - m); }, 0) / (a.length - 1)); }
  function f(x, d) { return x == null || !isFinite(x) ? '<span class="dv-dim">-</span>' : x.toFixed(d == null ? 1 : d); }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '<span class="dv-dim">-</span>'; }
  function isTimed(s) { return host.TIMED.indexOf(s.cond) !== -1; }
  function isSpi(s) { return s.cond === 'obj_spi_colleghi' || s.cond === 'obj_spi_clienti' || s.cond === 'obj_spi_test_cond'; }
  function planned(s, n) { return isTimed(s) ? (host.LIMIT[n - 1] || 30) + 1 : s.cond === 'control' ? 121 : null; }

  /* ---------- model: one object per session, one row per step ---------- */

  function compute(s) {
    var T = { v2: false, vw: null, vh: null, steps: [], flags: [], why: {}, hidden: 0, away: 0, errors: 0, starts: 0, intro: 0, restart: false, seq: [], tools: 0 };
    var by = {}, conds = {}, lastStep = null;
    function step(n, page) {
      if (!by[n]) { by[n] = { n: n, page: page, views: 0, view: null, on: null, clicks: 0, sent: null, sends: 0, hidden: 0, tools: 0 }; T.steps.push(by[n]); }
      return by[n];
    }
    s.events.forEach(function (e) {
      var d = e.d || {}, n = host.stepOf(e.page), x = n != null ? step(n, e.page) : null;
      if (e.cond) conds[e.cond] = 1;
      switch (e.type) {
        case 'session_start': T.starts++; break;
        case 'env': if (d.v >= 2) T.v2 = true; T.vw = d.vw || null; T.vh = d.vh || null; break;
        case 'page_view':
          if (x) { x.views++; x.view = e.t; x.sent = null; T.seq.push(n); lastStep = x; }
          else if (/acme_shop_[a-z0-9_]*\.html$/.test(e.page || '')) { T.intro++; if (T.seq.length) T.restart = true; }
          else if (lastStep && /catalogue|calendar|help_desk/.test(e.page || '')) { lastStep.tools++; T.tools++; }
          break;
        case 'page_leave': if (x && d.ms != null) x.on = d.ms / 1000; break;
        case 'click':
          if (!x) break;
          x.clicks++;
          if (d.id === 'evadi') { x.sends++; if (x.sent == null && x.view != null) x.sent = (e.t - x.view) / 1000; }
          break;
        case 'order_state':
          if (!x) break;
          if (d.at === 'submit' && (x.price == null || d.chars > 0)) {
            x.price = d.price; x.days = d.days; x.left = d.left; x.picks = (d.sel || []).filter(function (v) { return v && v !== '0'; }).length + (d.chk || []).length;
            if (d.budget) { x.lo = d.budget[0]; x.hi = d.budget.length > 1 ? d.budget[1] : d.budget[0]; }
            if (d.chars != null) { x.chars = d.chars; x.words = d.words; }
          } else if (d.at === 'leave') {
            x.finalPrice = d.price;
            if (x.chars == null && d.chars != null) { x.chars = d.chars; x.words = d.words; }
          }
          break;
        case 'spi_shown': if (x) { x.spi = x.spi || { shown: 0 }; x.spi.shown++; x.spi.clip = d.clip; x.spi.from = d.from; x.spi.left = d.secondsLeft; x.spi.t = x.view != null ? (e.t - x.view) / 1000 : null; } break;
        case 'spi_ended': if (x && x.spi && d.completed === true) x.spi.completed = true; break;
        case 'spi_play': if (x && x.spi) { x.spi.started = true; x.spi.delay = d.delay; x.spi.muted = !!d.muted; } break;
        case 'spi_exposure':
          if (x && x.spi) { x.spi.v2 = true; x.spi.played = d.played; x.spi.dur = d.dur; x.spi.ended = !!d.ended; x.spi.vis = d.vis; x.spi.w = d.w; x.spi.muted = !!d.muted; x.spi.at = d.at; x.spi.stalls = d.stalls || 0; if (d.started) x.spi.started = true; }
          break;
        case 'visibility': if (d.state === 'visible' && d.ms > 0) { T.hidden += d.ms / 1000; if (x) x.hidden += d.ms / 1000; } break;
        case 'focus': if (d.on === true && d.ms > 0) T.away += d.ms / 1000; break;
        case 'game_end': if (x) x.game = d; break;
        case 'js_error': T.errors++; break;
      }
    });
    T.steps.sort(function (a, b) { return a.n - b.n; });

    var timed = isTimed(s), spi = isSpi(s), ctrl = s.cond === 'control';
    function flag(k, why) { if (T.flags.indexOf(k) === -1) T.flags.push(k); (T.why[k] = T.why[k] || []).push(why); }

    // derived values per step
    var done = 0, sentN = 0, missed = [], off = [], gaps = [], lefts = [], words = [];
    T.steps.forEach(function (x) {
      var p = planned(s, x.n);
      x.planned = p;
      x.dev = p != null && x.on != null ? x.on - p : null;
      if (x.dev != null && Math.abs(x.dev) > TOL) off.push(x.n);
      if (x.price != null && x.lo != null) x.gap = x.price < x.lo ? x.lo - x.price : x.price > x.hi ? x.price - x.hi : 0;
      if (timed && x.on != null) {
        done++;
        if (x.sent != null) { sentN++; if (x.gap != null) gaps.push(x.gap); if (x.left != null) lefts.push(x.left); }
        else missed.push(x.n);
      }
      if (x.words != null && x.sends) words.push(x.words);
    });
    T.done = done; T.sentN = sentN; T.missed = missed; T.off = off;
    T.submitRate = done ? sentN / done * 100 : null;
    T.gap = mean(gaps); T.left = mean(lefts); T.words = mean(words);

    // SPI exposure
    if (spi) {
      var expected = s.cond === 'obj_spi_test_cond' ? null : host.SPI_ORDERS.filter(function (n) { return by[n] && (by[n].on != null || s.finished); });
      var shown = T.steps.filter(function (x) { return x.spi; });
      T.spi = { expected: expected ? expected.length : shown.length, shown: shown.length, started: 0, ended: 0, played: [], v2: 0, bad: [] };
      shown.forEach(function (x) {
        var v = x.spi;
        if (v.v2) T.spi.v2++;
        if (v.started) T.spi.started++;
        if (v.ended || v.completed) T.spi.ended++;
        if (v.played != null) T.spi.played.push(v.played);
        if (v.v2 && !v.started) T.spi.bad.push('order ' + x.n + ': video did not start');
        else if (!(v.ended || v.completed)) T.spi.bad.push('order ' + x.n + ': not played to the end' + (v.played != null ? ' (' + v.played + ' s)' : ''));
        if (v.v2 && v.muted) T.spi.bad.push('order ' + x.n + ': played without sound');
        if (v.vis != null && v.vis < VIS_MIN) T.spi.bad.push('order ' + x.n + ': ' + Math.round(v.vis * 100) + '% of the pop-up inside the window');
      });
      if (expected) expected.forEach(function (n) { if (!by[n].spi) T.spi.bad.push('order ' + n + ': no video shown'); });
      T.spi.bad.forEach(function (w) { flag('spi', w); });
    }

    // control game
    if (ctrl) {
      var g = T.steps.filter(function (x) { return x.game; });
      T.game = { trials: g.length, score: mean(g.map(function (x) { return x.game.score || 0; })), tiles: mean(g.map(function (x) { return x.game.tiles || 0; })),
        lost: mean(g.map(function (x) { return x.game.lost || 0; })), active: mean(g.map(function (x) { return x.game.active || 0; })),
        idle: g.filter(function (x) { return !x.game.launches; }).map(function (x) { return x.n; }) };
      if (T.game.idle.length) flag('idle', 'no input in level ' + T.game.idle.join(', '));
    }

    // session flags
    if (T.starts > 1) flag('merged', T.starts + ' session starts');
    if (Object.keys(conds).length > 1) flag('merged', 'events from ' + Object.keys(conds).length + ' conditions');
    if (T.restart) flag('merged', 'instructions opened again after the task had begun');
    var twice = T.steps.filter(function (x) { return x.views > 1; }).map(function (x) { return x.n; });
    if (twice.length) flag('reload', 'step ' + twice.join(', '));
    var seqOk = true;
    for (var i = 0; i < T.seq.length; i++) if (T.seq[i] !== (i ? T.seq[i - 1] + 1 : 1) && !(i && T.seq[i] === T.seq[i - 1])) seqOk = false;
    if (!seqOk) flag('sequence', 'visited: ' + T.seq.join(' ').slice(0, 80));
    if (off.length) flag('timing', 'step ' + off.join(', '));
    if (T.hidden > HIDDEN_FLAG) flag('hidden', Math.round(T.hidden) + ' s hidden');
    var w = T.vw || (s.screen ? parseInt(s.screen, 10) : null);
    if (w && w < 900 && (timed || T.vw)) flag('small', (T.vw ? 'window ' : 'screen ') + w + ' px wide');
    if (timed && done >= 5 && sentN === 0) flag('idle', 'no order sent in ' + done + ' orders');
    if (T.errors) flag('error', T.errors + ' script errors');
    s.task = T;
    return T;
  }

  function build(sessions) { sessions.forEach(compute); }

  // measures for the Analysis section (data-analysis.js adds them to its own)
  function metrics(s) {
    var T = s.task || compute(s), m = {};
    if (isTimed(s) && T.done) m.missed = T.missed.length;
    if (T.gap != null) m.gap = T.gap;
    if (T.v2) m.hidden = T.hidden;
    if (T.words != null) m.words = T.words;
    if (T.game && T.game.trials) { m.gscore = T.game.score; m.gactive = T.game.active; }
    if (T.spi && T.spi.played.length) m.vplayed = mean(T.spi.played);
    return m;
  }

  /* ---------- render ---------- */

  function sessions() { return host.sessions(); }
  function chips(list) {
    if (!list.length) return '<span class="dv-dim">none</span>';
    return list.slice(0, 40).map(function (s) { return '<button type="button" class="dv-code dv-tk-chip" data-tk-sid="' + esc(s.sid) + '" title="' + esc((s.task.flags.map(function (k) { return FLAG_LABEL[k] + ': ' + s.task.why[k].join('; '); })).join('\n')) + '">' + esc(s.sid) + '</button>'; }).join(' ') +
      (list.length > 40 ? ' <span class="dv-dim">+' + (list.length - 40) + '</span>' : '');
  }
  function table(head, rows, cls) {
    return '<div class="dv-table-wrap"><table class="dv-table dv-an-table ' + (cls || '') + '"><thead><tr>' + head.map(function (h) { return '<th scope="col" class="dv-th-plain">' + h + '</th>'; }).join('') +
      '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }
  function tr(cells, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cells.map(function (c, i) { return '<td' + (i ? ' class="dv-num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }
  function note(t) { return '<p class="dv-an-intro dv-tk-note">' + t + '</p>'; }

  function tiles() {
    var all = sessions(), flagged = all.filter(function (s) { return s.task.flags.length; });
    var timed = all.filter(isTimed), done = 0, missed = 0;
    timed.forEach(function (s) { done += s.task.done; missed += s.task.missed.length; });
    var spi = all.filter(function (s) { return s.task.spi; }), exp = 0, ended = 0;
    spi.forEach(function (s) { exp += s.task.spi.expected; ended += s.task.spi.ended; });
    var v2 = all.filter(function (s) { return s.task.v2; });
    var hid = v2.filter(function (s) { return s.task.hidden > HIDDEN_FLAG; }).length;
    var game = all.filter(function (s) { return s.task.game && s.task.game.trials; }), trials = 0, idle = 0;
    game.forEach(function (s) { trials += s.task.game.trials; idle += s.task.game.idle.length; });
    var t = [
      ['Sessions to check', flagged.length, 'of ' + all.length + ' have one flag or more'],
      ['Orders not sent', done ? Math.round(missed / done * 100) + '%' : '-', done ? missed + ' of ' + done + ' timed orders' : 'no timed orders'],
      ['SPI videos to the end', exp ? ended + '/' + exp : '-', exp ? 'planned videos played to the end' : 'no SPI sessions'],
      ['Tab hidden', v2.length ? hid : '-', v2.length ? 'sessions over ' + HIDDEN_FLAG + ' s, of ' + v2.length + ' with logger v2' : 'needs logger version 2'],
      ['Game trials played', trials ? Math.round((trials - idle) / trials * 100) + '%' : '-', trials ? (trials - idle) + ' of ' + trials + ' trials with input' : 'no game trials logged']
    ];
    return '<div class="dv-kpis dv-tk-kpis">' + t.map(function (x, i) {
      return '<div class="dv-kpi"><span class="dv-kpi-idx">' + (i < 9 ? '0' : '') + (i + 1) + '</span><span class="dv-kpi-label">' + esc(x[0]) + '</span><strong class="dv-kpi-value">' + esc(x[1]) + '</strong><span class="dv-kpi-hint">' + esc(x[2]) + '</span></div>';
    }).join('') + '</div>';
  }

  function tabFlags() {
    var all = sessions();
    var rows = FLAGS.map(function (F) {
      var list = all.filter(function (s) { return s.task.flags.indexOf(F.key) !== -1; });
      return '<tr class="' + (list.length ? '' : 'dv-an-off') + '"><td><strong>' + esc(F.label) + '</strong><span class="dv-st-hint">' + esc(F.hint) + '</span></td><td class="dv-num">' + list.length + '</td><td>' + chips(list) + '</td></tr>';
    });
    var old = all.filter(function (s) { return !s.task.v2; }).length;
    return note('Each row is one kind of problem. A flag does not exclude a session: it tells you which sessions to open before deciding. Click a code to see the session. To exclude by rule, use the Data quality tab of the questionnaire study, where three rules read these flags.') +
      table(['Check', 'Sessions', 'Codes'], rows, 'dv-tk-flags') +
      (old ? note(old + ' of ' + all.length + ' sessions were recorded before logger version 2: for them the form, exposure, visibility and game data do not exist, so the checks that need them stay silent.') : '');
  }

  function groupSelect(keys) {
    var C = host.COND;
    return '<div class="dv-an-controls"><label class="dv-select"><span class="dv-visually-hidden">Condition</span><select data-tk-group>' +
      '<option value="">All timed conditions</option>' + keys.map(function (k) { return '<option value="' + k + '"' + (st.group === k ? ' selected' : '') + '>' + esc(C[k].label) + '</option>'; }).join('') +
      '</select></label></div>';
  }
  function pick(keys) {
    if (keys.indexOf(st.group) === -1) st.group = '';
    return sessions().filter(function (s) { return st.group ? s.cond === st.group : keys.indexOf(s.cond) !== -1; });
  }
  function collect(list) {       // n -> array of steps
    var by = {};
    list.forEach(function (s) { s.task.steps.forEach(function (x) { (by[x.n] = by[x.n] || []).push(x); }); });
    return by;
  }
  function vals(a, k) { return a.map(function (x) { return x[k]; }).filter(function (v) { return v != null && isFinite(v); }); }

  function tabOrders() {
    var list = pick(host.TIMED), by = collect(list), rows = [];
    for (var n = 1; n <= 33; n++) {
      var a = (by[n] || []).filter(function (x) { return x.on != null; });
      if (!a.length) { rows.push(tr([n, (host.LIMIT[n - 1] || 30), '<span class="dv-dim">0</span>', '-', '-', '-', '-', '-', '-', '-', '-'], 'dv-an-off')); continue; }
      var sent = a.filter(function (x) { return x.sent != null; }), ts = vals(sent, 'sent'), off = a.filter(function (x) { return x.dev != null && Math.abs(x.dev) > TOL; }).length;
      var spi = a.filter(function (x) { return x.spi; }).length;
      rows.push(tr([n + (host.SPI_ORDERS.indexOf(n) !== -1 ? ' <span class="dv-tk-spi" title="SPI order">SPI</span>' : ''), (host.LIMIT[n - 1] || 30), a.length, f(mean(vals(a, 'on'))),
        off ? '<span class="dv-tk-warn">' + off + '</span>' : '0', pct(sent.length, a.length), f(mean(ts)), f(sd(ts)), f(mean(vals(sent, 'left'))), f(mean(vals(sent, 'gap')), 0), spi ? spi : '<span class="dv-dim">0</span>']));
    }
    return note('One row per order, over the sessions of the chosen condition. "On page" is the real length of the page (limit + 1 s of fade). "Off schedule" counts the pages that lasted over ' + TOL + ' s more or less than planned. "Sent" is the share of orders with a click on the send button; the others ran out of time. "Seconds left" and "Budget gap" (euro between the cost of the order and the budget of the customer, 0 when inside the range) need logger version 2.') +
      groupSelect(host.TIMED) +
      table(['Order', 'Limit s', 'Sessions', 'On page s', 'Off schedule', 'Sent', 'To send s', 'SD', 'Seconds left', 'Budget gap €', 'Videos shown'], rows, 'dv-tk-orders');
  }

  function tabSpi() {
    var list = sessions().filter(function (s) { return s.task.spi; }), clips = {}, rows = [];
    list.forEach(function (s) { s.task.steps.forEach(function (x) { if (x.spi) (clips[x.spi.clip || '?'] = clips[x.spi.clip || '?'] || []).push(x.spi); }); });
    Object.keys(clips).sort().forEach(function (k) {
      var a = clips[k], v2 = a.filter(function (v) { return v.v2; });
      rows.push(tr(['<span class="dv-code">' + esc(k) + '</span>', a.length, v2.length ? pct(v2.filter(function (v) { return v.started; }).length, v2.length) : '-', pct(a.filter(function (v) { return v.ended || v.completed; }).length, a.length),
        f(mean(vals(v2, 'played'))), f(mean(vals(v2, 'dur'))), f(mean(vals(a, 'delay')), 0), v2.length ? v2.filter(function (v) { return v.muted; }).length : '-',
        v2.length ? f(mean(vals(v2, 'vis')) == null ? null : mean(vals(v2, 'vis')) * 100, 0) : '-', f(mean(vals(a, 't')))]));
    });
    var per = list.map(function (s) {
      var p = s.task.spi, ok = !p.bad.length;
      return '<tr><td><button type="button" class="dv-code dv-tk-chip" data-tk-sid="' + esc(s.sid) + '">' + esc(s.sid) + '</button></td><td>' + esc(host.COND[s.cond].short) + '</td><td class="dv-num">' + p.shown + ' / ' + p.expected + '</td><td class="dv-num">' + p.ended + '</td><td class="dv-num">' +
        f(p.played.length ? p.played.reduce(function (x, y) { return x + y; }, 0) : null) + '</td><td>' + (ok ? '<span class="dv-state dv-state--done">Complete</span>' : '<span class="dv-tk-warn">' + esc(p.bad.join('; ')) + '</span>') + '</td></tr>';
    });
    if (!list.length) return note('No session of an SPI condition in these data.');
    return note('Manipulation check for the small positive interactions. A video counts as seen only if it started and played to the end with the pop-up inside the window. "Delay" is the time between the pop-up and the first frame (loading time of the clip). "At second" is when the pop-up appeared after the order opened. Started, played, length, delay, sound and window need logger version 2.') +
      table(['Clip', 'Shown', 'Started', 'To the end', 'Played s', 'Length s', 'Delay ms', 'No sound', 'In window %', 'At second'], rows, 'dv-tk-clips') +
      '<p class="dv-mono-label dv-tk-sub">Per session</p>' +
      table(['Code', 'Condition', 'Shown / planned', 'To the end', 'Seconds played', 'Exposure'], per, 'dv-tk-left2 dv-tk-per');
  }

  function tabTickets() {
    var list = sessions().filter(function (s) { return s.cond === 'not_obj_cond'; }), by = collect(list), rows = [];
    if (!list.length) return note('No session of the not objectifying condition in these data.');
    for (var n = 1; n <= 16; n++) {
      var a = (by[n] || []).filter(function (x) { return x.on != null; });
      if (!a.length) { rows.push(tr([n, '<span class="dv-dim">' + esc(host.NOT_OBJ_PAGES[n - 1] || '') + '</span>', '<span class="dv-dim">0</span>', '-', '-', '-', '-'], 'dv-an-off')); continue; }
      var on = vals(a, 'on');
      rows.push(tr([n, '<span class="dv-dim">' + esc(host.NOT_OBJ_PAGES[n - 1] || '') + '</span>', a.length, f(mean(on) / 60, 2), f(sd(on) == null ? null : sd(on) / 60, 2),
        f(mean(vals(a, 'words')), 0), f(mean(vals(a, 'tools')), 1)]));
    }
    return note('One row per ticket. There is no time limit here, so the length of each ticket is a result, not a check. "Reply words" is the length of the answer when it was sent (the text itself is never stored; needs logger version 2). "Tool windows" counts the catalogue, calendar and helpdesk windows opened during the ticket.') +
      table(['Ticket', 'Page', 'Sessions', 'Minutes', 'SD', 'Reply words', 'Tool windows'], rows, 'dv-tk-left2');
  }

  function tabGame() {
    var list = sessions().filter(function (s) { return s.cond === 'control'; }), by = collect(list), rows = [];
    if (!list.length) return note('No session of the control condition in these data.');
    for (var n = 1; n <= 10; n++) {
      var a = (by[n] || []).filter(function (x) { return x.on != null || x.game; }), g = a.filter(function (x) { return x.game; }).map(function (x) { return x.game; });
      if (!a.length) { rows.push(tr([n, '<span class="dv-dim">0</span>', '-', '-', '-', '-', '-', '-', '-'], 'dv-an-off')); continue; }
      var idle = g.filter(function (x) { return !x.launches; }).length;
      rows.push(tr([n + (g[0] && g[0].layout ? ' <small>' + esc(g[0].layout) + '</small>' : ''), a.length, f(mean(vals(a, 'on'))), f(mean(vals(g, 'score')), 0), f(mean(vals(g, 'tiles')), 1), f(mean(vals(g, 'lost')), 1),
        f(mean(vals(g, 'play')), 0), f(mean(vals(g, 'active')), 0), g.length ? (idle ? '<span class="dv-tk-warn">' + idle + '</span>' : '0') : '-']));
    }
    return note('Engagement with the control game, one row per trial of 120 s. "In play" is the time with the ball moving, "Paddle moved" the time the participant was steering. "No input" counts the trials where the ball was never launched: the participant sat through the trial without playing. Game data need logger version 2 (sessions run with the Ring Court game).') +
      table(['Trial', 'Sessions', 'On page s', 'Score', 'Tiles cleared', 'Balls lost', 'In play s', 'Paddle moved s', 'No input'], rows);
  }

  var TABS = [['flags', 'Flags', tabFlags], ['orders', 'Timed orders', tabOrders], ['spi', 'SPI videos', tabSpi], ['tickets', 'Tickets', tabTickets], ['game', 'Game', tabGame]];

  function render() {
    var box = document.getElementById('dv-tk');
    if (!box || !host) return;
    var cur = TABS.filter(function (t) { return t[0] === st.tab; })[0] || TABS[0];
    box.innerHTML = tiles() +
      '<div class="dv-panel dv-st dv-tk-panel"><div class="dv-st-tabs" role="tablist" aria-label="Task checks">' + TABS.map(function (t) {
        return '<button type="button" role="tab" class="dv-st-tab' + (t[0] === cur[0] ? ' is-on' : '') + '" aria-selected="' + (t[0] === cur[0]) + '" data-tk-tab="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div><div class="dv-st-body" role="tabpanel">' + cur[2]() + '</div></div>';
  }

  /* ---------- session panel and table ---------- */

  function badge(s) {
    var T = s.task;
    if (!T) return '';
    if (!T.flags.length) return '<span class="dv-tk-ok">OK</span>';
    return '<span class="dv-tk-flag" title="' + esc(T.flags.map(function (k) { return FLAG_LABEL[k] + ': ' + T.why[k].join('; '); }).join('\n')) + '">' + T.flags.length + (T.flags.length === 1 ? ' flag' : ' flags') + '</span>';
  }

  function drawerHtml(s) {
    var T = s.task;
    if (!T) return '';
    var h = '<div class="dv-tk-drawer"><p class="dv-mono-label">Task checks</p>';
    h += T.flags.length ? '<ul class="dv-tk-list">' + T.flags.map(function (k) { return '<li><strong>' + esc(FLAG_LABEL[k]) + '</strong> ' + esc(T.why[k].join('; ')) + '</li>'; }).join('') + '</ul>'
      : '<p class="dv-st-flags"><span class="dv-dim">No flag on this session.</span></p>';
    var facts = [];
    if (isTimed(s) && T.done) facts.push(T.sentN + ' of ' + T.done + ' orders sent');
    if (T.gap != null) facts.push('budget gap ' + T.gap.toFixed(0) + ' €');
    if (T.spi) facts.push('SPI ' + T.spi.ended + ' of ' + T.spi.expected + ' to the end');
    if (T.game && T.game.trials) facts.push('game score ' + Math.round(T.game.score) + ' per trial');
    if (T.v2) facts.push('tab hidden ' + Math.round(T.hidden) + ' s'); else facts.push('logger v1');
    if (T.vw) facts.push('window ' + T.vw + ' x ' + T.vh);
    h += '<p class="dv-tk-facts">' + esc(facts.join(' · ')) + '</p>';
    if (T.steps.length) {
      var timed = isTimed(s), ctrl = s.cond === 'control';
      var head = timed ? ['Order', 'On page', 'Sent at', 'Cost / budget', 'SPI'] : ctrl ? ['Trial', 'On page', 'Score', 'Tiles', 'Lost'] : ['Ticket', 'On page', 'Words', 'Tools', ''];
      h += '<details class="dv-tk-steps"><summary>Step by step <small>' + T.steps.length + ' rows</small></summary>' + table(head, T.steps.map(function (x) {
        var c;
        if (timed) c = [x.n + (x.views > 1 ? ' <small>x' + x.views + '</small>' : ''), x.on == null ? '-' : x.on.toFixed(1) + ' s' + (x.dev != null && Math.abs(x.dev) > TOL ? ' <span class="dv-tk-warn">!</span>' : ''),
          x.sent != null ? x.sent.toFixed(1) + ' s' : x.on != null ? '<span class="dv-tk-warn">not sent</span>' : '-', x.price != null ? x.price.toFixed(0) + (x.lo != null ? ' / ' + x.lo + (x.hi !== x.lo ? '-' + x.hi : '') : '') : '-',
          x.spi ? esc(x.spi.clip || '') + (x.spi.played != null ? ' ' + x.spi.played + ' s' : '') + (x.spi.ended || x.spi.completed ? '' : ' <span class="dv-tk-warn">cut</span>') : ''];
        else if (ctrl) c = [x.n, x.on == null ? '-' : x.on.toFixed(1) + ' s', x.game ? x.game.score : '-', x.game ? x.game.tiles : '-', x.game ? x.game.lost : '-'];
        else c = [x.n, x.on == null ? '-' : host.fmtDur(x.on * 1000), x.words != null ? x.words : '-', x.tools, ''];
        return tr(c);
      })) + '</details>';
    }
    return h + '</div>';
  }

  /* ---------- export: one row per session and step ---------- */

  function trialsCsv() {
    var head = ['sid', 'cond', 'unit', 'step', 'page', 'views', 'opened_iso', 'on_page_s', 'planned_s', 'off_schedule', 'sent', 'sent_after_s', 'seconds_left', 'send_clicks', 'clicks',
      'order_cost', 'budget_low', 'budget_high', 'budget_gap', 'items_picked', 'reply_words', 'reply_chars', 'tool_windows', 'tab_hidden_s',
      'spi_order', 'spi_clip', 'spi_from', 'spi_at_s', 'spi_started', 'spi_start_delay_ms', 'spi_played_s', 'spi_clip_s', 'spi_to_end', 'spi_muted', 'spi_in_window',
      'game_layout', 'game_score', 'game_tiles', 'game_clears', 'game_balls_lost', 'game_launches', 'game_paddle_hits', 'game_first_launch_ms', 'game_in_play_s', 'game_paddle_moved_s', 'finished', 'flags'];
    var b = function (v) { return v == null ? '' : v ? 1 : 0; };
    var rows = [];
    sessions().slice().sort(function (a, c) { return a.start - c.start; }).forEach(function (s) {
      var T = s.task, unit = host.COND[s.cond] ? host.COND[s.cond].unit.replace(/s$/, '') : '';
      T.steps.forEach(function (x) {
        var v = x.spi || {}, g = x.game || {};
        rows.push([s.sid, s.cond, unit, x.n, x.page, x.views, x.view ? new Date(x.view).toISOString() : '', x.on, x.planned, x.dev == null ? '' : Math.abs(x.dev) > TOL ? 1 : 0,
          x.on == null && x.sent == null ? '' : x.sent != null ? 1 : 0, x.sent, x.left, x.sends, x.clicks, x.price, x.lo, x.hi, x.gap, x.picks, x.words, x.chars, x.tools, T.v2 ? Math.round(x.hidden * 10) / 10 : '',
          isTimed(s) ? b(host.SPI_ORDERS.indexOf(x.n) !== -1) : '', v.clip, v.from, v.t, x.spi ? b(v.v2 ? v.started : null) : '', v.delay, v.played, v.dur, x.spi ? b(v.ended || v.completed) : '', x.spi && v.v2 ? b(v.muted) : '', v.vis,
          g.layout, g.score, g.tiles, g.clears, g.lost, g.launches, g.hits, g.first, g.play, g.active, s.finished ? 1 : 0, T.flags.join(' ')]
          .map(function (c) { return typeof c === 'number' && !Number.isInteger(c) ? Math.round(c * 1000) / 1000 : c; }).map(host.csvCell).join(','));
      });
    });
    host.download(host.prefix() + 'trials-' + host.stamp() + '.csv', '﻿' + head.join(',') + '\r\n' + rows.join('\r\n') + '\r\n', 'text/csv;charset=utf-8');
    host.toast(rows.length + ' rows: one per session and order, ticket or trial.');
  }

  // extra columns for the Sessions CSV (appended after the existing ones)
  var SESSION_COLS = [
    ['flags', function (s, T) { return T.flags.join(' '); }],
    ['logger_v2', function (s, T) { return T.v2 ? 1 : 0; }],
    ['orders_done', function (s, T) { return isTimed(s) ? T.done : ''; }],
    ['orders_sent', function (s, T) { return isTimed(s) ? T.sentN : ''; }],
    ['orders_not_sent', function (s, T) { return isTimed(s) ? T.missed.length : ''; }],
    ['pages_off_schedule', function (s, T) { return T.off.length; }],
    ['budget_gap_mean', function (s, T) { return T.gap == null ? '' : Math.round(T.gap * 100) / 100; }],
    ['seconds_left_mean', function (s, T) { return T.left == null ? '' : Math.round(T.left * 100) / 100; }],
    ['tab_hidden_s', function (s, T) { return T.v2 ? Math.round(T.hidden * 10) / 10 : ''; }],
    ['window_away_s', function (s, T) { return T.v2 ? Math.round(T.away * 10) / 10 : ''; }],
    ['window_w', function (s, T) { return T.vw || ''; }],
    ['window_h', function (s, T) { return T.vh || ''; }],
    ['spi_planned', function (s, T) { return T.spi ? T.spi.expected : ''; }],
    ['spi_started', function (s, T) { return T.spi && T.spi.v2 ? T.spi.started : ''; }],
    ['spi_to_end', function (s, T) { return T.spi ? T.spi.ended : ''; }],
    ['spi_played_s', function (s, T) { return T.spi && T.spi.played.length ? Math.round(T.spi.played.reduce(function (a, c) { return a + c; }, 0) * 10) / 10 : ''; }],
    ['reply_words_mean', function (s, T) { return T.words == null ? '' : Math.round(T.words * 10) / 10; }],
    ['tool_windows', function (s, T) { return s.cond === 'not_obj_cond' ? T.tools : ''; }],
    ['game_trials', function (s, T) { return T.game ? T.game.trials : ''; }],
    ['game_score_mean', function (s, T) { return T.game && T.game.trials ? Math.round(T.game.score * 10) / 10 : ''; }],
    ['game_trials_no_input', function (s, T) { return T.game && T.game.trials ? T.game.idle.length : ''; }]
  ];
  function sessionHead() { return SESSION_COLS.map(function (c) { return c[0]; }); }
  function sessionRow(s) { return SESSION_COLS.map(function (c) { return c[1](s, s.task); }); }

  function init(h) {
    host = h;
    var box = document.getElementById('dv-tk');
    if (box) {
      box.addEventListener('click', function (ev) {
        var t = ev.target.closest('[data-tk-tab]');
        if (t) { st.tab = t.getAttribute('data-tk-tab'); render(); var on = box.querySelector('.dv-st-tab.is-on'); if (on) on.focus(); return; }
        var c = ev.target.closest('[data-tk-sid]');
        if (c) host.open(c.getAttribute('data-tk-sid'));
      });
      box.addEventListener('change', function (ev) {
        if (ev.target.hasAttribute('data-tk-group')) { st.group = ev.target.value; render(); }
      });
    }
    var btn = document.getElementById('dv-exp-trials');
    if (btn) btn.addEventListener('click', trialsCsv);
  }

  window.ACME_TASK = { init: init, build: build, render: render, metrics: metrics, badge: badge, drawerHtml: drawerHtml, sessionHead: sessionHead, sessionRow: sessionRow,
    flags: function () { return FLAGS; }, has: function (s, k) { return !!(s.task && s.task.flags.indexOf(k) !== -1); }, state: st, HIDDEN_FLAG: HIDDEN_FLAG };
})();
