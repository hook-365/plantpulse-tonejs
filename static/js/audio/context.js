//! context.js: one native AudioContext for the page. The instruments are
//! Web Audio graphs node for node with the live engine's SynthDefs, and
//! they use the whole API (buffer-source rate modulation, value curves,
//! stereo panners), so the context is the browser's own: a wrapper such as
//! Tone.js's standardized context lacks parts of it (the first cello bow
//! threw on one), and this port never needed Tone's abstractions.

export async function createAudio({ volume = 1 } = {}) {
  const ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  if (ctx.state === "suspended") await ctx.resume();
  const pageOut = ctx.createGain();
  pageOut.gain.value = volume * volume;   //! the fader is squared, as on the live page
  pageOut.connect(ctx.destination);
  return {
    ctx, pageOut,
    setVolume(v) { pageOut.gain.setTargetAtTime(v * v, ctx.currentTime, 0.05); },
    //! composer time (performance.now seconds) -> this context's time
    toAudio(t) { return ctx.currentTime + (t - performance.now() / 1000); },
  };
}
