import { test } from "node:test";
import assert from "node:assert/strict";
import { VirtualClock } from "./virtual-clock.mjs";

test("a tempo change re-anchors at the current beat (TempoClock semantics)", () => {
  const c = new VirtualClock({ tempo: 2 });   //! 120 bpm
  c.runUntil(2);                               //! 4 beats elapsed
  assert.equal(c.beats, 4);
  c.tempo = 1;                                 //! 60 bpm from here
  assert.equal(c.beats, 4);
  c.runUntil(3);
  assert.equal(c.beats, 5);
  assert.equal(c.beatsToSecs(6), 4);
});

test("routines wait in beats, yield {sec} waits on the wall, and both see logical time", () => {
  const c = new VirtualClock({ tempo: 2 });
  const log = [];
  c.play(function* () { for (let i = 0; i < 3; i++) { log.push(["b", c.beats, c.now()]); yield 2; } });
  c.play(function* () { for (let i = 0; i < 2; i++) { log.push(["s", c.now()]); yield { sec: 1.5 }; } }, { sec: true });
  c.runUntil(10);
  assert.deepEqual(log.filter((l) => l[0] === "b").map((l) => [l[1], l[2]]), [[0, 0], [2, 1], [4, 2]]);
  assert.deepEqual(log.filter((l) => l[0] === "s").map((l) => l[1]), [0, 1.5]);
});

test("quant [4, phase] starts on the next bar line plus phase, ordering the players", () => {
  const c = new VirtualClock({ tempo: 1 });
  c.runUntil(1.3);                              //! beat 1.3
  const order = [];
  c.play(function* () { order.push(["lh", c.beats]); }, { quant: 4, phase: 0.05 });
  c.play(function* () { order.push(["pad", c.beats]); }, { quant: 4, phase: 0.02 });
  c.play(function* () { order.push(["rh", c.beats]); }, { quant: 4 });
  c.runUntil(5);
  assert.deepEqual(order, [["rh", 4], ["pad", 4.02], ["lh", 4.05]]);
});

test("a ritardando inside a routine moves only future beats", () => {
  const c = new VirtualClock({ tempo: 1 });
  const times = [];
  c.play(function* () {
    for (let k = 0; k < 4; k++) { times.push(c.now()); c.tempo = 1 / (1 + k); yield 1; }
    times.push(c.now());
  });
  c.runUntil(100);
  //! beat 0 at t0, then each beat lasts 1, 2, 3, 4 s
  assert.deepEqual(times, [0, 1, 3, 6, 10]);
});

test("stop() ends a routine; a finished generator schedules nothing more", () => {
  const c = new VirtualClock({ tempo: 1 });
  let n = 0;
  const h = c.play(function* () { for (;;) { n++; yield 1; } });
  c.runUntil(3.5);
  h.stop();
  c.runUntil(10);
  assert.equal(n, 4);
  assert.equal(c.nextDue(), null);
});
