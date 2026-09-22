//! cello.js: the live engine's \ppCello and \ppCelloLeg in Web Audio,
//! lifted from the roll page's cello and extended to the held bow. A bow
//! is a ~1.5-2.3 s Philharmonia recording; the engine holds a note by
//! looping its own sustain plateau with a wide crossfade. Here the buffer
//! is extended offline to bow length (the plateau measured per recording,
//! as the engine's loops.json is), then played with vibrato on the rate
//! (arriving after the note speaks and widening), a hairpin swell, the
//! bow's breath (+-0.5 dB wander, a wandering damping low-pass 3.4-4.6 kHz),
//! and the legato retune in place: a slurred pitch change is a finger
//! shift on a sounding string, not a new recording.

//! each bow's own sustain plateau: 50 ms RMS at 10 ms hop, everything
//! within 4 dB of the peak after the attack, trimmed 60 ms
const plateaus = new WeakMap();
export function plateauOf(buf) {
  let p = plateaus.get(buf); if (p) return p;
  const sr = buf.sampleRate, a = buf.getChannelData(0), hop = Math.floor(0.01 * sr), win = Math.floor(0.05 * sr);
  const db = [];
  for (let i = 0; i + win < a.length; i += hop) {
    let s = 0; for (let j = i; j < i + win; j++) s += a[j] * a[j];
    db.push(10 * Math.log10(s / win + 1e-12));
  }
  let peak = -999; for (let i = 15; i < db.length; i++) if (db[i] > peak) peak = db[i];
  let first = -1, last = -1;
  for (let i = 0; i < db.length; i++) if (db[i] >= peak - 4) { if (first < 0) first = i; last = i; }
  let ls = Math.max(0.25, first * 0.01 + 0.06), le = last * 0.01 - 0.06;
  if (le - ls < 0.2) { ls = Math.max(0.25, buf.duration * 0.3); le = Math.max(0.5, buf.duration * 0.6); }
  p = { ls, le }; plateaus.set(buf, p); return p;
}

//! extendBow(ctx, buf, seconds): the recording looped over its plateau with
//! a crossfade of half the loop, a hair different every bow
export function extendBow(ctx, buf, seconds, xf = 0.5) {
  const sr = buf.sampleRate, want = Math.ceil(seconds * sr);
  if (buf.length >= want) return buf;
  const { ls, le } = plateauOf(buf);
  const loopStart = ls, loopEnd = le - (le - ls) * Math.random() * 0.2;
  const lS = Math.floor(loopStart * sr), lE = Math.min(Math.floor(loopEnd * sr), buf.length - 64);
  const lL = lE - lS; if (lL < 256) return buf;
  const xfN = Math.floor(lL * xf);
  const out = ctx.createBuffer(buf.numberOfChannels, want, sr);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const a = buf.getChannelData(ch), o = out.getChannelData(ch);
    let w = 0;
    for (let i = 0; i < lE && w < want; i++, w++) o[w] = a[i];
    while (w < want) {
      w -= xfN;
      for (let i = 0; i < lL && w < want; i++, w++) {
        const v = a[lS + i];
        if (i < xfN) { const t = i / xfN, s2 = Math.sin(t * Math.PI / 2), c2 = Math.cos(t * Math.PI / 2); o[w] = o[w] * c2 + v * s2; }
        else o[w] = v;
      }
    }
  }
  return out;
}

const CELLO_MAKEUP = 6.0;   //! the def's x6
const HELD_SECONDS = 40;    //! a held bow is extended this far: longer than any planned bow with its retunes

