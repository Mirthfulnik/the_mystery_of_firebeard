// Музыка и звуки «Призрака Огнеборода», синтезированные в браузере (Web Audio).
// Чтобы заменить любой звук своим файлом, положите его в папку audio/
// с именем по ID из ТЗ: например audio/MU-01.mp3 или audio/SFX-01.mp3.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

const MUSIC_IDS = ['MU-01', 'MU-02', 'MU-03', 'MU-04', 'MU-05', 'MU-06', 'MU-07', 'MU-08', 'MU-09'];
const SFX_IDS = Array.from({ length: 22 }, (_, i) => 'SFX-' + String(i + 1).padStart(2, '0'));

export class GameAudio {
  constructor() {
    this.ctx = null;
    this.files = {};
    this.musicVol = 0.7;
    this.sfxVol = 0.9;
    this.muted = false;
    this.current = null;
    this.currentId = null;
  }

  // Нужно вызвать из обработчика клика: браузеры не дают звуку играть без жеста.
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.build(this.ctx);
    this.probeFiles();
  }

  build(ctx) {
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 1;
    this.comp.connect(this.master).connect(ctx.destination);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.musicBus.connect(this.comp);
    this.sfxBus.connect(this.comp);
    this.verb = ctx.createConvolver();
    this.verb.buffer = impulse(ctx, 2.8, 2.6);
    this.verbIn = ctx.createGain();
    this.verbIn.gain.value = 0.9;
    this.verbIn.connect(this.verb).connect(this.comp);
    this.noise = noiseBuffer(ctx, 3);
  }

  // Свои файлы перечисляются в audio/files.json, например: ["MU-01.mp3", "SFX-01.mp3"]
  async probeFiles() {
    try {
      const r = await fetch('audio/files.json', { cache: 'no-store' });
      if (!r.ok) return;
      const list = await r.json();
      for (const f of list) {
        const id = String(f).replace(/\.[a-z0-9]+$/i, '');
        if ([...MUSIC_IDS, ...SFX_IDS].includes(id)) this.files[id] = 'audio/' + f;
      }
    } catch (e) { /* нет списка — играем синтезатором */ }
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.05);
    if (this.current && this.current.el) this.current.el.muted = m;
  }

  setMusicVol(v) { this.musicVol = v; if (this.musicBus) this.musicBus.gain.value = v; if (this.current && this.current.el) this.current.el.volume = v; }
  setSfxVol(v) { this.sfxVol = v; if (this.sfxBus) this.sfxBus.gain.value = v; }

  // ---------- Музыка ----------
  music(id) {
    if (!this.ctx || id === this.currentId) return;
    this.stopMusic(1.6);
    this.currentId = id;
    if (!id) return;
    if (this.files[id]) {
      const el = new Audio(this.files[id]);
      el.loop = !['MU-08', 'MU-09'].includes(id);
      el.volume = this.musicVol;
      el.muted = this.muted;
      el.play().catch(() => {});
      this.current = { el, id };
      return;
    }
    const tr = TRACKS[id];
    if (!tr) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.linearRampToValueAtTime(tr.gain || 1, ctx.currentTime + 1.2);
    out.connect(this.musicBus);
    const send = ctx.createGain();
    send.gain.value = tr.verb ?? 0.25;
    out.connect(send).connect(this.verbIn);
    const spb = 60 / tr.bpm;
    const barDur = spb * (tr.beats || 4);
    const state = { out, id, bar: 0, t: ctx.currentTime + 0.15, stopped: false };
    const kit = this.kit(out);
    const tick = () => {
      if (state.stopped) return;
      while (state.t < ctx.currentTime + 1.2) {
        if (!tr.loop && state.bar >= tr.bars) {
          if (!state.ended) { state.ended = true; if (tr.end) tr.end(kit, state.t, spb); }
          return;
        }
        tr.bar(kit, state.t, state.bar % tr.bars, spb, state.bar);
        state.t += barDur;
        state.bar++;
      }
    };
    tick();
    state.timer = setInterval(tick, 250);
    this.current = state;
  }

  stopMusic(fade = 1.2) {
    const c = this.current;
    this.current = null;
    this.currentId = null;
    if (!c) return;
    if (c.el) {
      const el = c.el;
      const v0 = el.volume;
      const st = performance.now();
      const f = () => {
        const k = Math.min(1, (performance.now() - st) / (fade * 1000));
        el.volume = v0 * (1 - k);
        if (k < 1) requestAnimationFrame(f); else el.pause();
      };
      f();
      return;
    }
    c.stopped = true;
    clearInterval(c.timer);
    const g = c.out.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => c.out.disconnect(), fade * 1000 + 3000);
  }

  // ---------- Эффекты ----------
  sfx(id, opts = {}) {
    if (!this.ctx) return;
    if (this.files[id]) {
      const el = new Audio(this.files[id]);
      el.volume = this.sfxVol;
      el.muted = this.muted;
      el.play().catch(() => {});
      return;
    }
    const f = SFX[id];
    if (!f) return;
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = (opts.gain ?? 1) * (SFX_GAIN[id] || 1);
    out.connect(this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = opts.verb ?? 0.35;
    out.connect(send).connect(this.verbIn);
    const t = ctx.currentTime + 0.03 + (opts.delay || 0);
    const dur = f(this.kit(out), t, opts) || 4;
    setTimeout(() => out.disconnect(), (dur + (opts.delay || 0) + 4) * 1000);
    return dur;
  }

  // последовательность эффектов с паузами
  seq(ids, gap = 0.9) {
    let d = 0;
    for (const id of ids) {
      const len = SFX_LEN[id] ?? 1;
      this.sfx(id, { delay: d });
      d += Math.min(len, 2.2) * 0.7 + gap * 0.3;
    }
  }

  // набор инструментов, подключённых к выходу out
  kit(out) {
    const ctx = this.ctx;
    const noise = this.noise;
    const K = { ctx, out };

    K.env = (param, t, a, hold, r, peak = 1, base = 0.0001) => {
      param.cancelScheduledValues(t);
      param.setValueAtTime(base, t);
      param.linearRampToValueAtTime(peak, t + a);
      param.setValueAtTime(peak, t + a + hold);
      param.exponentialRampToValueAtTime(0.0001, t + a + hold + r);
    };

    K.osc = (type, freq, t, dur, dest = out) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      o.connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
      return o;
    };

    K.gain = (v = 1, dest = out) => { const g = ctx.createGain(); g.gain.value = v; g.connect(dest); return g; };

    K.filter = (type, freq, q = 1, dest = out) => {
      const f = ctx.createBiquadFilter();
      f.type = type; f.frequency.value = freq; f.Q.value = q;
      f.connect(dest);
      return f;
    };

    K.noise = (t, dur, dest = out, rate = 1) => {
      const s = ctx.createBufferSource();
      s.buffer = noise;
      s.playbackRate.value = rate;
      s.loop = true;
      s.connect(dest);
      s.start(t, Math.random() * 2);
      s.stop(t + dur + 0.05);
      return s;
    };

    // Электроорган: несколько гармоник, лёгкое вибрато
    K.organ = (m, t, dur, vel = 0.12, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.02, Math.max(0, dur - 0.06), 0.18, vel);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6.2;
      const lg = ctx.createGain(); lg.gain.value = 3;
      lfo.connect(lg); lfo.start(t); lfo.stop(t + dur + 0.3);
      [[1, 1], [2, 0.5], [3, 0.28], [4, 0.18], [0.5, 0.35]].forEach(([h, a]) => {
        const og = K.gain(a, g);
        const o = K.osc('sine', mtof(m) * h, t, dur + 0.25, og);
        lg.connect(o.frequency);
      });
    };

    // Контрабас пиццикато
    K.bass = (m, t, dur = 0.4, vel = 0.32, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.008, 0.02, Math.max(0.15, dur), vel);
      const lp = K.filter('lowpass', 700, 1.5, g);
      lp.frequency.setValueAtTime(1400, t);
      lp.frequency.exponentialRampToValueAtTime(320, t + 0.25);
      K.osc('triangle', mtof(m), t, dur + 0.3, lp);
      const s2 = K.gain(0.3, lp);
      K.osc('sawtooth', mtof(m), t, dur + 0.3, s2);
    };

    // Клавесин
    K.harpsi = (m, t, dur = 0.3, vel = 0.09, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.003, 0.01, dur + 0.25, vel);
      const hp = K.filter('highpass', 400, 0.7, g);
      K.osc('sawtooth', mtof(m), t, dur + 0.3, hp);
      const o2 = K.gain(0.5, hp);
      K.osc('square', mtof(m) * 2.001, t, dur + 0.3, o2);
    };

    // Терменвокс: синус с глиссандо и вибрато
    K.theremin = (notes, t, spb, vel = 0.11, dest = out) => {
      // notes: [[midi, beats], ...]
      let total = notes.reduce((a, n) => a + n[1], 0) * spb;
      const g = K.gain(0, dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.25);
      g.gain.setValueAtTime(vel, t + total - 0.3);
      g.gain.linearRampToValueAtTime(0.0001, t + total + 0.2);
      const o = ctx.createOscillator(); o.type = 'sine';
      const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5;
      const lg = ctx.createGain(); lg.gain.value = 9;
      lfo.connect(lg).connect(o.frequency);
      let tt = t;
      o.frequency.setValueAtTime(mtof(notes[0][0]), t);
      for (const [m, b] of notes) {
        o.frequency.setTargetAtTime(mtof(m), tt, 0.07);
        tt += b * spb;
      }
      const o2g = K.gain(0.12, g);
      const o2 = ctx.createOscillator(); o2.type = 'triangle';
      o2.frequency.setValueAtTime(mtof(notes[0][0]) * 2, t);
      tt = t; for (const [m, b] of notes) { o2.frequency.setTargetAtTime(mtof(m) * 2, tt, 0.07); tt += b * spb; }
      lg.connect(o2.frequency);
      o.connect(g); o2.connect(o2g);
      [o, o2, lfo].forEach(x => { x.start(t); x.stop(t + total + 0.4); });
    };

    K.swoop = (m1, m2, t, dur, vel = 0.1, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.15, dur - 0.4, 0.3, vel);
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(mtof(m1), t);
      o.frequency.exponentialRampToValueAtTime(mtof(m2), t + dur * 0.6);
      o.frequency.exponentialRampToValueAtTime(mtof(m1 + 5), t + dur);
      const lfo = ctx.createOscillator(); lfo.frequency.value = 6;
      const lg = ctx.createGain(); lg.gain.value = 12;
      lfo.connect(lg).connect(o.frequency);
      o.connect(g);
      [o, lfo].forEach(x => { x.start(t); x.stop(t + dur + 0.1); });
    };

    // Струнные: расстроенные пилы через фильтр, медленная атака
    K.strings = (ms, t, dur, vel = 0.05, dest = out, attack = 0.8) => {
      const g = K.gain(0, dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel, t + attack);
      g.gain.setValueAtTime(vel, t + Math.max(attack, dur - 0.6));
      g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
      const lp = K.filter('lowpass', 1600, 0.6, g);
      for (const m of ms) {
        for (const d of [-7, 0, 6]) {
          const o = K.osc('sawtooth', mtof(m), t, dur + 0.7, lp);
          o.detune.value = d;
        }
      }
    };

    // Тремоло виолончелей
    K.trem = (m, t, dur, vel = 0.08, dest = out) => {
      const g = K.gain(0, dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const am = ctx.createGain(); am.gain.value = 0.5; am.connect(g);
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 11;
      const lg = ctx.createGain(); lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      const lp = K.filter('lowpass', 900, 0.8, am);
      K.osc('sawtooth', mtof(m), t, dur, lp);
      lfo.start(t); lfo.stop(t + dur);
    };

    // Вибрафон / челеста
    K.vibes = (m, t, dur = 1.5, vel = 0.08, dest = out, trem = 4.5) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.004, 0.02, dur, vel);
      const am = ctx.createGain(); am.gain.value = 0.75; am.connect(g);
      if (trem) {
        const lfo = ctx.createOscillator(); lfo.frequency.value = trem;
        const lg = ctx.createGain(); lg.gain.value = 0.25;
        lfo.connect(lg).connect(am.gain); lfo.start(t); lfo.stop(t + dur + 0.1);
      }
      K.osc('sine', mtof(m), t, dur, am);
      const h = K.gain(0.18, am); K.osc('sine', mtof(m) * 4, t, dur * 0.4, h);
    };

    // Аккордеон
    K.accordion = (m, t, dur, vel = 0.07, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.03, Math.max(0, dur - 0.08), 0.08, vel);
      const bp = K.filter('lowpass', 2600, 0.8, g);
      for (const d of [-9, 9]) { const o = K.osc('sawtooth', mtof(m), t, dur + 0.1, bp); o.detune.value = d; }
      const o3 = K.osc('square', mtof(m - 12), t, dur + 0.1, K.gain(0.3, bp));
      void o3;
    };

    // Колокол: негармонические обертоны
    K.bell = (m, t, dur = 4, vel = 0.12, dest = out) => {
      const f = mtof(m);
      [[0.5, 0.6, 1.2], [1, 1, 1], [1.19, 0.5, 0.7], [1.56, 0.35, 0.5], [2, 0.4, 0.6], [2.74, 0.25, 0.35], [3.76, 0.12, 0.2], [5.4, 0.08, 0.12]].forEach(([r, a, dd]) => {
        const g = K.gain(0, dest);
        K.env(g.gain, t, 0.002, 0, dur * dd, vel * a);
        K.osc('sine', f * r, t, dur * dd + 0.1, g);
      });
    };

    // Ударные
    K.kick = (t, vel = 0.5, f0 = 120, f1 = 45, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.002, 0.02, 0.35, vel);
      const o = K.osc('sine', f0, t, 0.5, g);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.18);
    };
    K.snap = (t, vel = 0.2, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.001, 0.005, 0.07, vel);
      const bp = K.filter('bandpass', 2400, 3, g);
      K.noise(t, 0.12, bp);
    };
    K.brush = (t, dur = 0.35, vel = 0.05, dest = out) => {
      const g = K.gain(0, dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel, t + dur * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      const bp = K.filter('bandpass', 5200, 0.6, g);
      K.noise(t, dur, bp);
    };
    K.ride = (t, vel = 0.025, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.001, 0.01, 0.6, vel);
      const hp = K.filter('highpass', 6500, 0.5, g);
      K.noise(t, 0.7, hp);
      const p = K.gain(0.25, g);
      K.osc('square', 3150, t, 0.5, p);
    };
    K.wood = (t, vel = 0.18, f = 900, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.001, 0.005, 0.09, vel);
      const bp = K.filter('bandpass', f, 8, g);
      K.noise(t, 0.12, bp);
      const s = K.gain(0.5, g); K.osc('sine', f, t, 0.08, s);
    };
    K.timpani = (m, t, vel = 0.35, dest = out) => {
      const g = K.gain(0, dest);
      K.env(g.gain, t, 0.004, 0.05, 1.6, vel);
      const o = K.osc('sine', mtof(m) * 1.05, t, 2, g);
      o.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.2);
      const n = K.gain(0, dest);
      K.env(n.gain, t, 0.001, 0.01, 0.2, vel * 0.5);
      K.noise(t, 0.3, K.filter('lowpass', 500, 1, n));
    };

    // Волны: шумовой накат
    K.waves = (t, dur, vel = 0.06, dest = out) => {
      const g = K.gain(0, dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel, t + dur * 0.45);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const lp = K.filter('lowpass', 500, 0.5, g);
      lp.frequency.setValueAtTime(300, t);
      lp.frequency.linearRampToValueAtTime(1100, t + dur * 0.45);
      lp.frequency.linearRampToValueAtTime(250, t + dur);
      K.noise(t, dur, lp);
    };

    // Скрип дерева: импульсы через резонансный фильтр
    K.creak = (t, dur = 1.2, vel = 0.12, f = 380, dest = out) => {
      const g = K.gain(0, dest);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vel, t + 0.1);
      g.gain.setValueAtTime(vel, t + dur - 0.2);
      g.gain.linearRampToValueAtTime(0.0001, t + dur);
      const bp = K.filter('bandpass', f, 12, g);
      const bp2 = K.filter('bandpass', f * 2.3, 10, g);
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(28, t);
      o.frequency.linearRampToValueAtTime(55, t + dur * 0.5);
      o.frequency.linearRampToValueAtTime(34, t + dur);
      o.connect(bp); o.connect(bp2);
      o.start(t); o.stop(t + dur + 0.05);
    };

    // Голос с формантами — для хохота
    K.voice = (t, syl, f0, vel = 0.3, dest = out) => {
      // syl: [{v:'o'|'a', d, pitch:[start,end]}]
      const F = { o: [[480, 1], [820, 0.6], [2600, 0.12]], a: [[760, 1], [1220, 0.6], [2700, 0.15]], h: [[1200, 0.3], [2500, 0.3]] };
      let tt = t;
      for (const s of syl) {
        // придыхание «х»
        const hg = K.gain(0, dest);
        K.env(hg.gain, tt, 0.01, 0.03, 0.05, vel * 0.25);
        K.noise(tt, 0.12, K.filter('bandpass', 1500, 1, hg));
        const vt = tt + 0.04;
        const g = K.gain(0, dest);
        g.gain.setValueAtTime(0.0001, vt);
        g.gain.linearRampToValueAtTime(vel, vt + 0.03);
        g.gain.setValueAtTime(vel, vt + s.d * 0.55);
        g.gain.exponentialRampToValueAtTime(0.0001, vt + s.d);
        const src = ctx.createOscillator(); src.type = 'sawtooth';
        src.frequency.setValueAtTime(f0 * s.pitch[0], vt);
        src.frequency.linearRampToValueAtTime(f0 * s.pitch[1], vt + s.d);
        const jit = ctx.createOscillator(); jit.frequency.value = 23;
        const jg = ctx.createGain(); jg.gain.value = f0 * 0.03;
        jit.connect(jg).connect(src.frequency);
        for (const [ff, a] of F[s.v]) {
          const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = ff; bp.Q.value = 7;
          const ag = ctx.createGain(); ag.gain.value = a * 3;
          src.connect(bp).connect(ag).connect(g);
        }
        if (s.rasp) {
          const rg = K.gain(0, g);
          K.env(rg.gain, vt, 0.05, s.d * 0.5, 0.2, 0.6);
          K.noise(vt, s.d, K.filter('bandpass', 900, 2, rg));
        }
        [src, jit].forEach(x => { x.start(vt); x.stop(vt + s.d + 0.05); });
        tt += s.d + (s.gap ?? 0.05);
      }
      return tt - t;
    };

    return K;
  }
}

