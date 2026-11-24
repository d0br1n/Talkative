(function () {
  'use strict';

  // Ported from the brand animation. Returns 15 rows of 56 characters.
  function frame(t) {
    const HEAVY = ['@', '@', '@', '%', '#', '8', '&'];
    const MID_HI = ['#', '%', '*', '8', '&'];
    const MID = ['*', '+', '=', '#'];
    const MID_LO = ['+', '=', '-', '*'];
    const LOW = ['-', ':', '=', '~'];
    const DUST = ['.', ':', "'", '`', ','];
    const pick = (l, r) => l[Math.floor(r * l.length) % l.length];
    const hash = (a, b, c) => {
    let h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(c + 1, 2147483629);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
    };
    const charFor = (d, r) => {
    if (d > 0.86) return pick(HEAVY, r);
    if (d > 0.66) return pick(MID_HI, r);
    if (d > 0.46) return pick(MID, r);
    if (d > 0.30) return pick(MID_LO, r);
    if (d > 0.17) return pick(LOW, r);
    if (d > 0.07) return pick(DUST, r);
    return ' ';
    };
    const ENV = [0.25, 0.45, 0.7, 0.9, 0.6, 1.0, 0.75, 0.5, 0.85, 0.55, 0.4, 0.7, 0.35, 0.18];
    const R = 15;
    const cy = 7;
    const BARS = ENV.length;
    const COLS = BARS * 4;
    const grid = [];
    for (let y = 0; y < R; y++) grid.push(new Array(COLS).fill(' '));
    const tick = Math.floor(t / 2);
    for (let b = 0; b < BARS; b++) {
    let amp = ENV[b] * (0.55 + 0.45 * Math.sin(t * 0.33 + b * 0.9)) + 0.12 * Math.sin(t * 0.9 + b * 2.1);
    amp = Math.max(0.08, Math.min(1, amp));
    const half = Math.max(1, Math.round(amp * cy));
    for (let bx = 0; bx < 4; bx++) {
    const x = b * 4 + bx;
    for (let y = 0; y < R; y++) {
    const dist = Math.abs(y - cy);
    if (bx < 3) {
    if (dist <= half) {
    const tt = dist / (half + 0.8);
    let d = 1 - Math.pow(tt, 2.4);
    if (bx !== 1) d -= 0.16;
    d += (hash(x, y, 0) - 0.5) * 0.28;
    let ch = charFor(d, hash(x, y, 1));
    if (ch !== ' ' && hash(x, y, 5 + tick) < 0.015) ch = pick(DUST, hash(x, y, 9 + tick));
    grid[y][x] = ch;
    } else if (dist === half + 1 && hash(x, y, 2) < 0.5) {
    grid[y][x] = pick(DUST, hash(x, y, 3));
    }
    } else if (dist <= 1 && hash(x, y, 11 + tick) < 0.18) {
    grid[y][x] = pick(DUST, hash(x, y, 4 + tick));
    }
    }
    }
    }
    return grid.map((r) => r.join('')).join('\n');
  }

  function initMark() {
    var el = document.getElementById('hero-mark');
    if (!el || !window.setInterval) return;
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var timer = null;
    var t = 12;

    function tickOnce() {
      el.textContent = frame(t);
      t += 1;
    }
    function stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }
    function start() {
      if (timer !== null) return;
      if (document.hidden || (mq && mq.matches)) return;
      tickOnce();
      timer = setInterval(tickOnce, 90);
    }
    function onMotion() {
      if (mq && mq.matches) stop();
      else start();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else start();
    });
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onMotion);
      else if (mq.addListener) mq.addListener(onMotion);
    }
    start();
  }

  function initToggle() {
    var buttons = document.querySelectorAll('button[data-diagram]');
    if (!buttons.length) return;
    var items = [];
    Array.prototype.forEach.call(buttons, function (btn) {
      var d = document.getElementById('diagram-' + btn.getAttribute('data-diagram'));
      if (d) items.push({ btn: btn, diagram: d });
    });
    if (!items.length) return;

    function show(name) {
      items.forEach(function (it) {
        var on = it.btn.getAttribute('data-diagram') === name;
        if (on) it.diagram.removeAttribute('hidden');
        else it.diagram.setAttribute('hidden', '');
        it.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }
    items.forEach(function (it) {
      if (!it.btn.hasAttribute('aria-controls')) it.btn.setAttribute('aria-controls', it.diagram.id);
      it.btn.removeAttribute('hidden');
      it.btn.addEventListener('click', function () {
        show(it.btn.getAttribute('data-diagram'));
      });
    });
    show('split');
  }

  function initForm() {
    var form = document.querySelector('form[data-notify-form]');
    if (!form) return;
    var status = form.querySelector('[role="status"]');
    // TODO(owner): notify endpoint
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (status) status.textContent = 'Not wired up yet. Watch the repository for news.';
    });
  }

  if (typeof document !== 'undefined') {
    initMark();
    initToggle();
    initForm();
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { frame: frame };
})();
