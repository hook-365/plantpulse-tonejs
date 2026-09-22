//! player.js: the sink. The composer fires voices by name with sclang's
//! argument list (C.synth(name, args, when)); this maps each name to its
//! Web Audio graph and returns the handle the composer sets and gates,
//! exactly as it did Synth objects. Held voices are retuned from the four
//! plant signals every 100 ms (the live engine's control bus).
import { buildChain, applyMoodFx, moodFx } from "./master.js";
import { playBreath, playAir, playSubHeld, tuneLiveBeds } from "./breath.js";

export function installAudio(C, audio) {
  const { ctx, pageOut, toAudio } = audio;
  const chain = buildChain(ctx, moodFx(C.mood), pageOut);
  C.audio = audio;
  C.chain = chain;
  C.onMoodApplied = (mood) => applyMoodFx(chain, moodFx(mood));

  //! the voices this layer implements; pool draws filter on this
  C.voices = new Set(["ppBreath", "ppBreathHeld", "ppAir", "ppSubHeld"]);

  //! C.synth(name, args, when): args as sclang's key/value pairs, when in
  //! composer time (logical seconds), converted to the context's clock.
  //! A when already past starts now (the composer's tick jitter is
  //! bounded by its lookahead, so this is rare and small).
  C.synth = (name, args, when) => {
    const t0 = Math.max(ctx.currentTime, toAudio(when));
    const sig = C.bedSig();
    const dest = chain.input;
    switch (name) {
      case "ppBreathHeld":
        return playBreath(ctx, { f: args.freq, amp: args.amp, dur: 8.0, pan: args.pan ?? 0, held: true, atk: args.atk, rel: args.rel }, t0, dest, sig);
      case "ppBreath":
        return playBreath(ctx, { f: args.freq, amp: args.amp, dur: args.dur ?? 8.0, pan: args.pan ?? 0, held: false }, t0, dest, sig);
      case "ppAir":
        return playAir(ctx, { f: args.freq, amp: args.amp, dur: args.dur ?? 8.0, pan: args.pan ?? 0 }, t0, dest, sig);
      case "ppSubHeld":
        return playSubHeld(ctx, args.freq, t0, args.amp, dest);
      default:
        return null;   //! a voice this layer lacks: logged, drawn, silent
    }
  };

  //! wrap held handles so set() converts composer time and defaults to now
  const tuner = setInterval(() => tuneLiveBeds(C.bedSig(), ctx.currentTime), 100);
  C.stopAudio = () => { clearInterval(tuner); };
  return chain;
}
