# PlantPulse

**Your plant is making music right now. You just can't hear it yet.**

PlantPulse captures the invisible bioelectrical signals flowing through living plants and transforms them into real-time generative music. Every note, every rhythm, every chord change is driven by your plant's actual electrical activity — not random, not pre-programmed, genuinely alive.

![PlantPulse Dashboard](docs/screenshot.png)

**[Listen Live](https://plantpulse.hook.technology)** — a hibiscus tree performing right now

---

## What You're Hearing

Plants produce microvolt-level electrical fluctuations across their leaves — tiny signals caused by ion transport, light response, touch, temperature changes, and processes we don't fully understand yet. PlantPulse reads these signals at 16-bit resolution and uses them as the DNA for a full generative music system.

The plant doesn't just modulate a filter or pick random notes. It:

- **Seeds the musical motif** — a short melodic theme sampled from the plant's state at that moment, becoming the hook for an entire "track"
- **Conducts the ensemble** — active plant promotes fills and arps, quiet plant lets the lead play solo
- **Triggers section changes** — a spike in activity can push the music from verse to chorus
- **Crossfades between instruments** — calm plant gets a warm mellow lead, active plant gets a brighter, more energized voice layered on top
- **Writes new songs over time** — every 5-10 minutes, the motif regenerates from the plant's current state, the key modulates, and a genuinely new track begins

The result is music that evolves over hours. Leave it running and come back — it won't sound the same. Your plant is composing.

## The Signal Chain

```
Plant leaf ──→ Alligator clips ──→ ADS1115 16-bit ADC (±256mV, 4 samples/sec)
                                        │ I2C
                                   ESP32-WROOM-32D
                                        │ WiFi + MQTT
                                   Mosquitto broker
                                        │
                                   Flask server (SSE proxy, no credentials exposed)
                                        │ Server-Sent Events
                                   Browser
                                        │
                                   Generative Synth Engine (Tone.js / Web Audio API)
```

**~$15 in hardware. No cloud services. Runs entirely on your local network.**

## The Synth Engine

This isn't a simple "voltage → pitch" mapper. PlantPulse is a full generative music system with:

### Per-Instrument Signal Chains
Every preset has **6 independent instruments** (lead, lead_active, pad, bass, arp, fill), each with its own synth type, filter, envelope, distortion, and panner. The lead and lead_active crossfade based on plant activity — the plant literally chooses which instrument is playing.

### 5 Drum Kits + 8 Drummers
Each preset gets a unique **drum kit** (LinnDrum, chiptune NES, jazz brushes, bitcrushed lo-fi, tight modern) played by a unique **drummer personality** (The Machine, The Kid, The Cat, The Professor, The Preacher, The Rocker, The Robot, The Ghost) — each with its own swing, ghost note probability, variation tendency, and fill style.

### Motif DNA System
At each track start, the plant's current electrical state is sampled to generate a **motif** — a short melodic theme that becomes the riff, the bass line hook, and the phrase generator's reference. Motif variations (transposed, inverted, fragmented, ornamented) rotate per section. The bass riff plays the same motif pitches on a genre-specific rhythm template, creating a unified musical identity where melody and bass are siblings of the same plant-seeded idea.

### Song Structure
Presets define full **arrangements** — intro, verse, chorus, breakdown sections with per-section voice levels, drum styles, motif variations, octave shifts, and entry accents. Breakdowns use "cut" drops (sudden silence) at varied lengths (1-4 bars) per preset for genre-appropriate tension/release.

### Track Lifecycle
After 5-12 minutes (preset-dependent), the current "track" ends: master fades down, 2 bars of silence, then a **new motif regenerates from the plant's current state** and the **key modulates** through a hand-picked pool of related keys. The music keeps flowing like tracks on an album — same preset vibe, genuinely different composition.

### Plant-Driven Mixing
The plant acts as a **real-time conductor**: active plant promotes fills and arps while dimming the lead, quiet plant returns to sparse solo feel. This happens continuously, not just at section boundaries. Combined with the dual-lead crossfade, the plant controls both *who plays* and *how they sound*.

## 14 Presets, Each a Different Band

| Preset | Vibe | Key Feature |
|--------|------|-------------|
| Default | Balanced generative | Good starting point |
| Bells | Sparkling, percussive | High-res resonant pings |
| Pad | Massive detuned wash | Eno-style ambient |
| Pluck | Sharp bouncy arps | Fast scalar runs |
| Wind | Breathy, filter-heavy | LFO-driven movement |
| Glass | Inharmonic, resonant | Near-self-oscillation drips |
| Ethereal | Cathedral reverb | 20s decay, vast space |
| Organic | Warm, gritty, earthy | Gospel pocket drumming |
| Synth Wave | 80s analog drive | LinnDrum + fat saws |
| Crystal Cave | Sparse, huge echoes | Dripping cave reverb |
| Midnight | Dark, minimal | Deep sub foundation |
| Circuit | Chiptune 8-bit | NES noise channel drums |
| Piano | FM piano + brushes | DX7-style hammer attack |
| Lo-Fi | Chill dusty beats | Dilla ghost notes + vinyl crackle |

Each preset has its own drummer, drum kit, bass riff template, instrument signal chains, arrangement structure, key rotation pool, and track duration. No two presets share the same musical identity.

## Hardware

### What You Need

| Part | Description | Cost |
|------|-------------|------|
| ESP32-WROOM-32D | WiFi microcontroller | ~$5 |
| ADS1115 | 16-bit I2C ADC with PGA | ~$3 |
| Soft alligator clips | Electrode clips for leaves | ~$2 |
| Breadboard + jumpers | Prototyping | ~$5 |

**Total: ~$15**

### Wiring

```
ADS1115          ESP32
───────          ─────
VDD ──────────── 3.3V
GND ──────────── GND
SCL ──────────── GPIO 22
SDA ──────────── GPIO 21
ADDR ─────────── GND (I2C address 0x48)
A0 ───────────── Alligator clip 1 (leaf)
A1 ───────────── Alligator clip 2 (leaf)
```

The ADS1115 reads the **differential voltage** between the two clips at ±256mV gain — sensitive enough to pick up the microvolt-level signals plants produce.

### Multi-Channel Support

PlantPulse supports up to **3 differential channels** across 2 ADS1115 chips (6 electrodes total). The patch bay lets you route any channel to any synth parameter — each electrode pair can drive a different instrument's filter.

## Software Setup

### Prerequisites
- [ESPHome](https://esphome.io/) for flashing the ESP32
- An MQTT broker ([Mosquitto](https://mosquitto.org/))
- Docker for the server

### 1. Flash the ESP32

```bash
cp secrets.yaml.example secrets.yaml
# Edit secrets.yaml with your WiFi and MQTT credentials
esphome run plantpulse.yaml
```

### 2. Deploy the Server

```bash
cat > .env << EOF
MQTT_USER=plantpulse
MQTT_PASS=your-mqtt-password
EOF

docker compose up -d
# Dashboard available on port 8286
```

### 3. Open the Dashboard

Navigate to `http://your-server:8286`, click **Connect**, then **Play**. The plant starts performing immediately.

For public access behind nginx, enable SSE support:

```nginx
location /api/stream {
    proxy_pass http://localhost:8286;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400;
    proxy_set_header X-Accel-Buffering no;
}
```

## Architecture

**Dumb sensor, secure server, smart client.**

- **ESP32** reads the ADC, publishes raw voltage over MQTT. Nothing else.
- **Flask server** subscribes to MQTT (credentials server-side only), relays to browsers via SSE, serves the UI, provides a history API via TimescaleDB.
- **Browser** does all synthesis, visualization, and interaction using Tone.js and the Web Audio API.

The entire synth engine runs client-side. The server is a thin MQTT→SSE bridge. Your plant data never leaves your network unless you choose to expose the dashboard.

## Features

- Real-time signal visualization with Chart.js (raw + smoothed traces, activity level, oscilloscope)
- 14 preset buttons with instant switching and full state persistence to localStorage
- Modulation patch bay with drag-and-drop cable routing (18 sources × 38 targets)
- XY morph pad for manual parameter control
- WebMIDI output to external DAWs and hardware synths
- Audio recording to WebM/Opus with direct download
- Historical data viewer with TimescaleDB (time-bucketed aggregates)
- Mobile-optimized frequency design (all instruments have harmonics above 200Hz)

## License

MIT
