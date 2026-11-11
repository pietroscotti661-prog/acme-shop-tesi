/* Ring Court: the game of the control condition of the ACME study.
   Original design and code written for this study (GPL-3.0 like the rest of the paradigm): no code, art,
   sound or level layout comes from another game. Drawn on a canvas, no images, no sound, no libraries.

   How it plays: a ball moves inside a ring. The paddle is an arc that slides around the ring (mouse, or
   left and right arrow keys). The ball must not leave the ring; in the middle there are tiles to clear.

   Role in the study: about 20 minutes of neutral activity. The game shows only score, lives, level and
   tiles left. It never shows praise, messages or a story.

   One page per trial, as before: control/levelN/index.html loads this file with data-level and data-next.
   Timing is the same as the previous game: the page fades at 120 s and opens the next page at 121 s.
   The logger (assets/js/acme-data.js) records the events "ctrl:start" and "ctrl:end" sent from here. */
(function () {
  'use strict';

  var tag = document.currentScript;
  var LEVEL = parseInt(tag.getAttribute('data-level'), 10) || 1;
  var NEXT = tag.getAttribute('data-next') || '../end_task.html';
  var TRIAL_MS = 120000;      // length of a trial
  var LEAVE_MS = 121000;      // the next page opens one second after the fade starts

  /* ---------- court geometry (logical units: the canvas is 720 x 720, the centre is 0,0) ---------- */
  var SIZE = 720, R = 300, PADDLE_T = 12, BALL_R = 8, HUB_R = 26;
  var RH = R - PADDLE_T / 2 - BALL_R;                       // where the ball meets the paddle
  var RINGS = [[56, 78], [84, 106], [112, 134], [140, 162], [168, 190]];
  var TAU = Math.PI * 2;

  // Tile layouts. Each row: ring (0 inner .. 4 outer), tiles in the ring, pattern, shift in tiles.
  // Pattern letters: a b c d = colour, capital = two hits, dot = empty. The pattern repeats around the ring.
  var LAYOUTS = [
    { name: 'band',    rows: [[2, 12, 'ab', 0], [3, 15, 'c', 0]] },
    { name: 'spokes',  rows: [[0, 6, 'a', 0], [1, 12, 'b.', 0], [2, 12, 'b.', 0], [3, 18, 'c..', 0], [4, 18, 'c..', 0]] },
    { name: 'spiral',  rows: [[0, 6, 'a.', 0], [1, 12, 'ab..', 1], [2, 12, 'bc..', 2], [3, 12, 'cd..', 3], [4, 12, 'da..', 4]] },
    { name: 'checker', rows: [[0, 6, 'c.', 0], [1, 12, 'a.', 0], [2, 12, 'b.', 1], [3, 12, 'a.', 0], [4, 12, 'b.', 1]] },
    { name: 'bloom',   rows: [[0, 6, 'ab', 0], [1, 9, 'c', 0.5], [2, 12, 'ab', 0], [3, 15, 'd', 0.5]] },
    { name: 'gates',   rows: [[1, 9, 'a', 0], [2, 12, 'b', 0], [4, 18, 'CC.CC.', 0]] },
    { name: 'halves',  rows: [[0, 6, 'aaa...', 0.5], [1, 10, 'bbbbb.....', 0.5], [2, 12, 'aaaaaa......', 0.5], [3, 16, 'bbbbbbbb........', 0.5], [4, 18, 'ccccccccc.........', 0.5]] }
  ];
  // Ten trials, seven layouts: trials 8, 9 and 10 load again the layouts of trials 2, 4 and 6.
  var ORDER = [0, 1, 2, 3, 4, 5, 6, 1, 3, 5];
  var layout = LAYOUTS[ORDER[(LEVEL - 1) % ORDER.length]];

  var BASE_SPEED = 250 + (LEVEL - 1) * 11;                  // ball speed, units per second
  var HALF_ARC = 0.44 - (LEVEL - 1) * 0.012;                // half width of the paddle, radians
  var KEY_SPEED = 4.2, MOUSE_SPEED = 11;                    // paddle speed, radians per second
  var LIVES = 3;

  // Colours: the tokens of assets/acme.css, on the ink ground of the instrument panels.
  var INK = '#16181d', PAPER = '#f8f6f1', MUTED = '#aaa59b', SIGNAL = '#e8532b';
  var TILE = { a: '#f8f6f1', b: '#8d97f4', c: '#e9c877', d: '#e8532b' };
  var MONO = '"JetBrains Mono", Consolas, monospace';

  var canvas, ctx, hint, container, scale = 1;
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}

  var tiles = [], shards = [], trail = [];
  var paddle = { a: Math.PI / 2, target: null };           // starts at the bottom of the ring
  var ball = { x: 0, y: 0, vx: 0, vy: 0, held: true, out: false };
  var keys = { left: false, right: false };
  var speed = BASE_SPEED, lives = LIVES, score = 0, refill = false;
  var over = false, started = 0, last = 0;
  // what the logger receives at the end of the trial
  var stat = { level: LEVEL, layout: layout.name, score: 0, tiles: 0, clears: 0, lost: 0, rounds: 0, launches: 0, hits: 0, first: null, play: 0, active: 0, keys: 0 };
  var sent = false;

  function wrap(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
  function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

  function buildTiles() {
    tiles = [];
    layout.rows.forEach(function (row) {
      var ring = RINGS[row[0]], n = row[1], pat = row[2], shift = row[3], step = TAU / n;
      var gap = 3 / ((ring[0] + ring[1]) / 2);              // half of the space between two tiles, as an angle
      for (var i = 0; i < n; i++) {
        var ch = pat.charAt(i % pat.length);
        if (ch === '.') continue;
        tiles.push({
          r0: ring[0], r1: ring[1], mid: wrap((i + shift) * step - Math.PI / 2), half: step / 2 - gap,
          col: TILE[ch.toLowerCase()], hp: ch === ch.toUpperCase() ? 2 : 1, born: performance.now()
        });
      }
    });
  }

  function holdBall() {
    ball.held = true; ball.out = false; ball.vx = ball.vy = 0; trail.length = 0;
    if (hint) hint.hidden = false;
  }

  function launch() {
    if (over || !ball.held) return;
    var th = paddle.a, phi = (Math.random() - 0.5) * 0.7;
    var nx = -Math.cos(th), ny = -Math.sin(th), tx = -Math.sin(th), ty = Math.cos(th);
    ball.vx = speed * (Math.cos(phi) * nx + Math.sin(phi) * tx);
    ball.vy = speed * (Math.cos(phi) * ny + Math.sin(phi) * ty);
    ball.held = false;
    stat.launches++;
    if (stat.first == null) stat.first = Math.round(performance.now() - started);
    if (hint) hint.hidden = true;
  }

  function reflect(nx, ny) {
    var d = ball.vx * nx + ball.vy * ny;
    ball.vx -= 2 * d * nx; ball.vy -= 2 * d * ny;
  }

  function burst(t) {
    if (reduced) return;
    var rm = (t.r0 + t.r1) / 2;
    for (var i = 0; i < 6; i++) {
      var a = t.mid + (Math.random() - 0.5) * 2 * t.half, sp = 30 + Math.random() * 70, dir = a + (Math.random() - 0.5) * 1.6;
      shards.push({ x: rm * Math.cos(a), y: rm * Math.sin(a), vx: sp * Math.cos(dir), vy: sp * Math.sin(dir), life: 0.45, col: t.col });
    }
  }

  // Ball against one tile (a piece of ring): nearest point of the tile, in polar coordinates.
  function hitTile(t) {
    var r = Math.sqrt(ball.x * ball.x + ball.y * ball.y), th = Math.atan2(ball.y, ball.x);
    if (r < t.r0 - BALL_R || r > t.r1 + BALL_R) return false;
    var da = wrap(th - t.mid), ca = clamp(da, -t.half, t.half), cr = clamp(r, t.r0, t.r1);
    var px = cr * Math.cos(t.mid + ca), py = cr * Math.sin(t.mid + ca);
    var dx = ball.x - px, dy = ball.y - py, d = Math.sqrt(dx * dx + dy * dy);
    if (d > BALL_R) return false;
    if (d < 0.001) { ball.vx = -ball.vx; ball.vy = -ball.vy; return true; }   // centre inside the tile: go back
    var nx = dx / d, ny = dy / d;
    if (ball.vx * nx + ball.vy * ny < 0) reflect(nx, ny);
    ball.x = px + nx * (BALL_R + 0.5); ball.y = py + ny * (BALL_R + 0.5);
    return true;
  }

  function loseBall() {
    stat.lost++;
    lives--;
    if (lives <= 0) {            // a new round: lives and tiles come back, the score of the trial goes on
      lives = LIVES; stat.rounds++; speed = BASE_SPEED; buildTiles(); refill = false;
    }
    holdBall();
  }

  function stepBall(dt) {
    var dist = speed * dt, n = Math.max(1, Math.ceil(dist / 4)), h = dt / n;
    for (var s = 0; s < n; s++) {
      ball.x += ball.vx * h; ball.y += ball.vy * h;
      var r = Math.sqrt(ball.x * ball.x + ball.y * ball.y), outward = ball.x * ball.vx + ball.y * ball.vy > 0;

      if (ball.out) { if (r > R + 46) { loseBall(); return; } continue; }

      // paddle
      if (r >= RH && outward) {
        var th = Math.atan2(ball.y, ball.x), diff = wrap(th - paddle.a);
        if (Math.abs(diff) <= HALF_ARC + BALL_R / R) {
          var nx = -Math.cos(th), ny = -Math.sin(th), tx = -Math.sin(th), ty = Math.cos(th);
          reflect(nx, ny);
          var phi = Math.atan2(ball.vx * tx + ball.vy * ty, ball.vx * nx + ball.vy * ny);
          phi = clamp(0.5 * phi + 0.95 * (diff / HALF_ARC), -0.9, 0.9);   // where the paddle is hit steers the ball
          ball.vx = speed * (Math.cos(phi) * nx + Math.sin(phi) * tx);
          ball.vy = speed * (Math.cos(phi) * ny + Math.sin(phi) * ty);
          ball.x = (RH - 0.5) * Math.cos(th); ball.y = (RH - 0.5) * Math.sin(th);
          stat.hits++;
        } else {
          ball.out = true;
        }
        continue;
      }

      // hub in the centre
      if (r < HUB_R + BALL_R && !outward && r > 0.001) {
        reflect(ball.x / r, ball.y / r);
        var j = (Math.random() - 0.5) * 0.12, c = Math.cos(j), sn = Math.sin(j), vx = ball.vx;
        ball.vx = vx * c - ball.vy * sn; ball.vy = vx * sn + ball.vy * c;
        ball.x = ball.x / r * (HUB_R + BALL_R + 0.5); ball.y = ball.y / r * (HUB_R + BALL_R + 0.5);
        continue;
      }

      // tiles
      if (r < RINGS[RINGS.length - 1][1] + BALL_R + 1) {
        for (var i = 0; i < tiles.length; i++) {
          var t = tiles[i];
          if (!hitTile(t)) continue;
          t.hp--; score += 10;
          if (t.hp <= 0) { burst(t); tiles.splice(i, 1); stat.tiles++; }
          if (!tiles.length) { stat.clears++; refill = true; speed = Math.min(BASE_SPEED * 1.25, speed * 1.04); }
          break;
        }
      }
    }
  }

  function update(dt) {
    // paddle: keys first, otherwise follow the pointer
    var before = paddle.a;
    if (keys.left || keys.right) {
      paddle.target = null;
      paddle.a = wrap(paddle.a + (keys.left ? 1 : 0) * KEY_SPEED * dt - (keys.right ? 1 : 0) * KEY_SPEED * dt);
    } else if (paddle.target != null) {
      var d = wrap(paddle.target - paddle.a), m = MOUSE_SPEED * dt;
      paddle.a = wrap(paddle.a + clamp(d, -m, m));
    }
    if (Math.abs(wrap(paddle.a - before)) > 0.0005) stat.active += dt;

    if (ball.held) {
      ball.x = (RH - 1) * Math.cos(paddle.a); ball.y = (RH - 1) * Math.sin(paddle.a);
      if (refill) { buildTiles(); refill = false; }
    } else {
      stat.play += dt;
      stepBall(dt);
      // the tiles come back only when the ball is clear of the middle
      if (refill && !ball.held && ball.x * ball.x + ball.y * ball.y > 215 * 215) { buildTiles(); refill = false; }
      if (!reduced && !ball.held) { trail.push({ x: ball.x, y: ball.y }); if (trail.length > 9) trail.shift(); }
    }

    for (var i = shards.length - 1; i >= 0; i--) {
      var p = shards[i];
      p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.life <= 0) shards.splice(i, 1);
    }
  }

  /* ---------- drawing ---------- */

  function label(text, x, y, align) {
    ctx.font = '600 11px ' + MONO; ctx.fillStyle = MUTED; ctx.textAlign = align || 'left';
    ctx.fillText(text.split('').join(' '), x, y);
  }
  function value(text, x, y, align) {
    ctx.font = '600 26px ' + MONO; ctx.fillStyle = PAPER; ctx.textAlign = align || 'left';
    ctx.fillText(text, x, y);
  }
  function pad(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }

  function draw(now) {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = INK; ctx.fillRect(0, 0, SIZE, SIZE);

    // read-outs in the four corners, outside the ring
    ctx.textBaseline = 'alphabetic';
    label('SCORE', 28, 40); value(pad(score, 4), 28, 70);
    label('LIVES', SIZE - 28, 40, 'right');
    for (var l = 0; l < LIVES; l++) {
      var lx = SIZE - 28 - 16 - l * 24;
      if (l < lives) { ctx.fillStyle = PAPER; ctx.fillRect(lx, 54, 16, 16); }
      else { ctx.strokeStyle = 'rgba(248, 246, 241, 0.35)'; ctx.lineWidth = 1.5; ctx.strokeRect(lx + 0.75, 54.75, 14.5, 14.5); }
    }
    label('LEVEL', 28, SIZE - 58); value(pad(LEVEL, 2), 28, SIZE - 28);
    label('TILES', SIZE - 28, SIZE - 58, 'right'); value(pad(tiles.length, 2), SIZE - 28, SIZE - 28, 'right');

    ctx.translate(SIZE / 2, SIZE / 2);

    // the ring the paddle slides on, with tick marks like a dial
    ctx.strokeStyle = 'rgba(248, 246, 241, 0.16)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
    ctx.strokeStyle = 'rgba(248, 246, 241, 0.12)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (var k = 0; k < 72; k++) {
      var ta = k * TAU / 72, len = k % 6 === 0 ? 12 : 6;
      ctx.moveTo((R + 10) * Math.cos(ta), (R + 10) * Math.sin(ta));
      ctx.lineTo((R + 10 + len) * Math.cos(ta), (R + 10 + len) * Math.sin(ta));
    }
    ctx.stroke();
    // faint guides where the tile rings are
    ctx.strokeStyle = 'rgba(248, 246, 241, 0.05)';
    for (var g = 0; g < RINGS.length; g++) { ctx.beginPath(); ctx.arc(0, 0, (RINGS[g][0] + RINGS[g][1]) / 2, 0, TAU); ctx.stroke(); }

    // tiles
    for (var i = 0; i < tiles.length; i++) {
      var t = tiles[i], a0 = t.mid - t.half, a1 = t.mid + t.half;
      var age = reduced ? 1 : clamp((now - t.born) / 350, 0, 1);
      ctx.globalAlpha = age;
      ctx.beginPath(); ctx.arc(0, 0, t.r1, a0, a1); ctx.arc(0, 0, t.r0, a1, a0, true); ctx.closePath();
      ctx.fillStyle = t.col; ctx.fill();
      if (t.hp > 1) {                                        // two-hit tile: an ink line through the middle
        ctx.strokeStyle = INK; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(0, 0, (t.r0 + t.r1) / 2, a0 + 0.03, a1 - 0.03); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // hub: the square of the ACME mark
    ctx.fillStyle = '#2a2d36'; ctx.beginPath(); ctx.arc(0, 0, HUB_R, 0, TAU); ctx.fill();
    ctx.fillStyle = SIGNAL; ctx.fillRect(-6, -6, 12, 12);

    // shards
    for (var s = 0; s < shards.length; s++) {
      var p = shards[s];
      ctx.globalAlpha = clamp(p.life / 0.45, 0, 1); ctx.fillStyle = p.col; ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // paddle
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(141, 151, 244, 0.38)'; ctx.lineWidth = PADDLE_T + 10;
    ctx.beginPath(); ctx.arc(0, 0, R, paddle.a - HALF_ARC, paddle.a + HALF_ARC); ctx.stroke();
    ctx.strokeStyle = PAPER; ctx.lineWidth = PADDLE_T;
    ctx.beginPath(); ctx.arc(0, 0, R, paddle.a - HALF_ARC, paddle.a + HALF_ARC); ctx.stroke();
    ctx.lineCap = 'butt';

    // ball
    for (var q = 0; q < trail.length; q++) {
      ctx.globalAlpha = 0.05 + 0.03 * q; ctx.fillStyle = PAPER;
      ctx.beginPath(); ctx.arc(trail[q].x, trail[q].y, BALL_R * (0.45 + 0.05 * q), 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER; ctx.beginPath(); ctx.arc(ball.x, ball.y, BALL_R, 0, TAU); ctx.fill();
    ctx.fillStyle = SIGNAL; ctx.beginPath(); ctx.arc(ball.x, ball.y, 2.5, 0, TAU); ctx.fill();
  }

  function frame(now) {
    if (over) return;
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (dt > 0) update(dt);
    draw(now);
    requestAnimationFrame(frame);
  }

  function resize() {
    var css = canvas.clientWidth || SIZE, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var px = Math.round(css * dpr);
    if (canvas.width !== px) { canvas.width = px; canvas.height = px; }
    scale = px / SIZE;
    if (over) return;
    draw(performance.now());
  }

  /* ---------- input ---------- */

  function pointer(ev) {
    if (over) return;
    var b = canvas.getBoundingClientRect();
    var x = ev.clientX - (b.left + b.width / 2), y = ev.clientY - (b.top + b.height / 2);
    if (x * x + y * y < 24 * 24) return;                    // too close to the centre to give a direction
    paddle.target = Math.atan2(y, x);
  }

  function keydown(ev) {
    if (ev.ctrlKey || ev.altKey || ev.metaKey) return;
    var k = ev.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') { if (!keys.left) stat.keys++; keys.left = true; }
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') { if (!keys.right) stat.keys++; keys.right = true; }
    else if (k === ' ' || k === 'Spacebar' || k === 'Enter' || k === 'ArrowUp') { if (!ev.repeat) { stat.keys++; launch(); } }
    else return;
    ev.preventDefault();                                     // the page must not scroll while playing
  }
  function keyup(ev) {
    var k = ev.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  }

  /* ---------- trial clock: fade at 120 s, next page at 121 s, as in the previous game ---------- */

  function summary(partial) {
    stat.score = score;
    var d = {};
    for (var k in stat) d[k] = stat[k];
    d.play = Math.round(d.play * 10) / 10; d.active = Math.round(d.active * 10) / 10;
    if (partial) d.partial = true;
    return d;
  }

  function endTrial() {
    if (over) return;
    over = true;
    container.className += ' is-over';
    sent = true;
    window.dispatchEvent(new CustomEvent('ctrl:end', { detail: summary(false) }));
  }

  function clock(deadline) {
    var box = document.getElementById('clockdiv');
    if (!box) return;
    var min = box.querySelector('.minutes'), sec = box.querySelector('.seconds');
    function tick() {
      var t = Math.max(0, deadline - Date.now());
      var s = Math.floor(t / 1000) % 60, m = Math.floor(t / 60000) % 60;
      min.innerHTML = ('0' + m).slice(-2); sec.innerHTML = ('0' + s).slice(-2);
      if (t <= 0) clearInterval(timer);
    }
    tick();
    var timer = setInterval(tick, 250);
  }

  function init() {
    container = document.getElementById('container');
    canvas = document.getElementById('canvas');
    hint = document.getElementById('instructions');
    if (!canvas || !canvas.getContext) return;
    ctx = canvas.getContext('2d');

    setTimeout(endTrial, TRIAL_MS);
    setTimeout(function () { window.location.href = NEXT; }, LEAVE_MS);
    clock(Date.now() + TRIAL_MS);

    started = last = performance.now();
    buildTiles();
    holdBall();
    resize();

    window.addEventListener('resize', resize);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', function () { keys.left = keys.right = false; });
    document.addEventListener('mousemove', pointer);
    canvas.parentNode.addEventListener('mousedown', function (ev) { if (ev.button === 0) { pointer(ev); launch(); } });
    canvas.parentNode.addEventListener('touchstart', function (ev) { if (ev.touches[0]) { pointer(ev.touches[0]); launch(); } }, { passive: true });
    canvas.parentNode.addEventListener('touchmove', function (ev) { if (ev.touches[0]) pointer(ev.touches[0]); }, { passive: true });

    // the logger takes the last numbers if the page is closed before the end of the trial
    window.addEventListener('acme:collect', function (ev) {
      if (!sent && ev.detail && ev.detail.push) { sent = true; ev.detail.push('game_end', summary(true)); }
    });
    window.dispatchEvent(new CustomEvent('ctrl:start', { detail: { level: LEVEL, layout: layout.name, tiles: tiles.length } }));

    if (document.fonts && document.fonts.load) { try { document.fonts.load('600 26px ' + MONO); } catch (e) {} }
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // read-only hook for tests and the console
  window.RING_COURT = { stat: stat, state: function () { return { held: ball.held, lives: lives, score: score, tiles: tiles.length, paddle: paddle.a, ball: { x: ball.x, y: ball.y }, over: over }; } };
})();
