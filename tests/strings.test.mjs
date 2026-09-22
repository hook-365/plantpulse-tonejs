import { test } from "node:test";
import assert from "node:assert/strict";
import { band } from "./harness.mjs";

function pianoWithCello(seed) {
  const b = band({ room: "piano", seed, warm: 300 });
  b.C.voices.add("ppPianoSampler"); b.C.voices.add("ppCello"); b.C.voices.add("ppCelloLeg");
  return b;
}

test("piano: the cellist is drawn per song at stringsProb, sits between the left hand and the melody, and is on the log", () => {
  let withCello = 0, songs = 0, celloNotes = [], allNotes = [], marks = [];
  for (const seed of [41, 42, 43, 44, 45, 46]) {
    const b = pianoWithCello(seed);
    b.start();
    b.clock.runFor(9 * 60);
    songs += 1;
    const cn = b.notes.filter((n) => n.r === "cello");
    if (cn.length) withCello += 1;
    celloNotes.push(...cn); allNotes.push(...b.notes); marks.push(...b.marks);
    if (cn.length) {
      const held = b.audio.spawns.filter((s) => s.name === "ppCelloLeg");
      assert.ok(held.length > 0, "held bows spawned");
      assert.ok(b.audio.gates.some((g) => g.name === "ppCelloLeg"), "bows let go at rests and changes");
    }
    b.done();
  }
  assert.ok(withCello >= 1 && withCello <= 5, `${withCello} of ${songs} songs seated a cellist (stringsProb 0.5)`);
  for (const n of celloNotes) assert.ok(n.m >= 36 && n.m <= 79, `cello ${n.m}`);
  assert.ok(marks.some((m) => m.mark === "cellist"), "the cellist's words ride the log");
  const rh = allNotes.filter((n) => n.r === "rh"), lh = allNotes.filter((n) => n.r === "lh");
  const med = (xs) => xs.map((n) => n.m).sort((a, b) => a - b)[xs.length >> 1];
  assert.ok(med(celloNotes) < med(rh), `cello median ${med(celloNotes)} under the melody's ${med(rh)}`);
  assert.ok(med(celloNotes) > med(lh) - 12, `cello median ${med(celloNotes)} not under the left hand's ${med(lh)}`);
});

test("the inner voice moves by at most a 4th inside the band unless a new section lifts it", () => {
  const b = pianoWithCello(47);
  const { C, clock } = b;
  clock.runFor(10);
  C.rotateRootScale(); C.resetHarmonyWalk();
  C.arcPhase = "body";
  let last = null;
  for (let i = 0; i < 60; i++) {
    C.chordNow.barsLeft = 0; C.harmonyAdvanceBar();
    const m = C.stringsPick(C.chordDegrees("now"), "A", "root", 0.3, false);
    assert.ok(m >= 36 && m <= 76, `bed ${m}`);
    if (last != null) assert.ok(Math.abs(m - last) <= 5 || m === last, `moved ${last} -> ${m}`);
    C.stringsLastMidi = m; last = m;
  }
  b.done();
});