//! playCello(ctx, sampler, args, t0, dest, {held}) -> a handle for a held
//! bow ({set({midinote, glide, amp, rel, gate, ...}), release(t)}) or null
export function playCello(ctx, sampler, args, t0, dest, { held = false } = {}) {
  const { midinote, amp, dur = 3.0, pan = 0.25 } = args;
  const pick = sampler.nearestSample("cello", Math.round(midinote), 8);
  if (!pick) return null;
  const base = sampler.bufferNow(pick.url);
  if (!base) return null;
  const atk = args.atk ?? 0.30;
  let rel = args.rel ?? (held ? 0.7 : 0.55);
  const seconds = held ? HELD_SECONDS : dur + rel + 0.9;
  const buf = extendBow(ctx, base, seconds);
  const src = ctx.createBufferSource(); src.buffer = buf;
  //! a desk's fixed detune (cents) folds into the rate
  const rateFor = (m) => Math.pow(2, (m - pick.sampleMidi) / 12) * Math.pow(2, (args.cents ?? 0) / 1200);
  src.playbackRate.value = rateFor(midinote);
  //! vibrato: a sine at vibRate added to the rate (cents scaled to a rate
  //! delta: rate * ln2 / 1200 per cent), its depth arriving over vibDelay
  //! then vibGrow (Env [0, 0, 1]). On the rate, not detune: every context
  //! has playbackRate, and a buffer source's detune is missing in some.
  const vibRate = args.vibRate ?? 5.2, vibDepth = args.vibDepth ?? 0.0, vibDelay = args.vibDelay ?? 0.5, vibGrow = args.vibGrow ?? 0.6;
  const centsToRate = (c) => rateFor(midinote) * c * Math.LN2 / 1200;
  const vib = ctx.createOscillator(); vib.type = "sine"; vib.frequency.value = vibRate;
  const vibG = ctx.createGain(); vibG.gain.setValueAtTime(0, t0);
  vibG.gain.setValueAtTime(0, t0 + vibDelay);
  vibG.gain.linearRampToValueAtTime(centsToRate(vibDepth), t0 + vibDelay + Math.max(0.01, vibGrow));
  vib.connect(vibG); vibG.connect(src.playbackRate);
  //! the bow's breath: +-0.5 dB wander, and the damping low-pass wandering 3.4-4.6 kHz
  const damp = ctx.createBiquadFilter(); damp.type = "lowpass"; damp.frequency.value = 4000; damp.Q.value = 0.5;
  const dampLfo = ctx.createOscillator(); dampLfo.type = "sine"; dampLfo.frequency.value = 0.3; dampLfo.detune.value = (Math.random() * 2 - 1) * 600;
  const dampG = ctx.createGain(); dampG.gain.value = 600;
  dampLfo.connect(dampG); dampG.connect(damp.frequency);
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 55; hp.Q.value = 0.707;
  const breath = ctx.createGain(); breath.gain.value = 1;
  const brLfo = ctx.createOscillator(); brLfo.type = "sine"; brLfo.frequency.value = 0.7; brLfo.detune.value = (Math.random() * 2 - 1) * 700;
  const brG = ctx.createGain(); brG.gain.value = 0.059;   //! +-0.5 dB
  brLfo.connect(brG); brG.connect(breath.gain);
  //! the hairpin swell: 1 + swell * Env([0, 1, 0.15], [dur*0.45, dur*0.55])
  const swell = ctx.createGain(); swell.gain.value = 1;
  const sw = args.swell ?? 0.0;
  if (sw > 0) {
    const d1 = Math.max(0.1, dur * 0.45), d2 = Math.max(0.1, dur * 0.55);
    swell.gain.setValueAtTime(1, t0);
    swell.gain.linearRampToValueAtTime(1 + sw, t0 + d1);
    swell.gain.linearRampToValueAtTime(1 + sw * 0.15, t0 + d1 + d2);
  }
  //! the envelope: sin attack, held, sin release (held: gated)
  const env = ctx.createGain(); env.gain.setValueAtTime(0.0001, t0);
  const N = 24, up = new Float32Array(N), down = new Float32Array(N);
  for (let k = 0; k < N; k++) { const x = k / (N - 1); up[k] = Math.max(0.0001, 0.5 - 0.5 * Math.cos(Math.PI * x)); down[k] = Math.max(0.0001, 0.5 + 0.5 * Math.cos(Math.PI * x)); }
  env.gain.setValueCurveAtTime(up, t0, Math.max(0.01, atk));
  if (!held) {
    env.gain.setValueAtTime(1, t0 + atk + Math.max(0.1, dur));
    env.gain.setValueCurveAtTime(down, t0 + atk + Math.max(0.1, dur), Math.max(0.05, rel));
  }
  const out = ctx.createGain(); out.gain.value = amp * CELLO_MAKEUP;
  const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, pan));
  src.connect(damp); damp.connect(hp); hp.connect(breath); breath.connect(swell); swell.connect(env); env.connect(out); out.connect(panner); panner.connect(dest);
  const nodes = [src, vib, dampLfo, brLfo];
  for (const n of nodes) n.start(t0);
  const end = held ? null : t0 + atk + Math.max(0.1, dur) + rel + 0.1;
  if (!held) for (const n of nodes) n.stop(end);
  if (!held) return null;
  let released = false;
  return {
    set(a, t = ctx.currentTime) {
      if (a.rel != null) rel = a.rel;
      if (a.midinote != null) {
        const g = Math.max(0.001, a.glide ?? 0.05);
        src.playbackRate.cancelScheduledValues(t);
        src.playbackRate.setTargetAtTime(rateFor(a.midinote), t, g / 3);   //! VarLag's sine warp, near enough
      }
      if (a.amp != null) out.gain.setTargetAtTime(a.amp * CELLO_MAKEUP, t, 0.15 / 3);   //! the def's amp lag
      if (a.gate === 0) this.release(t);
    },
    release(t = ctx.currentTime) {
      if (released) return;
      released = true;
      env.gain.cancelScheduledValues(t); env.gain.setValueAtTime(Math.max(0.0001, env.gain.value), t);
      env.gain.setValueCurveAtTime(down, t, Math.max(0.05, rel));
      for (const n of nodes) { try { n.stop(t + rel + 0.1); } catch (e) { /* stopped */ } }
    },
  };
}
