# PlantPulse — Music Engine Reference

All configuration lives in `static/index.html`. This doc maps every tunable value.

---

## Signal Processing

| Parameter | Value | Description |
|-----------|-------|-------------|
| `RAW_WINDOW_SIZE` | 5 | Sliding window for raw MQTT values before processing |
| `EMA_ALPHA` | 0.1 | Exponential moving average smoothing (0 = no change, 1 = no smoothing) |
| Activity formula | `min(100, (delta / 15) * 100)` | Rate of change as percentage, delta = abs(current - previous) |

## Tempo System (Hybrid)

Base BPM comes from zero-crossing detection of the plant signal. Activity modulates it upward.

```
effectiveBPM = min(160, baseBPM + currentActivity * bpmEnergy)
```

| Parameter | Value | Description |
|-----------|-------|-------------|
| `detectedBPM` default | 40 | Starting BPM before first detection |
| BPM clamp | 20–120 | Raw zero-crossing BPM range |
| Effective BPM cap | 160 | Maximum after activity boost |
| `bpmEnergy` default | 3 | How much activity amplifies tempo (UI: 1–5) |
| Smoothing | 0.7/0.3 | `detectedBPM = old * 0.7 + new * 0.3` |
| Zero-crossing window | 20 crossings (10 cycles) | Kept for averaging |
| Min crossings | 4 (2 cycles) | Before estimation begins |

**Energy dropdown labels:** 1=Calm, 2=Gentle, 3=Balanced, 4=Lively, 5=Intense

**Example effective BPMs** (base 20, energy 3):

| Activity | Boost | Effective BPM | Beat interval |
|----------|-------|---------------|---------------|
| 0 | 0 | 20 | 3000ms |
| 5 | 15 | 35 | 1714ms |
| 11 | 33 | 53 | 1132ms |
| 20 | 60 | 80 | 750ms |
| 30 | 90 | 110 | 545ms |
| 45+ | 135+ | 160 (capped) | 375ms |

## Gain Structure

```
masterGain (0.6) ──► toDestination()
  ├── reverb (decay:5, wet:0.4) ──► masterGain
  │     ├── delay (time:'8n.', feedback:0.25, wet:0.2) ──► reverb
  │     │     ├── melodyGain (0.5)
  │     │     └── arpGain (0.3)
  │     ├── bassGain (0.35)
  │     ├── chimeGain (0.4)
  │     └── padGain (0.15)
  │           └── ambientFilter (LFO 0.05Hz, base 200Hz, 3 oct)
  │                 └── ambientPad (PolySynth)
  └── drumGain (0.35)
        ├── kickSynth (MembraneSynth)
        └── hihatFilter (8kHz highpass)
              └── hihatSynth (NoiseSynth)
```

Note: Each preset may create additional custom effects that route through masterGain. Those are tracked in `customEffects[]` and disposed on voice switch.

## Layer Trigger Logic

### Bass
- Fires every **4 beats**
- Only triggers if note has **changed** from last bass note
- Uses `currentSmoothed` mapped to octave offset -1
- Attack velocity: 0.3 (fixed)

### Melody
- Fires every **1 beat**, with probabilistic skip:

| Activity | Play chance | Skip chance |
|----------|-------------|-------------|
| > 20 | 55% | 45% |
| 10–20 | 35% | 65% |
| < 10 | 15% | 85% |

- Velocity: `0.15 + min(activity / 25, 0.7)` — range 0.15–0.85
- Duration by activity: >10 = 8th, >5 = quarter, else half note
- Uses `currentRawValue` for note mapping

### Arpeggio
- **Activity threshold: 15** — silent below this
- Speed tiers:

| Activity | Note speed | Interval |
|----------|------------|----------|
| < 15 | silent | — |
| 15–25 | quarter notes | beatInterval |
| 25–50 | 8th notes | beatInterval / 2 |
| > 50 | 16th notes | beatInterval / 4 |

- Chord: 4 tones at intervals [0, 2, 4, 7] from base index
- Velocity: `0.15 + min(activity / 10, 0.5)` — range 0.15–0.65
- Duration: 16th note (fixed)

