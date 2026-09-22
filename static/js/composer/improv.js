//! improv.js: the improviser (the live project's composer/improv.scd).
//! Plan a phrase, realize it note by note, remember what was just played,
//! develop it later, never verbatim. Coherence comes from process (contour
//! curves, voice-leading rules, tension arcs), not from stored phrases;
//! there is no library and no plant-seeded RNG (docs/COMPOSER.md,
//! "Per-note" and the negative space).
import { rrand, wchoose, choose, coin, gauss, clip, linlin, mean, mod, roundTo, sum } from "../sc.js";

const integrate = (xs) => { const out = []; let a = 0; for (const x of xs) { a += x; out.push(a); } return out; };
const maxIndex = (xs) => xs.reduce((bi, x, i) => (x > xs[bi] ? i : bi), 0);
const wrapAt = (xs, i) => xs[mod(i, xs.length)];
const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const rotate1 = (xs) => (xs.length ? [xs[xs.length - 1], ...xs.slice(0, -1)] : xs);
const uniq = (xs) => [...new Set(xs)];
const minBy = (xs, f) => xs.reduce((a, b) => (f(b) < f(a) ? b : a));
const maxBy = (xs, f) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));
const range = (a, b) => { const out = []; for (let i = a; i <= b; i++) out.push(i); return out; };

