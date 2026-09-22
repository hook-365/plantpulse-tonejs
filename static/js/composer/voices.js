//! voices.js: the audible surface (the live project's composer/voices.scd,
//! the pad half; the left hand lands in lefthand.js, the strings in
//! strings.js). One note-firing seam for every voice: fireNote logs the
//! note and hands it to the audio layer; sampler-backed and synth voices
//! are the audio layer's business. Decision rows: docs/COMPOSER.md
//! "Per-bar" and "Per-note".
import { rrand, choose, coin, clip, midicps } from "../sc.js";

export function install(C) {
  //! the audio layer registers the voices it implements (C.voices, a Set);
  //! a pool entry is playable when it is one of them, so an absent library
  //! drops the voice from the draw instead of firing silence
  C.voices = C.voices ?? new Set();
  C.voiceAvailable = (n) => C.voices.has(n);

  //! fireNote(voice, midinote, amp, dur, pan, vel, extra, role): dur in
  //! seconds, extra a flat ['key', value, ...] list as in sclang. The audio
  //! layer's C.synth(name, args, when) makes the sound; C.synth is a fake in
  //! tests. A voice the layer lacks is logged and silent (a typed absence,
  //! not an error): the roll still draws it.
  C.fireNote = (voice, midinote, amp, dur, pan = 0, vel = 8, extra = null, role = null) => {
    const xtr = extra ?? [];
    const rec = C.noteLogWrite(role, midinote, amp, dur, vel, xtr, voice);
    const args = { freq: midicps(midinote), midinote, amp, dur, pan, vel };
    for (let i = 0; i + 1 < xtr.length; i += 2) args[xtr[i]] = xtr[i + 1];
    return C.synth?.(voice, args, rec.t) ?? null;
  };

  //! the pedal: the sustain pedal belongs to the pianist (phase 3); until
  //! then no key-up resonance is suppressed and no pedal noise plays
  C.pedalNow = false;
  C.pedalRel = (base, cap, durBeats = 1) => {
    if (C.pedalNow && C.beatsToChordChange) {
      const toChange = C.beatsToChordChange() * C.clock.beatDur;
      return clip(toChange + 0.3, base, durBeats <= 0.35 ? Math.min(cap, 1.2) : cap);
    }
    return base;
  };
  C.pedalChange = null;

  //! the pianist's coin: two hands, or the keys player's part
  C.compsNow = () => C.touchNow?.comps ?? false;
  C.handsChordsNow = () => Math.max(C.mood.handsChords ?? 0, C.compsNow() ? 1 : 0);
  //! the keys player never idles for the pianist
  C.padLevelNow = () => C.mood.padLevel ?? 0;
  //! when the left hand's synth is not the right hand's, the hands are split
  //! across two players (lofi's upright; neither free room)
  C.lhSplit = () => (C.mood.leftHandSynth ?? "ppPianoSampler") !== (C.mood.rightHandSynth ?? "ppPianoSampler");

  //! the keys player's draw (padPool): the comp / pad instrument this take
  C.ensureKeys = () => {
    if (C.keysNow == null && (C.mood.padComp ?? 0) > 0) {
      C.keysNow = C.sampleKeys();
      C.keysNow.strum = C.keysNow.inst === "ppGuitarPop" ? rrand(0.012, 0.030) : 0;
      C.log(`[keys] ${C.keysNow.inst} trem=${C.keysNow.tremRate.toFixed(1)}Hz/${C.keysNow.tremDepth.toFixed(2)} bright=${Math.round(C.keysNow.bright)} oct=${C.keysNow.octDrop} shell=${C.keysNow.shell}`);
    }
    return C.keysNow;
  };
  C.padSynthNow = () => C.ensureKeys()?.inst ?? C.mood.padSynth ?? "ppPianoSampler";
  C.sampleKeys = () => ({
    inst: choose((C.mood.padPool ?? []).filter((n) => C.voiceAvailable(n))) ?? C.mood.padSynth ?? "ppPianoSampler",
    tremRate: rrand(3.2, 6.5),
    tremDepth: choose([rrand(0.03, 0.08), rrand(0.10, 0.22)]),
    bright: Math.exp(rrand(-0.35, 0.35)) * 2600,
    octDrop: coin(0.3) ? -1 : 0,
    shell: coin(0.35),
    warp: Math.exp(rrand(-0.5, 0.6)),
  });

  //! padHold > 0: the pad is a set of HELD voices (ppBreathHeld). On a chord
  //! change a voice already on a new chord tone stays; every other chord
  //! tone ENTERS as a fresh voice over an 8 s swell while the voices the
  //! chord no longer needs fade out over 8 s: the chords cross-fade, no
  //! portamento ("it'd be nice to just have them like blend"). subLevel adds
  //! one held sine on the root two octaves down. Every bar the loudness law
  //! follows the plant (the def's amp lag).
  C.padHeld = []; C.padSubHeld = null; C.padSubMidi = null; C.padHeldPath = -1; C.padLastColor = null;
  C.padHeldRelease = () => {
    for (const h of C.padHeld) h.syn?.set({ gate: 0 });
    C.padHeld = [];
    C.padSubHeld?.set({ gate: 0 });
    C.padSubHeld = null; C.padSubMidi = null;
    C.padHeldPath = -1;
  };
  C.padHoldBar = (level, gate) => {
    const oct = Math.trunc(C.mood.padOctave ?? 0);
    const arcG = C.arcGainFor?.("pad") ?? 1.0;
    const amp = level * 0.20 * (0.70 + C.sig.energy * 0.30) * gate * arcG;
    const pathSize = C.chordPath?.length ?? 0;
    const changed = pathSize !== C.padHeldPath || C.chordNow.color !== C.padLastColor;
    C.padLastColor = C.chordNow.color;
    for (const h of C.padHeld) h.syn?.set({ amp });
    C.padSubHeld?.set({ amp: amp * (C.mood.subLevel ?? 0) * 0.5 });   //! 0.5: a pure sine needs no makeup
    if (!changed) return;
    C.padHeldPath = pathSize;
    const degs = C.chordDegrees("now");
    const targets = C.voiceLeadTo(degs, oct).slice();
    const unassigned = C.padHeld.slice();
    const when = C.clock.beatsToSecs(C.clock.beats);
    for (const m of targets) {
      const same = unassigned.find((h) => h.midi === m);
      if (same) {
        unassigned.splice(unassigned.indexOf(same), 1);
        C.noteLogWrite("pad", m, amp, 4.0, 7, [], "ppBreathHeld");   //! kept: the feed carries the whole chord at every change
      } else {
        const rec = C.noteLogWrite("pad", m, amp, 8.0, 7, [], "ppBreathHeld");
        const syn = C.synth?.("ppBreathHeld", { freq: midicps(m), midinote: m, amp, glide: 0.05, atk: 8.0, rel: 8.0, pan: rrand(-0.4, 0.4) }, rec.t) ?? null;
        C.padHeld.push({ midi: m, syn });
        C.synth?.("ppAir", { freq: midicps(m), midinote: m, amp: amp * 0.5, dur: 12.0, pan: 0 }, when);
      }
    }
    for (const h of unassigned) { h.syn?.set({ gate: 0 }); C.padHeld.splice(C.padHeld.indexOf(h), 1); }
    if ((C.mood.subLevel ?? 0) > 0) {
      const rootMidi = Math.max(C.degToMidi(degs[0], oct - 2), 24);
      //! the sub blends too: a new root is a new sine, the old one fades
      if (C.padSubHeld == null || C.padSubMidi !== rootMidi) {
        C.padSubHeld?.set({ gate: 0 });
        C.padSubHeld = C.synth?.("ppSubHeld", { freq: midicps(rootMidi), midinote: rootMidi, amp: amp * (C.mood.subLevel ?? 0) * 0.5 }, when) ?? null;
        C.padSubMidi = rootMidi;
      }
      C.noteLogWrite("pad", rootMidi, amp * (C.mood.subLevel ?? 0) * 0.5, 4.0, 7, [], "ppSubHeld");
    }
  };

  //! the pad player: the held bed where padHold is on; the struck comp
  //! (padComp, the keys player's Rhodes / Wurli / guitar) is lofi's and is not
  //! seated in the free rooms (drift holds, piano's padLevel is 0)
  C.padPlayerBody = function* () {
    for (;;) {
      const gate = C.voiceGate.pad ?? 0;
      const level = C.padLevelNow();
      if (gate > 0.05 && level > 0.01) {
        if ((C.mood.padHold ?? 0) > 0) {
          C.padHoldBar(level, gate);
          yield 4;
        } else {
          C.ensureKeys();
          yield 4;
        }
      } else {
        if (C.padHeld.length || C.padSubHeld) C.padHeldRelease();
        yield 4.0;
      }
    }
  };

  //! Round-robin for the piano: a same-pitch strike within 1.5 s at the
  //! same layer is nudged to a neighbouring layer (alternating up/down), so
  //! no two strikes are the same recording. Velocity itself is untouched.
  C.pianoLastStrike = new Map();
  C.pianoRoundRobin = (midi, vel) => {
    const now = C.clock.now();
    const last = C.pianoLastStrike.get(midi);
    let layer = Math.trunc(Math.round(clip(vel, 1, 16)));
    let dir = 1;
    if (last != null && now - last.t < 1.5 && last.layer === layer) {
      dir = -last.dir;
      layer = clip(layer + dir, 1, 16);
      if (layer === last.layer) layer = clip(layer - 2 * dir, 1, 16);
    }
    C.pianoLastStrike.set(midi, { t: now, layer, dir });
    return layer;
  };

  //! the right hand: one phrase after another while its gate is open and
  //! its level is up; rests the final two bars of a song outro; never starts
  //! a phrase inside a section's final beats (the seam hold)
  C.rightHandBody = function* () {
    for (;;) {
      const gate = C.voiceGate.rightHand ?? 0;
      const level = C.mood.rightHandLevel ?? 0;
      if (level < 0.01 || gate < 0.05 || C.playPhrase == null) { yield 1.0; continue; }
      if (C.songOutro?.() && C.barsTotal != null && C.barsTotal - C.barIdx <= 2) { yield 1.0; continue; }
      const seamBeats = C.sectionBarsLeft != null ? C.sectionBarsLeft * 4 - C.beatInBar() : null;
      if (seamBeats != null && seamBeats < 4 && seamBeats > 0) yield seamBeats;
      else yield* C.playPhrase();
    }
  };
  //! the left hand is lefthand.js's (installed after this module)

  //! Phase offsets order the bar line: conductor (quant 4) advances harmony
  //! first, the pad strikes next, the left hand builds its bar last.
  C.startVoices = () => {
    C.padPlayer?.stop(); C.rightHand?.stop(); C.leftHand?.stop(); C.stringsPlayer?.stop();
    C.celloBedFree?.(0.7);
    C.padPlayer = C.clock.play(C.padPlayerBody, { quant: 4, phase: 0.02, name: "pad" });
    C.rightHand = C.clock.play(C.rightHandBody, { quant: 4, name: "rightHand" });
    C.leftHand = C.clock.play(C.leftHandBody, { quant: 4, phase: 0.05, name: "leftHand" });
    if (C.stringsPlayerBody) C.stringsPlayer = C.clock.play(C.stringsPlayerBody, { quant: 4, phase: 0.03, name: "strings" });
  };
  C.stopVoices = () => {
    C.padPlayer?.stop(); C.rightHand?.stop(); C.leftHand?.stop(); C.stringsPlayer?.stop();
    C.padHeldRelease();
  };
}
