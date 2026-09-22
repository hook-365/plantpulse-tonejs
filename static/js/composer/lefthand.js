//! lefthand.js: the pianist's left hand (the live project's
//! composer/voices.scd, the bass half). Component-built bars, no pattern
//! deck: an anchor on beat one, an event budget for the remaining three
//! beats (calm plant -> pedal bars, lively -> walking motion), a
//! draw-and-fit rhythm partition that always sums the bar to 4 beats,
//! chord-tone targets with passing-tone fills and tilt-biased direction,
//! the chromatic approach as a rule, and whole-bar texture draws (pedal /
//! broken chord / bass + voiced chord / walk, or the song's own figure).
//! With the mood's handsChords on, the left hand IS the whole left hand.
//! Where the bass is its own player (split hands: lofi's upright, not a
//! free room) a bassist is drawn per song; the defaults are the
//! pre-bassist numbers exactly.
import { rrand, wchoose, choose, coin, gauss, clip, linlin, roundTo, div } from "../sc.js";

const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const minBy = (xs, f) => xs.reduce((a, b) => (f(b) < f(a) ? b : a));
const maxBy = (xs, f) => xs.reduce((a, b) => (f(b) > f(a) ? b : a));
const wrapAt = (xs, i) => xs[((i % xs.length) + xs.length) % xs.length];

