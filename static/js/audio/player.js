//! player.js: the sink. The composer fires voices by name with sclang's
//! argument list (C.synth(name, args, when)); this maps each name to its
//! Web Audio graph and returns the handle the composer sets and gates,
//! exactly as it did Synth objects. Held voices are retuned from the four
//! plant signals every 100 ms (the live engine's control bus).
import { buildChain, applyMoodFx, moodFx } from "./master.js";
import { playBreath, playAir, playSubHeld, tuneLiveBeds } from "./breath.js";
import { makeSampler } from "./sampler.js";
import { playPiano, playPedalChange } from "./piano.js";
import { playCello } from "./cello.js";

export function installAudio(C, audio, { onSamples = null } = {}) {
  const { ctx, pageOut, toAudio } = audio;
  const chain = buildChain(ctx, moodFx(C.mood), pageOut);
  C.audio = audio;
  C.chain = chain;
  C.onMoodApplied = (mood) => applyMoodFx(chain, moodFx(mood));

  //! the voices this layer implements; pool draws filter on this. The
  //! sampled voices join once their packs are fetched (loadSamples): a
  //! room whose library is absent draws without them.
  C.voices = new Set(["ppBreath", "ppBreathHeld", "ppAir", "ppSubHeld"]);
  const sampler = makeSampler(ctx, { onCount: (n, total) => onSamples?.(n, total) });
  C.sampler = sampler;
  C.loadSamples = async () => {
    await sampler.loadManifests();
    if (sampler.has("piano")) C.voices.add("ppPianoSampler");
    if (sampler.has("cello")) { C.voices.add("ppCello"); C.voices.add("ppCelloLeg"); }
    await sampler.warmCache();
    return { piano: sampler.has("piano"), cello: sampler.has("cello"), release: sampler.has("release"), files: sampler.total };
  };
  //! the pedal noises on a chord change, when the pianist is pedalling
  C.pedalChange = () => {
    if (!(C.pedalNow && (C.mood.leftHandSynth ?? "") === "ppPianoSampler" && sampler.has("release"))) return;
    C.noteLogMark?.("pedal", "change");
    playPedalChange(ctx, sampler, C.mood.leftHandLevel ?? 0.7, toAudio(C.clock.beatsToSecs(C.clock.beats)), chain.input);
  };

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
      case "ppPianoSampler":
        return playPiano(ctx, sampler, { ...args, vel: C.pianoRoundRobin ? C.pianoRoundRobin(Math.round(args.midinote), args.vel ?? 8) : args.vel }, t0, dest);
      case "ppCello":
        return playCello(ctx, sampler, args, t0, dest, { held: false });
      case "ppCelloLeg":
        return playCello(ctx, sampler, args, t0, dest, { held: true });
      default:
        return null;   //! a voice this layer lacks: logged, drawn, silent
    }
  };

  //! wrap held handles so set() converts composer time and defaults to now
  const tuner = setInterval(() => tuneLiveBeds(C.bedSig(), ctx.currentTime), 100);
  C.stopAudio = () => { clearInterval(tuner); };
  return chain;
}
