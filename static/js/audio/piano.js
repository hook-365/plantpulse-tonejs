//! piano.js: the live engine's \ppPianoSampler in Web Audio, lifted from
//! the roll page: the two Salamander layers bracketing the note's velocity
//! crossfaded, velocity shading the tone (softer = darker, standing in for
//! the layers the pack does not carry), the note's own release (the pedal
//! stretches it), and the key-up: Holm's release resonance (-4 dB, 7.5 dB
//! per second held) and hammer noise (-37 dB) when the damper falls, silent
//! under the pedal. The pedal noises play on a chord change (pedalChange).

export function playPiano(ctx, sampler, args, t, dest) {
  const { midinote: m, amp, dur: durIn, vel = 8, rel: relIn } = args;
  const layer = Math.max(1, Math.min(16, Math.round(vel)));
  const pick = sampler.nearestSample("piano", m, layer);
  if (!pick) return null;
  const buf = sampler.bufferNow(pick.url);
  if (!buf) return null;   //! not resident: silence beats a beep
  const buf2 = pick.url2 ? sampler.bufferNow(pick.url2) : null;
  //! round-robin substitutes: a hair of pitch and onset so no two notes are bit-identical
  const cents = (Math.random() * 2 - 1) * 4;
  const rate = Math.pow(2, (m - pick.sampleMidi) / 12) * Math.pow(2, cents / 1200);
  const t0 = t + Math.random() * 0.006;
  const g = ctx.createGain();
  const velN = Math.min(1, Math.max(0.05, layer / 15));
  const voice = (b, lvl) => {
    const src = ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate;
    const vg = ctx.createGain(); vg.gain.value = lvl; src.connect(vg); vg.connect(g); return src;
  };
  const srcs = [];
  const bl = buf2 ? pick.blend : 0;
  srcs.push(voice(buf, Math.cos(bl * Math.PI / 2)));
  if (buf2) srcs.push(voice(buf2, Math.sin(bl * Math.PI / 2)));
  const tone = ctx.createBiquadFilter(); tone.type = "lowpass";
  tone.frequency.value = 2200 + velN * 9000; tone.Q.value = 0.5;
  const panner = ctx.createStereoPanner(); panner.pan.value = Math.max(-1, Math.min(1, args.pan ?? 0));
  g.connect(tone); tone.connect(panner); panner.connect(dest);
  const rel = relIn != null && relIn > 0 ? relIn : 0.15;
  const dur = Math.max(0.05, durIn ?? 1.0);
  g.gain.setValueAtTime(amp, t0);
  g.gain.setValueAtTime(amp, t0 + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + Math.max(0.05, rel));
  for (const sr of srcs) { sr.start(t0); sr.stop(t0 + dur + rel + 0.05); }
  //! the key-up: resonance + hammer noise when the damper falls (pedal up)
  const pedaled = rel > 1.4;
  if (!pedaled && sampler.has("release")) {
    const hold = Math.max(0.05, dur);
    const rs = sampler.releaseSample(m, layer);
    if (rs) sampler.playOneShot(rs.url, t0 + hold, amp * 0.63 * Math.pow(10, -7.5 * hold / 20), Math.pow(2, (m - rs.sampleMidi) / 12), dest, 2.2, 1.6);
    sampler.playOneShot(sampler.hammerSample(m), t0 + hold, amp * 0.014 * Math.pow(10, -2.0 * hold / 20), 1, dest, 2.2, 1.6);
  }
  return null;
}

//! the pedal lifting and re-pressing with the harmony (voices.scd
//! ~pedalChange): the up noise, then the down noise 80-160 ms later, at
//! the left hand's level
export function playPedalChange(ctx, sampler, level, when, dest) {
  const lvl = level * 0.11;
  sampler.playOneShot(sampler.pedalSample(false), Math.max(ctx.currentTime, when), lvl, 1, dest);
  sampler.playOneShot(sampler.pedalSample(true), Math.max(ctx.currentTime, when) + 0.08 + Math.random() * 0.08, lvl * 0.9, 1, dest);
}