// ---------- Вспомогательное ----------
function noiseBuffer(ctx, sec) {
  const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function impulse(ctx, sec, decay) {
  const len = ctx.sampleRate * sec;
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * 0.5;
  }
  return b;
}

const CH = {
  Dm: [62, 65, 69], Gm: [55, 58, 62], A7: [57, 61, 64, 67], Bb: [58, 62, 65], A: [57, 61, 64],
  Dm7: [62, 65, 69, 72], Gm7: [55, 58, 62, 65], Em7b5: [52, 55, 58, 62], C: [60, 64, 67], F: [53, 57, 60],
  D: [62, 66, 69], G: [55, 59, 62], Am: [57, 60, 64],
};
const ROOT = { Dm: 38, Gm: 43, A7: 45, Bb: 46, A: 45, Dm7: 38, Gm7: 43, Em7b5: 40, C: 36, F: 41, D: 38, G: 43, Am: 45 };

function walk(K, prog, b, t, spb, vel, swing = 0) {
  const ch = prog[b];
  const nx = prog[(b + 1) % prog.length];
  const r = ROOT[ch];
  const third = CH[ch][1] - CH[ch][0];
  const line = [r, r + third, r + 7, ROOT[nx] + (Math.random() < 0.5 ? 1 : -1)];
  line.forEach((m, i) => K.bass(m, t + i * spb + (i % 2 ? swing : 0), spb * 0.9, vel));
}