export function install(C) {
  C.bassistNow = null; C.bassistLast = null;
  C.bassistOr = () => C.bassistNow ?? { walkLean: 0.5, anchorLean: 0.5, approachLean: 0.5, pushLean: 0.0, noteLen: 1.0, regLean: 0.0, ghostLean: 0.0, lockLean: 0.0 };
  C.bassistWords = (b) => {
    const w = [];
    const add = (word, v, thr) => w.push([word, C.wordsMargin(v, thr)]);
    if (b.walkLean > 0.70) add("walks", b.walkLean, 0.70);
    if (b.walkLean < 0.30) add("two-feel", b.walkLean, 0.30);
    if (b.anchorLean > 0.65) add("off the root", b.anchorLean, 0.65);
    if (b.approachLean > 0.65) add("leads into the changes", b.approachLean, 0.65);
    if (b.pushLean > 0.60) add("pushes the changes", b.pushLean, 0.60);
    if (b.noteLen > 1.20) add("lets it ring", b.noteLen, 1.20);
    if (b.noteLen < 0.75) add("short notes", b.noteLen, 0.75);
    if (b.regLean > 0.60) add("up the neck", b.regLean, 0.60);
    if (b.regLean < -0.60) add("down low", b.regLean, -0.60);
    if (b.ghostLean > 0.65) add("ghost notes", b.ghostLean, 0.65);
    if (b.lockLean > 0.70) add("in the kick's pocket", b.lockLean, 0.70);
    if (b.lockLean < 0.30) add("around the kick", b.lockLean, 0.30);
    return C.wordsRank(w, "plain");
  };
  //! the bassist per song, where the bass is its own player (lhSplit)
  C.sampleBassist = () => {
    if (C.bassistNow != null) C.bassistLast = C.bassistNow;
    if (C.lhSplit()) {
      const b = {
        walkLean: rrand(0.0, 1.0), anchorLean: rrand(0.0, 1.0), approachLean: rrand(0.0, 1.0), pushLean: rrand(0.0, 1.0),
        noteLen: Math.exp(rrand(-0.45, 0.35)), regLean: rrand(-1.0, 1.0), ghostLean: rrand(0.0, 1.0), lockLean: rrand(0.0, 1.0),
      };
      b.words = C.bassistWords(b);
      C.bassistNow = b;
      C.log(`[bassist] ${b.words}`);
    } else C.bassistNow = null;
    //! the mark rides the feed either way: empty text hides the page's line
    C.noteLogMark?.("bassist", C.wordsTop(C.bassistNow?.words ?? ""));
  };

  C.bassBarEvents = []; C.bassEventIdx = 0;
  C.lhChordBeat = -9;
  C.lhLastBarHadChord = false;   //! the harmony may not skip two bars in a row
  C.lhVoicing = C.lhVoicing ?? null;

  //! The left hand's chord: 2-3 chord tones in the tenor (48-66), voice-led
  //! by nearest motion from the last chord and folded back into the band.
  //! Seats by chord ROLE (the 3rd's chair may be a sus tone, the 7th's a 6th,
  //! and a 9th/11th is the extension), so any chordColor shape voices.
  C.lhChordVoice = (degs, n = 3) => {
    const r = C.chordRoles(degs);
    const guide = [r.third, r.seventh ?? r.fifth].filter((x) => x != null);
    const root = r.root;
    let pick;
    if (n <= 1) {
      const led = C.voiceLeadFrom(guide, 0, C.lhVoicing);
      const last = C.lhVoicing != null && C.lhVoicing.length ? C.lhVoicing[C.lhVoicing.length - 1] : null;
      pick = [last == null ? led[0] : minBy(led, (m) => Math.abs(m - last))];
    } else if (n <= 2) pick = guide;
    else pick = r.ext != null ? [...guide, r.ext] : (r.seventh != null ? [r.third, r.fifth, r.seventh] : [root, r.third, r.fifth]);
    pick = pick.filter((x) => x != null);
    if (pick.length < Math.min(n, 2)) pick = [root, ...pick, root + 7].slice(0, Math.max(n, 2));
    let v = C.voiceLeadFrom(pick, 0, C.lhVoicing).map((m) => { let x = m; while (x < 48) x += 12; while (x > 66) x -= 12; return x; }).sort((a, b) => a - b);
    v = v.map((m, i) => (i > 0 && m <= v[i - 1] ? m + 12 : m));
    if (v[v.length - 1] > 67) v = v.map((m) => m - 12);
    C.lhVoicing = v;
    return v;
  };

  C.refillBassBar = () => {
    const rootDeg = Math.trunc(C.chordNow.deg);
    const nextRoot = C.nextRootDeg();
    const scaleSize = C.scale.length;
    const nextRootMidi = C.degToMidi(nextRoot - scaleSize);
    const approachFor = (precedingMidi) => (precedingMidi < nextRootMidi ? nextRootMidi + 1 : nextRootMidi - 1);
    const degs = C.chordDegrees("now").map((d) => Math.trunc(d));
    const chordTones = degs.filter((d) => d - rootDeg <= 6);   //! the bass stops at the 7th
    const e = clip(C.sig.energy * (0.6 + 0.8 * C.weatherEff()), 0, 1);
    const st = C.sig.stability;
    const hc = C.handsChordsNow();
    const split = C.lhSplit();
    //! the light left hand: on the song where another player comps, one guide tone on some bars
    const light = split && hc < 0.5;
    //! lhShare: with a keys player comping the pianist's left hand takes a share of the chord bars
    const share = (C.mood.padComp ?? 0) > 0 ? clip((C.mood.lhShare ?? 1) + (C.sectionNow === "B" ? 0.25 : 0), 0, 1) : 1;
    const hcs = hc * share;
    const touch = C.touchOr?.() ?? { lhChord: 0.65, lhBroken: 0.2, offbeat: 0.15 };
    //! draw-and-fit: k durations from the pool that sum to total
    const partition = (total, k, pool) => {
      const durs = []; let remaining = total;
      for (let i = 0; i < k; i++) {
        const left = k - 1 - i;
        let d;
        if (left === 0) d = remaining;
        else { const opts = pool.filter((x) => x <= remaining - left * 0.5); d = opts.length ? choose(opts) : 0.5; }
        durs.push(d); remaining -= d;
      }
      return durs;
    };
    const lift = C.sectionLift?.() ?? { chord: 1.0, gain: 1.0 };
    const bz = C.bassistOr();
    const rootProb = clip(1.1 - 0.6 * bz.anchorLean, 0.5, 1.0);
    //! this song's figure (drawn with the pianist): when the hands are the piano's it owns every bar
    const fig = (hc > 0 && !split) ? (touch.figure ?? null) : null;
    const texture = fig != null ? "figure" : wchoose(["pedal", "broken", "chord", "walk"], [
      0.15 * st * (1 - 0.5 * hc) * (1.5 - bz.walkLean),
      0.15 * e * (1 - hc) + hcs * touch.lhBroken * (0.4 + 0.6 * e) * (split ? 0 : 1),
      hcs * (0.5 + touch.lhChord) * lift.chord + (light ? 0.3 * touch.lhChord * lift.chord : 0),
      (0.3 + 0.7 * e) * (1 - 0.6 * hc) * (0.5 + bz.walkLean),
    ]);
    let events;
    if (texture === "figure") {
      //! the figure, component-built from the sounding chord: the bass on one,
      //! then the chord's tones in the song's order at the song's rate; thinned
      //! in the intro, the verse and the breakdown, full in the chorus
      const thin = lift.chord < 1.0 || C.arcPhase === "intro" || C.barIdx < (C.mood.introBars ?? 8);
      const n = Math.max(Math.trunc(roundTo(Math.trunc(roundTo(4 / fig.rate)) / (thin ? 2 : 1))), 2);
      const d = 4 / n;
      const ladder = [...chordTones, rootDeg + scaleSize].map((x) => x + scaleSize).sort((a, b) => a - b);
      const third = ladder[1] ?? ladder[0];
      const fifth = ladder[2] ?? ladder[ladder.length - 1];
      let cycle;
      if (fig.order === "up") cycle = fig.span > 1 ? [...ladder, ...ladder.map((x) => x + scaleSize)] : ladder;
      else if (fig.order === "updown") { const l = fig.span > 1 ? [...ladder, ...ladder.map((x) => x + scaleSize)] : ladder; cycle = [...l, ...l.slice(1, -1).reverse()]; }
      else if (fig.order === "alberti") cycle = [rootDeg, fifth, third, fifth];
      else cycle = [rootDeg, fifth, rootDeg, third];
      const tones = Array.from({ length: n }, (_, i) => (i === 0 ? rootDeg : wrapAt(cycle, (fig.order === "up" || fig.order === "updown") ? i - 1 : i)));
      events = tones.map((deg, i) => ({ deg, dur: d, hold: i === 0 ? 4 : Math.min(d * fig.ring * 1.6, 4), isRest: false }));
    } else if (texture === "pedal") {
      //! the pedal bar holds the root and a companion (the dwell's 7th or 6th, else a 5th-ish), and sometimes a soft chord
      events = [{
        deg: rootDeg,
        also: degs.find((d) => [5, 6].includes(d - rootDeg)) ?? choose([rootDeg + 4, rootDeg + 9]),
        voice: (hc > 0 && coin((0.5 + 0.5 * touch.lhChord) * share)) ? C.lhChordVoice(degs, 3) : null,
        dur: 4, hold: 4, isRest: false,
      }];
    } else if (texture === "broken") {
      const count = wchoose([2, 3, 4], [0.35, 0.4, 0.25 + 0.3 * e]);
      const arch = coin(0.35);
      const ladder = [...chordTones, rootDeg + scaleSize].map((x) => x + scaleSize).sort((a, b) => a - b);
      const head = coin(0.6) ? 0.5 : 1.0;
      const bdurs = partition(4.0 - head, count, [0.5, 1.0, 1.5]);
      const seq = [];
      let last = rootDeg;
      for (let i = 0; i < count; i++) {
        const up = !arch || i < div(count + 1, 2);
        const cands = ladder.filter((t) => (up ? t > last : t < last));
        const t = !cands.length ? choose(ladder) : (up ? Math.min(...cands) : Math.max(...cands));
        seq.push(t); last = t;
      }
      events = [{ deg: rootDeg, dur: head, hold: 4, isRest: false }];
      seq.forEach((t, i) => events.push({ deg: t, dur: bdurs[i], hold: bdurs[i] * 1.6, isRest: false }));
      const lastE = events[events.length - 1];
      if (lastE.dur >= 1.5 && coin(0.4)) {
        events[events.length - 1] = { ...lastE, dur: lastE.dur - 1.0 };
        events.push({ deg: rootDeg, dur: 1.0, isRest: true });
      }
    } else if (texture === "chord") {
      //! bass on one, the chord voiced in the tenor at a drawn slot; sometimes
      //! a second hit, sometimes bass-only: the spare pianist leaves bars alone
      const place = light || !C.lhLastBarHadChord || coin(touch.lhChord);
      const nVoice = light ? 1 : (coin(0.35 + 0.45 * touch.lhChord + 0.2 * e) ? 3 : 2);
      const slot = wchoose([1, 1.5, 2, 2.5, 3, 3.5], [
        0.12 * (1 - touch.offbeat), 0.05 * (1 + touch.offbeat), 0.35, 0.15 * (1 + 2 * touch.offbeat), 0.28, 0.08 * (1 + 2 * touch.offbeat)]);
      const second = !light && slot <= 2.5 && coin(0.15 + 0.35 * e + 0.1 * touch.lhChord);
      const slot2 = second ? choose([slot + 1.5, slot + 2, 3.5].filter((x) => x <= 3.5)) : null;
      const anchor = coin(rootProb) ? rootDeg : choose([rootDeg - 3, rootDeg - 7]);
      const chord = C.lhChordVoice(degs, nVoice);
      if (!place) events = [{ deg: anchor, dur: 4, isRest: false }];
      else if (slot === 1) events = [{ deg: anchor, dur: 4, hold: 4, voice: chord, isRest: false }];
      else {
        events = [{ deg: anchor, dur: slot - 1, hold: 4, isRest: false }];
        if (slot2 != null) {
          events.push({ voice: chord, dur: slot2 - slot, hold: slot2 - slot, isRest: false });
          events.push({ voice: C.lhChordVoice(degs, nVoice), dur: 5 - slot2, isRest: false });
        } else events.push({ voice: chord, dur: 5 - slot, isRest: false });
      }
    } else {
      const budget = wchoose([0, 1, 2, 3], [
        (1 - e) * 0.5 * (1.5 - bz.walkLean), 0.3 + 0.2 * (1 - e), (0.2 + 0.3 * e) * (0.5 + bz.walkLean), 0.4 * e * (0.5 + bz.walkLean)]);
      if (budget === 0) {
        events = [{ deg: rootDeg, dur: 4, hold: 4, isRest: false, voice: (hc > 0 && coin((0.4 + 0.5 * touch.lhChord) * share)) ? C.lhChordVoice(degs, 3) : null }];
      } else {
        const durs = partition(3.0, budget, [0.5, 1.0, 1.5, 2.0]);
        const dirBias = sign(C.sig.tilt);
        let prev = coin(rootProb) ? rootDeg : choose([rootDeg - 3, rootDeg - 7]);
        events = [{ deg: prev, dur: 1, isRest: false }];
        for (const d of durs) {
          const cands = chordTones.filter((t) => t !== prev);
          const best = cands.length ? minBy(cands, (t) => Math.abs(t - prev) - 0.25 * dirBias * sign(t - prev)) : rootDeg;
          const deg = (Math.abs(best - prev) === 2 && coin(0.5)) ? prev + sign(best - prev) : best;
          events.push({ deg, dur: d, isRest: coin(0.08) && d <= 1, ghost: d <= 1 && coin(0.3 * bz.ghostLean) });
          prev = deg;
        }
      }
    }
    const lastEv = events[events.length - 1];
    if (events.length >= 2 && !(lastEv.isRest ?? false) && lastEv.voice == null && lastEv.deg != null
        && (lastEv.dur ?? 1) <= 1 && coin(0.35 * (0.3 + 1.4 * bz.approachLean))) {
      //! the chromatic approach into the coming root
      events[events.length - 1] = { ...lastEv, midiOverride: approachFor(C.degToMidi((events[events.length - 2].deg ?? rootDeg) - scaleSize)) };
    } else {
      //! the push: the bassist who anticipates plays the coming root before one (never at the default)
      const pushProb = 0.5 * bz.pushLean;
      if (!(lastEv.isRest ?? false) && lastEv.voice == null && lastEv.deg != null && lastEv.midiOverride == null && (lastEv.dur ?? 1) >= 1 && coin(pushProb)) {
        const pushDur = 0.5;
        events[events.length - 1] = { ...lastEv, dur: lastEv.dur - pushDur, hold: Math.max((lastEv.hold ?? lastEv.dur) - pushDur, 0.5) };
        events.push({ deg: nextRoot, dur: pushDur, hold: pushDur, isRest: false, push: true });
      }
    }
    C.lhLastBarHadChord = events.some((ev) => ev.voice != null);
    C.bassBarEvents = events;
    C.bassEventIdx = 0;
    //! grid moods re-anchor every bar to the band's bar line; rubato keeps the free clock
    C.lhBarAnchor = C.gridActive?.() ? Math.round(C.clock.beats / 4) * 4 : null;
    C.lhBarPos = 0;
  };

  C.popBassEvent = () => {
    if (!C.bassBarEvents || !C.bassBarEvents.length || (C.bassEventIdx ?? 0) >= C.bassBarEvents.length) C.refillBassBar();
    const ev = C.bassBarEvents[C.bassEventIdx ?? 0];
    C.bassEventIdx = (C.bassEventIdx ?? 0) + 1;
    return ev;
  };

  C.leftHandBody = function* () {
    for (;;) {
      const gate = C.voiceGate.leftHand ?? 0;
      const level = C.mood.leftHandLevel ?? 0;
      if (level < 0.01 || gate < 0.05) {
        C.bassBarEvents = []; C.bassEventIdx = 0; C.lhVoicing = null; C.lhBarAnchor = null;
        yield 1.0;
        continue;
      }
      const hc = C.handsChordsNow();
      const beatDur = C.clock.beatDur;
      //! with the hands carrying the harmony, the left hand holds the outro's last tonic to the end
      const arcGain = Math.max(C.arcGainFor?.("leftHand") ?? 1.0, (C.arcGainFor?.("pad") ?? 1.0) * hc);
      const lhSynth = C.mood.leftHandSynth ?? "ppPianoSampler";
      //! the chord voice is the pianist's own left hand, on the instrument in the pianist's chair this take
      const chordSynth = C.rhSynth();
      //! when the bass note is on another instrument it is another player (role bass); lh is the pianist's left hand
      const bassRole = lhSynth !== chordSynth ? "bass" : "lh";
      const ev = C.popBassEvent();
      const dur = Number(ev.dur ?? 1);
      let hold = Number(ev.hold ?? dur);
      const voice = ev.voice;
      if (!(ev.isRest ?? false) && arcGain > 0.01) {
        const touch = C.touchOr?.() ?? { beat1: 0.12, lhBalance: 0.92, legato: 1.2 };
        const onOne = (C.beatInBar?.() ?? 1) < 0.3;
        const velF = clip(0.5 * touch.lhBalance + (C.phraseDynNow ?? 0) * 0.5 + (onOne ? touch.beat1 * 0.7 : 0) + gauss(0, 0.04), 0.3, 0.8);
        let amp = level * 0.5 * velF * (0.70 + 0.30 * C.sig.energy) * gate * arcGain * (C.sectionLift?.().gain ?? 1.0);
        let layer = Math.trunc(roundTo(linlin(velF, 0, 1, 2, 16)));
        if (ev.deg != null || ev.midiOverride != null) {
          let midi = ev.midiOverride ?? C.degToMidi(ev.deg - C.scale.length);
          if (C.bassistNow != null && bassRole === "bass") {
            //! the bassist's register on the neck: the mood's bassWindow bounds it absolutely
            const win = C.mood.bassWindow ?? [28, 50];
            const lo = win[0] + Math.round((C.bassistNow.regLean + 1) * 1.5);
            const hi = Math.max(win[1], lo + 12);
            C.bassFoldHi = hi; C.bassFoldLo = lo;
            while (midi < lo) midi += 12;
            while (midi > hi) midi -= 12;
            if (ev.ghost ?? false) { amp *= 0.35; hold = Math.min(hold, 0.35); layer = 3; }
          }
          C.fireNote(lhSynth, midi, amp, hold * beatDur * (touch.legato * 0.92) * (bassRole === "bass" ? C.bassistOr().noteLen : 1.0), -0.25,
            layer, ["rel", C.pedalRel(0.9, 3.5, hold)], bassRole);
          //! the floor under the upright: a sine an octave under at subLevel, none below C1
          if (bassRole === "bass" && (C.mood.subLevel ?? 0) > 0 && !(ev.ghost ?? false) && midi - 12 >= 24) {
            C.synth?.("ppSub", { freq: 440 * Math.pow(2, (midi - 12 - 69) / 12), midinote: midi - 12, amp: amp * (C.mood.subLevel ?? 0), dur: hold * beatDur * 0.9 }, C.clock.beatsToSecs(C.clock.beats));
          }
          if (ev.also != null) {
            let alsoMidi = C.degToMidi(ev.also - C.scale.length);
            if (C.bassistNow != null && bassRole === "bass") { while (alsoMidi < C.bassFoldLo) alsoMidi += 12; while (alsoMidi > C.bassFoldHi) alsoMidi -= 12; }
            C.fireNote(lhSynth, alsoMidi, amp * 0.8, hold * beatDur * 1.1, -0.25, Math.trunc(roundTo(linlin(velF, 0, 1, 3, 13))), ["rel", C.pedalRel(0.9, 3.5, hold)], bassRole);
          }
        }
        if (voice != null && voice.length) {
          //! the left hand's chord: softer than the bass, the top voice a touch
          //! above the inner voices, a small spread left of centre, the pedal held
          const nV = voice.length;
          const onKeys = chordSynth === C.padSynthNow() && chordSynth !== "ppPianoSampler";
          const kp = C.keysNow;
          const keysX = onKeys ? (kp ? ["tremRate", kp.tremRate, "tremDepth", kp.tremDepth, "warp", kp.warp, "bright", clip(kp.bright, 1000, 6500)] : []) : null;
          C.lhChordBeat = C.clock.beats;
          voice.forEach((m, i) => {
            const top = i === nV - 1;
            const vl = clip(layer - 1 + (top ? 1 : 0), 3, 14);
            const strum = (onKeys ? (kp?.strum ?? 0) : 0) * i;   //! the guitar's strum
            const fire = () => C.fireNote(chordSynth, m, amp * 0.62 * (top ? 1.12 : 1.0), hold * beatDur * 1.05,
              (onKeys ? 0.2 : -0.2) + (i - (nV - 1) / 2) * 0.12, vl,
              onKeys ? [...keysX, "vel", vl] : ["rel", C.pedalRel(1.2, 3.5, hold)], "lh");
            if (strum > 0) C.clock.schedSec(strum, fire); else fire();
          });
        }
      }
      if (C.lhBarAnchor != null) {
        C.lhBarPos = (C.lhBarPos ?? 0) + dur;
        yield Math.max(C.lhBarAnchor + C.swingAt(C.lhBarPos) - C.clock.beats, 0.02);
      } else {
        yield dur * rrand(0.985, 1.015);   //! rubato: the free clock
      }
    }
  };
}
