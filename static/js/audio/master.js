//! master.js: the live engine's \ppMaster (instruments/synthdefs.scd)
//! rebuilt in Web Audio, lifted from the live project's roll page: a
//! generated-IR reverb at the mood's room/mix/damp, DC block, the cascaded
//! low-cut at fxHpf (24 dB/oct), the tone ceiling at fxLpf, shelves 80 Hz
//! +2 dB / 8 kHz +1.5 dB, the glue compressor (-15 dB, 1.67:1, 25/180 ms),
//! tanh saturation, two limiters and a true-peak clamp. The mood's
//! masterTrim rides the makeup, fxVerb picks the reverb (the live engine
//! has two; the IR stands for both), fxWarp is the samplers' tape wobble
//! and is kept on the fx record for them.
import { dbamp } from "../sc.js";

//! composer/startup.scd's ppMaster \amp: applied once, in the chain, where
//! the live engine applies it
export const STREAM_MAKEUP = 2.8;

//! the mood's master keys, one record
export function moodFx(mood) {
  return {
    fxRoom: mood.fxRoom ?? 0.7, fxMix: mood.fxMix ?? 0.25, fxDamp: mood.fxDamp ?? 0.4,
    fxHpf: mood.fxHpf ?? 24, fxLpf: mood.fxLpf ?? 18000, fxVerb: mood.fxVerb ?? "free",
    masterTrim: mood.masterTrim ?? 0, fxWarp: mood.fxWarp ?? 0,
  };
}

//! Reverb as a generated impulse response: an exponential tail with an RT60
//! tied to room (0.85 -> ~3 s), early-reflection density up front, damping
//! that darkens the tail over time. No feedback loops, so it cannot run away.
export function makeRoomIR(ac, room, damp) {
  const sr = ac.sampleRate;
  const rt60 = 0.8 + room * 2.6;
  const seconds = rt60 * 1.15;
  const len = Math.floor(sr * seconds);
  const ir = ac.createBuffer(2, len, sr);
  const tilt = 0.12 + damp * 0.55;
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.pow(10, -3 * t / rt60);
      const noise = Math.random() * 2 - 1;
      lp += (noise - lp) * (1 - tilt * Math.min(1, t / rt60));
      const early = t < 0.08 ? 1.6 : 1.0;
      d[i] = lp * env * early * (i < 32 ? i / 32 : 1);
    }
  }
  return ir;
}

export function makeVerb(ac, room, damp) {
  const input = ac.createGain(); input.gain.value = 1.0;
  const conv = ac.createConvolver(); conv.buffer = makeRoomIR(ac, room, damp);
  const output = ac.createGain(); output.gain.value = 1.4;
  input.connect(conv); conv.connect(output);
  let cur = room;
  return { input, output, setRoom(r) { if (Math.abs(r - cur) > 0.02) { cur = r; conv.buffer = makeRoomIR(ac, r, damp); } } };
}

export function buildChain(ac, fx, dest) {
  const input = ac.createGain();
  const verb = makeVerb(ac, fx.fxRoom, fx.fxDamp);
  const mixDry = ac.createGain(), mixWet = ac.createGain();
  input.connect(mixDry);
  input.connect(verb.input); verb.output.connect(mixWet);
  const sum = ac.createGain();
  mixDry.connect(sum); mixWet.connect(sum);
  const dc = ac.createBiquadFilter(); dc.type = "highpass"; dc.frequency.value = 10; dc.Q.value = 0.5;
  const hp1 = ac.createBiquadFilter(); hp1.type = "highpass"; hp1.frequency.value = fx.fxHpf; hp1.Q.value = 0.707;
  const hp2 = ac.createBiquadFilter(); hp2.type = "highpass"; hp2.frequency.value = fx.fxHpf; hp2.Q.value = 0.707;
  const lpf = ac.createBiquadFilter(); lpf.type = "lowpass"; lpf.frequency.value = fx.fxLpf; lpf.Q.value = 0.707;
  const lo = ac.createBiquadFilter(); lo.type = "lowshelf"; lo.frequency.value = 80; lo.gain.value = 2.0;
  const hi = ac.createBiquadFilter(); hi.type = "highshelf"; hi.frequency.value = 8000; hi.gain.value = 1.5;
  const comp = ac.createDynamicsCompressor();
  comp.threshold.value = -15; comp.ratio.value = 1.67; comp.knee.value = 3;
  comp.attack.value = 0.025; comp.release.value = 0.18;
  const makeup = ac.createGain(); makeup.gain.value = 1.0;   //! the engine's x1.5 lives in the browser comp's auto makeup
  const pre = ac.createGain(); pre.gain.value = 1.3;
  const shaper = ac.createWaveShaper();
  const N = 2048, curve = new Float32Array(N);
  for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; curve[i] = Math.tanh(x * 3) / Math.tanh(3); }
  const shaperIn = ac.createGain(); shaperIn.gain.value = 1 / 3;
  const shaperOut = ac.createGain(); shaperOut.gain.value = Math.tanh(3);
  shaper.curve = curve; shaper.oversample = "2x";
  const lim1 = ac.createDynamicsCompressor(); lim1.threshold.value = -1.0; lim1.ratio.value = 20; lim1.knee.value = 0; lim1.attack.value = 0.001; lim1.release.value = 0.05;
  const amp = ac.createGain(); amp.gain.value = STREAM_MAKEUP * dbamp(fx.masterTrim);
  const lim2 = ac.createDynamicsCompressor(); lim2.threshold.value = -0.45; lim2.ratio.value = 20; lim2.knee.value = 0; lim2.attack.value = 0.001; lim2.release.value = 0.05;
  //! the true-peak guard behind the 20:1 compressor, which overshoots on transients
  const clamp = ac.createWaveShaper();
  { const M = 4096, c = new Float32Array(M); for (let i = 0; i < M; i++) { const x = (i / (M - 1)) * 2 - 1; c[i] = Math.max(-0.95, Math.min(0.95, x)); } clamp.curve = c; clamp.oversample = "2x"; }
  const out = ac.createGain(); out.gain.value = 0.8;
  sum.connect(dc); dc.connect(hp1); hp1.connect(hp2); hp2.connect(lpf); lpf.connect(lo); lo.connect(hi); hi.connect(comp); comp.connect(makeup);
  makeup.connect(pre); pre.connect(shaperIn); shaperIn.connect(shaper); shaper.connect(shaperOut);
  shaperOut.connect(lim1); lim1.connect(amp); amp.connect(lim2); lim2.connect(clamp); clamp.connect(out); out.connect(dest);
  const chain = { input, verb, mixDry, mixWet, out, comp, lim1, lim2, hp1, hp2, lpf, amp, fx };
  applyMoodFx(chain, fx);
  return chain;
}

export function applyMoodFx(chain, fx) {
  chain.fx = fx;
  chain.mixDry.gain.value = 1 - fx.fxMix; chain.mixWet.gain.value = fx.fxMix;
  chain.verb.setRoom(fx.fxRoom);
  chain.hp1.frequency.value = fx.fxHpf; chain.hp2.frequency.value = fx.fxHpf;
  chain.lpf.frequency.value = fx.fxLpf;
  chain.amp.gain.value = STREAM_MAKEUP * dbamp(fx.masterTrim);
}
