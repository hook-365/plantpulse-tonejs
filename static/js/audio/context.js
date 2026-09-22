//! context.js: one AudioContext for the page. Tone.js, when present, is the
//! host (Tone.start() is the user-gesture unlock the browser wants and the
//! page's own oscilloscope runs on it); the instruments are Web Audio
//! graphs on the same context, node for node with the live engine's
//! SynthDefs. Without Tone the context is made directly.

export async function createAudio({ volume = 1 } = {}) {
  let ctx;
  const T = globalThis.Tone;
  if (T && typeof T.start === "function") {
    await T.start();
    ctx = T.getContext().rawContext;
  } else {
    ctx = new (globalThis.AudioContext || globalThis.webkitAudioContext)();
  }
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
