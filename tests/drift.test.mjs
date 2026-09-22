import { test } from "node:test";
import assert from "node:assert/strict";
import { band } from "./harness.mjs";

test("drift: a full take is held breath voices and a sub, nothing else, and the take's receipts are whole", () => {
  const b = band({ room: "drift", seed: 11, warm: 300 });
  const { C, clock, audio, takes, notes, marks } = b;
  const endTempos = [];
  const close = C.takeClose;
  C.takeClose = () => { if (C.noteLog) endTempos.push({ tempo: clock.tempo, trackTempo: C.trackTempo }); return close(); };
  b.start();
  clock.runFor(25 * 60);
  assert.ok(takes.length >= 1, `takes ${takes.length}`);
  const roles = new Set(notes.map((n) => n.r));
  assert.deepEqual([...roles], ["pad"], `roles ${[...roles]}`);
  const syns = new Set(notes.map((n) => n.syn));
  for (const s of syns) assert.ok(["ppBreathHeld", "ppSubHeld"].includes(s), `synth ${s}`);
  const names = new Set(audio.spawns.map((s) => s.name));
  for (const n of names) assert.ok(["ppBreathHeld", "ppAir", "ppSubHeld"].includes(n), `spawned ${n}`);
  assert.ok(marks.some((m) => m.mark === "chord"), "chord marks on the log");
  const t = takes[0];
  assert.match(t.lines[0], /^\{"header":1,"bpm":[\d.]+,"mood":"drift","root_midi":\d+,"scale":"\w+"\}$/);
  assert.match(t.lines[1], /^\{"mark":"chord"/);
  assert.ok(t.lines.some((l) => /"r":"pad"/.test(l)));
  assert.match(t.meta.wav_filename, /__drift__web$/);
  assert.equal(t.meta.preset_name, "drift");
  //! the ritardando: the conductor marks the track ended at the top of its
  //! last bar and the lifecycle stops it within a second, so the double bar
  //! falls one to three half-beat steps into the last bar's curve (the live
  //! engine's exact behaviour: lifecycle.scd polls ~trackEnded every 1 s).
  //! The tempo at the take's close therefore sits between the curve's value
  //! at the last bar's first step and its floor trackTempo*(1 - ritDepth).
  const rb = Math.max(C.mood.ritBars, 1), rd = C.mood.ritDepth;
  const atStep = (T, k) => T * (1 - rd * Math.pow(((rb - 1) * 4 + k * 0.5) / (rb * 4), 1.4));
  assert.ok(endTempos.length >= 1);
  for (const e of endTempos) {
    assert.ok(e.tempo < e.trackTempo * (1 - rd * 0.5), `the rit is audible: ${e.tempo} of ${e.trackTempo}`);
    assert.ok(e.tempo <= atStep(e.trackTempo, 0) + 1e-9 && e.tempo >= e.trackTempo * (1 - rd) - 1e-9, `end tempo ${e.tempo} outside the last bar's curve`);
  }
  b.done();
});

test("drift is seamless: the pad gate stays open across the boundary and no voice is dropped at the seam", () => {
  const b = band({ room: "drift", seed: 12, warm: 120 });
  const { C, clock, audio } = b;
  b.start();
  let sawEnd = false, gateAtEnd = null;
  const orig = C.takeClose;
  C.takeClose = () => { sawEnd = true; gateAtEnd = C.voiceGate.pad; return orig(); };
  clock.runFor(20 * 60);
  assert.ok(sawEnd, "a track ended");
  assert.equal(gateAtEnd, 1.0, "pad gate open through the seam");
  //! voices held at the end of the run: the chord's tones plus the sub
  const alive = audio.alive().filter((s) => s.name === "ppBreathHeld");
  assert.ok(alive.length >= 3 && alive.length <= 5, `${alive.length} held voices`);
  assert.equal(audio.alive().filter((s) => s.name === "ppSubHeld").length, 1);
  b.done();
});

test("a chord change cross-fades: voices on a kept tone stay, new tones enter, the rest gate off", () => {
  const b = band({ room: "drift", seed: 13, warm: 120 });
  const { C, clock, audio } = b;
  b.start();
  clock.runFor(30);
  const before = audio.alive().filter((s) => s.name === "ppBreathHeld").map((s) => s.args.midinote).sort();
  assert.ok(before.length >= 3);
  //! force the next chord and a bar
  C.chordNow.barsLeft = 1;
  clock.runFor(4.2 * clock.beatDur * 1);
  clock.runFor(8);
  const after = audio.alive().filter((s) => s.name === "ppBreathHeld").map((s) => s.args.midinote).sort();
  const kept = before.filter((m) => after.includes(m));
  const entered = audio.spawns.filter((s) => s.name === "ppBreathHeld").length - before.length;
  assert.ok(entered >= 1, "new voices entered");
  assert.ok(audio.gates.filter((g) => g.name === "ppBreathHeld").length >= 1, "unneeded voices gated off");
  assert.ok(kept.length + entered >= after.length, "the chord is complete");
  b.done();
});

test("piano room: the pad idles (padLevel 0); the pianist's two hands sound, nothing else until the strings are seated", () => {
  const b = band({ room: "piano", seed: 14, warm: 60 });
  b.C.voices.add("ppPianoSampler");
  b.start();
  b.clock.runFor(180);
  const names = new Set(b.audio.spawns.map((s) => s.name));
  assert.deepEqual([...names], ["ppPianoSampler"], `spawned ${[...names]}`);
  assert.ok(b.C.chordPath.length >= 1);
  assert.ok(b.notes.every((n) => ["rh", "lh", "duo"].includes(n.r)), `roles ${[...new Set(b.notes.map((n) => n.r))]}`);
  assert.ok(b.notes.some((n) => n.r === "lh"), "the left hand played");
  b.done();
});
