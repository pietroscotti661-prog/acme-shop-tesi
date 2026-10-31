/* Small positive interaction: short video pop-up shown during an order page.
   Needs spi-config.js (window.SPI) loaded first. data-from="colleghi" or "clienti" picks who speaks.
   data-test="1" is the test version: the source is random and two buttons on the right play a colleague
   or a customer video at any moment.
   The pop-up reads the page countdown, so it stays in step with the task. It never pauses or changes the task timers. */
(function () {
  var tag = document.currentScript;
  var cfg = window.SPI;
  var isTest = tag.getAttribute('data-test') === '1';
  var from = tag.getAttribute('data-from') || (Math.random() < 0.5 ? 'colleghi' : 'clienti');
  var videoBase = new URL('../video/', tag.src).href;
  var order = parseInt((location.pathname.match(/(\d+)\.html$/) || [])[1], 10);
  var title = 'New video message';
  var box = null, video = null, shown = false;

  if (!cfg || isNaN(order)) return;

  function phaseOf(n) {
    for (var k in cfg.phases) {
      if (n >= cfg.phases[k][0] && n <= cfg.phases[k][1]) return k;
    }
    return 'any';
  }

  function hasOrder(n) {
    return cfg.orders === 'all' || cfg.orders.indexOf(n) !== -1;
  }

  // Random clip of the right phase, not repeated until all fitting clips were used (per browser session).
  function pick(source) {
    var phase = phaseOf(order);
    var mine = cfg.pool.filter(function (c) { return c.from === source; });
    var fit = mine.filter(function (c) { return [].concat(c.phase).indexOf(phase) !== -1 || c.phase === 'any'; });
    if (!fit.length) fit = mine;
    if (!fit.length) return null;
    var used = [];
    try { used = JSON.parse(sessionStorage.getItem('spi-used') || '[]'); } catch (e) {}
    var fresh = fit.filter(function (c) { return used.indexOf(c.id) === -1; });
    if (!fresh.length) {
      used = used.filter(function (id) { return !fit.some(function (c) { return c.id === id; }); });
      fresh = fit;
    }
    var clip = fresh[Math.floor(Math.random() * fresh.length)];
    used.push(clip.id);
    try { sessionStorage.setItem('spi-used', JSON.stringify(used)); } catch (e) {}
    return clip;
  }

  var current = null;

  function build(clip) {
    if (!clip) return false;
    current = clip;
    box = document.createElement('div');
    box.className = 'spi-popup';
    box.setAttribute('role', 'status');
    box.innerHTML =
      '<div class="spi-head"><span class="spi-dot"></span>' + title + '</div>' +
      '<video playsinline preload="auto"></video>';
    document.body.appendChild(box);

    video = box.getElementsByTagName('video')[0];
    video.src = videoBase + clip.file;
    video.load();
    var mine = box;
    video.addEventListener('ended', function () {
      window.dispatchEvent(new CustomEvent('spi:ended', { detail: { clip: clip.id, completed: true } }));
      setTimeout(function () { close(mine); }, 800);
    });
    video.addEventListener('error', function () { close(mine); });
    return true;
  }

  function close(b) {
    b.className = 'spi-popup spi-out';
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 600);
  }

  // Fill the free area left of the task, under the countdown box (never over the task itself).
  function place() {
    var counter = document.getElementById('counter');
    var task = document.getElementById('ordine');
    if (!counter || !task) return;
    var c = counter.getBoundingClientRect();
    var t = task.getBoundingClientRect();
    var head = 40, gap = 14, margin = 16;
    var top = c.bottom + gap;
    var areaW = t.left - margin - margin;
    var fitW = (window.innerHeight - top - margin - head) * (16 / 9);
    var width = Math.max(200, Math.min(areaW, fitW));
    box.style.left = (margin + (areaW - width) / 2) + 'px';
    box.style.top = top + 'px';
    box.style.width = width + 'px';
  }

  function show() {
    place();
    box.className = 'spi-popup spi-in';
    window.dispatchEvent(new CustomEvent('spi:shown', { detail: { clip: current.id, from: current.from, secondsLeft: secondsLeft() } }));
    var b = box, v = video;
    var p = v.play();
    if (p && p.catch) {
      p.catch(function () { v.muted = true; v.play().catch(function () { close(b); }); });
    }
  }

  function secondsLeft() {
    var el = document.getElementById('countdown');
    var n = el ? parseInt(el.innerHTML, 10) : NaN;
    return isNaN(n) ? null : n;
  }

  // Test buttons, right side of the screen: play a video now. A new press replaces the one playing.
  // Each press plays the next clip of that source, in pool order, whatever the phase, so all of them can be checked.
  function addTestButton(label, source, offset) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'spi-test-btn';
    btn.style.setProperty('--spi-offset', offset + 'px');
    btn.innerHTML = label + '<small>test version</small>';
    var clips = cfg.pool.filter(function (c) { return c.from === source; });
    var next = 0;
    btn.addEventListener('click', function () {
      if (!clips.length) return;
      var n = next % clips.length;
      next++;
      if (box && box.parentNode) { box.parentNode.removeChild(box); }
      if (build(clips[n])) {
        shown = true;
        show();
        btn.getElementsByTagName('small')[0].textContent = 'video ' + (n + 1) + ' of ' + clips.length;
      }
    });
    document.body.appendChild(btn);
  }

  document.addEventListener('DOMContentLoaded', function () {
    if (isTest) {
      addTestButton('Colleague video', 'colleghi', -50);
      addTestButton('Customer video', 'clienti', 50);
    }
    if (!hasOrder(order)) return;
    if (!build(pick(from))) return;
    var poll = setInterval(function () {
      var left = secondsLeft();
      if (left !== null && left <= cfg.at) {
        clearInterval(poll);
        if (!shown) { shown = true; show(); }
      }
    }, 100);
  });
})();
