//! harmony.js: key, scale, and the functional harmony walk (the live
//! project's composer/harmony.scd). Harmony never loops: a Markov walk over
//! tonic/subdominant/dominant functions with a one-chord lookahead,
//! plant-biased transitions, a forced return home, and a scheduled cadence
//! at track end. Decision rows: docs/COMPOSER.md "Per-dwell" and "Per-track".
import { rrand, wchoose, choose, coin, clip, mean, mod, div, roundTo } from "../sc.js";

//! sclang's Scale tables by semitone (whole has 6 degrees, pentatonic 5;
//! degToMidi folds by the table's length, so the tables are ported, not
//! the names)
export const scaleByName = {
  pentatonic: [0, 2, 4, 7, 9],
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  wholeTone: [0, 2, 4, 6, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

//! The degree that names the mode: the one scale-relative index separating
//! it from its reference neighbor. The walk weights chords containing it.
export const modeColorDeg = { dorian: 5, lydian: 3, mixolydian: 6 };
//! Brightness rank per mode for the weather-biased palette pick.
export const modeBrightness = { lydian: 1.0, major: 0.8, pentatonic: 0.7, mixolydian: 0.6, wholeTone: 0.5, dorian: 0.35, minor: 0.15 };

//! Chord colour vocabulary (schema chordColor.vocab; the gate requires
//! every name here): degree offsets from the chord root, diatonic.
export const colorShapes = {
  triad: [0, 2, 4],
  seventh: [0, 2, 4, 6],
  ninth: [0, 2, 4, 6, 8],
  eleventh: [0, 2, 4, 6, 10],   //! 9th omitted: m11 = 1 b3 5 b7 11
  sixth: [0, 2, 4, 5],
  sixNine: [0, 2, 4, 5, 8],
  add9: [0, 2, 4, 8],
  sus2: [0, 1, 4],
  sus4: [0, 3, 4],
  open5: [0, 4, 7],
};
export const colorToken = { triad: "", seventh: "+7", ninth: "+9", eleventh: "+11", sixth: "+6", sixNine: "+69", add9: "+add9", sus2: "+sus2", sus4: "+sus4", open5: "+5" };

export function noteNameToMidi(name, baseOctave = 3) {
  const map = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const s = String(name);
  let acc = 0;
  if (s.length > 1) { if (s[1] === "#") acc = 1; if (s[1] === "b") acc = -1; }
  return baseOctave * 12 + 12 + map[s[0].toUpperCase()] + acc;
}

export function install(C) {
  C.rootIdx = 0;
  C.rootMidi = 55;
  C.scale = scaleByName.major;
  C.scaleName = "major";
  //! Per-track walk personality: plant signals set the lean (settled ->
  //! home-loving, lively -> pull), free randomness spreads same-key takes
  //! apart. Parameter continuity, not seed determinism.
  C.walkTilt = { func: { T: 1.0, S: 1.0, D: 1.0 }, deg: [1, 1, 1, 1, 1, 1, 1] };
  C.sampleWalkTilt = () => {
    const e = C.sig?.energy ?? 0.5, st = C.sig?.stability ?? 0.5;
    C.walkTilt = {
      func: {
        //! hinges at 0.5: energy and stability are ranks
        T: Math.exp((st - 0.5) * 0.8 + rrand(-0.15, 0.15)),
        S: Math.exp(rrand(-0.15, 0.15)),
        D: Math.exp((e - 0.5) * 1.2 + rrand(-0.15, 0.15)),
      },
      deg: Array.from({ length: 7 }, () => Math.exp(rrand(-0.35, 0.35))),
    };
    C.log(`[harmony] walk tilt func=${JSON.stringify(C.walkTilt.func)}`);
  };

  C.degToMidi = (deg, octOffset = 0) => {
    const semis = C.scale, n = semis.length;
    const oct = div(deg, n) + octOffset, idx = mod(deg, n);
    return C.rootMidi + oct * 12 + semis[idx];
  };

  //! Root: deterministic cycle through the pool. Scale: weather-biased pick,
  //! no immediate repeat; lively days lean bright, quiet days dark; at
  //! neutral weather the pick is uniform.
  C.rotateRootScale = () => {
    const pool = C.mood.rootPool, spool = C.mood.scalePool;
    C.rootIdx = (C.rootIdx + 1) % pool.length;
    C.rootMidi = noteNameToMidi(pool[C.rootIdx]);
    let pick = spool.filter((s) => s !== C.scaleName);
    if (!pick.length) pick = spool;
    const w = C.weatherEff();
    const k = 4;
    const wts = pick.map((s) => Math.exp(k * (w - 0.5) * ((modeBrightness[s] ?? 0.5) - 0.5)));
    C.scaleName = wchoose(pick, wts);
    C.scale = scaleByName[C.scaleName] ?? scaleByName.major;
    C.sampleWalkTilt();
    C.log(`[harmony] root=${C.rootMidi} (${pool[C.rootIdx]}) scale=${C.scaleName} (weather ${roundTo(w, 0.01)})`);
  };

  C.shapeDegs = (deg, shape) => (colorShapes[shape] ?? colorShapes.triad).map((o) => o + Math.trunc(deg));

  //! Chord roles by OFFSET, not by index: the 3rd's chair is taken by a sus
  //! tone, the 7th's by a 6th; ext is the 9th/11th when the dwell carries one.
  C.chordRoles = (degs) => {
    const root = Math.trunc(degs[0]);
    const offs = degs.map((d) => Math.trunc(d) - root);
    const susOff = offs.find((o) => o === 1 || o === 3);
    const extOff = offs.find((o) => o >= 8);
    return {
      root,
      third: offs.includes(2) ? root + 2 : (susOff != null ? root + susOff : null),
      fifth: root + 4,
      seventh: offs.includes(6) ? root + 6 : (offs.includes(5) ? root + 5 : null),
      ext: extOff != null ? root + extOff : null,
    };
  };

  C.drawColor = (deg, func) => {
    const row = (C.mood.chordColor ?? {})[func] ?? { triad: 1.0 };
    const names = Object.keys(row);
    const pick = String(wchoose(names, names.map((k) => Number(row[k])))).split(">");
    let shape = pick[0];
    const resolve = pick.length > 1 ? pick[1] : null;
    //! the 11th only rides a minor 3rd; over a major 3rd it is the avoid note
    if (shape === "eleventh" && mod(C.degToMidi(deg + 2) - C.degToMidi(deg), 12) === 4) shape = "ninth";
    return { color: shape, resolve, degs: C.shapeDegs(deg, shape) };
  };
  C.withColor = (ev) => Object.assign(ev, C.drawColor(ev.deg, ev.func));

  //! the chord on the note log: a mark at every chord change carrying the
  //! sounding pitch classes, so take-review measures chord-tone fit exactly
  C.chordMark = () => {
    if (!C.noteLogMark) return;
    const degs = C.chordNow.degs ?? [C.chordNow.deg];
    C.noteLogMark("chord", degs.map((d) => mod(C.degToMidi(Math.trunc(d)), 12)).join(","));
  };
  //! Path token: deg func bars [+colour] [>resolved]: "0T3", "1S2+7", "4D2+sus4>7"
  C.chordToken = (c, bars) =>
    `${Math.trunc(c.deg)}${c.func}${Math.trunc(bars)}${colorToken[c.color ?? "triad"]}${c.resolve ? ">" + colorToken[c.resolve].slice(1) : ""}`;

  C.chordNow = { deg: 0, func: "T", barsLeft: 2 };
  C.chordNext = { deg: 3, func: "S" };
  C.chordPath = [];
  C.cadence = { armed: false, deceptiveUsed: false, pedalUsed: false, queue: [] };
  C.nonTStreak = 0;

  //! Rising plant leans dominant-ward, falling leans home; the per-track
  //! tilt gives each take its own resting lean underneath.
  C.pp2BiasedRow = (row) => {
    const ft = C.walkTilt.func;
    const b = C.sigOver(60, "tilt") * 0.18;
    const r = { T: Math.max(row.T * ft.T - b, 0.05), S: row.S * ft.S, D: Math.max(row.D * ft.D + b, 0.05) };
    const sum = r.T + r.S + r.D;
    return { T: r.T / sum, S: r.S / sum, D: r.D / sum };
  };

  //! A settled plant earns longer harmony: stability tilts the dwell draw
  //! toward the longer entries in log-bars.
  C.pickDwell = () => {
    const pool = C.mood.dwellPool ?? [[2, 1.0]];
    const st = C.sigOver(75, "stability");
    const g = mean(pool.map((p) => Math.log(p[0])));
    const wts = pool.map((p) => p[1] * Math.exp(1.2 * (st - 0.5) * (Math.log(p[0]) - g)));
    return Math.trunc(wchoose(pool, wts)[0]);
  };

  //! Degree pick: base function weights x per-track tilt, chords that hold
  //! the mode's colour degree weighted up x1.4.
  C.pickDegForFunc = (func, avoidDeg) => {
    let pairs = C.mood.funcTrans[func].degs.filter((p) => Math.trunc(p[0]) !== avoidDeg);
    if (!pairs.length) pairs = C.mood.funcTrans[func].degs;
    const color = modeColorDeg[C.scaleName];
    const ws = pairs.map((p) => {
      let w = Number(p[1]) * (C.walkTilt.deg[Math.trunc(p[0])] ?? 1.0);
      if (color != null && [0, 2, 4].includes(mod(color - Math.trunc(p[0]), 7))) w *= 1.4;
      return w;
    });
    return wchoose(pairs.map((p) => Math.trunc(p[0])), ws);
  };

  //! One step of the walk: cadence script wins when armed; otherwise a
  //! biased function pick with the forced return home after 4 non-tonic
  //! dwells, and at most one deceptive resolution (D -> vi) per track in
  //! the middle third.
  C.walkStep = (from) => {
    if (C.cadence.armed && C.cadence.queue.length > 0) {
      const step = C.cadence.queue.shift();
      return C.withColor({ deg: step.deg, func: step.func, scriptBars: step.bars });
    }
    let func;
    if (C.nonTStreak >= 4) func = "T";
    else {
      const row = C.pp2BiasedRow(C.mood.funcTrans[from.func]);
      func = wchoose(["T", "S", "D"], [row.T, row.S, row.D]);
    }
    const elapsedFrac = (C.trackDur != null && C.trackStart != null) ? clip((C.clock.now() - C.trackStart) / C.trackDur, 0, 1) : 0;
    const inMiddleThird = elapsedFrac > 0.33 && elapsedFrac < 0.67;
    let deg;
    if (from.func === "D" && func === "T" && !C.cadence.deceptiveUsed && inMiddleThird && coin(0.25)) {
      C.cadence.deceptiveUsed = true;
      deg = 5;
      C.log("[harmony] deceptive cadence -> vi");
    } else {
      deg = C.pickDegForFunc(func, from.deg);
    }
    return C.withColor({ deg, func });
  };

  //! Section seams call the walk home: cut the current dwell and force the
  //! next chord to tonic.
  C.walkCallHome = () => {
    C.chordNext = C.withColor({ deg: 0, func: "T" });
    C.chordNow.barsLeft = Math.min(C.chordNow.barsLeft ?? 1, 1);
  };

  //! The chorus keeps its progression: the first B freezes its chord path
  //! and every later B replays it. Song memory, cleared per track.
  C.chorusProg = null; C.chorusQueue = []; C.chorusRecording = false;
  C.chorusProgArm = (sec) => {
    if (sec === "B") {
      if (C.chorusProg == null) {
        C.chorusProg = []; C.chorusRecording = true;
        C.log("[harmony] chorus progression: recording");
      } else {
        C.chorusRecording = false;
        C.chorusQueue = C.chorusProg.slice();
        if (C.chorusQueue.length) {
          const q = C.chorusQueue.shift();
          C.chordNext = { deg: q.deg, func: q.func, scriptBars: q.bars, color: q.color, resolve: q.resolve, degs: C.shapeDegs(q.deg, q.color ?? "triad") };
        }
        C.log(`[harmony] chorus progression: replaying ${C.chorusProg.map((c) => C.chordToken(c, c.bars)).join(" ")}`);
      }
    } else {
      C.chorusRecording = false; C.chorusQueue = [];
    }
  };

  C.harmonyAdvanceBar = () => {
    C.chordNow.barsLeft = C.chordNow.barsLeft - 1;
    //! a resolving colour (sus4>seventh) lands on the dwell's last bar
    if (C.chordNow.barsLeft === 1 && C.chordNow.resolve != null) {
      C.chordNow.color = C.chordNow.resolve;
      C.chordNow.degs = C.shapeDegs(C.chordNow.deg, C.chordNow.color);
      C.chordNow.resolve = null;
      C.chordMark();
    }
    if (C.chordNow.barsLeft <= 0) {
      const next = C.chordNext;
      const bars = Math.trunc(next.scriptBars ?? C.pickDwell());
      C.chordNow = { deg: Math.trunc(next.deg), func: next.func, barsLeft: bars, color: next.color, resolve: next.resolve, degs: next.degs };
      C.chordPath.push(C.chordToken(C.chordNow, bars));
      C.chordMark();
      C.nonTStreak = next.func === "T" ? 0 : C.nonTStreak + 1;
      C.pedalChange?.();   //! the pedal lifts and re-presses with the harmony
      if (C.chorusRecording && C.sectionNow === "B") {
        C.chorusProg.push({ deg: C.chordNow.deg, func: C.chordNow.func, bars, color: C.chordNow.color, resolve: C.chordNow.resolve });
      }
      if (C.chorusQueue.length && C.sectionNow === "B" && !C.cadence.armed) {
        const q = C.chorusQueue.shift();
        C.chordNext = { deg: q.deg, func: q.func, scriptBars: q.bars, color: q.color, resolve: q.resolve, degs: C.shapeDegs(q.deg, q.color ?? "triad") };
      } else {
        C.chordNext = C.walkStep(C.chordNow);
      }
      //! the one event: a fade room holds the tonic for 8 bars once, near the
      //! middle of the take, the drone's single arrival
      if ((C.mood.outroStyle ?? "cadence") === "fade" && !(C.cadence.pedalUsed ?? false)
          && C.trackDur != null && C.trackStart != null) {
        const frac = (C.clock.now() - C.trackStart) / C.trackDur;
        if (frac >= 0.45 && frac <= 0.6) {
          C.cadence.pedalUsed = true;
          C.chordNext = C.withColor({ deg: 0, func: "T", scriptBars: 8 });
          C.log("[harmony] pedal: 8 bars on I");
        }
      }
      C.log(`[harmony] ${C.chordNow.deg} (${C.chordNow.func}) for ${bars} bars -> next ${C.chordNext.deg} (${C.chordNext.func})`);
    }
  };

  //! Track-end script: pre-dominant, dominant, then tonic held under the
  //! outro; outroStyle "fade" ends on the tonic alone for the whole outro.
  C.armCadence = () => {
    if (C.cadence.armed) return;
    C.cadence.armed = true;
    const outro = C.mood.outroBars ?? 8;
    C.cadence.queue = (C.mood.outroStyle ?? "cadence") === "fade"
      ? [{ deg: 0, func: "T", bars: outro }]
      : [{ deg: choose([1, 3]), func: "S", bars: 2 }, { deg: 4, func: "D", bars: 2 }, { deg: 0, func: "T", bars: Math.max(outro - 4, 2) }];
    C.log("[harmony] cadence armed");
  };

  C.resetHarmonyWalk = () => {
    C.chordNow = C.withColor({ deg: 0, func: "T" });
    C.chordNow.barsLeft = C.pickDwell();
    C.chordNext = C.walkStep(C.chordNow);
    C.cadence = { armed: false, deceptiveUsed: false, pedalUsed: false, queue: [] };
    C.nonTStreak = 0;
    C.padVoicing = null; C.lhVoicing = null; C.rhVoicing = null;
    C.chordPath = [C.chordToken(C.chordNow, C.chordNow.barsLeft)];
    C.chordMark();
    C.chorusProg = null; C.chorusQueue = []; C.chorusRecording = false;
  };

  //! the chord carries its own degree list (drawn with its colour); both
  //! now and next read it, so lead-ins aim at the coming colour
  C.chordDegrees = (which = "now") => {
    const c = which === "next" ? C.chordNext : C.chordNow;
    return (c.degs ?? C.shapeDegs(c.deg, "triad")).map((d) => Math.trunc(d));
  };
  C.nextRootDeg = () => Math.trunc(C.chordNext.deg);

  //! Voice-leading: each held voice moves to the nearest chord tone within a
  //! 4th; missing chord tones claim a doubled voice; the voice count follows
  //! the chord; voices fold by octaves back to within a fifth of the register
  //! asked for (a voicing once sank two octaves across a song).
  C.padVoicing = null; C.lhVoicing = null; C.rhVoicing = null;
  C.voiceLeadFrom = (chordDegs, oct = 0, prev) => {
    const targets = chordDegs.map((d) => C.degToMidi(d, oct));
    const pcs = targets.map((m) => mod(m, 12));
    if (prev == null || !prev.length) return targets;
    let v = prev.map((m) => {
      const cands = [];
      for (let c = m - 5; c <= m + 5; c++) if (pcs.includes(mod(c, 12))) cands.push(c);
      if (!cands.length) return m;
      return cands.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));
    });
    const occurrences = (arr, p) => arr.filter((x) => x === p).length;
    while (v.length > targets.length) {
      const have = v.map((m) => mod(m, 12));
      let idx = v.findIndex((m) => !pcs.includes(mod(m, 12)));
      const dupPc = have.find((p) => occurrences(have, p) > 1);
      if (idx < 0 && dupPc != null) idx = v.length - 1 - v.slice().reverse().findIndex((m) => mod(m, 12) === dupPc);
      v.splice(idx >= 0 ? idx : v.length - 1, 1);
    }
    for (const pc of pcs) {
      const have = v.map((m) => mod(m, 12));
      if (have.includes(pc)) continue;
      if (v.length < targets.length) {
        const top = Math.max(...v);
        const cands = [];
        for (let c = top - 6; c <= top + 6; c++) if (mod(c, 12) === pc) cands.push(c);
        if (cands.length) v.push(cands.reduce((a, b) => (Math.abs(b - top) < Math.abs(a - top) ? b : a)));
      } else {
        const counts = have.map((p) => occurrences(have, p));
        const dupIdx = counts.indexOf(Math.max(...counts));
        const base = v[dupIdx];
        const cands = [];
        for (let c = base - 6; c <= base + 6; c++) if (mod(c, 12) === pc) cands.push(c);
        if (cands.length) v[dupIdx] = cands.reduce((a, b) => (Math.abs(b - base) < Math.abs(a - base) ? b : a));
      }
    }
    v.sort((a, b) => a - b);
    const lo = Math.min(...targets) - 7, hi = Math.max(...targets) + 7;
    v = v.map((m) => { while (m < lo) m += 12; while (m > hi) m -= 12; return m; }).sort((a, b) => a - b);
    return v;
  };
  //! The pad's memory.
  C.voiceLeadTo = (chordDegs, oct = 0) => {
    C.padVoicing = C.voiceLeadFrom(chordDegs, oct, C.padVoicing);
    return C.padVoicing;
  };
}
