(function () {
  'use strict';

  // ---------- The renderer ----------
  // The same renderer as MarkRenderer.swift in the iPhone app: 14 bar
  // amplitudes (0 to 1) in, 15 rows of 56 characters out. With no
  // amplitudes it draws the brand's idle wave at full level.
  var ROWS = 15;
  var BARS = 14;
  var ENV = [0.25, 0.45, 0.7, 0.9, 0.6, 1.0, 0.75, 0.5, 0.85, 0.55, 0.4, 0.7, 0.35, 0.18];
  var HEAVY = ['@', '@', '@', '%', '#', '8', '&'];
  var MID_HI = ['#', '%', '*', '8', '&'];
  var MID = ['*', '+', '=', '#'];
  var MID_LO = ['+', '=', '-', '*'];
  var LOW = ['-', ':', '=', '~'];
  var DUST = ['.', ':', "'", '`', ','];

  function pick(l, r) { return l[Math.floor(r * l.length) % l.length]; }
  function hash(a, b, c) {
    var h = Math.imul(a + 1, 374761393) ^ Math.imul(b + 1, 668265263) ^ Math.imul(c + 1, 2147483629);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }
  function charFor(d, r) {
    if (d > 0.86) return pick(HEAVY, r);
    if (d > 0.66) return pick(MID_HI, r);
    if (d > 0.46) return pick(MID, r);
    if (d > 0.30) return pick(MID_LO, r);
    if (d > 0.17) return pick(LOW, r);
    if (d > 0.07) return pick(DUST, r);
    return ' ';
  }

  function idleBars(t, level) {
    var out = [];
    for (var b = 0; b < BARS; b++) {
      out.push((ENV[b] * (0.55 + 0.45 * Math.sin(t * 0.33 + b * 0.9)) + 0.12 * Math.sin(t * 0.9 + b * 2.1)) * level);
    }
    return out;
  }

  function frame(t, amps) {
    if (!amps) amps = idleBars(t, 1);
    var cy = 7;
    var COLS = BARS * 4;
    var grid = [];
    for (var y0 = 0; y0 < ROWS; y0++) grid.push(new Array(COLS).fill(' '));
    var tick = Math.floor(t / 2);
    for (var b = 0; b < BARS; b++) {
      var amp = Math.max(0.08, Math.min(1, amps[b] || 0));
      var half = Math.max(1, Math.round(amp * cy));
      for (var bx = 0; bx < 4; bx++) {
        var x = b * 4 + bx;
        for (var y = 0; y < ROWS; y++) {
          var dist = Math.abs(y - cy);
          if (bx < 3) {
            if (dist <= half) {
              var tt = dist / (half + 0.8);
              var d = 1 - Math.pow(tt, 2.4);
              if (bx !== 1) d -= 0.16;
              d += (hash(x, y, 0) - 0.5) * 0.28;
              var ch = charFor(d, hash(x, y, 1));
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
    return grid.map(function (r) { return r.join(''); }).join('\n');
  }

  // ---------- The band meter ----------
  // A port of BandMeter.swift: Goertzel power at 14 log-spaced centres
  // over a Hann-windowed buffer, tilt-compensated, normalised against a
  // slowly falling peak, with an instant rise and a soft fall. The app
  // runs this on the microphone and on the agent's voice; the page runs
  // it on the visitor's microphone, or on the synthetic voice below.
  function BandMeter(sampleRate) {
    this.sampleRate = sampleRate;
    this.rms = 0;
    this.peakDB = -50;
    this.levels = new Array(BARS).fill(0);
    this.window = null;
    this.centres = [];
    for (var b = 0; b < BARS; b++) this.centres.push(150 * Math.pow(4000 / 150, b / (BARS - 1)));
  }
  BandMeter.prototype.process = function (samples, dt) {
    var n = samples.length;
    if (!n) return this.levels.slice();
    if (!this.window || this.window.length !== n) {
      this.window = new Float32Array(n);
      for (var i = 0; i < n; i++) this.window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n);
    }
    if (!dt) dt = n / this.sampleRate;
    var sumSq = 0, windowSum = 0;
    var w = new Float64Array(n);
    for (var j = 0; j < n; j++) {
      sumSq += samples[j] * samples[j];
      w[j] = samples[j] * this.window[j];
      windowSum += this.window[j];
    }
    this.rms = Math.sqrt(sumSq / n);
    var FLOOR = -120;
    var db = [];
    var maxDB = FLOOR;
    for (var b = 0; b < BARS; b++) {
      var coeff = 2 * Math.cos(2 * Math.PI * this.centres[b] / this.sampleRate);
      var s1 = 0, s2 = 0;
      for (var k = 0; k < n; k++) {
        var s0 = w[k] + coeff * s1 - s2;
        s2 = s1; s1 = s0;
      }
      var power = Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2);
      var a = 2 * Math.sqrt(power) / Math.max(windowSum, 1e-9);
      var level = a > 1e-9 ? 20 * Math.log10(a) : FLOOR;
      level = Math.max(level, FLOOR);
      if (level > FLOOR) level += 3 * Math.log2(this.centres[b] / 500);
      db.push(level);
      if (level > maxDB) maxDB = level;
    }
    this.peakDB = Math.max(maxDB, this.peakDB - 3 * dt, -50);
    var decay = Math.exp(-dt / 0.12);
    var out = [];
    for (var c = 0; c < BARS; c++) {
      var raw = Math.min(1, Math.max(0, (db[c] - (this.peakDB - 30)) / 30));
      var prev = this.levels[c];
      var v = raw >= prev ? raw : raw + (prev - raw) * decay;
      this.levels[c] = v;
      out.push(v);
    }
    return out;
  };

  // ---------- A synthetic voice ----------
  // Speech-shaped sound, so the passive run is measured, not drawn:
  // a pitched source (harmonics of f0 with a falling tilt) shaped by
  // three vowel formants, in syllables with their own stress and pitch,
  // gaps between words, and the odd breathy consonant. Deterministic per
  // seed, so every run of the page looks the same.
  var VOWELS = [[730, 1090, 2440], [270, 2290, 3010], [300, 870, 2240], [530, 1840, 2480],
    [570, 840, 2410], [660, 1720, 2410], [440, 1020, 2240], [390, 1990, 2550]];
  var SR = 16000;
  var CHUNK = 1024;

  function Voice(seed, f0, length) {
    this.f0 = f0;
    this.length = length;
    this.syl = [];
    var time = 0.04, i = 0;
    while (time < length - 0.14) {
      var dur = 0.13 + 0.13 * hash(seed, i, 1);
      this.syl.push({
        start: time,
        end: Math.min(time + dur, length),
        vowel: VOWELS[Math.floor(hash(seed, i, 2) * VOWELS.length)],
        stress: 0.55 + 0.45 * hash(seed, i, 3),
        lift: (hash(seed, i, 4) - 0.4) * 0.25,
        fric: hash(seed, i, 5) < 0.3
      });
      time += dur + (hash(seed, i, 6) < 0.3 ? 0.07 + 0.1 * hash(seed, i, 7) : 0.015);
      i++;
    }
    this.seed = seed;
    this.n = 0;
  }
  Voice.prototype.chunk = function (tau) {
    var out = new Float32Array(CHUNK);
    var s = null;
    for (var i = 0; i < this.syl.length; i++) {
      if (tau >= this.syl[i].start && tau < this.syl[i].end) { s = this.syl[i]; break; }
    }
    this.n++;
    // A faint room hiss, so silence is not digital zero.
    for (var q = 0; q < CHUNK; q++) out[q] = (hash(this.seed, this.n, q) - 0.5) * 0.0004;
    if (!s) return out;
    var into = tau - s.start, left = s.end - tau;
    var env = Math.min(1, into / 0.03) * Math.min(1, left / 0.06) * s.stress;
    // Pitch falls across the phrase and wobbles a little per syllable.
    var f0 = this.f0 * (1 + s.lift - 0.12 * tau / this.length + 0.02 * Math.sin(tau * 31));
    var F = s.vowel;
    var BW = [90, 110, 170];
    var GAIN = [1, 0.75, 0.35];
    var gains = [], freqs = [], phases = [];
    for (var k = 1; k * f0 < 4600; k++) {
      var f = k * f0, g = 0;
      for (var m = 0; m < 3; m++) {
        var r = (f - F[m]) / BW[m];
        g += GAIN[m] / (1 + r * r);
      }
      gains.push(g * 0.35 / Math.sqrt(k) * env);
      freqs.push(2 * Math.PI * f / SR);
      phases.push(hash(this.seed, k, 8) * 6.283);
    }
    // Real pitch glides; a steady one would leave some bands sitting
    // between harmonics and dark. Integrate a glide across the chunk.
    var glide = (hash(this.seed, this.n, 9) - 0.5) * 0.24;
    var base = new Float64Array(CHUNK);
    var acc = 0;
    for (var p = 0; p < CHUNK; p++) {
      base[p] = acc;
      acc += 1 + glide * (p / CHUNK - 0.5);
    }
    for (var h = 0; h < gains.length; h++) {
      var gh = gains[h], wh = freqs[h], ph = phases[h];
      for (var j = 0; j < CHUNK; j++) out[j] += gh * Math.sin(wh * base[j] + ph);
    }
    // A consonant at the start of some syllables: high-passed noise.
    if (s.fric && into < 0.07) {
      var amp = 0.06 * s.stress * (1 - into / 0.07);
      var last = 0;
      for (var z = 0; z < CHUNK; z++) {
        var wn = hash(this.seed + 7, this.n, z) - 0.5;
        out[z] += (wn - last) * amp;
        last = wn;
      }
    }
    return out;
  };

  // The scripted run, in milliseconds: you ask, it thinks, it answers.
  var YOU_END = 1700;
  var THINK_END = 2500;

  // ---------- The animation ----------
  // WCAG 2.2.2: the passive run lasts at most 5 seconds, then the static
  // mark comes back. It plays only while the mark is on screen
  // (IntersectionObserver; without it, only the 5-second cap applies).
  // Scrolling the mark back into view starts a new run. Hiding the tab
  // pauses the run; showing it resumes what is left. Reduced motion ends
  // the run at once and restores the static mark. The microphone mode
  // runs only when the visitor starts it, and has its own stop button.
  function initMark() {
    var el = document.getElementById('hero-mark');
    if (!el || !window.setInterval) return;
    var modeEl = document.getElementById('mark-mode');
    var STATIC = el.textContent; // saved before the first frame
    var MAX_MS = 5000;
    var STEP_MS = 90;
    var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    var hasIO = typeof window.IntersectionObserver === 'function';
    var onScreen = !hasIO;
    var runOpen = false; // a run has started and still has time left
    var used = 0;        // ms of the current run already played
    var resumedAt = 0;
    var timer = null;
    var t = 12;
    var you, it, youMeter, itMeter;
    var mic = null;      // set while the microphone mode owns the mark

    function now() { return Date.now(); }
    function reduced() { return !!(mq && mq.matches); }
    function setListening(on) {
      if (el.classList) el.classList[on ? 'add' : 'remove']('is-listening');
    }
    function setMode(word) {
      if (modeEl && modeEl.textContent !== word) modeEl.textContent = word;
    }
    function clearTimer() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    }
    function endRun() {
      clearTimer();
      runOpen = false;
      used = 0;
      if (mic) return;
      setListening(false);
      setMode('');
      el.textContent = STATIC;
    }
    function scripted(e) {
      var dt = STEP_MS / 1000;
      if (e < YOU_END) {
        setMode('listening');
        return youMeter.process(you.chunk(e / 1000), dt);
      }
      if (e < THINK_END) {
        setMode('thinking');
        youMeter.process(new Float32Array(CHUNK), dt);
        return idleBars(t * 0.35, 0.22);
      }
      setMode('speaking');
      return itMeter.process(it.chunk((e - THINK_END) / 1000), dt);
    }
    function tick() {
      var e = used + (now() - resumedAt);
      // End on the tick whose successor would land past 5 seconds, so the
      // last animated frame never outlives the cap.
      if (e + STEP_MS > MAX_MS) {
        endRun();
        return;
      }
      el.textContent = frame(t, scripted(e));
      t += 1;
    }
    function play() {
      if (timer !== null || !runOpen || mic) return;
      if (!onScreen || document.hidden || reduced()) return;
      resumedAt = now();
      setListening(true);
      tick();
      if (runOpen) timer = setInterval(tick, STEP_MS);
    }
    function pause() {
      if (timer === null) return;
      clearTimer();
      used += now() - resumedAt;
      setListening(false);
    }
    function beginRun() {
      if (reduced() || mic) return;
      if (!runOpen) {
        runOpen = true;
        used = 0;
        you = new Voice(3, 196, YOU_END / 1000);
        it = new Voice(11, 118, (MAX_MS - THINK_END) / 1000);
        youMeter = new BandMeter(SR);
        itMeter = new BandMeter(SR);
      }
      play();
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        pause();
        if (mic) mic.stop();
      } else play();
    });
    if (mq) {
      var onMotion = function () {
        if (reduced()) endRun();
        else if (onScreen) beginRun();
      };
      if (mq.addEventListener) mq.addEventListener('change', onMotion);
      else if (mq.addListener) mq.addListener(onMotion);
    }
    if (hasIO) {
      new window.IntersectionObserver(function (entries) {
        var entry = entries[entries.length - 1];
        if (entry.isIntersecting) {
          if (!onScreen) {
            onScreen = true;
            beginRun();
          }
        } else if (onScreen) {
          onScreen = false;
          endRun();
        }
      }).observe(el);
    } else {
      beginRun();
    }

    initMic({
      take: function (session) {
        endRun();
        mic = session;
        setListening(true);
        setMode('listening');
      },
      draw: function (bars) {
        el.textContent = frame(t, bars);
      },
      advance: function (ticks) { t += ticks; },
      release: function () {
        mic = null;
        setListening(false);
        setMode('');
        el.textContent = STATIC;
      }
    });
  }

  // ---------- Microphone mode ----------
  // The visitor's own voice, through the same band meter the app uses.
  // The audio goes from the microphone to an analyser in this tab and
  // nowhere else: nothing is recorded, stored or sent. It stops on the
  // button, when the tab is hidden, or after a minute.
  function initMic(mark) {
    var button = document.getElementById('mark-mic');
    var note = document.getElementById('mark-note');
    var status = document.getElementById('mark-status');
    var AC = window.AudioContext || window.webkitAudioContext;
    var md = navigator.mediaDevices;
    if (!button || !AC || !md || typeof md.getUserMedia !== 'function') return;
    var LIMIT_MS = 60000;
    var session = null;
    var starting = false;

    function say(text) {
      if (!status) return;
      status.textContent = '';
      setTimeout(function () { status.textContent = text; }, 50);
    }
    function setPressed(on) {
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
      button.textContent = on ? '[ stop listening ]' : '[ talk to it ]';
    }

    function start() {
      starting = true;
      md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        .then(function (stream) {
          starting = false;
          var ctx = new AC();
          var source = ctx.createMediaStreamSource(stream);
          var analyser = ctx.createAnalyser();
          analyser.fftSize = 2048;
          source.connect(analyser);
          var buf = new Float32Array(analyser.fftSize);
          var meter = new BandMeter(ctx.sampleRate);
          var began = Date.now();
          var last = began;
          var carry = 0;
          var timer = null;
          session = {
            stop: function () {
              if (timer !== null) clearInterval(timer);
              timer = null;
              stream.getTracks().forEach(function (tr) { tr.stop(); });
              if (ctx.close) ctx.close();
              session = null;
              setPressed(false);
              mark.release();
            }
          };
          mark.take(session);
          setPressed(true);
          timer = setInterval(function () {
            var at = Date.now();
            if (at - began > LIMIT_MS) {
              session.stop();
              say('Stopped listening after a minute.');
              return;
            }
            var dt = (at - last) / 1000;
            last = at;
            analyser.getFloatTimeDomainData(buf);
            mark.draw(meter.process(buf, dt));
            // The renderer's dust moves once per 90 ms tick, as in the app.
            carry += dt / 0.09;
            var whole = Math.floor(carry);
            carry -= whole;
            mark.advance(whole);
          }, 40);
          if (ctx.resume) ctx.resume();
        })
        .catch(function () {
          starting = false;
          say('No microphone, or permission was not given. The mark stays still.');
        });
    }

    button.addEventListener('click', function () {
      if (session) session.stop();
      else if (!starting) start();
    });
    setPressed(false);
    button.removeAttribute('hidden');
    if (note) note.removeAttribute('hidden');
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
    var button = form.querySelector('button[type="submit"]');
    var pending = null;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!status) return;
      // Clear, then set on a later tick, so a repeat submit is announced again.
      status.textContent = '';
      if (pending !== null) clearTimeout(pending);
      pending = setTimeout(function () {
        pending = null;
        status.textContent = 'Not wired up yet. Check back here for news.';
      }, 50);
    });
    // The button ships disabled so the no-JS form cannot submit at all.
    if (button) button.disabled = false;
  }

  if (typeof document !== 'undefined') {
    initMark();
    initToggle();
    initForm();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { frame: frame, idleBars: idleBars, BandMeter: BandMeter, Voice: Voice };
  }
})();
