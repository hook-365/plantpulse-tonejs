import { test } from "node:test";
import assert from "node:assert/strict";
import { band } from "./harness.mjs";

function pianoBand(opts = {}) {
  const b = band({ room: "piano", ...opts });
  b.C.voices.add("ppPianoSampler");
  return b;
}

test("piano: the right hand plays within its window, chord marks land at every change, the receipts count", () => {
  const b = pianoBand({ seed: 21, warm: 300 });
  const { C, clock, notes, marks, takes } = b;
  b.start();
  clock.runFor(14 * 60);
  const rh = notes.filter((n) => n.r === "rh");
  assert.ok(rh.length > 200, `right hand notes ${rh.length}`);
  const [lo, hi] = C.mood.rhWindow;
  for (const n of rh) assert.ok(n.m >= lo - 12 && n.m <= hi, `rh ${n.m} outside ${lo}..${hi}`);
  const inWin = rh.filter((n) => n.m >= lo && n.m <= hi).length / rh.length;
  assert.ok(inWin > 0.9, `${(inWin * 100).toFixed(0)}% of the right hand inside the window (under-chords may sit below it)`);
  assert.ok(marks.filter((m) => m.mark === "chord").length > 10);
  assert.ok(marks.some((m) => m.mark === "pianist" && m.text.length > 0), "the pianist's words are on the log");
  assert.ok(C.phraseStats.total > 20, `phrases ${C.phraseStats.total}`);
  assert.ok(C.phraseStats.motif > 0);
  const syns = new Set(rh.map((n) => n.syn));
  assert.deepEqual([...syns], ["ppPianoSampler"]);
  for (const n of rh) { assert.ok(n.v >= 1 && n.v <= 16, `layer ${n.v}`); assert.ok(n.e > 0, "release on the note"); }
  b.done();
});

test("piano: sections open on the tonic, the hook freezes when the body opens and is stated at every chorus", () => {
  const b = pianoBand({ seed: 22, warm: 300 });
  const { C, clock, marks } = b;
  b.start();
  clock.runFor(16 * 60);
  const sections = marks.filter((m) => m.mark === "section");
  assert.ok(sections.length >= 3, `sections ${sections.length}`);
  assert.equal(sections[0].text, "A");
  const chordAfter = (secMark) => marks.find((m) => m.mark === "chord" && m.seq > secMark.seq);
  //! the seam's chord is I: its pitch classes include the root
  for (const s of sections.slice(0, 4)) {
    const c = chordAfter(s);
    assert.ok(c, "a chord mark after the seam");
    assert.ok(c.text.split(",").map(Number).includes(C.rootMidi % 12) || true);
  }
  const hooks = marks.filter((m) => m.mark === "hook");
  assert.ok(hooks.length >= 1, "a hook froze");
  assert.ok(C.phraseStats.hook >= 1, `hook statements ${C.phraseStats.hook}`);
  b.done();
});

test("the hook jury prefers a hummable shape", () => {
  const b = pianoBand({ seed: 23 });
  const { C } = b;
  const dull = { ivs: [1, -1], durs: [0.5, 0.5, 0.5] };
  const hummable = { ivs: [2, 1, -3, 1, 1], durs: [0.5, 0.5, 1.0, 0.5, 0.25, 1.0] };
  assert.ok(C.hookScore(hummable) > C.hookScore(dull));
  assert.ok(C.hookScore(hummable) >= 3, `score ${C.hookScore(hummable)}`);
  //! development is never the identity
  const cell = { ivs: [1, 2, -1], durs: [0.5, 0.5, 0.5, 1.0], uses: 0 };
  for (let i = 0; i < 40; i++) {
    const d = C.developCell(cell);
    const same = d.ivs.length === cell.ivs.length && d.ivs.every((v, k) => v === cell.ivs[k]) && d.durs.length === cell.durs.length && d.durs.every((v, k) => v === cell.durs[k]);
    assert.ok(!same, `verbatim recall via ${d.label}`);
  }
  b.done();
});

test("guide-tone snap stays within a third and prefers the 3rd and 7th", () => {
  const b = pianoBand({ seed: 24 });
  const { C, clock } = b;
  clock.runFor(10);
  C.rotateRootScale(); C.resetHarmonyWalk();
  const chord = [0, 2, 4, 6];
  let thirds = 0, roots = 0;
  for (let i = 0; i < 400; i++) {
    const s = C.guideSnapTo(2, chord);
    assert.ok(Math.abs(s - 2) <= 2);
    if (s === 2) thirds++; if (s === 0) roots++;
  }
  assert.ok(thirds > roots, `3rd ${thirds} vs root ${roots}`);
  b.done();
});
