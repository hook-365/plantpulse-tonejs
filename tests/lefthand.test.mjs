import { test } from "node:test";
import assert from "node:assert/strict";
import { band } from "./harness.mjs";

test("piano: the left hand plays under the right, in the tenor and bass, every bar summing to four beats", () => {
  const b = band({ room: "piano", seed: 31, warm: 300 });
  const { C, clock, notes } = b;
  b.C.voices.add("ppPianoSampler");
  b.start();
  clock.runFor(12 * 60);
  const lh = notes.filter((n) => n.r === "lh");
  const rh = notes.filter((n) => n.r === "rh");
  assert.ok(lh.length > 100, `left hand notes ${lh.length}`);
  assert.ok(rh.length > 100, `right hand notes ${rh.length}`);
  assert.ok(notes.every((n) => n.r !== "bass"), "one-instrument rooms keep the bass note in the pianist's hand");
  for (const n of lh) assert.ok(n.m >= 24 && n.m <= 79, `lh ${n.m}`);
  const lhMed = lh.map((n) => n.m).sort((a, b2) => a - b2)[lh.length >> 1];
  const rhMed = rh.map((n) => n.m).sort((a, b2) => a - b2)[rh.length >> 1];
  assert.ok(lhMed < rhMed - 12, `left hand median ${lhMed} under the right's ${rhMed}`);
  assert.deepEqual([...new Set(lh.map((n) => n.syn))], ["ppPianoSampler"]);
  //! every bar the hand builds sums to four beats
  for (let i = 0; i < 40; i++) {
    C.refillBassBar();
    const total = C.bassBarEvents.reduce((a, ev) => a + ev.dur, 0);
    assert.ok(Math.abs(total - 4) < 1e-9, `bar sums to ${total}: ${JSON.stringify(C.bassBarEvents)}`);
  }
  b.done();
});

test("the left hand's chord sits in the tenor, voice-led, and reads any colour by role", () => {
  const b = band({ room: "piano", seed: 32 });
  const { C, clock } = b;
  clock.runFor(10);
  C.rotateRootScale(); C.resetHarmonyWalk();
  let prev = null;
  for (const shape of ["triad", "seventh", "add9", "sus2", "sus4", "open5", "ninth", "sixNine"]) {
    const degs = C.shapeDegs(2, shape);
    const v = C.lhChordVoice(degs, 3);
    assert.ok(v.length >= 2 && v.length <= 3, `${shape}: ${v}`);
    for (const m of v) assert.ok(m >= 48 && m <= 67, `${shape} voice ${m} outside the tenor`);
    for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1]);
    if (prev) for (const m of v) assert.ok(Math.min(...prev.map((p) => Math.abs(p - m))) <= 12);
    prev = v;
  }
  b.done();
});

test("a fixed left-hand figure runs the whole song when the pianist drew one", () => {
  const b = band({ room: "piano", seed: 33, warm: 60 });
  const { C, clock } = b;
  clock.runFor(10);
  C.rotateRootScale(); C.resetHarmonyWalk();
  C.sampleTouch();
  C.touchNow.figure = { order: "alberti", rate: 0.5, span: 1, ring: 1.5 };
  C.barIdx = 20; C.arcPhase = "body"; C.sectionNow = "B";
  C.refillBassBar();
  assert.equal(C.bassBarEvents.length, 8, "eighths at rate 0.5, full in the chorus");
  assert.ok(C.bassBarEvents.every((ev) => ev.dur === 0.5));
  C.sectionNow = "A"; C.sectionLift = () => ({ chord: 0.9, gain: 1, density: 1, reg: 0, space: 1 });
  C.refillBassBar();
  assert.equal(C.bassBarEvents.length, 4, "thinned to half rate in the verse");
  b.done();
});