// ---------- Треки ----------
const TRACKS = {
  // Титул и лобби: весёлая жуть
  'MU-01': {
    bpm: 112, bars: 8, loop: true, gain: 1.1, verb: 0.3,
    bar(K, t, b, spb) {
      const prog = ['Dm', 'Dm', 'Gm', 'Dm', 'Bb', 'A7', 'Dm', 'A7'];
      walk(K, prog, b, t, spb, 0.34, spb * 0.08);
      [1, 3].forEach(i => {
        CH[prog[b]].forEach(m => K.organ(m, t + i * spb, spb * 0.35, 0.05));
        K.snap(t + i * spb, 0.28);
      });
      K.ride(t, 0.015); K.ride(t + 2 * spb, 0.012);
      if (b === 0) K.theremin([[74, 1], [77, 1], [76, 0.5], [74, 0.5], [73, 1.5], [69, 1], [70, 1.5], [69, 1]], t + spb * 0.5, spb, 0.08);
      if (b === 4) K.theremin([[70, 1.5], [69, 0.5], [67, 1], [65, 1], [64, 1.5], [65, 0.5], [67, 1], [69, 2]], t + spb * 0.5, spb, 0.08);
    },
  },
  // Пролог: тревожные струнные
  'MU-02': {
    bpm: 60, bars: 8, loop: true, gain: 1.8, verb: 0.5,
    bar(K, t, b, spb) {
      const prog = [['Dm', 50], ['Dm', 50], ['Bb', 46], ['Bb', 46], ['Gm', 43], ['Gm', 43], ['A', 45], ['A7', 45]];
      const [ch, low] = prog[b];
      K.trem(low - 12, t, spb * 4, 0.07);
      if (b % 2 === 0) K.strings(CH[ch].map(m => m - 12), t, spb * 8, 0.035);
      if (b === 0 || b === 4) K.timpani(38, t, 0.4);
      if (b === 6) { K.timpani(45, t, 0.3); K.timpani(45, t + spb * 2, 0.35); }
      if (b === 7) K.strings([81, 82], t + spb, spb * 3, 0.012, K.out, 2);
    },
  },
  // Чтение карточек: тихий эмбиент — гул, море, скрипы
  'MU-03': {
    bpm: 60, bars: 4, loop: true, gain: 1.8, verb: 0.45,
    bar(K, t, b, spb) {
      const len = spb * 4;
      K.strings([38, 45], t, len, 0.022, K.out, 1.5);
      K.waves(t, len, 0.07);
      if (Math.random() < 0.45) K.creak(t + Math.random() * 2, 0.9 + Math.random(), 0.05, 300 + Math.random() * 200);
      if (b === 3 && Math.random() < 0.5) K.bell(62, t + 1, 5, 0.03);
      if (b === 1) K.vibes(74, t + 2, 3, 0.02, K.out, 0);
    },
  },
  // Обсуждение: крадущийся джаз-нуар
  'MU-04': {
    bpm: 96, bars: 8, loop: true, gain: 1.35, verb: 0.3,
    bar(K, t, b, spb) {
      const prog = ['Dm7', 'Dm7', 'Gm7', 'Gm7', 'Em7b5', 'A7', 'Dm7', 'A7'];
      walk(K, prog, b, t, spb, 0.26, spb * 0.1);
      for (let i = 0; i < 4; i++) K.ride(t + i * spb, 0.012);
      K.ride(t + 1.66 * spb, 0.008); K.ride(t + 3.66 * spb, 0.008);
      K.brush(t + spb, 0.3, 0.035); K.brush(t + 3 * spb, 0.3, 0.035);
      if (b % 2 === 0) CH[prog[b]].forEach(m => K.vibes(m + 12, t + spb * 0.02, spb * 3.5, 0.022));
      if (b === 3) [74, 77, 76, 72].forEach((m, i) => K.vibes(m, t + (1 + i * 0.66) * spb, 1, 0.03));
      if (b === 7) [69, 72, 70, 67].forEach((m, i) => K.vibes(m, t + (0.5 + i * 0.75) * spb, 1, 0.026));
    },
  },
  // Шоу призрака: комичная погоня
  'MU-05': {
    bpm: 152, bars: 4, loop: true, gain: 1.3, verb: 0.25,
    bar(K, t, b, spb) {
      const prog = ['Dm', 'Dm', 'Gm', 'A7'];
      const ch = CH[prog[b]];
      const arp = [ch[0], ch[1], ch[2], ch[0] + 12, ch[2], ch[1], ch[0], ch[1]];
      arp.forEach((m, i) => K.harpsi(m + 12, t + i * spb / 2, spb / 2, 0.06));
      [0, 2].forEach(i => K.bass(ROOT[prog[b]], t + i * spb, spb * 0.8, 0.3));
      [1, 3].forEach(i => CH[prog[b]].forEach(m => K.harpsi(m, t + i * spb, spb * 0.4, 0.035)));
      for (let i = 0; i < 4; i++) K.wood(t + i * spb, i % 2 ? 0.08 : 0.13, i % 2 ? 1200 : 850);
      if (b === 0) K.swoop(62, 86, t, spb * 3.5, 0.06);
      if (b === 2) K.swoop(67, 91, t + spb, spb * 2.8, 0.05);
    },
  },
  // Полночь: тяжёлый орган и колокол
  'MU-06': {
    bpm: 50, bars: 4, loop: true, gain: 0.85, verb: 0.55,
    bar(K, t, b, spb) {
      const prog = ['Dm', 'Bb', 'Gm', 'A7'];
      const ch = CH[prog[b]];
      [...ch, ch[0] + 12].forEach(m => K.organ(m, t, spb * 3.8, 0.04));
      K.organ(ROOT[prog[b]] - 12, t, spb * 3.9, 0.07);
      K.organ(ROOT[prog[b]], t, spb * 3.9, 0.05);
      K.bell(50, t, 6, 0.08);
    },
  },
  // Голосование: тиканье и пульс
  'MU-07': {
    bpm: 100, bars: 2, loop: true, gain: 1.45, verb: 0.2,
    bar(K, t, b, spb) {
      for (let i = 0; i < 4; i++) K.wood(t + i * spb, 0.07, i % 2 ? 2200 : 1700);
      K.kick(t, 0.35, 80, 40); K.kick(t + spb * 0.4, 0.22, 80, 40);
      K.kick(t + spb * 2, 0.3, 80, 40); K.kick(t + spb * 2.4, 0.18, 80, 40);
      if (b === 0) K.strings([50, 51, 57], t, spb * 8, 0.025, K.out, spb * 6);
    },
  },
  // Дело раскрыто: бодрая морская тема
  'MU-08': {
    bpm: 132, bars: 8, loop: false, gain: 0.95, verb: 0.3,
    bar(K, t, b, spb) {
      const mel = [
        [[69, 1], [74, 1], [74, 1], [76, 1]], [[78, 1], [76, 1], [74, 1], [71, 1]],
        [[69, 1], [69, 1], [71, 1], [74, 1]], [[76, 2], [78, 1], [76, 1]],
        [[74, 1], [78, 1], [81, 1], [78, 1]], [[79, 1], [76, 1], [73, 1], [76, 1]],
        [[74, 1], [71, 1], [69, 1], [73, 1]], [[74, 4]],
      ];
      const prog = ['D', 'D', 'G', 'A', 'D', 'A', 'A', 'D'];
      let tt = t;
      for (const [m, d] of mel[b]) { K.accordion(m, tt, d * spb * 0.92, 0.06); tt += d * spb; }
      K.bass(ROOT[prog[b]], t, spb * 0.8, 0.32); K.bass(ROOT[prog[b]] + 7, t + 2 * spb, spb * 0.8, 0.28);
      [1, 3].forEach(i => CH[prog[b]].forEach(m => K.accordion(m - 12, t + i * spb, spb * 0.4, 0.025)));
      K.kick(t, 0.25); K.snap(t + spb, 0.12); K.kick(t + 2 * spb, 0.2); K.snap(t + 3 * spb, 0.12);
    },
    end(K, t, spb) {
      CH.D.forEach(m => K.accordion(m, t, spb * 3, 0.05));
      K.bass(38, t, spb * 2, 0.35); K.kick(t, 0.35);
    },
  },
  // Дело не раскрыто: зловещий вальс
  'MU-09': {
    bpm: 84, beats: 3, bars: 8, loop: false, gain: 1.6, verb: 0.55,
    bar(K, t, b, spb) {
      const mel = [
        [[69, 1], [74, 1], [77, 1]], [[76, 2], [74, 1]], [[73, 1], [76, 1], [81, 1]], [[79, 3]],
        [[77, 1], [76, 1], [74, 1]], [[70, 2], [69, 1]], [[76, 1], [73, 1], [69, 1]], [[74, 3]],
      ];
      const prog = ['Dm', 'Dm', 'A', 'A', 'Dm', 'Gm', 'A', 'Dm'];
      let tt = t;
      for (const [m, d] of mel[b]) { K.vibes(m + 12, tt, d * spb + 0.8, 0.05, K.out, 0); tt += d * spb; }
      K.bass(ROOT[prog[b]], t, spb, 0.28);
      [1, 2].forEach(i => CH[prog[b]].forEach(m => K.organ(m, t + i * spb, spb * 0.5, 0.025)));
    },
    end(K, t) {
      K.organ(38, t, 4, 0.06); CH.Dm.forEach(m => K.organ(m, t, 4, 0.03));
      K.voice(t + 2, LAUGH, 105, 0.22);
    },
  },
};

