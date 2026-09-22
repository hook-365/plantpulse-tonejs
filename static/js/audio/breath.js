//! breath.js: drift's bed, the live engine's \ppBreath / \ppBreathHeld,
//! \ppAir and \ppSubHeld (instruments/synthdefs.scd) rebuilt in Web Audio,
//! lifted from the live project's roll page. Eight sine partials at n^-1.6,
//! each with its own slow amplitude wander, ONE shared swell over the upper
//! partials, a drifting lowpass, the wah band swept by centre and tilt, and
//! the plateau envelope; the held variant is gated and cross-fades over
//! 8 s. The defs read a live control bus; here tuneLiveBeds(sig, t) retunes
//! every ringing voice with setTargetAtTime time constants standing in for
//! the defs' Lag.kr.

const liveBeds = [];   //! {until, tune(sig, t)}

export function tuneLiveBeds(sig, t) {
  for (let i = liveBeds.length - 1; i >= 0; i--) {
    if (liveBeds[i].until < t) { liveBeds.splice(i, 1); continue; }
    liveBeds[i].tune(sig, t);
  }
}
export function liveBedCount() { return liveBeds.length; }

//! Env \sin: a half-cosine ease in and out
function halfCos(N, up, scale = 1) {
  const a = new Float32Array(N);
  for (let k = 0; k < N; k++) { const x = k / (N - 1); a[k] = Math.max(0.0001, scale * (up ? 0.5 - 0.5 * Math.cos(Math.PI * x) : 0.5 + 0.5 * Math.cos(Math.PI * x))); }
  return a;
}
//! the wah, as in the def: centre sweeps the band across two octaves of the
//! overtones, tilt narrows it (rq 0.38..0.12 -> Q)
const wahHz = (f, c) => Math.min(4200, Math.max(150, f * 2 * Math.pow(2, c + 1)));
const wahQ = (t) => 1 / (0.38 - 0.13 * (t + 1));
const shimCents = (stab) => (0.0005 + 0.0035 * (1 - stab)) * 1731;   //! the def's fractional detune, in cents

//! playBreath(ctx, {f, amp, dur, pan, held}, t0, dest, sig) -> handle for a
//! held voice ({set({amp}), release(t)}) or null for a one-shot
export function playBreath(ctx, { f, amp, dur = 8.0, pan = 0, held = false, atk: atkIn, rel: relIn }, t0, dest, sig) {
  const { energy, stab, center, tilt } = sig;
  const atk = atkIn ?? (held ? 8.0 : Math.min(4, Math.max(1.2, dur * 0.3)));
  const rel = relIn ?? (held ? 8.0 : 3.0);
  const hold = Math.max(0.5, dur - atk), end = held ? Infinity : t0 + atk + hold + rel + 0.1;
  const sum = ctx.createGain(); sum.gain.value = 0.17;   //! the def's trim
  const nodes = [], shims = [];
  const swLfo = ctx.createOscillator(); swLfo.type = "sine";
  swLfo.frequency.value = 0.012 + 0.025 * energy;
  swLfo.detune.value = (Math.random() * 2 - 1) * 900;
  nodes.push(swLfo);
  for (let i = 0; i < 8; i++) {
    const k = i + 1;
    const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = f * k;
    o.detune.value = (Math.random() * 2 - 1) * 1;
    const shLfo = ctx.createOscillator(); shLfo.type = "sine";
    shLfo.frequency.value = 0.05 + 0.02 * i; shLfo.detune.value = (Math.random() * 2 - 1) * 700;
    const shG = ctx.createGain(); shG.gain.value = shimCents(stab);
    shLfo.connect(shG); shG.connect(o.detune); shims.push(shG); nodes.push(shLfo);
    const w = ctx.createGain();
    const lfo = ctx.createOscillator(); lfo.type = "sine";
    const lg = ctx.createGain();
    const base = Math.pow(k, -1.6);
    lfo.frequency.value = 0.03 + 0.01 * i; lfo.detune.value = (Math.random() * 2 - 1) * 600;
    if (k <= 2) {
      w.gain.value = base * 0.75; lg.gain.value = base * 0.25;   //! root and octave stay back
    } else {
      w.gain.value = base * 0.75 * 0.625; lg.gain.value = base * 0.25 * 0.625;
      const swG = ctx.createGain(); swG.gain.value = base * 0.75 * 0.375;
      swLfo.connect(swG); swG.connect(w.gain);
    }
    lfo.connect(lg); lg.connect(w.gain);
    o.connect(w); w.connect(sum); nodes.push(o, lfo);
  }
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.707;
  const lpBase = (e) => Math.min(9000, Math.max(200, f * (3.5 + 4.5 * e)));
  lp.frequency.value = lpBase(energy);
  const cutLfo = ctx.createOscillator(); cutLfo.type = "sine";
  cutLfo.frequency.value = 0.02 + 0.03 * energy; cutLfo.detune.value = (Math.random() * 2 - 1) * 700;
  const cutG = ctx.createGain(); cutG.gain.value = f * 1.5;
  cutLfo.connect(cutG); cutG.connect(lp.frequency); nodes.push(cutLfo);
  const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t0);
  env.gain.setValueCurveAtTime(halfCos(24, true), t0, atk);
  if (!held) {
    env.gain.setValueAtTime(1, t0 + atk + hold);
    env.gain.setValueCurveAtTime(halfCos(24, false), t0 + atk + hold, rel);
  }
  const wah = ctx.createBiquadFilter(); wah.type = "bandpass";
  wah.frequency.value = wahHz(f, center); wah.Q.value = wahQ(tilt);
  const wahG = ctx.createGain(); wahG.gain.value = 0.5;
  sum.connect(wah); wah.connect(wahG); wahG.connect(lp);
  const out = ctx.createGain(); out.gain.value = amp;
  const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
  sum.connect(lp); lp.connect(env); env.connect(out); out.connect(panner); panner.connect(dest);
  for (const o of nodes) { o.start(t0); if (!held) o.stop(end); }
  const live = { until: end, tune: (g, t) => {
    swLfo.frequency.setTargetAtTime(0.012 + 0.025 * g.energy, t, 2.0);
    cutLfo.frequency.setTargetAtTime(0.02 + 0.03 * g.energy, t, 2.0);
    lp.frequency.setTargetAtTime(lpBase(g.energy), t, 2.0);
    wah.frequency.setTargetAtTime(wahHz(f, g.center), t, 8.0);
    wah.Q.setTargetAtTime(wahQ(g.tilt), t, 6.0);
    const sc = shimCents(g.stab);
    for (const g2 of shims) g2.gain.setTargetAtTime(sc, t, 4.0);
  } };
  liveBeds.push(live);
  if (!held) return null;
  //! the held voice's handle: the def's amp.lag and gate
  return {
    set({ amp: a, gate }, t = ctx.currentTime) {
      if (a != null) out.gain.setTargetAtTime(a, t, 1.0);
      if (gate === 0) this.release(t);
    },
    release(t = ctx.currentTime) {
      env.gain.cancelScheduledValues(t); env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), t);
      env.gain.setTargetAtTime(0.0001, t, rel / 3);
      for (const o of nodes) { try { o.stop(t + rel + 0.5); } catch (e) { /* already stopped */ } }
      live.until = t + rel + 0.5;
    },
  };
}

