# COMPOSER: the browser composer's decision surface

This is the contract for `static/js/composer/`, the browser port of the live PlantPulse project's SuperCollider composer (its `docs/DECISION-SPEC.md`, rewritten for the two free rooms and the JavaScript names). It lists every musical choice the system makes: what decides it, on what timescale, with what plant input and what randomness. `tools/gate` keeps this document and the code agreeing: every key of the closed mood schema must be named here and read by its consumer module.

Status: everything below is **live** in the port unless marked otherwise. The drummer is a **typed hole**: the free rooms seat none (`drumLevel` 0 in both), lofi's kit is a licensed pack, and the six kit keys are data without a reader here, warned by the gate on every run.

## The signal vocabulary

All plant influence flows through `composer/energy.js` and nowhere else (gate-enforced: raw feature names may appear only there and in `signal.js`). `signal.js` turns the ESP32's volts into the raw features the live bridge computed (activity, volatility, trend, signal_norm: the maths came home to the browser). Energy reduces them to five named signals:

| Signal | Range | Smoothing τ | Derived from | Meaning |
|---|---|---|---|---|
| `sig.energy` | 0..1 | 4 s | **rank** of max(activity, volatility) against the plant's trailing 24 h (`rankBelow`, `sigNormNow`) | how lively the plant is, relative to its own day: median 0.5 by construction |
| `sig.stability` | 0..1 | 30 s | 1 − rank(volatility) | how settled the recent signal is |
| `sig.center` | −1..1 | 60 s | signal_norm | where the signal sits in its 10-minute range |
| `sig.tilt` | −1..1 | 10 s | trend | which way the signal is heading |
| `sig.weather` | 0..1 | 30 s poll | rank of the current hour's mean energy against the rolling one-hour means of the trailing day (`weatherRank`) | the day's character; neutral 0.5 on cold start (< 2 h) or a flat day |

