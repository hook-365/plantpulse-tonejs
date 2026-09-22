import { test } from "node:test";
import assert from "node:assert/strict";
import { band } from "./harness.mjs";
import { mod } from "../static/js/sc.js";
import { scaleByName } from "../static/js/composer/harmony.js";

function walk(room, bars, seed = 3) {
  const b = band({ room, seed });
  const { C, clock } = b;
  clock.runFor(120);
  C.rotateRootScale();
  C.trackStart = clock.now(); C.trackDur = bars * 4; C.barsTotal = bars;
  C.resetHarmonyWalk();
  const seen = [];
  for (let i = 0; i < bars; i++) {
    C.barIdx = i;
    if (bars - i <= (C.mood.outroBars ?? 8)) C.armCadence();
    C.harmonyAdvanceBar();
    seen.push({ ...C.chordNow, degsNow: C.chordDegrees("now") });
    clock.runFor(4);
  }
  b.done();
  return { C, seen };
}

test("every chord tone of every dwell is in the scale (the walk is diatonic by construction)", () => {
  for (const room of ["drift", "piano"]) {
    const { C, seen } = walk(room, 120);
    const semis = scaleByName[C.scaleName];
    for (const c of seen) {
      for (const d of c.degsNow) {
        const pc = mod(C.degToMidi(d) - C.rootMidi, 12);
        assert.ok(semis.includes(pc), `${room}: degree ${d} -> pc ${pc} not in ${C.scaleName}`);
      }
      assert.ok(["T", "S", "D"].includes(c.func));
    }
    assert.ok(C.chordPath.length > 5, `${room} walked ${C.chordPath.length} dwells`);
  }
});

test("no more than four non-tonic dwells in a row (the forced return home)", () => {
  const { seen } = walk("piano", 200, 5);
  const dwells = [];
  for (let i = 0; i < seen.length; i++) if (i === 0 || seen[i].deg !== seen[i - 1].deg || seen[i].func !== seen[i - 1].func || seen[i].barsLeft > seen[i - 1].barsLeft) dwells.push(seen[i]);
  let s = 0, maxS = 0;
  for (const d of dwells) { s = d.func === "T" ? 0 : s + 1; maxS = Math.max(maxS, s); }
  assert.ok(maxS <= 5, `longest non-tonic run of dwells ${maxS}`);
});

test("voice leading: every voice moves by at most a 4th (or folds an octave back into register)", () => {
  const b = band({ room: "drift", seed: 7 });
  const { C, clock } = b;
  clock.runFor(60);
  C.rotateRootScale();
  C.resetHarmonyWalk();
  let prev = C.voiceLeadTo(C.chordDegrees("now"), 0);
  const lo0 = Math.min(...prev), hi0 = Math.max(...prev);
  for (let i = 0; i < 60; i++) {
    C.chordNow.barsLeft = 0;
    C.harmonyAdvanceBar();
    const v = C.voiceLeadTo(C.chordDegrees("now"), 0);
    for (const m of v) {
      const nearest = Math.min(...prev.map((p) => Math.abs(p - m)));
      assert.ok(nearest <= 7 || nearest === 12, `voice ${m} is ${nearest} st from every previous voice ${prev}`);
    }
    assert.ok(Math.min(...v) >= lo0 - 14 && Math.max(...v) <= hi0 + 14, `register wandered to ${v}`);
    prev = v;
  }
  b.done();
});

test("the cadence script: fade rooms end on the tonic alone, cadence rooms go S D T", () => {
  const drift = band({ room: "drift", seed: 2 }); drift.clock.runFor(10); drift.C.rotateRootScale(); drift.C.resetHarmonyWalk();
  drift.C.armCadence();
  assert.deepEqual(drift.C.cadence.queue, [{ deg: 0, func: "T", bars: drift.C.mood.outroBars }]);
  drift.done();
  const piano = band({ room: "piano", seed: 2 }); piano.clock.runFor(10); piano.C.rotateRootScale(); piano.C.resetHarmonyWalk();
  piano.C.armCadence();
  const q = piano.C.cadence.queue;
  assert.equal(q.length, 3);
  assert.ok([1, 3].includes(q[0].deg) && q[0].func === "S");
  assert.deepEqual([q[1].deg, q[1].func], [4, "D"]);
  assert.deepEqual([q[2].deg, q[2].func], [0, "T"]);
  piano.done();
});

test("a fade room lands its one tonic pedal, 8 bars on I, near the middle of the take", () => {
  const { C } = walk("drift", 100, 9);
  assert.equal(C.cadence.pedalUsed, true);
  assert.ok(C.chordPath.some((t) => /^0T8/.test(t)), `no 0T8 in ${C.chordPath.join(" ")}`);
});

test("the root cycles through the pool in order and the scale never repeats itself", () => {
  const b = band({ room: "piano", seed: 4 });
  b.clock.runFor(10);
  const roots = [], scales = [];
  for (let i = 0; i < 6; i++) { b.C.rotateRootScale(); roots.push(b.C.rootMidi); scales.push(b.C.scaleName); }
  const pool = b.C.mood.rootPool;
  for (let i = 1; i < roots.length; i++) assert.notEqual(roots[i], roots[i - 1]);
  assert.equal(roots.length, 6);
  for (let i = 1; i < scales.length; i++) assert.notEqual(scales[i], scales[i - 1]);
  assert.ok(pool.length >= 6);
  b.done();
});