const LAUGH = [
  { v: 'o', d: 0.22, pitch: [1.25, 1.05] },
  { v: 'o', d: 0.22, pitch: [1.2, 1.0] },
  { v: 'o', d: 0.26, pitch: [1.15, 0.95] },
  { v: 'a', d: 0.3, pitch: [1.45, 1.2], gap: 0.06 },
  { v: 'a', d: 0.42, pitch: [1.35, 0.95] },
];

// ---------- Эффекты ----------
const SFX = {
  // Хохот Огнеборода. opts.variant: 'choke' — обрывается хрипом, 'far' — издалека
  'SFX-01'(K, t, o = {}) {
    if (o.variant === 'choke') {
      const syl = LAUGH.slice(0, 3).concat([{ v: 'a', d: 0.7, pitch: [1.2, 0.6], rasp: true }]);
      return K.voice(t, syl, 100, 0.32) + 0.5;
    }
    const vel = o.variant === 'far' ? 0.14 : 0.34;
    const a = K.voice(t, LAUGH, 100, vel);
    K.voice(t + a + 0.15, LAUGH.slice(2), 96, vel * 0.8);
    return a * 2;
  },
  // Свист сабли
  'SFX-02'(K, t) {
    const g = K.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    const bp = K.filter('bandpass', 400, 4, g);
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(3200, t + 0.32);
    bp.frequency.exponentialRampToValueAtTime(600, t + 0.7);
    K.noise(t, 0.75, bp);
    return 0.8;
  },
  // Удар сабли в дерево
  'SFX-03'(K, t) {
    K.kick(t, 0.6, 180, 70);
    K.wood(t, 0.4, 420);
    const g = K.gain(0);
    K.env(g.gain, t + 0.01, 0.001, 0.0, 0.5, 0.08);
    K.osc('triangle', 1650, t, 0.5, g).frequency.linearRampToValueAtTime(1610, t + 0.5);
    return 0.8;
  },
  // Шипение сухого льда
  'SFX-04'(K, t) {
    const g = K.gain(0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.3);
    g.gain.linearRampToValueAtTime(0.1, t + 1.6);
    g.gain.linearRampToValueAtTime(0.0001, t + 2.4);
    K.noise(t, 2.5, K.filter('highpass', 3500, 0.7, g));
    for (let i = 0; i < 26; i++) {
      const tt = t + Math.random() * 2.2;
      const b = K.gain(0); K.env(b.gain, tt, 0.001, 0, 0.03, 0.08 * Math.random());
      K.noise(tt, 0.04, K.filter('bandpass', 2000 + Math.random() * 3000, 4, b));
    }
    return 2.5;
  },
  // Мыльные пузыри
  'SFX-05'(K, t) {
    for (let i = 0; i < 14; i++) {
      const tt = t + i * 0.09 + Math.random() * 0.12;
      const g = K.gain(0); K.env(g.gain, tt, 0.004, 0.02, 0.08, 0.12);
      const f = 300 + Math.random() * 500;
      const o = K.osc('sine', f, tt, 0.15, g);
      o.frequency.exponentialRampToValueAtTime(f * 2.6, tt + 0.08);
    }
    return 1.7;
  },
  // Падение тела
  'SFX-06'(K, t) {
    K.kick(t, 0.8, 90, 35);
    K.kick(t + 0.16, 0.45, 70, 30);
    const g = K.gain(0); K.env(g.gain, t, 0.005, 0.05, 0.6, 0.22);
    K.noise(t, 0.8, K.filter('lowpass', 380, 1, g));
    return 1;
  },
  // Шум моря
  'SFX-07'(K, t) { K.waves(t, 5, 0.14); K.waves(t + 3.5, 5, 0.1); return 8.5; },
  // Бой часов, 12 ударов
  'SFX-08'(K, t, o = {}) {
    const n = o.count || 12;
    for (let i = 0; i < n; i++) K.bell(55, t + i * 1.25, 3.5, 0.13);
    return n * 1.25 + 2;
  },
  // Половина часа, 1 удар
  'SFX-09'(K, t) { K.bell(55, t, 4, 0.14); return 3; },
  // Звон вилки
  'SFX-10'(K, t) {
    [0, 0.14, 0.24, 0.3].forEach((d, i) => {
      [3100, 4730, 6890].forEach((f, j) => {
        const g = K.gain(0); K.env(g.gain, t + d, 0.001, 0, 0.25 - i * 0.04, (0.09 - j * 0.02) * (1 - i * 0.2));
        K.osc('sine', f * (1 + i * 0.01), t + d, 0.3, g);
      });
    });
    return 0.8;
  },
  // Скрип люка
  'SFX-11'(K, t) { K.creak(t, 1.6, 0.25, 420); K.kick(t + 1.6, 0.3, 110, 50); return 2; },
  // Вспышка фотоаппарата
  'SFX-12'(K, t) {
    K.snap(t, 0.4);
    const g = K.gain(0);
    g.gain.setValueAtTime(0.0001, t + 0.05);
    g.gain.linearRampToValueAtTime(0.05, t + 0.15);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.4);
    const o = K.osc('sine', 1800, t + 0.05, 1.4, g);
    o.frequency.exponentialRampToValueAtTime(7500, t + 1.4);
    K.snap(t + 0.02, 0.25);
    return 1.5;
  },
  // Колокольчик для дворецкого
  'SFX-13'(K, t) {
    for (let i = 0; i < 3; i++) K.bell(93, t + i * 0.16, 1.4, 0.08);
    return 1.8;
  },
  // Хруст скорлупы
  'SFX-14'(K, t) {
    for (let i = 0; i < 18; i++) {
      const tt = t + Math.random() * 0.35;
      const g = K.gain(0); K.env(g.gain, tt, 0.001, 0.003, 0.03, 0.25 * Math.random() + 0.05);
      K.noise(tt, 0.05, K.filter('bandpass', 1200 + Math.random() * 3000, 2, g));
    }
    return 0.6;
  },
  // Магнитофон: щелчок, шипение, кашель и хрип
  'SFX-15'(K, t) {
    K.wood(t, 0.35, 1500); K.snap(t + 0.05, 0.2);
    const h = K.gain(0);
    h.gain.setValueAtTime(0.0001, t + 0.1);
    h.gain.linearRampToValueAtTime(0.05, t + 0.3);
    h.gain.setValueAtTime(0.05, t + 6.5);
    h.gain.linearRampToValueAtTime(0.0001, t + 7);
    K.noise(t + 0.1, 7, K.filter('bandpass', 4000, 0.5, h));
    // кашель
    [1.0, 1.35, 1.65].forEach((d, i) => {
      const g = K.gain(0); K.env(g.gain, t + d, 0.01, 0.06, 0.12, 0.3 - i * 0.05);
      K.noise(t + d, 0.25, K.filter('bandpass', 700 + i * 80, 1.5, g));
    });
    // хрип «Гнилл… шприц…» — шёпотом, сквозь помехи
    const breath = (tt, len, f, v) => {
      const g = K.gain(0);
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(v, tt + len * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, tt + len);
      const bp = K.filter('bandpass', f, 3, g);
      bp.frequency.linearRampToValueAtTime(f * 0.8, tt + len);
      K.noise(tt, len, bp);
    };
    breath(t + 2.4, 0.5, 900, 0.16);
    breath(t + 2.95, 0.35, 1400, 0.12);
    breath(t + 4.0, 0.3, 4200, 0.12);
    breath(t + 4.35, 0.45, 2600, 0.12);
    breath(t + 5.2, 0.9, 600, 0.12);
    K.voice(t + 5.3, [{ v: 'a', d: 0.8, pitch: [0.9, 0.55], rasp: true }], 90, 0.08);
    K.wood(t + 7, 0.3, 1500);
    return 7.3;
  },
  // Всплеск за бортом
  'SFX-16'(K, t) {
    K.kick(t, 0.3, 70, 40);
    const g = K.gain(0); K.env(g.gain, t, 0.01, 0.1, 1.1, 0.3);
    const lp = K.filter('lowpass', 2500, 0.7, g);
    lp.frequency.exponentialRampToValueAtTime(400, t + 1.2);
    K.noise(t, 1.3, lp);
    SFX['SFX-05'](K, t + 0.4);
    return 2;
  },
  // Звон золота
  'SFX-17'(K, t) {
    for (let i = 0; i < 9; i++) {
      const tt = t + i * 0.07 + Math.random() * 0.05;
      [2637, 3520, 5274].forEach((f, j) => {
        const g = K.gain(0); K.env(g.gain, tt, 0.001, 0, 0.4, 0.05 - j * 0.012);
        K.osc('sine', f * (1 + (Math.random() - 0.5) * 0.06), tt, 0.45, g);
      });
    }
    K.bell(86, t + 0.8, 2, 0.06);
    return 2.5;
  },
  // Шорох бумаги (телефон)
  'SFX-18'(K, t) {
    for (let i = 0; i < 7; i++) {
      const tt = t + i * 0.045;
      const g = K.gain(0); K.env(g.gain, tt, 0.005, 0.02, 0.05, 0.12);
      K.noise(tt, 0.08, K.filter('bandpass', 3000 + Math.random() * 2500, 1.2, g));
    }
    return 0.4;
  },
  // Деревянный стук (телефон)
  'SFX-19'(K, t) { K.wood(t, 0.4, 520); K.kick(t, 0.15, 260, 140); return 0.3; },
  // Рында: игрок подключился
  'SFX-20'(K, t) { K.bell(67, t, 3.5, 0.15); return 3; },
  // Учащённое тиканье, 10 секунд
  'SFX-21'(K, t) {
    let tt = t, gap = 0.5;
    while (tt < t + 10) { K.wood(tt, 0.2, 1900); tt += gap; gap = Math.max(0.12, gap * 0.94); }
    K.bell(62, t + 10, 2.5, 0.15);
    return 11;
  },
  // Скрип двери и ветер: открылась новая зона
  'SFX-22'(K, t) {
    K.creak(t, 1.3, 0.2, 520);
    const g = K.gain(0);
    g.gain.setValueAtTime(0.0001, t + 0.6);
    g.gain.linearRampToValueAtTime(0.12, t + 1.4);
    g.gain.linearRampToValueAtTime(0.0001, t + 3);
    const bp = K.filter('bandpass', 500, 6, g);
    bp.frequency.linearRampToValueAtTime(900, t + 1.8);
    bp.frequency.linearRampToValueAtTime(400, t + 3);
    K.noise(t + 0.6, 2.5, bp);
    return 3;
  },
};

const SFX_GAIN = { 'SFX-02': 2, 'SFX-10': 2, 'SFX-12': 2.5, 'SFX-14': 1.8, 'SFX-17': 2, 'SFX-18': 1.6, 'SFX-19': 1.4, 'SFX-22': 4, 'SFX-11': 1.5, 'SFX-13': 1.5, 'SFX-05': 1.6 };

const SFX_LEN = { 'SFX-01': 3, 'SFX-02': 0.8, 'SFX-03': 0.8, 'SFX-04': 2.4, 'SFX-05': 1.6, 'SFX-06': 1, 'SFX-08': 4, 'SFX-10': 0.8, 'SFX-11': 2 };

export { TRACKS, SFX, MUSIC_IDS, SFX_IDS };