The rank warms from a fixed ceiling (raw / 40) over the first two to four hours of samples (`sigRankWarm` 240, `sigRankFull` 480, one sample per 30 s). The day buffer persists per room in the browser (`localStorage`, the live engine's text format, `unixTime e x v` lines); a room with no record seeds from the freshest sibling room. `sigOver(seconds, field)` is the only sanctioned way to ask about slower timescales; `weatherEff()` (weather bent by `weatherDepth`) the one door weather consumers use; `bedSig()` mirrors the four products to the held voices so they breathe while they ring.

## Choice points

### Per-mood (set by data, changed only by the operator)

The closed schema (`static/composer/mood-schema.json`, gate-enforced: every mood defines every key; every key names the module that reads it; `tools/sync-composer-data` copies both files and the two moods from the live project). Values as of 2026-09-22, **drift / piano**:

| Key | Type | Consumer | drift | piano | What it decides |
|---|---|---|---|---|---|
| `name` | string | `moods.js` | `"drift"` | `"piano"` |  |
| `bpm` | number [40, 140] | `lifecycle.js` | `52` | `72` |  |
| `scalePool` | array | `harmony.js` | `["dorian","dorian","minor","minor","lydian",…` | `["major","major","major","minor","minor","ly…` |  |
| `rootPool` | array | `harmony.js` | `["E","A","D","G","C","F","B"]` | `["G","D","A","E","C","F","Bb","Eb"]` |  |
| `trackDurRange` | array | `lifecycle.js` | `[420,600]` | `[300,480]` |  |
| `rightHandLevel` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0.85` |  |
| `leftHandLevel` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0.75` |  |
| `padSynth` | string | `voices.js / lefthand.js / strings.js` | `"ppBreath"` | `"ppPianoSampler"` |  |
| `padLevel` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0.9` | `0` |  |
| `fxRoom` | number [0, 1] | `audio/master.js` | `0.92` | `0.85` |  |
| `fxMix` | number [0, 1] | `audio/master.js` | `0.48` | `0.35` |  |
| `fxDamp` | number [0, 1] | `audio/master.js` | `0.6` | `0.5` |  |
| `introBars` | number [2, 32] | `arc.js` | `8` | `8` |  |
| `outroBars` | number [2, 32] | `arc.js` | `8` | `8` |  |
| `padOctave` | number [-2, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0` |  |
| `weatherDepth` | number [0, 1] | `energy.js` | `0.4` | `0.6` |  |
| `phraseBarsMax` | number [2, 8] | `improv.js` | `4` | `6` |  |
| `duo` | number [0, 1] | `improv.js` | `0` | `0.7` |  |
| `sectionBars` | number [0, 16] | `lifecycle.js` | `0` | `16` |  |
| `drumLevel` | number [0, 1] | `(drums.js: a typed hole)` | `0` | `0` |  |
| `drumSwing` | number [0, 1] | `lifecycle.js` | `0` | `0` |  |
| `drumFeel` | string ['boombap', 'halftime', 'sparse'] | `(drums.js: a typed hole)` | `"sparse"` | `"sparse"` |  |
| `vinylLevel` | number [0, 1] | `(drums.js: a typed hole)` | `0` | `0` |  |
| `phraseFeel` | string ['rubato', 'grid'] | `improv.js` | `"rubato"` | `"rubato"` |  |
| `lickSeed` | number [0, 1] | `improv.js` | `0` | `0.5` |  |
| `padComp` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0` |  |
| `leftHandSynth` | string | `voices.js / lefthand.js / strings.js` | `"ppPianoSampler"` | `"ppPianoSampler"` |  |
| `rightHandSynth` | string | `improv.js` | `"ppPianoSampler"` | `"ppPianoSampler"` |  |
| `duoSynth` | string | `improv.js` | `"ppPianoSampler"` | `"ppPianoSampler"` |  |
| `rainLevel` | number [0, 1] | `(drums.js: a typed hole)` | `0` | `0` |  |
| `kitPool` | array | `(drums.js: a typed hole)` | `[]` | `[]` |  |
| `motifForm` | number [0, 1] | `improv.js` | `0` | `0.85` |  |
| `hookJury` | number [0, 1] | `improv.js` | `0` | `1` |  |
| `phraseTargets` | number [0, 1] | `improv.js` | `0` | `0.65` |  |
| `periodForm` | number [0, 1] | `improv.js` | `0` | `0.7` |  |
| `ritDepth` | number [0, 0.5] | `lifecycle.js` | `0.14` | `0.3` |  |
| `ritBars` | number [1, 16] | `lifecycle.js` | `4` | `6` |  |
| `stringsProb` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0.5` |  |
| `stringsLevel` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0.38` |  |
| `handsChords` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `1` |  |
| `pianoCompProb` | number [0, 1] | `improv.js` | `0` | `0` | per-track coin: the pianist's left hand comps the changes on the piano (hands-carry-the-harmony for the song, pad idles); 0 = never. 2026-08-18 |
| `lineRun` | number [0, 1] | `improv.js` | `0` | `0.6` |  |
| `themeHold` | number [0, 1] | `improv.js` | `0` | `0.7` |  |
| `regDrop` | number [0, 7] | `improv.js` | `0` | `5` |  |
| `lhFigure` | number [0, 1] | `improv.js` | `0` | `0.6` |  |
| `dynWide` | number [0, 1] | `improv.js` | `0` | `1` |  |
| `celloVoice` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0.5` |  |
| `rhWindow` | array | `improv.js` | `[72,84]` | `[62,88]` | [lo, hi] MIDI: the right hand's absolute range; every RH pitch folds by octaves into it (~rhMidi). 2026-08-25 |
| `funcTrans` | object | `harmony.js` | `{"T":{"T":0.35,"S":0.45,"D":0.2,"degs":[[0,0…` | `{"T":{"T":0.25,"S":0.45,"D":0.3,"degs":[[0,0…` | the walk's own table per mood: row = function now, T/S/D = next-function weights (renormalised by ~pp2BiasedRow), degs = [[degree 0..6, weight]] for that function. 2026-08-25 |
| `chordColor` | object | `harmony.js` | `{"T":{"seventh":0.3,"add9":0.3,"sus2":0.2,"o…` | `{"T":{"triad":0.55,"add9":0.25,"seventh":0.1…` | per-function weighted colour set, drawn once per dwell (~drawColor); a name may resolve on the dwell's last bar: "sus4>seventh". Diatonic: seventh is maj7/7/m7 by mode. Replaces chordExtensions. 2026-08-25 |
| `dwellPool` | array | `harmony.js` | `[[6,0.35],[8,0.4],[10,0.25]]` | `[[1,0.25],[2,0.5],[4,0.25]]` | [[bars, weight]] per dwell; stability tilts the draw toward the longer entries (~pickDwell). Replaces harmonyDwell. 2026-08-25 |
| `fxVerb` | string ['free', 'jp'] | `audio/master.js` | `"jp"` | `"jp"` | which reverb ppMaster selects: FreeVerb2 or JPverb (sc3-plugins). 2026-08-25 |
| `fxLpf` | number [2000, 18000] | `audio/master.js` | `18000` | `18000` | master tone ceiling in Hz (lofi 5500). 2026-08-25 |
| `masterTrim` | number [-12, 6] | `audio/master.js` | `0` | `0` | dB trim on the master makeup gain (2.8), per mood. 2026-08-25 |
| `fxWarp` | number [0, 1] | `audio/master.js` | `0` | `0` | tape depth: a shared slow pitch drift every sampler reads (\ppWarpLfo). 0 = none. 2026-08-25 |
| `subLevel` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0.5` | `0` | a sine an octave under the bass (\ppSub), as a fraction of the bass note's amp. 2026-08-25 |
| `padHold` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `1` | `0` | > 0: the pad is held voices that glide between chords (\ppBreathHeld), no per-bar restrike. drift. 2026-08-25 |
| `outroStyle` | string ['cadence', 'fade'] | `harmony.js` | `"fade"` | `"cadence"` | cadence = ii/IV, V, I under the outro; fade = the tonic alone, plus one 8-bar tonic pedal mid-take. 2026-08-25 |
| `rhDensityCap` | number [0.2, 1] | `improv.js` | `0.25` | `0.78` | ceiling on right-hand note density (grid 1.0, rubato 0.78, drift 0.25). 2026-08-25 |
| `rhPool` | array | `improv.js` | `[]` | `[]` | synth names the right hand is drawn from per take (repeats weight; [] = rightHandSynth every take). The instrument sits in the pianist's chair and inherits the pianist's phrasing; \ppVibes is the first alternative. 2026-08-25 |
| `padPool` | array | `voices.js / lefthand.js / strings.js` | `[]` | `[]` | synth names the comp / pad instrument is drawn from per take by the keys player (repeats weight; [] = padSynth every take). \ppLofiWurli is the first alternative to the Rhodes. 2026-08-26 |
| `seamless` | number [0, 1] | `lifecycle.js` | `1` | `0` | 1 = no silence between tracks: the arc holds its body level through intro and outro (arc.scd), the pad gate stays open at track end, the weather gap is skipped, and the held voices glide into the next key on its first bar. Drift, 2026-08-26 (Anthony: 'it's supposed to be something to sleep to'). |
| `bassWindow` | array | `voices.js / lefthand.js / strings.js` | `[28,45]` | `[28,45]` | [lo, hi] MIDI: the bass player's absolute range where the bass is its own player (lofi's upright); the bassist's regLean walks the floor up to a minor third inside it and every bass note (the anchor and its doubled 7th/6th) folds by octaves into [floor, hi]. 2026-08-27 (Anthony: 'pretty high in this song to really sound like a bass'; measured median A2-C3, top decile to A3, over a two-octave fold). |
| `fxHpf` | number [10, 120] | `audio/master.js` | `24` | `24` | master low-cut in Hz (two cascaded 2nd-order high-passes, 24 dB/oct) after the DC block; the page's chain mirrors it. 2026-08-27 (Anthony, at the desk: 'a sane lowpass filter at like 20 Hz'). 24 for every room: the sub sine's floor is MIDI 24, 32.7 Hz. |
| `celloLift` | number [-12, 12] | `voices.js / lefthand.js / strings.js` | `0` | `7` | semitones added to every section centre of the cello bed (~stringsCentre; the C2-E5 clamp stays). 2026-08-27 (Track C step 2): measured 18-20 st under the piano's line, an octave and a half; +5 puts the chorus on the A string, 13-15 st under. |
| `drumFeelPool` | array | `(drums.js: a typed hole)` | `[]` | `[]` | feels the drummer draws from per take (boombap / halftime / sparse, ~drumFeelDef: where the backbeat lives; repeats weight); [] = drumFeel every take. 2026-08-27 (Anthony: 'a lot of similar drumming patterns'; 39 takes all on 2 and 4 with straight 8ths). |
| `bassPresence` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `0` | `0` | the upright's presence layer (\ppDoubleBass): the note's own odd harmonics band-passed at 250 and 600 Hz so the bass reads on a laptop; 0 = the plain sample. 2026-08-27 (Anthony: 'hard to hear on a laptop'; the bass had just moved to E1-A2). |
| `lhShare` | number [0, 1] | `voices.js / lefthand.js / strings.js` | `1` | `1` | how much of the chord work the pianist's left hand takes per bar when a keys player is comping (padComp > 0); the chorus adds 0.25; 1 = full-handed. 2026-08-27: after the two-hands ruling lofi's comp onsets doubled (pad 22 -> 40/min, left hand 25 -> 52/min); 0.5 lets two comping players share the bar. |

### Per-track (every 5–10 min)

| Choice point | Plant input | Randomness | Consumer | Mood key |
|---|---|---|---|---|
| Track duration | none | free uniform in range | `lifecycle.js` | `trackDurRange` |
| Root (key) pick | none | deterministic cycle through the pool | `harmony.js` `rotateRootScale` | `rootPool` |
| Scale/mode pick | weather tilts toward bright/dark modes | free pick from the pool, no immediate repeat | `harmony.js` | `scalePool` `weatherDepth` |
| Walk tilt (T/S/D lean, per-degree lean) | stability → T, energy → D (hinged at 0.5) | per-track log-uniform | `harmony.js` `sampleWalkTilt` | — |
| Pianist and cellist draws | none (leans, not lines) | independent uniform leanings per song | `improv.js` `sampleTouch`, `strings.js` `sampleStrings` | `lhFigure` `stringsProb` `celloVoice` `rhPool` `pianoCompProb` |
| Two hands (the pianist's chord voice) | none | none: `handsChords` | `lefthand.js` (the chord on the instrument in the pianist's chair, `rhSynth`) | `handsChords` |
| Tempo nudge | weather ±8% | none | `lifecycle.js` | `bpm` |
| Inter-track silence | weather (2–12 s); none when `seamless` | none | `lifecycle.js` | `seamless` |

### Per-section (form clock, `sectionBars` > 0: the piano room)

| Choice point | Plant input | Randomness | Consumer | Mood key |
|---|---|---|---|---|
| Next section (A / B / breakdown), drawn four bars early | `sigOver(30, energy)` weights B up, breakdown down | weighted pick | `lifecycle.js` `formWalkStep` | `sectionBars` |
| Section length | none | none: a breakdown is half a section | `lifecycle.js` `formAdvanceBar` | `sectionBars` |
| Section lift (gain, density, register, chord fullness, space) | none | none | `lifecycle.js` `sectionLiftFor` | `dynWide` `regDrop` |
| Seam: call the walk home to I | none | none | `harmony.js` `walkCallHome` | — |
| Chorus progression freeze (the first B records, later Bs replay, colour included) | none | none | `harmony.js` `chorusProgArm` | — |
| The cello as the voice for one section | none | the cellist's draw | `strings.js` `celloVoiceSeam` | `celloVoice` |

### Per-dwell (each chord)

| Choice point | Plant input | Randomness | Consumer | Mood key |
|---|---|---|---|---|
| Next function (T/S/D) | 60 s tilt shoves D up / T down | the mood's row, renormalised | `harmony.js` `walkStep` `pp2BiasedRow` | `funcTrans` |
| Degree for the function | mode colour degree ×1.4 | weighted, no immediate repeat | `harmony.js` `pickDegForFunc` | `funcTrans[..].degs` |
| Chord colour (a shape from the vocabulary; may resolve on the last bar, `sus4>seventh`) | none | weighted draw per function; the 11th demoted to a 9th over a major 3rd | `harmony.js` `drawColor` `colorShapes` | `chordColor` |
| Dwell (bars) | 75 s stability tilts toward the longer entries | weighted pool | `harmony.js` `pickDwell` | `dwellPool` |
| Forced return home after 4 non-tonic dwells | none | none | `harmony.js` | — |
| Deceptive cadence (D→vi), once, in the middle third | none | 25% coin | `harmony.js` | — |
| Track-end script: ii/IV, V, I; or the tonic alone (`fade`), plus one 8-bar tonic pedal mid-take | none | none | `harmony.js` `armCadence` | `outroStyle` `outroBars` |
| Voice-leading (nearest motion, the voice count follows the chord, octave fold) | none | none | `harmony.js` `voiceLeadFrom` | — |

### Per-bar

| Choice point | Plant input | Randomness | Consumer | Mood key |
|---|---|---|---|---|
| Left-hand bar texture (pedal / broken / chord / walk, or the song's figure) | energy, stability | weighted per bar | `lefthand.js` `refillBassBar` | `handsChords` `lhFigure` `lhShare` |
| Chromatic approach into the coming root; the anticipating push | none | the bassist's leans (identity in the free rooms) | `lefthand.js` | `bassWindow` `bassPresence` |
| Sub under the drone (`ppSubHeld`) | none | none | `voices.js` `padHoldBar` | `subLevel` |
| Pad: held voices cross-fading between chords (no portamento) | energy (the amp law); the live signals for the breath | none | `voices.js` `padPlayerBody` `padHoldBar` | `padLevel` `padHold` `padOctave` `padSynth` `padComp` `padPool` |
| The cello's bow plan per four-bar group, sit-outs, the retune under the bow at a change | energy (the amp law) | the cellist's leans | `strings.js` `stringsPlayerBody` | `stringsLevel` `celloLift` |
| Arc intensity | `sigOver(75 or 300, energy)` body plateau | none | `arc.js` | `introBars` `outroBars` |
| Swing map (one map for every grid player; 0 in both free rooms) | none | none | `lifecycle.js` `swingAt` | `drumSwing` |

### Per-note

| Choice point | Plant input | Randomness | Consumer | Mood key |
|---|---|---|---|---|
| Phrase plan: length, contour, register centre, span, density | tilt → contour; center → register; energy → density (capped) | weighted | `improv.js` `planPhrase` | `phraseBarsMax` `rhDensityCap` `regDrop` `phraseFeel` |
| Register window: every right-hand pitch folds into `[lo, hi]` MIDI | none | none | `improv.js` `rhMidi` | `rhWindow` |
| Note source: the motif form / a recalled cell / a lick / the free walk; direction persistence and runs | weather → recall probability | coins | `improv.js` | `motifForm` `lickSeed` `lineRun` `themeHold` `hookJury` `phraseTargets` `periodForm` |
| Chord-tone snap on strong beats, lead-in before a change (role weights: 3rd 1.0, 7th 0.9, 9th/11th/sus 0.8, 6th 0.7, root 0.55) | none | weighted | `improv.js` `chordRoleW` | — |
| Velocity: the shaped sum → Salamander layer 1..16 (the web pack carries three, crossfaded) | energy widens the gaussian | gaussian | `improv.js`, `audio/piano.js` | `dynWide` |
| Duo / cello answer | weather > 0.55 or `sigOver(300, energy)` > 0.6 arms; the cello by draw | coins | `improv.js` `duoConsider` | `duo` `duoSynth` `stringsProb` |
| Note amplitude | energy (the only loudness driver) | none | every voice | `rightHandLevel` `leftHandLevel` `padLevel` `stringsLevel` `masterTrim` |
| The master chain: room, mix, damp, the low-cut, the ceiling, the tape | none | none | `audio/master.js` | `fxRoom` `fxMix` `fxDamp` `fxVerb` `fxHpf` `fxLpf` `fxWarp` |

## Negative space: deliberate absences, with reasons

- **No drummer.** `drumLevel` is 0 in both free rooms; lofi's kits (IQ Samples, the three unattributed one-shot kits) and its Loopcloud Play voices are licensed, so that room stays on the live stream. The kit keys (`drumLevel` `drumFeel` `drumFeelPool` `kitPool` `vinylLevel` `rainLevel`) are data with no reader here: the gate names the hole every run.
- **No Tone.js.** The repo's name is history. The instruments are the live SynthDefs node for node in plain Web Audio on the browser's own `AudioContext`; Tone's wrapper context lacked a buffer source's `detune`, and the port never needed its abstractions.
- **No chromatic chords.** The walk is scale-degree based; modal colour comes from the scale pool and the mode-colour boost.
- **No spike consumer, no jitter micro-signal.** Fast texture folds into `sig.energy` (τ 4 s) plus free per-note randomness.
- **No guest voices.** A new instrument takes an existing player's chair (`rhPool`, `padPool`), never its own player.
- **No comps coin.** `pianoCompProb` is 0; the pianist has two hands by `handsChords`.
- **No stored phrases.** Every cell is generated or remembered within the track; the hook history only forbids repeats across songs.
- **No plant-seeded randomness.** The plant sets parameters; randomness stays free (tests inject a seeded generator, production uses `Math.random`).
- **No server-side recordings, posters, streams or accounts.** Those belong to the live site. The page records what you hear to a `.webm` and posts each take's note log to `POST /api/take` (and can save it), which is what `tools/take-review` reads.
- **No ch2/ch3 wiring.** Only ch1 is heard.

## Receipts

The port is checked headlessly (`node --test "tests/*.test.mjs"`, on a virtual clock with a synthetic plant and a fake audio layer) against the live project's own receipts: after a day the second day's energy median lands in 0.40–0.55 by construction and a dead-flat day reads weather 0.5; every chord tone of every dwell is in the scale; voice leading moves by at most a 4th or folds an octave; the fade room lands its one 8-bar tonic pedal; drift's take is held breath voices and a sub and nothing else, seamless across the boundary; the piano's right hand stays in `rhWindow`, freezes a hook at the body's opening and states it at the chorus; the left hand's bars always sum to four beats; six songs seat a cellist between one and five times at `stringsProb` 0.5, between the left hand and the melody. On real takes, `tools/take-review energy | harmony | melody | cello` prints the live tool's numbers from the page's own note logs.