//! \ppSubHeld: one sine on the root two octaves down, 4 s in, 6 s out, gated
export function playSubHeld(ctx, hz, t0, amp, dest) {
  const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = Math.max(20, Math.min(160, hz));
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 120; lp.Q.value = 0.707;
  const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t0); env.gain.setTargetAtTime(1, t0, 1.5);
  const out = ctx.createGain(); out.gain.value = amp;
  o.connect(lp); lp.connect(env); env.connect(out); out.connect(dest); o.start(t0);
  return {
    set({ amp: a, gate }, t = ctx.currentTime) {
      if (a != null) out.gain.setTargetAtTime(a, t, 1.0);
      if (gate === 0) this.release(t);
    },
    release(t = ctx.currentTime) {
      env.gain.cancelScheduledValues(t); env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), t);
      env.gain.setTargetAtTime(0.0001, t, 2.0);
      try { o.stop(t + 8); } catch (e) { /* already stopped */ }
    },
  };
}

//! \ppAir: tuned-resonator air, pink noise blown through a Klank bank on
//! the note and its first two overtones. Web: a looping pink-noise buffer
//! through a lowpass into three high-Q bandpasses (Q from the def's ring
//! times: Q = t60 * pi * f / 6.91), band gains 1 / 0.5 / 0.28.
let airBuf = null;
export function pinkBuffer(ctx) {
  if (airBuf && airBuf.sampleRate === ctx.sampleRate) return airBuf;
  const len = 4 * ctx.sampleRate, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;   //! Paul Kellet economy pink
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
  }
  airBuf = b; return b;
}
const AIR_MAKEUP = 4;   //! stands in for the resonator gain a 0 dB-peak bandpass lacks

export function playAir(ctx, { f, amp, dur = 8.0, pan = 0 }, t0, dest, sig) {
  const energy = sig.energy;
  const atk = Math.min(5, Math.max(1.5, dur * 0.4)), rel = 4.0;
  const hold = Math.max(0.5, dur - atk), end = t0 + atk + hold + rel + 0.1;
  const src = ctx.createBufferSource(); src.buffer = pinkBuffer(ctx); src.loop = true;
  src.loopStart = Math.random() * 3;
  const blow = ctx.createGain(); blow.gain.value = 0.35 + 0.65 * energy;   //! a lively tree blows harder
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 0.707;
  lp.frequency.value = 1200 + 2400 * energy;
  const mix = ctx.createGain(); mix.gain.value = AIR_MAKEUP;
  const ratios = [1, 2.003, 2.998], rings = [1.6, 1.3, 1.0], gains = [1.0, 0.5, 0.28];
  src.connect(blow); blow.connect(lp);
  for (let i = 0; i < 3; i++) {
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass";
    const fk = f * ratios[i];
    bp.frequency.value = fk; bp.Q.value = Math.min(800, rings[i] * Math.PI * fk / 6.91);
    const g = ctx.createGain(); g.gain.value = gains[i];
    lp.connect(bp); bp.connect(g); g.connect(mix);
  }
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90; hp.Q.value = 0.707;
  const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t0);
  env.gain.setValueCurveAtTime(halfCos(24, true), t0, atk);
  env.gain.setValueAtTime(1, t0 + atk + hold);
  env.gain.setValueCurveAtTime(halfCos(24, false), t0 + atk + hold, rel);
  const out = ctx.createGain(); out.gain.value = amp;
  const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
  mix.connect(hp); hp.connect(env); env.connect(out); out.connect(panner); panner.connect(dest);
  src.start(t0); src.stop(end);
  liveBeds.push({ until: end, tune: (g, t) => {
    blow.gain.setTargetAtTime(0.35 + 0.65 * g.energy, t, 3.0);
    lp.frequency.setTargetAtTime(1200 + 2400 * g.energy, t, 3.0);
  } });
  return null;
}