export function install(C) {
  //! Motivic memory: cells are intervallic + rhythmic, never absolute.
  C.memCells = [];
  C.memMax = 12;
  //! Phrase receipts: where each phrase's material came from.
  C.phraseStats = { total: 0, hook: 0, recall: 0, lick: 0, free: 0, motif: 0 };

  //! the words: margin-ranked, the page gets the top three
  C.wordsMargin = (v, thr) => Math.abs((v - thr) / Math.max(Math.abs(thr), 0.05));
  C.wordsRank = (pairs, fallback = "") => {
    const sorted = pairs.slice().sort((a, b) => b[1] - a[1]);
    return sorted.length ? sorted.map((p) => p[0]).join(" · ") : fallback;
  };
  C.wordsTop = (str, n = 3) => String(str).split(" · ").map((s) => s.trim()).filter(Boolean).slice(0, n).join(" · ");

  //! The pianist per song: independent leanings, drawn uniformly (no
  //! archetypes: the words DESCRIBE a draw), constant for the song.
  C.touchNow = null;
  C.pianistWords = (t) => {
    const w = [];
    const rubatoMood = (C.mood.phraseFeel ?? "rubato") !== "grid";
    const lhPiano = (C.mood.handsChords ?? 0) > 0 || (t.comps ?? false);
    const add = (word, v, thr) => w.push([word, C.wordsMargin(v, thr)]);
    if (t.offbeat > 0.45) add("syncopated", t.offbeat, 0.45);
    if (rubatoMood && t.rubato > 1.25) add("free", t.rubato, 1.25);
    if (rubatoMood && t.rubato < 0.65) add("steady", t.rubato, 0.65);
    if (t.breath > 1.4) add("spacious", t.breath, 1.4);
    if (t.breath < 0.8) add("talkative", t.breath, 0.8);
    if (t.stepLean > 1.2) add("stepwise", t.stepLean, 1.2);
    if (t.stepLean < 0.8) add("wide-ranging", t.stepLean, 0.8);
    if (t.regLean > 1.0) add("bright", t.regLean, 1.0);
    if (t.regLean < -1.0) add("dark", t.regLean, -1.0);
    if (t.doubling > 0.35) add("lush", t.doubling, 0.35);
    if (t.blockChord > 0.15) add("chordal", t.blockChord, 0.15);
    if (t.dynRange > 1.15) add("dramatic", t.dynRange, 1.15);
    if (t.dynRange < 0.85) add("even", t.dynRange, 0.85);
    if (t.restIn > 0.35) add("breathes mid-phrase", t.restIn, 0.35);
    if (t.phraseLen > 0.5) add("long lines", t.phraseLen, 0.5);
    if (t.phraseLen < -0.5) add("short sentences", t.phraseLen, -0.5);
    if (lhPiano && t.lhChord > 0.8) add("full-handed", t.lhChord, 0.8);
    if (lhPiano && t.lhChord < 0.6) add("spare bass", t.lhChord, 0.6);
    if (lhPiano && t.lhBroken > 0.35) add("rolling", t.lhBroken, 0.35);
    if ((t.pedalLean ?? 0) > 0.8) add("pedals deep", t.pedalLean, 0.8);
    if ((t.pedalLean ?? 0) < 0.45) add("dry-pedalled", t.pedalLean, 0.45);
    if ((t.dotLean ?? 0) > 0.4) add("dotted", t.dotLean, 0.4);
    if ((t.endLean ?? 0) > 0.65) add("lands long", t.endLean, 0.65);
    if (t.devLean != null) {
      const top = maxIndex(t.devLean), s = sum(t.devLean);
      if (t.devLean[top] > s * 0.28) {
        w.push([["turns it over", "stretches it", "quickens it", "fragments it", "sequences it", "plays it backwards", "shifts the rhythm"][top], t.devLean[top] / (s * 0.28) - 1]);
      }
    }
    if (t.comps ?? false) w.push(["comps the changes", 0.6]);
    if (t.figure != null) w.push([{ up: "arpeggiates", updown: "rolls the chords", alberti: "Alberti bass" }[t.figure.order] ?? "rocks the bass", 0.7]);
    if (t.endBig ?? false) w.push(["big finish", 0.5]);
    if ((t.rhSynth ?? "ppPianoSampler") === "ppVibes") w.push([t.vibes.depth > 0 ? "on vibes, motor on" : "on vibes, motor off", 1.0]);
    if ((t.rhSynth ?? "ppPianoSampler") === "ppMarimba") w.push(["on marimba", 1.0]);
    return C.wordsRank(w, "plain-spoken");
  };
  C.sampleTouch = () => {
    //! a room whose hands are both silent seats no pianist at all
    if ((C.mood.rightHandLevel ?? 0) <= 0 && (C.mood.leftHandLevel ?? 0) <= 0) {
      C.touchNow = null;
      C.noteLogMark?.("pianist", "");
      return;
    }
    C.touchNow = {
      dynRange: rrand(0.7, 1.3), peakLift: rrand(0.06, 0.18), legato: rrand(0.95, 1.45),
      beat1: rrand(0.08, 0.16), beat3: rrand(0.03, 0.09), off: rrand(0.03, 0.08),
      repeatAmt: rrand(0.05, 0.10), repeatLean: choose([-1, 1]), lhBalance: rrand(0.85, 1.0),
      offbeat: rrand(0.0, 0.7), sync: rrand(0.0, 0.5), rubato: rrand(0.4, 1.6),
      breath: rrand(0.6, 1.8), phraseLen: rrand(-1.0, 1.0), restIn: rrand(0.0, 0.5),
      stepLean: rrand(0.6, 1.4), regLean: rrand(-2.0, 2.0),
      doubling: rrand(0.10, 0.45), blockChord: rrand(0.0, 0.25),
      lhChord: rrand(0.5, 1.0), lhBroken: rrand(0.0, 0.5),
      devLean: Array.from({ length: 7 }, () => rrand(0.05, 1.0)),
      dotLean: rrand(0.0, 0.6), endLean: rrand(0.0, 0.9),
      pedalLean: rrand(0.25, 1.0),
      //! the left-hand figure: one accompaniment figure that runs the whole song
      figure: coin(C.mood.lhFigure ?? 0)
        ? { order: choose(["up", "updown", "alberti", "rock"]), rate: choose([0.5, 0.5, 1 / 3]), span: choose([1, 1, 2]), ring: rrand(1.0, 2.2) }
        : null,
      endBig: (C.mood.dynWide ?? 0) > 0 && coin(0.4),
      comps: coin(C.mood.pianoCompProb ?? 0),
      //! the right hand's instrument, drawn per take from the mood's rhPool
      rhSynth: choose((C.mood.rhPool ?? []).filter((n) => C.voiceAvailable(n))) ?? C.mood.rightHandSynth ?? "ppPianoSampler",
      vibes: { rate: rrand(3.0, 5.5), depth: choose([0.0, 0.15, 0.3, 0.45]) },
    };
    C.touchNow.words = C.pianistWords(C.touchNow);
    const t = C.touchNow;
    C.log(`[pianist] ${t.words} | dyn=${t.dynRange.toFixed(2)} legato=${t.legato.toFixed(2)} off=${t.offbeat.toFixed(2)} rub=${t.rubato.toFixed(2)} breath=${t.breath.toFixed(2)} step=${t.stepLean.toFixed(2)} reg=${t.regLean.toFixed(1)}`);
    C.noteLogMark?.("pianist", C.wordsTop(t.words));
  };
  C.rhSynth = () => C.touchNow?.rhSynth ?? C.mood.rightHandSynth ?? "ppPianoSampler";
  C.touchOr = () => C.touchNow ?? { dynRange: 1.0, peakLift: 0.1, legato: 1.2, beat1: 0.12, beat3: 0.06,
    off: 0.05, repeatAmt: 0.07, repeatLean: -1, lhBalance: 0.92, doubling: 0.25,
    offbeat: 0.15, sync: 0.15, rubato: 1.0, breath: 1.0, phraseLen: 0.0, restIn: 0.2,
    stepLean: 1.0, regLean: 0.0, blockChord: 0.05, lhChord: 0.65, lhBroken: 0.2,
    dotLean: 0.0, endLean: 0.0, pedalLean: 0.0 };
  C.phraseDynNow = 0.0;
  C.phraseStatsReset = () => { C.phraseStats = { total: 0, hook: 0, recall: 0, lick: 0, free: 0, motif: 0 }; };
  C.phraseTally = (k) => { C.phraseStats[k] = (C.phraseStats[k] ?? 0) + 1; };

  C.cellWeight = (c) => Math.exp(-(C.clock.now() - c.born) / 90) / (1 + c.uses);
  C.memPrune = () => {
    C.memCells = C.memCells.filter((c) => !(C.cellWeight(c) < 0.15 || c.uses >= 4));
    while (C.memCells.length > C.memMax) {
      const weakest = minBy(C.memCells, C.cellWeight);
      C.memCells.splice(C.memCells.indexOf(weakest), 1);
    }
  };
  //! Absorb up to 2 cells from a finished phrase: its head, and the group
  //! around its registral peak. Cells of 3-6 notes.
  C.memAbsorb = (degs, durs) => {
    const grab = (startIdx) => {
      const n = Math.min(choose([4, 4, 5, 6]), degs.length - startIdx);
      if (n >= 2) {
        C.memCells.push({
          ivs: range(1, n - 1).map((i) => degs[startIdx + i] - degs[startIdx + i - 1]),
          durs: durs.slice(startIdx, startIdx + n),
          born: C.clock.now(), uses: 0,
        });
      }
    };
    if (degs.length >= 2) {
      grab(0);
      if (degs.length >= 6) grab(Math.max(degs.indexOf(Math.max(...degs)) - 1, 2));
      C.memPrune();
    }
  };

  //! Development: exactly one non-identity transform, always; verbatim
  //! recall is unreachable by construction. Which transform is the
  //! pianist's lean (devLean, drawn per song).
  C.devNames = ["invert", "augment", "diminish", "fragment", "sequence", "retro", "shift"];
  C.devDefault = [0.25, 0.2, 0.15, 0.2, 0.2, 0.0, 0.0];
  C.developCell = (cell) => {
    const wts = C.touchNow?.devLean ?? C.devDefault;
    const t = wchoose(C.devNames, wts);
    let ivs = cell.ivs.slice(), durs = cell.durs.slice();
    switch (t) {
      case "retro": ivs = ivs.slice().reverse().map((v) => -v); break;
      case "shift": durs = rotate1(durs); break;
      case "invert": ivs = ivs.map((v) => -v); break;
      case "augment": durs = durs.map((d) => Math.min(d * choose([1.5, 2]), 3)); break;
      case "diminish": durs = durs.map((d) => Math.max(d * 0.5, 0.25)); break;
      case "fragment": { const n = Math.min(2, ivs.length); ivs = ivs.slice(0, n); durs = durs.slice(0, n + 1); break; }
      case "sequence": {
        ivs = [...ivs, choose([-1, 1]), ...ivs];
        const extra = durs.slice(0, Math.max(0, ivs.length + 1 - durs.length)).map((d) => Math.max(d, 0.25));
        durs = [...durs, ...extra];
        break;
      }
      default: break;
    }
    cell.uses = (cell.uses ?? 0) + 1;
    return { ivs, durs, label: t };
  };

  //! Song shape: the track's hook, frozen when the body opens; stated
  //! unchanged at the first phrase of every chorus and of the ending.
  C.chorusCell = null;
  C.hookStatedIdx = null;
  C.hookPlan = null;
  C.hookHistory = [];   //! recent songs' hook shapes (survives the track reset)
  C.hookSeenBefore = (ivs) => {
    const inv = ivs.map((v) => -v);
    const eq = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
    return C.hookHistory.some((h) => eq(h, ivs) || eq(h, inv));
  };
  C.stateHook = () => ({ ivs: C.chorusCell.ivs.slice(), durs: C.chorusCell.durs.slice(), label: "state", state: true });

  //! the hook jury: what makes a shape hummable
  C.hookScore = (cell) => {
    const ivs = cell.ivs ?? [], durs = cell.durs ?? [];
    if (!ivs.length) return 0;
    let s = 0.0;
    const line = [0, ...integrate(ivs)];
    const span = Math.max(...line) - Math.min(...line);
    const peaks = line.filter((v) => v === Math.max(...line)).length;
    const leaps = ivs.filter((v) => Math.abs(v) >= 3).length;
    const li = ivs.findIndex((v) => Math.abs(v) >= 3);
    if (ivs.length >= 3) s += 1;
    if (uniq(durs).length >= 2) s += 1;
    if (peaks === 1) s += 1;
    if (leaps === 0) s += 0.5;
    if (leaps === 1 && li >= 0 && li < ivs.length - 1 && sign(ivs[li + 1]) === -sign(ivs[li]) && Math.abs(ivs[li + 1]) <= 2) s += 1;
    if (Math.abs(ivs[ivs.length - 1]) === 1) s += 1;
    if (line[line.length - 1] !== 0) s += 0.5;
    if (span > 7) s -= 1;
    if (leaps >= 2) s -= 1;
    return s;
  };

  //! Guide tones: the snap prefers the tones that NAME the chord (the 3rd,
  //! the 7th) over root and 5th; a 9th/11th or a sus tone is a colour tone.
  C.chordRoleW = (c, root) => {
    const r = mod(c - root, C.scale.length);
    if (r === 2) return 1.0;
    if (r === 6) return 0.9;
    if (r === 0) return 0.55;
    if (r === 1 || r === 3) return 0.8;
    if (r === 5) return 0.7;
    return 0.45;
  };
  const allOctaves = (ct, n) => [...ct, ...ct.map((c) => c + n), ...ct.map((c) => c - n), ...ct.map((c) => c + 2 * n)];
  C.guideSnapTo = (deg, chordDegs) => {
    const n = C.scale.length;
    const ct = chordDegs.map((d) => Math.trunc(d));
    const root = ct[0];
    const all = allOctaves(ct, n);
    let near = all.filter((c) => Math.abs(c - deg) <= 2);
    if (!near.length) near = [minBy(all, (c) => Math.abs(c - deg))];
    const w = near.map((c) => C.chordRoleW(c, root) / (1 + (c - deg) ** 2));
    return wchoose(near, w);
  };
  //! Lead into the coming chord: land on its guide tone when adjacent, else
  //! on its neighbour on the near side, so the change resolves by step.
  C.leadIntoNext = (from) => {
    const nxt = C.nextChordDegsForLead();
    const t = C.guideSnapTo(from, nxt);
    if (Math.abs(from - t) <= 1) return t;
    if (Math.abs(from - t) <= 3) return t + sign(from - t);
    return from + sign(t - from);
  };
  //! the target-tone skeleton: each chord dwell owns one structural target,
  //! voice-led deterministically from the previous dwell's
  C.guideLead = (ref, chordDegs) => {
    const n = C.scale.length;
    const ct = chordDegs.map((d) => Math.trunc(d));
    const root = ct[0];
    return maxBy(allOctaves(ct, n), (c) => C.chordRoleW(c, root) / (1 + (c - ref) ** 2));
  };
  C.skelState = { path: -1, target: null };
  C.skelReset = () => { C.skelState = { path: -1, target: null }; };
  C.skelTarget = (fallback) => {
    const t = clip(C.mood.phraseTargets ?? 0, 0, 1);
    const n = C.scale.length;
    if (t <= 0) return fallback;
    if (C.skelState.path !== C.chordPath.length) {
      const prevT = C.skelState.target ?? Math.trunc(roundTo(fallback));
      let tgt = C.guideLead(prevT, C.chordDegrees("now"));
      while (tgt - fallback > 5) tgt -= n;
      while (tgt - fallback < -5) tgt += n;
      C.skelState.path = C.chordPath.length;
      C.skelState.target = tgt;
    }
    return fallback * (1 - t) + C.skelState.target * t;
  };

  //! antecedent and consequent: a question ends away, the answer restates
  //! the cell and ends home
  C.periodState = { half: "q", cell: null, bars: 4, contour: "arch", reg: 11, secIdx: -1 };
  C.periodReset = () => { C.periodState = { half: "q", cell: null, bars: 4, contour: "arch", reg: 11, secIdx: -1 }; };
  C.periodEndDeg = (aim, ref) => {
    const n = C.scale.length;
    const ct = C.chordDegrees("now").map((d) => Math.trunc(d));
    const root = ct[0];
    let pool;
    if (aim === "home") {
      const home = ct.filter((c) => mod(c, n) === 0);
      pool = home.length ? home : [root];
    } else {
      const open = ct.filter((c) => mod(c - root, n) !== 0);
      const fifth = open.filter((c) => mod(c - root, n) === 4);
      pool = fifth.length ? fifth : (open.length ? open : ct);
    }
    return minBy(allOctaves(pool, n), (c) => Math.abs(c - ref));
  };

  //! Right-hand chord tones under the melody: n chord tones inside the
  //! octave under the melody note, never within a 2nd of it, never below the
  //! tenor ceiling, voice-led by nearest motion from the last under-chord.
  C.rhChordFloor = 58;
  //! the window: every right-hand pitch folds by octaves into it
  C.rhMidi = (deg) => {
    let m = C.degToMidi(deg, 1);
    const w = C.mood.rhWindow ?? [60, 88];
    const lo = Math.trunc(w[0]), hi = Math.trunc(w[1]);
    if (hi - lo >= 12) { while (m > hi) m -= 12; while (m < lo) m += 12; }
    return m;
  };
  C.rhFloorNow = () => (C.mood.rhWindow ? Math.trunc(C.mood.rhWindow[0]) - 5 : C.rhChordFloor);
  C.rhVoicing = null;
  C.rhChordUnder = (melMidi, n, chordDegs) => {
    const pcs = chordDegs.map((d) => mod(C.degToMidi(d, 0), 12));
    const lo = Math.max(melMidi - 12, C.rhFloorNow());
    const cands = range(lo, melMidi - 3).filter((m) => pcs.includes(mod(m, 12)));
    const prev = C.rhVoicing ?? [];
    let out = [];
    for (let i = 0; i < n; i++) {
      const ref = prev.length ? wrapAt(prev, i) : melMidi - (i === 0 ? 4 : 8);
      const pool = cands.filter((m) => !out.includes(m) && !out.some((o) => Math.abs(o - m) < 3));
      if (pool.length) out.push(minBy(pool, (m) => Math.abs(m - ref)));
    }
    out.sort((a, b) => a - b);
    if (out.length) C.rhVoicing = out;
    return out;
  };

  //! Seed-lick vocabulary: idiom interval shapes used ONLY as seeds when the
  //! memory has nothing to offer, and ALWAYS through developCell.
  C.lickCells = [
    { label: "pentDescent", ivs: [-1, -1, -2], durs: [0.5, 0.5, 0.5, 1.0] },
    { label: "enclosure", ivs: [-1, 2, -1], durs: [0.5, 0.25, 0.25, 1.0] },
    { label: "approach", ivs: [1, 1, -1], durs: [0.25, 0.25, 0.5, 1.0] },
    { label: "dropReturn", ivs: [-3, 1, 1], durs: [0.5, 0.5, 0.5, 1.5] },
    { label: "hookTail", ivs: [2, -1, -1], durs: [0.5, 0.25, 0.25, 1.0] },
    { label: "ripple", ivs: [1, -2, 1], durs: [0.25, 0.25, 0.5, 1.0] },
  ];

  C.maybeRecallCell = () => {
    const p = 0.40 + 0.25 * C.weatherEff();
    const pickWeighted = () => wchoose(C.memCells, C.memCells.map(C.cellWeight));
    let stated = null;
    //! the moment the body opens, the intro's strongest cell is frozen as
    //! the hook (juried: the best hummable shape wins, weight breaks ties)
    if (C.sectionNow != null && C.chorusCell == null && C.memCells.length) {
      let pool = C.memCells.slice();
      if ((C.mood.hookJury ?? 0) > 0 && pool.every((c) => C.hookScore(c) < 3)) {
        for (let i = 0; i < 6; i++) { const c = C.makeCell(0.45); pool.push({ ivs: c.ivs, durs: c.durs, born: C.clock.now(), uses: 0 }); }
      }
      const ranked = (C.mood.hookJury ?? 0) > 0
        ? pool.slice().sort((a, b) => { const sa = C.hookScore(a), sb = C.hookScore(b); return sb - sa || C.cellWeight(b) - C.cellWeight(a); })
        : pool.slice().sort((a, b) => C.cellWeight(b) - C.cellWeight(a));
      const fresh = ranked.find((c) => !C.hookSeenBefore(c.ivs));
      C.chorusCell = fresh ?? ranked[0];
      if (!fresh) C.log("[improv] hook: every candidate echoed a past hook; strongest taken");
      C.hookHistory.unshift(C.chorusCell.ivs.slice());
      while (C.hookHistory.length > 24) C.hookHistory.pop();
      C.log(`[improv] hook frozen at body open: ivs=${JSON.stringify(C.chorusCell.ivs)} (jury ${C.hookScore(C.chorusCell).toFixed(1)})`);
      C.noteLogMark?.("hook", JSON.stringify(C.chorusCell.ivs));
      C.hookStatedIdx = -2;
      stated = C.stateHook();
    }
    //! the first phrase of each chorus, and of the ending, states it
    if (stated == null && C.chorusCell != null && (C.sectionNow === "B" || C.songOutro())) {
      const key = C.songOutro() ? -1 : C.sectionIdx;
      if (C.hookStatedIdx !== key) { C.hookStatedIdx = key; stated = C.stateHook(); }
    }
    if (stated != null) { C.phraseTally("hook"); return stated; }
    if (C.songOutro() && C.chorusCell != null && coin(0.85)) { C.phraseTally("hook"); return C.developCell(C.chorusCell); }
    if (C.sectionNow === "B" && (C.chorusCell != null || C.memCells.length) && coin(0.9)) {
      if (C.chorusCell == null) C.chorusCell = pickWeighted();
      C.phraseTally("hook"); return C.developCell(C.chorusCell);
    }
    if (C.sectionNow === "A" && C.chorusCell != null && coin(0.35)) { C.phraseTally("hook"); return C.developCell(C.chorusCell); }
    if (coin(p) && C.memCells.length) { C.phraseTally("recall"); return C.developCell(pickWeighted()); }
    //! no lick seeding in the intro: the hook frozen from it is the song's own idea
    if (C.arcPhase !== "intro" && coin(C.mood.lickSeed ?? 0)) {
      const lk = choose(C.lickCells);
      C.phraseTally("lick");
      return C.developCell({ ivs: lk.ivs.slice(), durs: lk.durs.slice(), uses: 0, label: lk.label });
    }
    C.phraseTally("free");
    return null;
  };

  //! The second player: strictly antiphonal, answers in player one's
  //! breath, develops the freshest memory cell, sparser and an octave away,
  //! quieter, panned opposite. With strings in the room the answer is the
  //! cello's countermelody (strings.js).
  C.duoActive = false; C.duoForce = null; C.duoReserve = 0;
  C.duoAnswer = (phrase) => {
    const scaleSize = C.scale.length;
    const meanDeg = mean(phrase.degrees);
    let octShift = meanDeg < 11 ? scaleSize : -scaleSize;
    const stretch = rrand(1.5, 2.0);
    const level = (C.mood.rightHandLevel ?? 0) * 0.7;
    const chordT = C.chordDegrees("now").map((d) => Math.trunc(d));
    const allCT = [...chordT, ...chordT.map((c) => c + scaleSize), ...chordT.map((c) => c + 14)];
    let startDeg = minBy(allCT, (c) => Math.abs(c - meanDeg));
    const cello = C.stringsPresent != null && C.stringsPresent();
    const voice = cello ? "ppCello" : (C.mood.duoSynth ?? "ppPianoSampler");
    const minDur = cello ? 1.0 : 0.5;
    const sec = C.sectionNow;
    let lo = 36, hi = 79;
    const cell = (cello && sec === "A" && C.chorusCell != null && coin(0.6))
      ? { ivs: C.chorusCell.ivs.slice(), durs: C.chorusCell.durs.slice(), label: "hookSung" }
      : C.developCell(wchoose(C.memCells, C.memCells.map(C.cellWeight)));
    if (cello) {
      const ctr = C.stringsCentre?.(sec) ?? 58;
      lo = Math.max(ctr - 8, 36); hi = Math.min(ctr + 12, 79);
      startDeg = C.stringsDegOf(C.stringsLastMidi ?? ctr);
      octShift = 0;
    }
    let degs = [startDeg + octShift];
    for (const iv of cell.ivs) degs.push(degs[degs.length - 1] + (cello ? clip(iv, -4, 4) : iv));
    let durs = degs.map((_, i) => clip((wrapAt(cell.durs, i) ?? 0.5) * stretch, minDur, 3.0));
    if (degs.length >= 4 && !cello) {
      const keep = degs.map((_, i) => i === 0 || i === degs.length - 1 || !coin(0.3));
      degs = degs.filter((_, i) => keep[i]); durs = durs.filter((_, i) => keep[i]);
    }
    if (cello) {
      const toChange = C.beatsToChordChange?.() ?? 4;
      const lead = 1.5 + sum(durs);
      const prev = degs[Math.max(degs.length - 2, 0)];
      let endDegs = (lead > toChange ? (C.nextChordDegsForLead?.() ?? chordT) : chordT).map((d) => Math.trunc(d));
      let cands = [...endDegs, ...endDegs.map((d) => d + scaleSize), ...endDegs.map((d) => d - scaleSize)].filter((d) => Math.abs(d - prev) <= 3);
      if (cands.length) degs[degs.length - 1] = minBy(cands, (d) => Math.abs(d - prev) + (d === prev ? 0.5 : 0));
      durs[durs.length - 1] = Math.max(durs[durs.length - 1], 1.5);
    }
    C.duoReserve = sum(durs) + 2.0;
    if (cello) {
      C.stringsBusyUntil = C.clock.beats + 2.0 + sum(durs) + 2.0;
      let lastM = C.degToMidi(degs[degs.length - 1], 0);
      while (lastM > hi) lastM -= 12;
      while (lastM < lo) lastM += 12;
      C.stringsLastMidi = lastM;
      C.stringsPhrasePos = 1;
    }
    C.clock.play(function* () {
      let prevMidi = null, held = null;
      const c = C.stringsNow;
      yield rrand(1.0, 2.0);
      C.log(`[duo] answers: ${degs.length} notes (${cell.label}) on ${voice}`);
      for (let i = 0; i < degs.length; i++) {
        const deg = degs[i];
        const velF = clip(0.42 + gauss(0, 0.04), 0.25, 0.6);
        let amp = level * 0.42 * velF * (0.70 + 0.30 * C.sig.energy) * (C.voiceGate.rightHand ?? 0) * C.arcGainFor("rightHand");
        let midi = cello ? C.degToMidi(deg, 0) : C.rhMidi(deg);
        let xtr = null;
        if (cello) {
          while (midi > hi) midi -= 12;
          while (midi < lo) midi += 12;
          amp = amp * (0.85 + 0.25 * (i / Math.max(degs.length - 1, 1))) * (i === degs.length - 1 ? 0.85 : 1.0);
        }
        if (amp > 0.001) {
          const vel = Math.trunc(roundTo(linlin(velF, 0, 1, 3, 12)));
          if (cello && c != null) {
            const joinL = prevMidi != null && held != null && midi !== prevMidi && Math.abs(midi - prevMidi) <= 7;
            const glide = coin((c.slurLean ?? 0.5) * 0.7) ? rrand(0.05, 0.09) : 0.03;
            const relL = i === degs.length - 1 ? 1.2 : 0.6;
            const durSec = Math.max(durs[i], minDur) * C.clock.beatDur * 1.25;
            if (joinL) {
              held.set({ midinote: midi, glide, amp, rel: relL });
              C.noteLogWrite("cello", midi, amp, durSec, vel, ["rel", relL, "glide", glide], "ppCelloLeg");
            } else {
              if (held != null) held.set({ rel: 0.6, gate: 0 });
              xtr = ["vibRate", c.vibRate, "vibDepth", coin(c.vibProb) ? c.vibDepth : 0.0, "vibDelay", c.vibDelay * 0.8, "vibGrow", 0.5,
                "atk", prevMidi != null ? 0.24 * (1 - (c.slurLean ?? 0.5) * 0.7) : 0.2, "rel", relL, "glide", glide];
              held = C.fireNote("ppCelloLeg", midi, amp, durSec, 0.25, vel, xtr, "cello");
            }
          } else {
            C.fireNote(voice, midi, amp, Math.max(durs[i], minDur) * C.clock.beatDur * 1.25, cello ? 0.25 : 0.35, vel, xtr, cello ? "cello" : "duo");
          }
          prevMidi = midi;
        }
        yield durs[i];
      }
      if (held != null) { held.set({ rel: 1.2, gate: 0 }); held = null; }
    }, { name: "duo" });
  };

  C.duoConsider = (phrase) => {
    const w = C.weatherEff();
    if (!C.duoActive && (w > 0.55 || C.sigOver(300, "energy") > 0.6)) C.duoActive = true;
    if (C.duoActive && w < 0.40) C.duoActive = false;
    const cello = C.stringsPresent != null && C.stringsPresent();
    const on = C.duoForce ?? (C.duoActive || cello);
    const p = (C.mood.duo ?? 0) * (cello ? (C.stringsNow?.lineLean ?? 0.5) : 0.8);
    if (on && coin(p) && C.memCells.length && phrase.degrees.length >= 3) C.duoAnswer(phrase);
  };
  C.phraseDone = (phrase) => C.duoConsider(phrase);

  //! Phrase planning.
  C.contourAt = (shape, pos, base, span) => {
    switch (shape) {
      case "arch": return base + span * Math.max(1 - Math.abs(pos - 0.65) * 2.2, 0);
      case "valley": return base - span * Math.max(1 - Math.abs(pos - 0.5) * 2.0, 0) * 0.7;
      case "rise": return base + span * pos;
      case "fall": return base + span * (1 - pos);
      default: return base + 2.0 * Math.sin(pos * 2 * Math.PI);
    }
  };
  C.pickContour = () => {
    const tilt = C.sig.tilt;
    if (C.arcPhase === "outro") return "fall";
    if (tilt > 0.2) return choose(["rise", "arch", "arch", "plateau"]);
    if (tilt < -0.2) return choose(["fall", "valley", "valley", "plateau"]);
    return choose(["arch", "valley", "rise", "fall", "plateau"]);
  };
  //! Grid follows the DRUMMER, not the mood: quantization with no audible
  //! beat reads as stiff, so grid engages only while the kit plays.
  C.gridActive = () => (C.mood.phraseFeel ?? "rubato") === "grid" && C.sectionNow != null
    && (C.voiceGate.drums ?? 0) > 0.05 && (C.mood.drumLevel ?? 0) > 0.01;
  //! Song outro: form-clock moods get a song-shaped ending.
  C.songOutro = () => (C.mood.sectionBars ?? 0) > 0 && C.arcPhase === "outro";

  //! Motivic phrase construction: a SHAPE stated, varied, contrasted,
  //! brought back, inside four bars; the cell carries rhythm too.
  C.pp2DurPool = (density) => {
    const durs = [0.25, 0.5, 0.75, 1.0, 1.5, 2.0];
    const weights = density > 0.6 ? [0.18, 0.38, 0.20, 0.14, 0.07, 0.03]
      : density > 0.35 ? [0.15, 0.30, 0.20, 0.20, 0.10, 0.05] : [0.05, 0.20, 0.20, 0.28, 0.17, 0.10];
    return [durs, weights];
  };
  C.makeCell = (density) => {
    let n = choose([2, 2, 3, 3, 4]);
    const pool = C.pp2DurPool(density);
    const d0 = wchoose(pool[0], pool[1]);
    const lineRun = clip(C.mood.lineRun ?? 0, 0, 1);
    let runKind = null;
    //! fingers mostly step; leaps are events; fast cells step and third only
    const ivPool = [1, -1, 2, -2, 3, -3, 4, -4];
    const lean = C.touchOr().stepLean;
    const ivW = (density > 0.6 ? [0.30, 0.30, 0.17, 0.17, 0.03, 0.03, 0.0, 0.0] : [0.27, 0.27, 0.16, 0.16, 0.05, 0.05, 0.02, 0.02])
      .map((w, i) => (i < 4 ? w * lean : w / lean));
    if (lineRun > 0 && coin(lineRun * 0.35)) {
      runKind = choose(["scale", "scale", "arp"]);
      n = runKind === "scale" ? choose([3, 4, 5]) : choose([3, 3, 4]);
    }
    let durs = runKind != null
      ? range(0, n).map((i) => (i === n ? Math.min(d0 * 2, 2.0) : d0))
      : range(0, n).map(() => (coin(0.55) ? d0 : wchoose(pool[0], pool[1])));
    //! the pianist's rhythmic identity: long-short pairs, landing notes
    {
      const t = C.touchOr();
      const dl = t.dotLean ?? 0.0, el = t.endLean ?? 0.0;
      let i = 0;
      while (i < durs.length - 1) {
        if (durs[i] === durs[i + 1] && durs[i] >= 0.5 && coin(dl)) {
          const pair = durs[i] * 2;
          durs[i] = pair * 0.75; durs[i + 1] = pair * 0.25;
          i += 2;
        } else i += 1;
      }
      if (coin(el)) durs[durs.length - 1] = Math.min(durs[durs.length - 1] * 1.5, 2.0);
    }
    let ivs;
    if (runKind != null) {
      ivs = range(1, n).map(() => (runKind === "scale" && !coin(0.15) ? 1 : 2));
    } else {
      let last = 0;
      ivs = range(1, n).map(() => {
        let iv = wchoose(ivPool, ivW);
        if (lineRun > 0 && last !== 0 && coin(lineRun * 0.7)) iv = Math.abs(iv) * sign(last);
        last = iv;
        return iv;
      });
    }
    return { ivs, durs, run: runKind };
  };

  //! The variation vocabulary: a states, a1 quickens, a2 turns the shape
  //! over, b answers against it, c closes short; seq and aug under themeHold.
  C.cellAs = (cell, slot) => {
    let ivs = cell.ivs.slice(), durs = cell.durs.slice();
    const hold = clip(C.mood.themeHold ?? 0, 0, 1);
    let runK = cell.run ?? null;
    switch (slot) {
      case "a": break;
      case "a1":
        if (hold > 0 && coin(hold)) ivs = ivs.map((v) => v + choose([0, 0, 1, -1]));
        else if (coin(0.5)) durs = durs.map((d) => Math.max(d * 0.5, 0.25));
        else ivs = ivs.map((v) => v + choose([0, 0, 1, -1]));
        break;
      case "a2": ivs = ivs.map((v) => -v); break;
      case "b":
        ivs = ivs.slice().reverse().map((v) => -v);
        if (!(hold > 0 && coin(hold))) durs = durs.map((d) => Math.min(d * choose([1, 1.5]), 3));
        break;
      case "c": { const n = Math.min(2, ivs.length); ivs = ivs.slice(0, n); durs = durs.slice(0, n + 1); break; }
      case "seq": break;
      case "aug": durs = durs.map((d) => Math.min(d * 2, 3)); break;
      case "run": {
        const kind = choose(["scale", "scale", "arp"]);
        const n = kind === "scale" ? choose([3, 4, 5]) : choose([3, 3, 4]);
        const d = clip(durs.length ? Math.min(...durs) : 0.5, 0.25, 0.5);
        ivs = range(1, n).map(() => (kind === "scale" && !coin(0.15) ? 1 : 2));
        durs = range(0, n).map((i) => (i === n ? Math.min(d * 3, 2.0) : d));
        runK = kind;
        break;
      }
      default: break;
    }
    return { ivs, durs, seq: slot === "seq", run: runK };
  };

  C.phraseFormFor = (bars) => {
    const hold = clip(C.mood.themeHold ?? 0, 0, 1);
    const lineRun = clip(C.mood.lineRun ?? 0, 0, 1);
    let form;
    if (hold > 0 && coin(hold)) {
      form = bars <= 2 ? choose([["a", "seq"], ["a", "aug"]])
        : bars === 3 ? choose([["a", "seq", "b"], ["a", "seq", "seq"], ["a", "a1", "aug"]])
        : choose([["a", "seq", "b", "c"], ["a", "seq", "seq", "c"], ["a", "a1", "seq", "aug"], ["a", "seq", "b", "aug"]]);
    } else {
      form = bars <= 2 ? choose([["a", "a1"], ["a", "b"]])
        : bars === 3 ? choose([["a", "a1", "b"], ["a", "b", "a1"], ["a", "a1", "a2"]])
        : choose([["a", "a1", "b", "a2"], ["a", "a1", "b", "c"], ["a", "b", "a1", "c"]]);
    }
    form = form.slice();
    if (lineRun > 0 && coin(lineRun * 0.6)) {
      if (bars <= 2) form = ["a", "run"]; else form.splice(1, 0, "run");
    }
    return form;
  };

  //! Lay the form out in time: each slot anchors on the contour where it
  //! falls, then walks the cell's intervals; breaths between gestures.
  C.buildMotifEvents = (plan, totalBeats) => {
    let cell = plan.seedCell != null ? { ivs: plan.seedCell.ivs.slice(), durs: plan.seedCell.durs.slice() } : C.makeCell(plan.density);
    const form = C.phraseFormFor(plan.bars);
    const events = [];
    let beats = 0, slot = 0;
    const limit = totalBeats - 1.5;
    let lastDeg = null, lastIv = 0, quickRun = 0, lastStart = null;
    const hold = clip(C.mood.themeHold ?? 0, 0, 1);
    const stated = hold > 0 && plan.seedCell != null && (plan.seedCell.state ?? false);
    const tame = (d) => {
      let out;
      if (d <= 0.3 && quickRun >= 4) { quickRun = 0; out = choose([0.75, 1.0]); }
      else { if (d <= 0.3) quickRun += 1; else quickRun = 0; out = d; }
      if (out === 0.5 && (beats % 1) < 0.01 && coin(C.touchOr().sync)) out = 0.75;
      return out;
    };
    const pian = C.touchOr();
    if (cell.ivs == null || !cell.ivs.length) cell = C.makeCell(plan.density);
    if (plan.pairRole === "q") C.periodState.cell = { ivs: cell.ivs.slice(), durs: cell.durs.slice() };
    //! the hand, not a teleport: each gesture anchors within a third of
    //! where the last one ended, a leap is answered by a step back, two
    //! leaps in a row are not allowed, quick notes run INTO something
    while (beats < limit) {
      const g = C.cellAs(cell, wrapAt(form, slot));
      const pos = clip(beats / totalBeats, 0, 1);
      const target = Math.trunc(roundTo(C.skelTarget(C.contourAt(plan.contour, pos, plan.regCenter, plan.span))));
      const isRun = g.run != null;
      const verbatim = (g.seq ?? false) || isRun || (stated && slot === 0);
      let deg;
      if (lastDeg == null) deg = target;
      else if ((g.seq ?? false) && lastStart != null) { const dir = sign(target - lastStart); deg = lastStart + (dir === 0 ? choose([1, -1]) : dir); }
      else deg = lastDeg + clip(target - lastDeg, -2, 2);
      const d0 = verbatim ? clip(g.durs[0] ?? 0.5, 0.25, 3) : tame(clip(g.durs[0] ?? 0.5, 0.25, 3));
      let gIvs = g.ivs;
      if (g.run != null) {
        let dir = sign(target - deg);
        if (dir === 0) dir = choose([1, -1]);
        gIvs = g.ivs.map((v) => Math.abs(v) * dir);
      }
      lastStart = deg;
      //! the syncopated pianist starts a gesture on the "and"
      if ((beats % 1) < 0.01 && coin(pian.offbeat) && beats + 0.5 < limit) { events.push({ deg, dur: 0.5, isRest: true }); beats += 0.5; }
      events.push({ deg, dur: d0, isRest: false });
      lastIv = lastDeg == null ? 0 : deg - lastDeg;
      beats += d0;
      gIvs.forEach((iv, i) => {
        if (beats < limit) {
          const d = verbatim ? clip(wrapAt(g.durs, i + 1) ?? 0.5, 0.25, 3) : tame(clip(wrapAt(g.durs, i + 1) ?? 0.5, 0.25, 3));
          let step = iv;
          if (!verbatim) {
            if (Math.abs(lastIv) >= 3) step = -sign(lastIv) * choose([1, 1, 2]);
            if (Math.abs(step) >= 3 && Math.abs(lastIv) >= 3) step = sign(step) * 1;
          }
          deg += step;
          lastIv = step;
          events.push({ deg, dur: d, isRest: false, hold: verbatim && (!isRun || i < gIvs.length - 1) });
          beats += d;
        }
      });
      lastDeg = deg;
      if (beats < limit) { const br = choose([0.5, 0.5, 1.0]); events.push({ deg, dur: br, isRest: true }); beats += br; }
      slot += 1;
    }
    return events;
  };

  C.planPhrase = () => {
    const w = C.weatherEff();
    const gridFeel = C.gridActive();
    const endBars = C.songOutro() && C.barsTotal != null ? Math.max(C.barsTotal - C.barIdx - 1, 1) : null;
    const maxBars = Math.trunc(C.mood.phraseBarsMax ?? 6);
    //! seam fit: with the form clock running a phrase may not plan past the section boundary
    const seamBars = C.sectionBarsLeft != null ? Math.floor(Math.max(C.sectionBarsLeft * 4 - C.beatInBar(), 0) / 4) : null;
    let capBars = seamBars == null ? maxBars : Math.min(maxBars, seamBars);
    const lift = C.sectionLift?.() ?? { gain: 1.0, density: 1.0, reg: 0, chord: 1.0, space: 1.0 };
    const seed = C.maybeRecallCell();
    if (endBars != null) capBars = Math.min(capBars, endBars);
    const cands = [2, 3, 3, 4, 4, 5, 6].filter((b) => b <= capBars);
    const bars = !cands.length ? 1
      : wchoose(cands, [0.15, 0.25, 0.25, 0.2, 0.1, 0.03, 0.02].map((wt, i) => wt * Math.exp(C.touchOr().phraseLen * (i - 3) * 0.35)).slice(0, cands.length));
    const n = C.scale.length;
    const plan = {
      bars,
      contour: C.pickContour(),
      //! the register band in scale degrees, scaled by n/7 so it is the same
      //! in every scale; the pianist's lean, the chorus lift, regDrop
      regCenter: Math.trunc(roundTo(((gridFeel || C.arcPhase === "intro") ? linlin(C.sig.center, -1, 1, 9, 13) : linlin(C.sig.center, -1, 1, 7, 15)) * n / 7))
        + Math.trunc(roundTo(C.touchOr().regLean)) + lift.reg - Math.trunc(roundTo(C.mood.regDrop ?? 0)),
      span: Math.max(Math.trunc(roundTo((4 + 4 * w) * n / 7)), 3),
      //! excitement is intensity, not note count: density caps at the mood's
      density: clip((0.30 + 0.55 * C.sig.energy * (0.6 + 0.4 * w)) * (C.arcIntensity ?? 1.0) * (C.arcPhase === "intro" ? 0.6 : 1.0) * lift.density,
        0.2, C.mood.rhDensityCap ?? 0.78),
      cadential: C.cadence.armed,
      seedCell: seed,
    };
    //! a hook statement keeps the hook's height, contour and span
    if (seed != null && (seed.state ?? false)) {
      if (C.hookPlan == null) C.hookPlan = { contour: plan.contour, regCenter: plan.regCenter - lift.reg, span: plan.span };
      plan.contour = C.hookPlan.contour;
      plan.regCenter = C.hookPlan.regCenter + lift.reg;
      plan.span = C.hookPlan.span;
    }
    //! pair plain phrases into question and answer
    if ((C.mood.periodForm ?? 0) > 0 && !C.songOutro()) {
      const stated = seed != null && (seed.state ?? false);
      const ps = C.periodState;
      if (ps.half === "a" && ps.cell != null && !stated && ps.secIdx === (C.sectionIdx ?? -1)) {
        plan.pairRole = "a"; plan.endAim = "home";
        plan.seedCell = { ivs: ps.cell.ivs.slice(), durs: ps.cell.durs.slice(), uses: 0, label: "answer" };
        if (ps.bars <= capBars) plan.bars = ps.bars;
        plan.contour = ps.contour; plan.regCenter = ps.reg;
        ps.half = "q"; ps.cell = null;
      } else if (!stated && seed == null && coin(C.mood.periodForm ?? 0)) {
        plan.pairRole = "q"; plan.endAim = "away";
        ps.half = "a"; ps.cell = null; ps.bars = plan.bars; ps.contour = plan.contour; ps.reg = plan.regCenter; ps.secIdx = C.sectionIdx ?? -1;
      } else {
        ps.half = "q"; ps.cell = null;
      }
    }
    return plan;
  };

  //! Realization: blocks (yields beats) through one phrase, then returns.
  //! The right hand's routine calls this in a loop (yield*).
  C.lastPhrase = null;
  C.rhLastDir = 0;
  C.lhChordBeat = C.lhChordBeat ?? -9;
  C.playPhrase = function* () {
    const plan = C.planPhrase();
    const totalBeats = plan.bars * 4;
    let beatsUsed = 0;
    const grid = C.gridActive();
    let prev = null, pendingRec = 0, runLen = 0, runDur = -1;
    const breathAt = (plan.bars >= 3 && coin(0.35 + C.touchOr().restIn)) ? totalBeats * rrand(0.4, 0.6) : -1;
    let breathed = false;
    const playedDegs = [], playedDurs = [];
    const seedIvs = plan.seedCell?.ivs ?? null, seedDurs = plan.seedCell?.durs ?? null;
    let seedIdx = 0, seedLastIv = 0;
    const motifEvents = ((plan.seedCell != null && (plan.seedCell.state ?? false)) || plan.pairRole != null || coin(C.mood.motifForm ?? 0))
      ? C.buildMotifEvents(plan, totalBeats) : null;
    const secGain = () => C.sectionLift?.().gain ?? 1.0;
    let motifIdx = 0;
    const level = C.mood.rightHandLevel ?? 0;
    const chordOf = () => C.chordDegrees("now").map((d) => Math.trunc(d));
    const chordSnap = (deg) => C.guideSnapTo(deg, chordOf());
    const leadIfDue = (deg, dur) => { const toChange = C.beatsToChordChange(); return (toChange <= dur && toChange > 0) ? C.leadIntoNext(deg) : deg; };
    const touch = C.touchOr();
    const dynW = 1 + (C.mood.dynWide ?? 0);
    const phraseDyn = clip(gauss(0, 0.05 * dynW) * touch.dynRange, -0.15 * dynW, 0.15 * dynW);
    const peakPos = { arch: 0.65, rise: 0.9, fall: 0.12, valley: 0.15 }[plan.contour] ?? 0.5;
    let repeatRun = 0;
    const legatoMul = touch.legato * (plan.density > 0.6 ? 0.85 : plan.density < 0.35 ? 1.15 : 1.0);
    C.phraseDynNow = phraseDyn;
    C.phraseTally("total");
    C.pedalNow = coin(touch.pedalLean ?? 0);
    if (motifEvents != null) C.phraseTally("motif");
    if (plan.seedCell != null) C.log(`[improv] developing cell (${plan.seedCell.label}) ivs=${JSON.stringify(seedIvs)}`);
    if (grid) { const b = C.clock.beats; yield (Math.ceil(b) - b) + 0.01; }
    while (beatsUsed < totalBeats - 1.5) {
      const pos = beatsUsed / totalBeats;
      const target = C.skelTarget(C.contourAt(plan.contour, pos, plan.regCenter, plan.span));
      const beatPos = beatsUsed % 4;
      const strong = beatPos < 0.25 || Math.abs(beatPos - 2) < 0.25;
      const q0 = grid ? Math.floor((C.beatInBar() + 0.03) * 4) / 4 : 0;
      const durPair = C.pp2DurPool(plan.density);
      let dur, deg = null, isRest;
      if (motifEvents != null && motifIdx < motifEvents.length) {
        const mev = motifEvents[motifIdx++];
        dur = mev.dur; isRest = mev.isRest; deg = mev.deg;
        if (!isRest) deg = (strong && !(mev.hold ?? false)) ? chordSnap(deg) : leadIfDue(deg, dur);
      } else if (seedIvs != null && seedIdx <= seedIvs.length) {
        dur = clip(seedDurs ? (wrapAt(seedDurs, seedIdx) ?? 0.5) : 0.5, 0.25, 3);
        if (seedIdx === 0) deg = chordSnap(plan.regCenter);
        else {
          let iv = seedIvs[seedIdx - 1];
          if (Math.abs(seedLastIv) >= 3) iv = -sign(seedLastIv) * choose([1, 1, 2]);
          if (Math.abs(iv) >= 3 && Math.abs(seedLastIv) >= 3) iv = sign(iv);
          seedLastIv = iv;
          deg = (prev ?? plan.regCenter) + iv;
        }
        deg = strong ? chordSnap(deg) : leadIfDue(deg, dur);
        seedIdx += 1;
        isRest = false;
      } else {
        dur = wchoose(durPair[0], durPair[1]);
        if (dur === runDur && runLen >= 3) dur = coin(0.5) ? Math.min(dur * 2, 2) : Math.max(dur * 0.5, 0.25);
        isRest = !breathed && breathAt > 0 && beatsUsed >= breathAt;
        if (isRest) { breathed = true; dur = grid ? choose([1.0, 1.5, 2.0]) : rrand(1.0, 2.0); }
        else isRest = coin(1 - plan.density) && !strong;
        if (!isRest) {
          if (strong) deg = chordSnap(Math.trunc(roundTo(target)));
          else {
            const toChange = C.beatsToChordChange();
            if (toChange <= dur && toChange > 0) deg = C.leadIntoNext(Math.trunc(roundTo(prev ?? target)));
            else if (pendingRec !== 0) { deg = (prev ?? target) + pendingRec; pendingRec = 0; }
            else if (coin(0.75) || prev == null) {
              deg = (prev ?? Math.trunc(roundTo(target))) + clip(sign(target - (prev ?? target)), -1, 1);
              if (deg === prev) deg += choose([-1, 1]);
            } else {
              let leap = rrand(2, 4) * clip(sign(target - (prev ?? target)), -1, 1);
              if (leap === 0) leap = choose([-3, 3]);
              deg = (prev ?? target) + leap;
              pendingRec = -sign(leap);
            }
          }
        }
      }
      runLen = dur === runDur ? runLen + 1 : 1;
      runDur = dur;
      if (!isRest) {
        const wCap = grid ? Math.min(0.70 + 0.25 * C.weatherEff(), 0.52) : 0.70 + 0.25 * C.weatherEff();
        const metric = beatPos < 0.25 ? touch.beat1 : Math.abs(beatPos - 2) < 0.25 ? touch.beat3 : (beatPos % 1) > 0.3 ? -touch.off + touch.offbeat * 0.16 : 0.0;
        let repeatAdj = 0.0;
        if (prev != null && deg === prev) { repeatRun += 1; repeatAdj = touch.repeatLean * touch.repeatAmt * (repeatRun % 2 === 1 ? 1 : -0.6); }
        else repeatRun = 0;
        const velF = clip(0.55 + phraseDyn
          + touch.dynRange * (touch.peakLift * (1 + 1.5 * (dynW - 1)) * Math.max(1 - Math.abs(pos - peakPos) * 2.2, 0))
          + touch.dynRange * metric + repeatAdj
          + gauss(0, 0.03 + 0.04 * C.sig.energy) * touch.dynRange, 0.25, wCap);
        const amp = level * 0.42 * velF * (0.70 + 0.30 * C.sig.energy) * (C.voiceGate.rightHand ?? 0) * C.arcGainFor("rightHand") * secGain();
        if (amp > 0.001) {
          const noteSec = (dur <= 0.5 ? dur * 1.05 : Math.max(dur, 0.4) * legatoMul) * C.clock.beatDur;
          const layer = Math.trunc(roundTo(linlin(velF, 0, 1, 1, 16)));
          if (C.celloSingOn != null && C.celloSingOn()) {
            C.celloSing(C.rhMidi(deg), amp / Math.max(level, 0.01) * (C.mood.stringsLevel ?? 0.38) * 1.5, noteSec * 1.3, Math.min(layer, 12), false);
          } else {
            C.fireNote(C.rhSynth(), C.rhMidi(deg), amp, noteSec, rrand(-0.25, -0.15), layer, ["rel", C.pedalRel(0.5, 2.5, dur)], "rh");
            //! under-chords: on strong beats when the line is not racing, 1-2
            //! voice-led chord tones inside the octave under the melody, the
            //! octave at a peak; how often is the pianist's doubling / blockChord
            if (strong && dur >= 0.5 && velF > 0.35 && (plan.density < 0.7 || dur >= 1.0)) {
              const hc = C.handsChordsNow();
              const melMidi = C.rhMidi(deg);
              const atPeak = Math.abs(pos - peakPos) < 0.12 && velF > 0.6;
              const lhBusy = Math.abs(C.clock.beats - (C.lhChordBeat ?? -9)) < 0.3;
              const wantChord = coin(touch.blockChord * (1 + hc) + 0.08 * hc);
              const wantDbl = wantChord || coin(touch.doubling * (1 + 0.5 * hc));
              const nUnder = wantChord && !lhBusy ? 2 : 1;
              const under = (atPeak && coin(0.5)) ? [melMidi - 12] : C.rhChordUnder(melMidi, nUnder, chordOf());
              if (wantDbl) {
                under.slice().reverse().forEach((m, i) => {
                  C.fireNote(C.rhSynth(), m, amp * [0.72, 0.6][Math.min(i, 1)], noteSec, rrand(-0.2, -0.05), Math.max(layer - 1 - i, 3), ["rel", C.pedalRel(0.7, 2.5, dur)], "rh");
                });
              }
            }
          }
        }
        if (prev != null && deg !== prev) C.rhLastDir = sign(deg - prev);
        playedDegs.push(deg); playedDurs.push(dur);
        prev = deg;
      }
      //! micro-rubato: a slight push toward the contour peak, ritenuto into the ending
      const rub = grid ? 1.0 : pos > 0.85 ? 1 + 0.06 * touch.rubato : Math.abs(pos - 0.6) < 0.15 ? 1 - 0.025 * touch.rubato : 1.0;
      yield grid ? dur + C.swingOff(q0 + dur) - C.swingOff(q0) : dur * rub * (1 + rrand(-0.015, 0.015) * touch.rubato);
      beatsUsed += dur;
    }
    //! The ending: a chord tone, long, never a rest.
    {
      const toChange = C.beatsToChordChange();
      let dur = grid ? choose([1.5, 2.0, 2.5, 3.0]) : rrand(1.5, 3.0);
      let endDeg;
      if (plan.cadential) {
        endDeg = choose([0, 2]) + C.scale.length * clip(Math.trunc(roundTo(plan.regCenter / C.scale.length)), 0, 2);
      } else {
        const color = { dorian: 5, lydian: 3, mixolydian: 6 }[C.scaleName];
        const ref = prev ?? plan.regCenter;
        if (toChange > 0 && toChange <= 2.0) {
          const n = C.scale.length;
          const nxt = C.nextChordDegsForLead().map((d) => Math.trunc(d));
          const curPc = chordOf().map((c) => mod(c, n));
          const nxtAll = allOctaves(nxt, n);
          const common = nxtAll.filter((c) => curPc.includes(mod(c, n)) && Math.abs(c - ref) <= 2);
          dur = Math.max(dur, toChange + 1.0);
          endDeg = common.length ? minBy(common, (c) => Math.abs(c - ref)) : C.guideSnapTo(ref, nxt);
        } else if (plan.endAim != null) {
          endDeg = C.periodEndDeg(plan.endAim, ref);
        } else if (color != null && chordOf().map((c) => mod(c, C.scale.length)).includes(color) && coin(0.3)) {
          endDeg = minBy([color - 7, color, color + 7, color + 14], (c) => Math.abs(c - ref));
        } else {
          endDeg = chordSnap(ref + choose([-1, 1]));
        }
      }
      const velF = clip(0.5 + phraseDyn + gauss(0, 0.04), 0.3, grid ? 0.52 : 0.7);
      const amp = level * 0.42 * velF * (0.70 + 0.30 * C.sig.energy) * (C.voiceGate.rightHand ?? 0) * C.arcGainFor("rightHand") * secGain();
      if (plan.endAim === "home") dur = Math.min(dur * 1.2, 3.5);
      if (amp > 0.001) {
        if (C.celloSingOn != null && C.celloSingOn()) {
          C.celloSing(C.rhMidi(endDeg), amp / Math.max(level, 0.01) * (C.mood.stringsLevel ?? 0.38) * 1.5, dur * C.clock.beatDur * 1.3, Math.trunc(roundTo(linlin(velF, 0, 1, 3, 12))), true);
        } else {
          C.fireNote(C.rhSynth(), C.rhMidi(endDeg), amp, dur * C.clock.beatDur * 1.3, rrand(-0.25, -0.15), Math.trunc(roundTo(linlin(velF, 0, 1, 1, 15))), ["rel", C.pedalRel(0.7, 3.0, dur)], "rh");
          //! the closing note carries a voiced chord under it, fuller at a cadence
          const hc = C.handsChordsNow();
          const endMidi = C.rhMidi(endDeg);
          const nClose = (plan.cadential && coin(0.5 + 0.4 * hc)) ? 2 + (coin(0.35 * hc) ? 1 : 0)
            : coin(touch.doubling * 1.6) ? 1 + (coin(touch.blockChord * 2 * (1 + hc)) ? 1 : 0) : 0;
          const close = nClose > 0 ? C.rhChordUnder(endMidi, nClose, chordOf()) : [];
          const vl = Math.trunc(roundTo(linlin(velF, 0, 1, 1, 15)));
          close.slice().reverse().forEach((m, i) => {
            C.fireNote(C.rhSynth(), m, amp * [0.7, 0.58, 0.5][Math.min(i, 2)], dur * C.clock.beatDur * 1.3, rrand(-0.2, -0.05), Math.max(vl - 1 - i, 3), ["rel", C.pedalRel(0.9, 3.0, dur)], "rh");
          });
          if (plan.cadential && !C.cadence.queue.length && coin(0.6)) {
            C.fireNote(C.rhSynth(), C.rhMidi(endDeg) - 12, amp * 0.6, dur * C.clock.beatDur * 1.3, -0.2, 5, null, "rh");
          }
        }
      }
      playedDegs.push(endDeg); playedDurs.push(dur);
      yield dur * (grid ? 1.0 : 1.06);
    }
    C.celloSingEnd?.();
    C.rhLastDir = 0;
    C.memAbsorb(playedDegs, playedDurs);
    C.lastPhrase = { degrees: playedDegs, length: playedDegs.length };
    C.phraseDone?.(C.lastPhrase);
    //! inter-phrase breath; the duo may extend it via duoReserve
    const breath = (grid ? Math.max(roundTo(1 + (1 - C.sig.energy) * 3, 1.0), 1.0) : (1 + (1 - C.sig.energy) * 3) * C.touchOr().breath)
      * (C.songOutro() ? 2.0 : 1.0) * (C.sectionLift?.().space ?? 1.0) + (C.duoReserve ?? 0);
    yield breath;
    C.duoReserve = 0;
  };
}