### Chimes
- Triggered by **signal spikes** (not beat-based)
- Spike threshold: **10% of signal range**
- Minimum gap: **1500ms** (~0.7 chimes/sec max)
- Velocity: `min(0.3 + delta/range, 0.8)`
- Double chime at 2x spike threshold, +80ms delay, half velocity
- Uses `currentRawValue` mapped to octave offset +1 (and +1.5 for double)

### Drums
- 4-beat cycle, `drumStyle` controls behavior per preset

**Kick:**

| Activity | Pattern | Velocity |
|----------|---------|----------|
| < 5 | beat 0 only | 0.15 |
| >= 5 | beats 0 & 2 | `0.08 + min(activity/100, 0.12)` |

- Note: C2 (65Hz), duration: 8th note

**Hi-hat** (only when `drumStyle === 'gentle'`):

| Condition | Pattern | Velocity |
|-----------|---------|----------|
| activity >= 5 | every beat | `0.08 + min(activity/100, 0.15)` |
| activity > 20 | + ghost 8th notes | 0.06 |

### Ambient Pad
- Updates every **8 beats**
- Plays 2–3 note chord (base + 3rd + 5th from scale)
- Only re-triggers when chord **changes**
- Attack velocity: 0.12 (fixed)
- Brown noise bed: gain 0.03 through 400Hz lowpass
- AutoFilter LFO: `0.02 + min(activity/80, 0.13)` Hz, ramp 2s

## Preset Configurations

### drumStyle per preset

| Preset | drumStyle | Drums behavior |
|--------|-----------|----------------|
| Bells | minimal | kick only |
| Soft Pad | minimal | kick only |
| Pluck | gentle | kick + hihat |
| Wind | minimal | kick only |
| Glass | minimal | kick only |
| Ethereal | none | silent |
| Organic | gentle | kick + hihat |
| Synth Wave | gentle | kick + hihat |
| Crystal Cave | none | silent |
| Rainforest | gentle | kick + hihat |
| Midnight | minimal | kick only |
| Circuit | gentle | kick + hihat |

### Preset effect chains

| Preset | Custom effects | Character |
|--------|---------------|-----------|
| Bells | Phaser (0.5Hz, 3oct, wet 0.3) on melody | Metallic shimmer |
| Soft Pad | Chorus (0.2Hz, depth 0.9, wet 0.7), Reverb (8s, wet 0.7) | Thick ambient wash |
| Pluck | Reverb (1.5s, wet 0.2) | Dry, percussive strings |
| Wind | AutoFilter (0.1Hz, 4oct, wet 0.8), Tremolo (2Hz, depth 0.5, wet 0.6) | Breathy, airy |
| Glass | Freeverb (roomSize 0.9, damp 3kHz, wet 0.5) | Crystalline, spacious |
| Ethereal | Reverb (10s, wet 0.85), Chorus (0.3Hz, wet 0.6), Delay (4n., fb 0.4, wet 0.35), LP filter 2kHz on chimes | Dreamy wash |
| Organic | Distortion (0.1, wet 0.3), AutoWah (base 200Hz, 4oct, wet 0.4) | Warm, woody |
| Synth Wave | Chorus (1.5Hz, depth 0.7, wet 0.5) | Retro analog |
| Crystal Cave | Reverb (15s, wet 0.8), Delay (4n, fb 0.6, wet 0.5) | Cavernous echo |
| Rainforest | Bandpass noise (800Hz, LFO 0.08Hz 400–1200), Delay (120ms, fb 0.3, wet 0.3) on chimes | Nature soundscape |
| Midnight | Delay (2n, fb 0.55, wet 0.45), LP filter 2kHz | Dark, sparse |
| Circuit | BitCrusher (7-bit), Distortion (0.3, wet 0.4) | Digital lo-fi |

## Telemetry

Console logs every 10 seconds while music is playing. Shows per-layer:
- Triggers per 10s and 60s
- Average gap between triggers (ms)
- Skipped attempts (gated by thresholds)

Check browser console (F12) to see live data.
