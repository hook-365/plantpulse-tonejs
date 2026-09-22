//! lifecycle.js: the track loop and the conductor (the live project's
//! composer/lifecycle.scd). The conductor is the single bar-grid
//! authority: it advances the harmony walk once per bar, arms the
//! track-end cadence, runs the ritardando, and ends the track on the bar.
import { rrand, wchoose, clip, div, roundTo } from "../sc.js";

export function install(C) {
  C.voiceGate = { pad: 0.0, leftHand: 0.0, rightHand: 0.0, drums: 0.0 };
  //! Live tempo, so the ritardando stretches every consumer for free.
  C.secondsPerBar = () => 4.0 * C.clock.beatDur;
  C.trackStart = null; C.trackDur = null; C.barIdx = 0; C.barsTotal = null;
  C.trackEnded = false; C.barStartBeat = 0; C.trackTempo = null;

  C.beatInBar = () => clip(C.clock.beats - C.barStartBeat, 0, 4);
  //! the one swing map: 8th offbeats late by sw*k8, odd 16ths by sw*k16
  C.swingK8 = 0.12; C.swingK16 = 0.083;
  C.swingOff = (pos) => {
    const sw = clip(C.mood.drumSwing ?? 0, 0, 1);
    const frac = roundTo(pos % 1.0, 0.001);
    if (frac === 0.5) return sw * C.swingK8;
    if (frac === 0.25 || frac === 0.75) return sw * C.swingK16;
    return 0;
  };
  C.swingAt = (pos) => pos + C.swingOff(pos);
  //! A section seam cuts the dwell and lands on I, so in the last bar of a
  //! section the honest "next chord" is the tonic.
  C.atSectionSeam = () => C.sectionBarsLeft != null && C.sectionBarsLeft === 1
    && ((C.barsTotal ?? 0) - C.barIdx - 1) > (C.mood.outroBars ?? 8);
  C.beatsToChordChange = () => {
    const dwell = ((C.chordNow.barsLeft ?? 1) - 1) * 4 + (4 - C.beatInBar());
    return C.atSectionSeam() ? Math.min(dwell, 4 - C.beatInBar()) : dwell;
  };
  C.nextChordDegsForLead = () => (C.atSectionSeam() ? C.shapeDegs(0, "triad") : C.chordDegrees("next"));

  //! Section character: the chorus lifts, the verse gives space, the
  //! breakdown thins; dynWide widens the gains and regDrop hands B the
  //! octave. A null section is neutral (drift, intro/outro).
  C.sectionLiftFor = (sec) => {
    const w = clip(C.mood.dynWide ?? 0, 0, 1);
    const r = Math.trunc(roundTo(C.mood.regDrop ?? 0));
    switch (sec) {
      case "B": return { gain: 1.10 + 0.30 * w, density: 1.15, reg: 2 + r, chord: 1.5, space: 0.8 };
      case "A": return { gain: 0.96 - 0.06 * w, density: 0.90, reg: 0, chord: 0.9, space: 1.15 };
      case "breakdown": return { gain: 0.90 - 0.15 * w, density: 0.75, reg: -1, chord: 0.7, space: 1.3 };
      default: return { gain: 1.0, density: 1.0, reg: 0, chord: 1.0, space: 1.0 };
    }
  };
  C.sectionNext = null;
  C.sectionLift = () => {
    let now = C.sectionLiftFor(C.sectionNow);
    const w = clip(C.mood.dynWide ?? 0, 0, 1);
    if (w > 0 && C.sectionNext != null && C.sectionBarsLeft != null && C.sectionBarsLeft <= 4) {
      const nxt = C.sectionLiftFor(C.sectionNext);
      const prog = clip(((4 - C.sectionBarsLeft) + C.beatInBar() / 4) / 4, 0, 1);
      now = { ...now, gain: now.gain + (nxt.gain - now.gain) * prog * w };
    }
    return now;
  };

  //! The form clock: when a mood sets sectionBars > 0 the body is cut into
  //! sections. null section = form clock off (drift never sees it).
  C.sectionNow = null; C.sectionBarsLeft = null; C.sectionIdx = 0;
  //! The form walk: B lifts with energy, breakdown invites collapse, A is
  //! home. First body section is always A; breakdown never repeats.
  C.formWalkStep = (idx) => {
    const i = idx ?? C.sectionIdx;
    const e = C.sigOver(30, "energy");
    let cands = ["A", "B", "breakdown"];
    let wts = [1.0, Math.exp(2.2 * (e - 0.5)), Math.exp(2.2 * (0.35 - e))];
    if (C.sectionNow === "breakdown") { cands = cands.slice(0, 2); wts = [0.3, 1.5]; }
    return i === 0 ? "A" : wchoose(cands, wts);
  };
  C.sectionStartBar = null; C.sectionLen = null;
  C.formAdvanceBar = (remaining) => {
    const sb = Math.trunc(C.mood.sectionBars ?? 0);
    const intro = C.mood.introBars ?? 8, outro = C.mood.outroBars ?? 8;
    if (sb > 0 && C.barIdx >= intro && remaining > outro) {
      const bodyBar = C.barIdx - intro;
      const opening = C.sectionStartBar == null || bodyBar >= C.sectionStartBar + C.sectionLen;
      if (opening) {
        C.sectionIdx = C.sectionStartBar == null ? 0 : C.sectionIdx + 1;
        C.sectionStartBar = bodyBar;
        C.sectionNow = C.sectionNext ?? C.formWalkStep(C.sectionIdx);
        C.sectionNext = null;
        C.sectionLen = C.sectionNow === "breakdown" ? Math.max(div(sb, 2), 4) : sb;
        C.walkCallHome?.();
        C.chorusProgArm?.(C.sectionNow);
        C.log(`[form] section ${C.sectionNow} (idx ${C.sectionIdx}) at bar ${C.barIdx}`);
        C.noteLogMark?.("section", C.sectionNow);
        C.celloVoiceSeam?.(C.sectionNow);
      }
      const pos = bodyBar - C.sectionStartBar;
      if (pos === Math.max(C.sectionLen - 4, 1) && C.sectionNext == null) C.sectionNext = C.formWalkStep(C.sectionIdx + 1);
      C.sectionBarsLeft = Math.min(C.sectionLen - pos, remaining - outro);
    } else {
      C.sectionNow = null; C.sectionNext = null; C.sectionBarsLeft = null;
    }
  };

  C.conductorBody = function* () {
    C.barIdx = 0;
    for (;;) {
      C.barStartBeat = C.clock.beats;
      //! the note log's beat 0 is this track's first bar
      if (C.barIdx === 0) C.noteLogBeat0 = C.barStartBeat;
      const remaining = (C.barsTotal ?? 0) - C.barIdx;
      C.formAdvanceBar(remaining);
      if (remaining <= (C.mood.outroBars ?? 8)) C.armCadence();
      C.harmonyAdvanceBar();
      //! Ritardando: continuous (re-set every half beat), curved (progress^1.4),
      //! scaled from the track's true tempo, over the final ritBars.
      C.barIdx = C.barIdx + 1;
      if (C.barIdx >= (C.barsTotal ?? 0)) C.trackEnded = true;
      if (remaining <= (C.mood.ritBars ?? 4) && C.trackTempo != null) {
        const rb = Math.max(C.mood.ritBars ?? 4, 1);
        const rd = clip(C.mood.ritDepth ?? 0.14, 0, 0.5);
        const into = Math.max(rb - remaining, 0);
        for (let k = 0; k < 8; k++) {
          const prog = clip((into * 4 + k * 0.5) / (rb * 4), 0, 1);
          C.clock.tempo = C.trackTempo * (1 - rd * Math.pow(prog, 1.4));
          yield 0.5;
        }
      } else {
        yield 4;
      }
    }
  };

  //! the take's sidecar meta (the live project's recording.scd ~recCaptureMeta)
  C.recCaptureMeta = () => ({
    preset_name: C.mood.name ?? "unknown",
    bpm: C.mood.bpm ?? 0,
    scale: C.scaleName ?? "unknown",
    root_midi: C.rootMidi ?? 0,
    track_dur_s: C.trackDur ?? 0,
    outro_bars: C.mood.outroBars ?? 8,
    sig_energy_at_start: C.sig.energy,
    sig_stability_at_start: C.sig.stability,
    sig_center_at_start: C.sig.center,
    weather_at_start: C.sig.weather ?? 0.5,
  });

  //! the stop-time sidecar fields tools/take-review reads: the chord path,
  //! the phrase receipts, the players' draws
  C.takeExtra = () => ({
    chord_path: (C.chordPath ?? []).join(" "),
    phr_total: C.phraseStats?.total ?? 0, phr_hook: C.phraseStats?.hook ?? 0, phr_recall: C.phraseStats?.recall ?? 0,
    phr_lick: C.phraseStats?.lick ?? 0, phr_free: C.phraseStats?.free ?? 0, phr_motif: C.phraseStats?.motif ?? 0,
    motif_len: C.chorusCell?.ivs ? C.chorusCell.ivs.length + 1 : 0,
    rh_synth: C.touchNow?.rhSynth ?? C.mood.rightHandSynth ?? "",
    pianist: C.touchNow?.words ?? "",
    strings: C.stringsNow?.on ? 1 : 0,
    strings_role: C.stringsNow?.on ? C.stringsNow.role : "none",
    cellist: C.stringsNow?.on ? C.stringsNow.words : "",
    cello_voice: C.stringsNow?.on && C.stringsNow.voice ? C.stringsNow.voiceSec : "none",
    root_name: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((C.rootMidi ?? 60) % 12 + 12) % 12] + String(Math.floor((C.rootMidi ?? 60) / 12) - 1),
  });

  C.lifecycleBody = function* () {
    for (;;) {
      //! Weather nudges tempo at track boundaries only; this line is also the
      //! ritardando restore.
      C.clock.tempo = ((C.mood.bpm ?? 60) / 60.0) * (1 + (C.weatherEff() - 0.5) * 0.16);
      C.trackTempo = C.clock.tempo;
      C.rotateRootScale();
      const range = C.mood.trackDurRange;
      C.barsTotal = Math.max(Math.trunc(roundTo(rrand(range[0], range[1]) / C.secondsPerBar())), 8);
      C.trackDur = C.barsTotal * C.secondsPerBar();
      C.trackStart = C.clock.now();
      C.trackEnded = false;
      C.sectionNow = null; C.sectionBarsLeft = null; C.sectionIdx = 0; C.sectionStartBar = null; C.sectionLen = null;
      C.resetHarmonyWalk();
      C.memCells = []; C.chorusCell = null; C.hookStatedIdx = null; C.hookPlan = null;
      C.phraseStatsReset?.(); C.skelReset?.(); C.periodReset?.(); C.sampleTouch?.();
      C.padHeldPath = -1;   //! seamless: voices held across the boundary re-voice-lead on the new track's first bar
      if (C.keysNow != null) C.keysLast = C.keysNow;
      C.keysNow = null;
      C.sampleBassist?.();
      if (C.stringsNow != null) C.stringsLast = C.stringsNow;
      C.stringsNow = null;
      C.celloVoiceReset?.(); C.celloSingEnd?.();
      C.bassBarEvents = []; C.bassEventIdx = 0;
      C.voiceGate.pad = 1.0; C.voiceGate.leftHand = 1.0; C.voiceGate.rightHand = 1.0; C.voiceGate.drums = 1.0;
      C.log(`[lifecycle] track start: mood=${C.mood.name} root=${C.rootMidi} scale=${C.scaleName} bars=${C.barsTotal} (${Math.round(C.trackDur)}s)`);
      C.takeOpen?.(C.recCaptureMeta());
      C.conductor?.stop();
      C.conductor = C.clock.play(C.conductorBody, { quant: 4, name: "conductor" });
      while (!C.trackEnded) yield { sec: 1.0 };
      C.conductor.stop(); C.conductor = null;
      //! seamless (drift): the pad gate stays open so the held voices sound
      //! straight through the boundary, and there is no weather gap.
      if (!((C.mood.seamless ?? 0) > 0)) C.voiceGate.pad = 0.0;
      C.voiceGate.leftHand = 0.0; C.voiceGate.rightHand = 0.0; C.voiceGate.drums = 0.0;
      C.log("[lifecycle] track end");
      yield { sec: 3.0 };
      C.takeClose?.();
      if (!((C.mood.seamless ?? 0) > 0)) yield { sec: 2.0 + (1 - C.weatherEff()) * 10.0 };
    }
  };

  C.lifecycle = null;
  C.playLifecycle = () => {
    C.lifecycle?.stop();
    C.conductor?.stop(); C.conductor = null;
    C.trackEnded = false;
    C.lifecycle = C.clock.play(C.lifecycleBody, { sec: true, name: "lifecycle" });
    return C.lifecycle;
  };
  C.stopLifecycle = () => {
    C.lifecycle?.stop(); C.lifecycle = null;
    C.conductor?.stop(); C.conductor = null;
    C.voiceGate.pad = 0; C.voiceGate.leftHand = 0; C.voiceGate.rightHand = 0; C.voiceGate.drums = 0;
    C.takeClose?.();
  };
}
