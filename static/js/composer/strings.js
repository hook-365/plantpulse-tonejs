//! strings.js: the string player (the live project's composer/voices.scd,
//! the cello half). A cellist is drawn per song where the mood seats one
//! (stringsProb): vibrato, swells, bow length, rests, how melodic, how
//! legato, a solo cellist or a section of two or three. The bed holds an
//! inner voice under the melody and above the left hand, planned by
//! four-bar groups (a chorus group often one long bow), retuning on the
//! string at chord changes; a melodic cellist may take one section of the
//! song as the voice (celloSing), and answers the piano's phrases
//! (improv.js duoAnswer, the cello branch).
import { rrand, wchoose, choose, coin, clip, mod, div } from "../sc.js";

const minBy = (xs, f) => xs.reduce((a, b) => (f(b) < f(a) ? b : a));

export function install(C) {
  C.stringsNow = null; C.stringsLast = null; C.stringsLastMidi = null; C.stringsLastPath = null; C.stringsLastSec = null;
  C.stringsPhrasePos = 0; C.stringsVibDepth = null; C.stringsSitMap = null; C.stringsEntered = false; C.stringsEnterBar = null;
  C.stringsBusyUntil = 0; C.stringsBowKey = null; C.stringsBowsLeft = 1;
  C.rhLastDir = C.rhLastDir ?? 0;

  //! The cellist per song: uniform draws, never a favourite.
  C.sampleStrings = () => {
    const c = {
      on: coin(C.mood.stringsProb ?? 0),
      role: choose(["duet", "chorus"]),
      vibRate: rrand(4.6, 6.4), vibDepth: rrand(8.0, 20.0), vibDelay: rrand(0.3, 0.9), vibProb: rrand(0.4, 0.85),
      swellProb: rrand(0.2, 0.55), bowBeats: rrand(3.0, 6.0), restLean: rrand(0.15, 0.40),
      dblStop: rrand(0.0, 0.35), lineLean: rrand(0.25, 0.75), slurLean: rrand(0.30, 0.90),
      desks: choose([1, 2, 3]),
    };
    //! the voice: a melodic cellist may take ONE section of the song as the voice
    c.voice = (C.mood.celloVoice ?? 0) > 0 && c.lineLean > 0.5 && coin(C.mood.celloVoice ?? 0);
    c.voiceSec = choose(["A2", "breakdown", "B2"]);
    return c;
  };
  C.cellistWords = (c) => {
    if (!c.on) return "";
    const w = [];
    const add = (word, v, thr) => w.push([word, C.wordsMargin(v, thr)]);
    w.push([c.role === "duet" ? "from the first bar" : "arrives at the chorus", 9]);
    if (c.lineLean > 0.6) add("melodic", c.lineLean, 0.6);
    if (c.lineLean < 0.4) add("sustaining", c.lineLean, 0.4);
    if (c.vibDepth > 15 && c.vibProb > 0.65) add("singing", c.vibProb, 0.65);
    if (c.vibProb < 0.5) add("plain-toned", c.vibProb, 0.5);
    if (c.slurLean > 0.7) add("legato", c.slurLean, 0.7);
    if (c.slurLean < 0.45) add("detached", c.slurLean, 0.45);
    if (c.swellProb > 0.45) add("swelling", c.swellProb, 0.45);
    if (c.bowBeats > 5.0) add("long-bowed", c.bowBeats, 5.0);
    if (c.bowBeats < 3.8) add("short-bowed", c.bowBeats, 3.8);
    if (c.restLean > 0.32) add("sparing", c.restLean, 0.32);
    if (c.dblStop > 0.25) add("double-stopping", c.dblStop, 0.25);
    if ((c.desks ?? 1) > 1) w.push([["", "a section of two", "a section of three"][Math.min((c.desks ?? 1) - 1, 2)], 8]);
    if (c.voice ?? false) w.push([{ A2: "sings the second verse", breakdown: "sings the breakdown" }[c.voiceSec] ?? "sings the last chorus", 8.5]);
    return C.wordsRank(w);
  };
  C.stringsOn = () => C.stringsNow != null && C.stringsNow.on;
  //! in the room AND playing yet (chorus waits for its seam)
  C.stringsPresent = () => C.stringsOn() && (C.stringsNow.role === "duet" || C.stringsEntered);

  //! register plan: a centre per section, the bed above the left hand and
  //! under the melody; celloLift moves every centre
  C.stringsCentre = (sec) => (C.arcPhase === "intro" ? 54 : C.arcPhase === "outro" ? 55 : sec === "B" ? 63 : sec === "breakdown" ? 54 : 58)
    + Math.trunc(Math.round(C.mood.celloLift ?? 0));
  //! the inner voice: which chord tone the next bow takes
  C.stringsPick = (degs, sec, lean = "root", moveP = 0.3, newSec = false) => {
    const n = C.scale.length;
    const ctr = C.stringsCentre(sec);
    const lo = Math.max(ctr - 6, 36), hi = Math.min(ctr + 6, 76);
    const last = C.stringsLastMidi;
    const mdir = C.rhLastDir ?? 0;
    const root = Math.trunc(degs[0]);
    const wts = degs.map((d) => {
      const o = clip(Math.trunc(d) - root, 0, 10);
      return lean === "guide" ? [0.5, 0.9, 1.0, 0.9, 0.6, 0.8, 1.0, 0.5, 0.8, 0.6, 0.7][o] : [1.0, 0.5, 0.5, 0.5, 0.7, 0.35, 0.4, 0.9, 0.3, 0.3, 0.3][o];
    });
    const cands = [];
    degs.forEach((d, i) => { for (let k = -3; k <= 3; k++) { const m = C.degToMidi(d + k * n, 0); if (m >= lo && m <= hi) cands.push([m, wts[i]]); } });
    if (!cands.length) return clip(C.degToMidi(degs[0], 0), lo, hi);
    const hold = last != null && cands.some((c) => c[0] === last) && !(newSec && Math.abs(last - ctr) > 4) && !coin(moveP);
    if (hold) return last;
    const ref = newSec || last == null ? ctr : last;
    let near = cands.filter((c) => Math.abs(c[0] - ref) <= 5 && c[0] !== last);
    if (!near.length) near = cands.filter((c) => Math.abs(c[0] - ctr) <= 5);
    if (!near.length) near = cands;
    const sgn = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
    return wchoose(near, near.map((c) => c[1] / (1 + Math.abs(c[0] - ref) * 0.35) * (mdir === 0 ? 1.0 : (sgn(c[0] - ref) === -mdir ? 1.5 : 0.7))))[0];
  };
  //! the scale degree nearest a midi note
  C.stringsDegOf = (midi) => {
    let best = 0, bestD = 999;
    for (let d = -14; d <= 35; d++) { const m = C.degToMidi(d, 0); if (Math.abs(m - midi) < bestD) { bestD = Math.abs(m - midi); best = d; } }
    return best;
  };
  //! four-bar groups: [group key, bar in group, beats to the group's end]
  C.stringsGroup = () => {
    const sb = Math.trunc(C.mood.sectionBars ?? 0);
    let pos, key;
    if (C.sectionNow != null && C.sectionBarsLeft != null && sb > 0) { pos = Math.max(sb - C.sectionBarsLeft, 0); key = C.sectionIdx * 100 + div(pos, 4); }
    else { pos = Math.max(C.barIdx - 1, 0); key = -1000 + div(pos, 4); }
    return [key, mod(pos, 4), (4 - mod(pos, 4)) * 4 - C.beatInBar()];
  };
  //! does the cellist sit this group out? Decided once per group.
  C.stringsSitOut = (key, sec) => {
    const c = C.stringsNow;
    if (C.stringsSitMap == null) C.stringsSitMap = new Map();
    if (C.stringsSitMap.has(key)) return C.stringsSitMap.get(key);
    let out = false;
    if (c != null && c.on) {
      if (C.arcPhase === "intro") out = coin(c.restLean * 1.5);
      if (sec === "A" && C.arcPhase === "body") out = coin(c.restLean);
      //! the chorus breathes too, at 0.6 x the cellist's restLean
      if (sec === "B" && C.arcPhase === "body") out = coin(c.restLean * 0.6);
      //! never the group it entered in
      if (c.role === "chorus" && C.stringsEnterBar != null && C.barIdx - C.stringsEnterBar < 4) out = false;
    }
    C.stringsSitMap.set(key, out);
    return out;
  };

  //! the held bow: a list of desks; desk 1 fires through fireNote (one note
  //! on the log), desks 2..n are spawned direct with their own detune,
  //! vibrato rate, slower attack, softer amp and seat in the pan field
  C.celloBedSynths = [];
  C.celloBedTune = (midi, glide) => { for (const d of C.celloBedSynths) d.syn?.set({ midinote: midi, glide }); };
  C.celloBedAmp = (a) => { for (const d of C.celloBedSynths) d.syn?.set({ amp: a * d.sc }); };
  C.celloBedFree = (rel = 0.7) => { for (const d of C.celloBedSynths) d.syn?.set({ rel, gate: 0 }); C.celloBedSynths = []; };
  const xtrToArgs = (midi, amp, xtr) => { const a = { midinote: midi, freq: 440 * Math.pow(2, (midi - 69) / 12), amp }; for (let i = 0; i + 1 < (xtr ?? []).length; i += 2) a[xtr[i]] = xtr[i + 1]; return a; };
  C.celloDeskSynth = (midi, amp, xtr) => C.synth?.("ppCelloLeg", xtrToArgs(midi, amp, xtr), C.clock.beatsToSecs(C.clock.beats)) ?? null;
  C.celloBedSpawn = (midi, amp, durSec, xtr, c) => {
    //! solo in the verse, the section in the chorus and the ending
    const n = (C.sectionNow === "B" || C.arcPhase === "outro") ? clip(Math.trunc(c.desks ?? 1), 1, 3) : 1;
    C.celloBedSynths = [];
    C.celloBedSynths.push({ sc: 1.0, syn: C.fireNote("ppCelloLeg", midi, amp, durSec, 0.25, 8, xtr, "cello") });
    for (let i = 0; i < n - 1; i++) {
      const sc = [0.72, 0.58][Math.min(i, 1)];
      const x2 = [...(xtr ?? []), "cents", choose([1, -1]) * rrand(4.0, 9.0), "atk", 0.30 * rrand(1.05, 1.4),
        "vibRate", (C.stringsNow?.vibRate ?? 5.2) * rrand(0.92, 1.08), "pan", [0.1, 0.42][Math.min(i, 1)]];
      C.celloBedSynths.push({ sc, syn: C.celloDeskSynth(midi, amp * sc, x2) });
    }
  };

  //! the cello as the voice: at every section seam, when this song's cellist
  //! sings and the drawn section arrives, the section is the cello's
  C.celloVoiceNow = false;
  C.celloVoiceCount = { A: 0, B: 0, breakdown: 0 };
  C.celloVoiceReset = () => { C.celloVoiceNow = false; C.celloVoiceCount = { A: 0, B: 0, breakdown: 0 }; };
  C.celloVoiceSeam = (sec) => {
    const c = C.stringsNow;
    C.celloVoiceNow = false;
    if (sec == null) return;
    C.celloVoiceCount[sec] = (C.celloVoiceCount[sec] ?? 0) + 1;
    if (c != null && c.on && (c.voice ?? false)) {
      const want = c.voiceSec === "A2" ? (sec === "A" && C.celloVoiceCount.A === 2)
        : c.voiceSec === "breakdown" ? (sec === "breakdown" && C.celloVoiceCount.breakdown === 1)
        : (sec === "B" && C.celloVoiceCount.B === 2);
      if (want) {
        C.celloVoiceNow = true;
        C.stringsEntered = true;
        C.log(`[strings] the cello sings this section (${sec})`);
        C.noteLogMark?.("cello", "sings");
      }
    }
  };
  C.celloSingOn = () => (C.celloVoiceNow ?? false) && C.stringsNow != null && (C.mood.stringsLevel ?? 0) > 0;
  C.celloSingHeld = null; C.celloSingPrev = null;
  C.celloSing = (midi, amp, durSec, vel = 8, last = false) => {
    const c = C.stringsNow;
    let m = midi;
    while (m > 79) m -= 12;
    while (m < 55) m += 12;
    const glide = coin((c?.slurLean ?? 0.5) * 0.7) ? rrand(0.05, 0.09) : 0.03;
    const rel = last ? 1.2 : 0.6;
    const join = C.celloSingHeld != null && C.celloSingPrev != null && m !== C.celloSingPrev && Math.abs(m - C.celloSingPrev) <= 7;
    if (join) {
      C.celloSingHeld.set({ midinote: m, glide, amp, rel });
      C.noteLogWrite("cello", m, amp, durSec, vel, ["rel", rel, "glide", glide], "ppCelloLeg");
    } else {
      if (C.celloSingHeld != null) C.celloSingHeld.set({ rel: 0.5, gate: 0 });
      C.celloSingHeld = C.fireNote("ppCelloLeg", m, amp, durSec, 0.25, vel, [
        "vibRate", c?.vibRate ?? 5.2, "vibDepth", coin(c?.vibProb ?? 0.5) ? (c?.vibDepth ?? 12) : 0.0,
        "vibDelay", (c?.vibDelay ?? 0.5) * 0.8, "vibGrow", 0.5,
        "atk", C.celloSingPrev != null ? 0.16 : 0.22, "rel", rel, "glide", glide], "cello");
    }
    C.celloSingPrev = m;
    C.stringsLastMidi = m;
  };
  C.celloSingEnd = () => {
    if (C.celloSingHeld != null) C.celloSingHeld.set({ rel: 1.0, gate: 0 });
    C.celloSingHeld = null; C.celloSingPrev = null;
  };

  C.stringsPlayerBody = function* () {
    for (;;) {
      const gate = C.voiceGate.pad ?? 0;
      const level = C.mood.stringsLevel ?? 0;
      if (!(gate > 0.05 && level > 0.01)) {
        if (C.stringsNow != null) C.stringsLast = C.stringsNow;
        C.celloBedFree(1.3);
        C.stringsNow = null; C.stringsLastMidi = null; C.stringsLastSec = null; C.stringsPhrasePos = 0;
        C.stringsSitMap = null; C.stringsBowKey = null; C.stringsEntered = false;
        yield 4.0;
        continue;
      }
      if (C.stringsNow == null) {
        C.stringsNow = C.sampleStrings();
        C.stringsNow.words = C.cellistWords(C.stringsNow);
        C.stringsLastMidi = null; C.stringsLastSec = null; C.stringsPhrasePos = 0; C.stringsSitMap = null; C.stringsBowKey = null; C.stringsEntered = false;
        const s = C.stringsNow;
        C.log(s.on ? `[strings] this song: cello (${s.role}) vib ${s.vibRate.toFixed(1)}Hz/${Math.round(s.vibDepth)}c bow ${s.bowBeats.toFixed(1)}b rest ${s.restLean.toFixed(2)} line ${s.lineLean.toFixed(2)} slur ${s.slurLean.toFixed(2)} | ${s.words}` : "[strings] this song: none");
        C.noteLogMark?.("cellist", C.wordsTop(C.stringsNow.words));
      }
      const c = C.stringsNow;
      const sec = C.sectionNow;
      //! chorus waits for the first B, then never leaves
      if (c.on && c.role === "chorus" && !C.stringsEntered && sec === "B") {
        C.stringsEntered = true; C.stringsEnterBar = C.barIdx;
        C.log(`[strings] cello enters at the chorus (bar ${C.barIdx})`);
        C.noteLogMark?.("cello", "enters");
      }
      let present = c.on && C.arcPhase != null && (c.role === "duet" ? (C.arcPhase !== "intro" || C.barIdx >= 4) : c.role === "chorus" ? C.stringsEntered : false);
      if (present && (C.celloVoiceNow ?? false)) present = false;   //! one cellist: the bed rests while the cello sings
      if (present && C.clock.beats < C.stringsBusyUntil) present = false;   //! on its answering line
      if (!present) { C.stringsPhrasePos = 0; C.celloBedFree(0.9); yield 2.0; continue; }

      const degs = C.chordDegrees("now").map((d) => Math.trunc(d));
      const pathSize = C.chordPath?.length ?? 0;
      const changed = pathSize !== (C.stringsLastPath ?? -1);
      C.stringsLastPath = pathSize;
      const [gKey, gBar, gLeft] = C.stringsGroup();
      const sitOut = C.stringsSitOut(gKey, sec);
      if (sitOut) {
        //! a phrase's rest: sit the group out, then look again
        C.stringsPhrasePos = 0;
        C.celloBedFree(1.3);
        yield Math.max(Math.min(gLeft, 4.0), 0.5) + 0.02;
        continue;
      }
      const newSec = sec !== C.stringsLastSec || C.stringsLastMidi == null;
      C.stringsLastSec = sec;
      let lean = sec === "B" ? "guide" : "root";
      let moveP = changed ? (sec === "B" ? 0.45 : 0.3) : 0.12;
      if (C.arcPhase === "outro") {
        lean = "root"; moveP = 0.0;
        if (C.stringsLastMidi != null && mod(C.stringsLastMidi - C.rootMidi, 12) !== 0) moveP = 1.0;
      }
      const lastBefore = C.stringsLastMidi;
      let midi = C.arcPhase === "outro" ? C.stringsPick([0, 2, 4], sec, "root", moveP, newSec) : C.stringsPick(degs, sec, lean, moveP, newSec);
      if (C.arcPhase === "outro" && mod(midi - C.rootMidi, 12) !== 0) {
        //! the outro holds the tonic: the nearest one
        const opts = [-3, -2, -1, 0, 1, 2, 3].map((k) => C.rootMidi + k * 12).filter((m) => m >= 36 && m <= 67);
        midi = opts.length ? minBy(opts, (m) => Math.abs(m - (lastBefore ?? 48))) : 48;
      }
      let secF = sec === "B" ? 1.0 : sec === "breakdown" ? 0.45 : C.arcPhase === "intro" ? 0.55 : C.arcPhase === "outro" ? 0.85 : 0.7;
      //! entrance swell: the chorus arrival grows over its first three bars
      if (c.role === "chorus" && C.stringsEnterBar != null) secF *= [0.5, 0.7, 0.85, 1.0][clip(C.barIdx - C.stringsEnterBar, 0, 3)];
      //! the long line: a hairpin across the four-bar group, peaking in bar 3
      const pos01 = clip((gBar + C.beatInBar() / 4) / 4, 0, 1);
      const grpF = 0.86 + 0.22 * clip(1 - Math.abs(pos01 - 0.62) * 1.7, 0, 1);
      const amp = level * 0.30 * (0.70 + 0.30 * C.sig.energy) * gate * (C.arcGainFor?.("pad") ?? 1.0) * secF * grpF;
      const toChange = C.beatsToChordChange?.() ?? 4;
      //! each four-bar group draws its bow count ONCE; the bows divide the group's remaining beats
      if (C.stringsBowKey !== gKey) {
        C.stringsBowKey = gKey;
        C.stringsBowsLeft = sec === "B" ? choose([1, 1, 2]) : C.arcPhase === "intro" ? choose([1, 2]) : c.bowBeats > 4.2 ? choose([1, 2, 2]) : choose([2, 2, 3]);
      }
      let bowBeats = (gLeft / Math.max(C.stringsBowsLeft ?? 1, 1)) * rrand(0.9, 1.1);
      C.stringsBowsLeft = Math.max((C.stringsBowsLeft ?? 1) - 1, 1);
      let nextSit = false;
      if (bowBeats > gLeft - 0.4) {
        bowBeats = gLeft + 0.05;   //! the group's last bow runs to the line
        nextSit = C.stringsSitOut(gKey + 1, sec) && (C.arcPhase === "body" || C.arcPhase === "intro");
      }
      bowBeats = Math.min(Math.max(bowBeats, 3.0), Math.max(gLeft, 1.5));
      if (sec === "breakdown") bowBeats = !changed ? 0 : Math.max(toChange, 2);
      if (C.arcPhase === "outro" && (C.barsTotal ?? 0) - C.barIdx <= 2) bowBeats = Math.max(((C.barsTotal ?? 0) - C.barIdx) * 4, 2);
      if (!(bowBeats > 0 && amp > 0.001)) {
        //! a rest: a breath, then look again
        C.stringsPhrasePos = 0;
        C.celloBedFree(1.0);
        yield rrand(1.0, 2.5);
        continue;
      }
      const vibOn = coin(c.vibProb * (bowBeats >= 2.5 ? 1.0 : 0.4));
      let swellOn = bowBeats >= 3 && coin(c.swellProb * (pos01 > 0.35 && pos01 < 0.8 ? 1.3 : 0.8));
      const slurred = C.stringsPhrasePos > 0 && lastBefore != null;
      let atk = slurred ? 0.28 * (1 - c.slurLean * 0.72) : rrand(0.22, 0.30);
      //! a re-bow of the SAME pitch is not a slur: the new bow bites the string
      const bowChange = slurred && midi === lastBefore;
      if (bowChange) atk = rrand(0.05, 0.09);
      const glide = coin(c.slurLean * 0.6) ? rrand(0.05, 0.09) : 0.03;
      const ease = (nextSit || (bowBeats >= gLeft - 0.3 && gBar === 3)) ? 0.85 : 1.0;
      const lastBow = nextSit || sec === "breakdown" || (C.arcPhase === "outro" && (C.barsTotal ?? 0) - C.barIdx <= 2);
      const relBow = lastBow ? 1.3 : 0.7;
      if (!bowChange) C.stringsVibDepth = vibOn ? c.vibDepth * rrand(0.8, 1.2) : 0.0;
      if (bowChange && bowBeats < 4) swellOn = false;
      C.stringsLastMidi = midi;
      const ampAt = (g2) => level * 0.30 * (0.70 + 0.30 * C.sig.energy) * (C.voiceGate.pad ?? 0) * (C.arcGainFor?.("pad") ?? 1.0) * secF * g2 * ease;
      const xtr = [
        "vibRate", c.vibRate * (bowChange ? 1.0 : rrand(0.95, 1.05)),
        "vibDepth", C.stringsVibDepth ?? 0.0,
        "vibDelay", bowChange ? 0.05 : c.vibDelay * rrand(0.8, 1.2),
        "vibGrow", bowChange ? 0.2 : rrand(0.4, 0.9),
        "swell", swellOn ? rrand(0.3, 0.6) : 0.0,
        "atk", atk, "rel", relBow, "glide", glide,
      ];
      //! the old bow lets go under the new one (a bow change, not a gap)
      C.celloBedFree(bowChange ? 0.35 : relBow);
      C.celloBedSpawn(midi, amp * ease, bowBeats * C.clock.beatDur, xtr, c);
      //! double stop: a second string on an arrival, a chorus chord change, or the outro's held tonic
      if ((sec === "B" && changed) || C.arcPhase === "outro" || (c.role === "chorus" && C.barIdx - (C.stringsEnterBar ?? -9) < 1)) {
        if (coin(c.dblStop)) {
          const isRoot = mod(midi - C.degToMidi(degs[0], 0), 12) === 0;
          let second = isRoot ? midi + 12 : midi + 7;
          if (C.arcPhase === "outro") second = midi + 12;
          if (second <= 69) C.fireNote("ppCello", second, amp * ease * 0.8, bowBeats * C.clock.beatDur, -0.25, 8, xtr, "cello");
        }
      }
      C.stringsPhrasePos += 1;
      //! the held bow is LIVED, not slept through: the wait walks in one-beat
      //! steps, each re-setting bow pressure along the group hairpin, and a
      //! chord change under the bow retunes it on the string
      let left = Math.max(bowBeats - (bowChange ? 0.05 : c.slurLean > 0.5 ? 0.22 : 0.12), 0.5);
      while (left > 0.05) {
        const step = Math.min(left, 1.0);
        yield step;
        left -= step;
        if ((C.voiceGate.pad ?? 0) > 0.05 && C.celloBedSynths.length) {
          const grp2 = C.stringsGroup();
          const p2 = clip((grp2[1] + C.beatInBar() / 4) / 4, 0, 1);
          const g2 = 0.86 + 0.22 * clip(1 - Math.abs(p2 - 0.62) * 1.7, 0, 1);
          C.celloBedAmp(ampAt(g2));
          const ps = C.chordPath?.length ?? 0;
          if (ps !== C.stringsLastPath && left > 0.4) {
            C.stringsLastPath = ps;
            const nm = C.stringsPick(C.chordDegrees("now").map((d) => Math.trunc(d)), sec, lean, 0.3, false);
            if (nm !== C.stringsLastMidi && Math.abs(nm - C.stringsLastMidi) <= 7) {
              const gl = coin(c.slurLean * 0.6) ? rrand(0.05, 0.09) : 0.03;
              C.celloBedTune(nm, gl);
              C.noteLogWrite("cello", nm, ampAt(g2), Math.max(left, 0.5) * C.clock.beatDur, 8, ["rel", relBow, "glide", gl], "ppCelloLeg");
              C.stringsLastMidi = nm;
            }
          }
        }
      }
    }
  };
}
