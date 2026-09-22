//! A headless band: the composer on a virtual clock with a fake audio
//! layer that records every spawn, set and gate, and a synthetic plant.
import fs from "node:fs";
import { VirtualClock } from "./virtual-clock.mjs";
import { makeSignal, feed } from "./synth-signal.mjs";
import { SignalProcessor } from "../static/js/signal.js";
import { makeContext } from "../static/js/composer/state.js";
import { loadMoods, applyMood } from "../static/js/composer/moods.js";
import * as energy from "../static/js/composer/energy.js";
import * as notelog from "../static/js/composer/notelog.js";
import * as harmony from "../static/js/composer/harmony.js";
import * as arc from "../static/js/composer/arc.js";
import * as lifecycle from "../static/js/composer/lifecycle.js";
import * as voices from "../static/js/composer/voices.js";
import * as improv from "../static/js/composer/improv.js";
import * as lefthand from "../static/js/composer/lefthand.js";
import { setRng } from "../static/js/sc.js";
import { mulberry32 } from "./rng.mjs";

export const MOODS = JSON.parse(fs.readFileSync(new URL("../static/composer/moods.json", import.meta.url)));

export function fakeAudio(C, available = ["ppBreath", "ppBreathHeld", "ppAir", "ppSubHeld"]) {
  const spawns = [], sets = [], gates = [];
  C.voices = new Set(available);
  C.synth = (name, args, when) => {
    const rec = { name, args, when, alive: true };
    spawns.push(rec);
    return {
      set(a) { sets.push({ name, a }); if (a.gate === 0) { rec.alive = false; gates.push(rec); } },
      release() { rec.alive = false; gates.push(rec); },
    };
  };
  return { spawns, sets, gates, alive: () => spawns.filter((s) => s.alive) };
}

export function band({ room = "drift", seed = 1, signalSeed = 1, warm = 0, log = () => {} } = {}) {
  setRng(mulberry32(seed));
  const clock = new VirtualClock({ tempo: 1 });
  const C = makeContext({ clock, room, log, warn: log });
  loadMoods(C, MOODS);
  energy.install(C, { persist: energy.memoryPersist() });
  const takes = [];
  notelog.install(C, { onTake: (t) => takes.push(t) });
  harmony.install(C);
  arc.install(C);
  lifecycle.install(C);
  voices.install(C);
  improv.install(C);
  lefthand.install(C);
  const audio = fakeAudio(C);
  applyMood(C, room);
  feed(clock, new SignalProcessor(), C.onFeature, makeSignal({ seed: signalSeed }));
  clock.play(C.weatherPoll, { sec: true });
  if (warm > 0) clock.runFor(warm);
  const notes = [], marks = [];
  C.onNote = (n) => notes.push(n);
  C.onMark = (m) => marks.push(m);
  const start = () => { C.startVoices(); clock.play(C.arcPoll, { sec: true }); C.playLifecycle(); };
  return { C, clock, audio, takes, notes, marks, start, done: () => setRng(null) };
}
