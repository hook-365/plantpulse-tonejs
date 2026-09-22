import { test } from "node:test";
import assert from "node:assert/strict";
import { VirtualClock } from "./virtual-clock.mjs";
import { makeSignal, feed } from "./synth-signal.mjs";
import { SignalProcessor } from "../static/js/signal.js";
import { makeContext } from "../static/js/composer/state.js";
import * as energy from "../static/js/composer/energy.js";

const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };

function build({ seed = 1, quiet = false, persist = energy.memoryPersist(), room = "drift" } = {}) {
  const clock = new VirtualClock({ tempo: 1 });
  const C = makeContext({ clock, room, log: () => {}, warn: () => {} });
  C.mood = { weatherDepth: 0.4 };
  energy.install(C, { persist });
  const proc = new SignalProcessor();
  feed(clock, proc, C.onFeature, makeSignal({ seed, quiet }));
  clock.play(C.weatherPoll, { sec: true });
  return { clock, C };
}

test("cold start: energy sits under the fixed ceiling, weather is neutral", () => {
  const { clock, C } = build();
  clock.runFor(600);
  assert.ok(C.sig.energy >= 0 && C.sig.energy <= 1);
  assert.equal(C.sig.weather, 0.5);
  assert.ok(C.rawSorted.x.length >= 20 && C.rawSorted.x.length <= 21, `day samples ${C.rawSorted.x.length}`);
});

test("over a day, energy's median is 0.5 by construction (the rank) and weather moves off neutral", () => {
  //! the rank is against the trailing 24 h, so only a full day of samples
  //! after a full day of warm-up centres by construction (the live
  //! project's receipt: "after 24h energy med 0.40-0.55")
  const { clock, C } = build({ seed: 2 });
  clock.runFor(24 * 3600);
  const es = [];
  for (let i = 0; i < 24 * 60; i++) { clock.runFor(60); es.push(C.sig.energy); }
  const med = median(es);
  assert.ok(med > 0.40 && med < 0.55, `energy median ${med.toFixed(3)} over the second day`);
  assert.equal(C.rawSorted.x.length, 2880, `rank buffer ${C.rawSorted.x.length}`);
  assert.notEqual(C.sig.weather, 0.5);
  assert.ok(C.sig.weather >= 0 && C.sig.weather <= 1);
});

test("a flat day reads weather 0.5", () => {
  const { clock, C } = build({ seed: 3, quiet: true });
  clock.runFor(5 * 3600);
  assert.equal(C.sig.weather, 0.5);
});

test("sigOver returns the instantaneous value under 8 samples, then a window mean", () => {
  const { clock, C } = build({ seed: 4 });
  clock.runFor(1);
  assert.equal(C.sigOver(60, "energy"), C.sig.energy);
  clock.runFor(120);
  const over = C.sigOver(60, "energy");
  assert.ok(over >= 0 && over <= 1);
});

test("the day memory survives a reload and a sibling room seeds a fresh one", () => {
  const persist = energy.memoryPersist();
  const a = build({ seed: 5, persist, room: "drift" });
  a.clock.runFor(3 * 3600 + 5);           //! past a save (every 300 s)
  const saved = persist.load("drift");
  assert.ok(saved && saved.text.split("\n").length > 300, "saved a day file");
  assert.match(saved.text.split("\n")[0], /^\d+ [\d.]+ [\d.-]+ [\d.-]+$/);
  const b = build({ seed: 6, persist, room: "piano" });
  const n = b.C.weatherLoad();
  assert.ok(n > 300, `piano seeded ${n} samples from drift`);
  assert.ok(b.C.rawSorted.x.length > 300);
});
