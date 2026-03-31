# PlantPulse

A DIY plant bioelectrical sonification system — listen to your plants make music in real-time.

PlantPulse reads microvolt-level bioelectrical signals from plant leaves using an ADS1115 16-bit ADC, streams the data via MQTT, and transforms the signal into generative music through a modular synthesizer built on the Web Audio API.

![PlantPulse Dashboard](docs/screenshot.png)

**[Live Demo](https://plantpulse.hook.technology)** — listen to a hibiscus tree make music in real-time

## How It Works

```
Plant leaf --> Alligator clips --> ADS1115 (16-bit ADC, +/-256mV)
                                      | I2C
                                 ESP32-WROOM-32D --> MQTT --> Mosquitto broker
                                                                   |
                                                             Flask server (SSE proxy)
                                                                   |
                                                              Browser (Tone.js)
                                                                   |
                                                             Modular Synth Engine
```

1. **Bioelectrical signal capture**: Soft alligator clips attach to a plant leaf, picking up microvolt-level electrical fluctuations
2. **Signal digitization**: The ADS1115 reads the differential voltage between the two clips at 4 samples/sec with 16-bit resolution (±256mV range)
3. **Data streaming**: The ESP32 publishes raw voltage readings over MQTT. The Flask server subscribes to MQTT and relays data to browsers via Server-Sent Events — no MQTT credentials are exposed to the client
4. **Sonification**: A modular synthesizer in the browser uses the plant's voltage, smoothed signal, and activity level as control voltage to drive oscillators, filters, effects, percussion, and melody generation

## The Synthesizer

PlantPulse includes a full modular synthesizer where the plant's bioelectrical signal acts as control voltage — like patch cables on a Moog.

### Signal Processing

The plant's raw voltage is processed into several control signals:

| Signal | Description | Typical Range |
|--------|-------------|---------------|
| **Raw** | Sliding window average of last 5 MQTT readings | -20 to +5 mV |
| **Smoothed** | Exponential moving average (alpha 0.1) | Slowly follows raw |
| **Activity** | Rate of change, spike-protected | 0-100% (usually 0-15%) |

### Synth Architecture

Two oscillators feed through a shared filter/effects chain:

```
[OSC 1] --> [Gain] --+
                      +--> [Filter] --> [Panner] --> [Distortion] --> [Chorus]
[OSC 2] --> [Gain] --+                                                   |
                                                                    [Delay] --> [Reverb] --> [Master Gain]
                                                                                                  |
                                                                          [Stereo Widener] --> [EQ] --> [Compressor] --> [Limiter] --> Speakers
                                                                                                  |
[Sub-bass Synth] -----------------------------------------------------------> [Limiter]

[Kick + Click] --+
[Snare + Body]   +--> [Perc Gain] --> [Drum Compressor] --> [Master Gain]
[Hi-hat]         |
[Rim]           -+
[Bass Synth] --> [Bass Gain] --> [Master Gain]
```

### Modulation Matrix

Each synth parameter can be modulated by any plant signal source:

- **plant_raw**: Voltage position (always has a value — the plant is always *somewhere*)
- **plant_smooth**: EMA-filtered voltage (slower, more stable)
- **plant_activity**: Rate of change (spiky, responds to movement)
- **lfo1 / lfo2**: JavaScript-side LFOs for cyclic modulation

Modulation depth is configurable per-parameter per-preset. The pan knob, filter cutoff, oscillator levels, reverb wet, delay feedback, distortion, and chorus can all be driven by the plant.

### Presets

13 factory presets, each with unique synth configuration, modulation routing, drum patterns, melody style, and tempo:

| Preset | Character | Mode | Perc | Tempo |
|--------|-----------|------|------|-------|
| Default | Balanced starting point | Drone | Off | 85 |
| Bells | Sparkling, percussive, wide leaps | Generative | Off | 75 |
| Pad | Massive detuned wash, Eno-style ambient | Drone | Off | 70 |
| Pluck | Sharp attack, fast scalar runs, dry | Arp | On | 95 |
| Wind | Breathy, filter-heavy, LFO-driven | Drone | Off | 65 |
| Glass | Inharmonic, resonant, sparse drips | Spike | Off | 70 |
| Ethereal | Deep reverb cathedral, slow chorus swirl | Drone | Off | 60 |
| Organic | Warm, distorted, gritty, earthy | Generative | On | 80 |
| Synth Wave | Bright, driving, punchy saws, 80s analog | Generative | On | 110 |
| Crystal Cave | Sparse, huge reverb + delay, dripping echoes | Spike | Off | 65 |
| Midnight | Dark, minimal, spacious, restrained | Drone | Off | 60 |
| Circuit | Chiptune, clean square waves, 8-bit | Arp | On | 120 |
| Piano | Piano + cello, lyrical, concert hall | Generative | Off | 72 |

### Percussion

A pattern-based drum sequencer with 16-step grid:

- **5 instruments**: Kick (layered with mid-frequency click), snare (tonal body + noise), hi-hat, rim, bass synth
- **Per-preset drum recipes**: Pluck (bouncy, syncopated), Organic (swung, shuffled), Synthwave (four-on-floor), Circuit (broken, glitchy)
- **5 density tiers**: Plant activity selects pattern complexity, locked per bar
- **Sidechain ducking**: Kick briefly pumps down the synth bus
- **Drum bus compressor**: Separate from master, optimized for punch

### Melody Generation

Activity-triggered melodic phrases with per-preset interval styles:

- Phrases generate when plant activity spikes, then play out on the beat grid
- Note selection uses weighted probabilities (stepwise, thirds, leaps, repeats) — not linear signal mapping
- Signal direction biases upward vs downward motion but doesn't dictate it
- Last note resolves toward stable chord tones (root, 3rd, 5th)
- Each preset defines its own melody character (Bells = wide leaps, Pluck = fast scalar runs, Piano = lyrical, Circuit = rapid bursts)

### Stereo Enhancement

- **Stereo widener**: Slow chorus on master bus creates spatial width
- **Sub-bass synth**: Pure sine an octave below bass notes (for full-range speakers)
- **Low shelf EQ**: +4dB warmth below 200Hz
- **Stereo ping-pong**: Reverb tails bounce between L/R speakers
- **Plant-controlled panning**: Voltage position sweeps the stereo field

### WebMIDI Output

PlantPulse can send MIDI to external DAWs and hardware synths:

- Note On/Off messages on configurable MIDI channel
- CC messages: CC1 (raw signal), CC2 (smoothed), CC11 (activity), CC74 (activity)
- Output modes: Audio only, MIDI only, or both
- Enable in the Synth Panel → MIDI section

**Tip**: Route to Logic Pro's Alchemy via the IAC Driver for world-class sounds driven by plant signals.

## Hardware

### Components

| Part | Description | Approx Cost |
|------|-------------|-------------|
| ESP32-WROOM-32D | WiFi microcontroller | ~$5 |
| ADS1115 | 16-bit I2C ADC with PGA | ~$3 |
| Soft alligator clips | Electrode clips for plant leaves | ~$2 |
| Breadboard + jumper wires | For prototyping | ~$5 |

**Total: ~$15**

### Wiring

```
ADS1115          ESP32-WROOM-32D
-------          ---------------
VDD ----------- 3.3V
GND ----------- GND
SCL ----------- GPIO 22
SDA ----------- GPIO 21
ADDR ---------- GND (sets I2C address to 0x48)

A0 ------------ Alligator clip 1 (plant electrode)
A1 ------------ Alligator clip 2 (plant electrode)
```

> **Important**: Use GPIO numbers, not the "D" labels printed on some dev boards — they may not match!

## Software Setup

### Prerequisites

- [ESPHome](https://esphome.io/) (for flashing the ESP32)
- An MQTT broker (e.g., [Mosquitto](https://mosquitto.org/))
- Docker (for the server)

### 1. Flash the ESP32

```bash
cp secrets.yaml.example secrets.yaml
# Edit secrets.yaml with your WiFi and MQTT credentials
esphome run plantpulse.yaml
```

### 2. Configure MQTT Broker

Ensure your Mosquitto broker is running. Create credentials:

```bash
mosquitto_passwd -c /mosquitto/config/passwords plantpulse
```

### 3. Deploy the Server

The server handles MQTT subscription, SSE streaming to browsers, and the history API.

```bash
# Create .env with your MQTT credentials
cat > .env << EOF
MQTT_USER=plantpulse
MQTT_PASS=your-mqtt-password
EOF

# Start with Docker
docker compose up -d
# Dashboard available on port 8286
```

For public access behind a reverse proxy (nginx), configure SSE support:

```nginx
location /api/stream {
    proxy_pass http://localhost:8286;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 86400;
    proxy_set_header X-Accel-Buffering no;
}
```

### 4. Configure Plant Identity

Edit `static/config.json` with your plant's name:

```json
{
  "plantName": "Your Plant",
  "plantType": "Species",
  "location": "Room"
}
```

## Architecture

The design philosophy is **dumb sensor, secure server, smart client**:

- **ESP32**: Reads the ADS1115 and publishes raw voltage over MQTT. Nothing else.
- **Flask server**: Subscribes to MQTT (credentials stay server-side), relays data to browsers via SSE, serves the web UI, provides history API via TimescaleDB.
- **Browser**: All synthesis, visualization, and interaction happens client-side using Tone.js and the Web Audio API.

### Data Collection

A separate collector service (`plantpulse-collector`) subscribes to the same MQTT topic and writes readings to TimescaleDB for historical analysis. The history viewer is available at `/history`.

### Sequencer Simulator

`simulate.py` replays captured plant signal data through different sequencer configurations offline, allowing rapid iteration on beat distribution and note placement without needing the browser.

```bash
python3 simulate.py --url http://localhost:8286
```

## Features

### Signal Visualization
- Raw and smoothed (EMA) signal traces with Chart.js
- Auto-scaling chart with 30s / 1m / 2m / 5m time windows
- Min/max range and 60-second rolling average
- Plant activity level indicator
- Audio waveform oscilloscope (when playing)

### Music Controls
- 13 preset buttons with copper-highlighted active state
- Scale selection (Pentatonic, Major, Minor, Dorian, Mixolydian, Whole Tone)
- Root note (C through B)
- Sequencer mode (Drone, Generative, Arp, Spike)
- Master tempo (60-140 BPM)
- Percussion and melody toggles
- Synth panel with full knob control and modulation routing

### Recording
- Record browser audio to WebM/Opus format
- Download recordings directly from the UI

### State Persistence
- All settings (synth params, mod routing, scale, root, preset, percussion, melody, tempo) persist to localStorage
- Returns to exactly where you left off on next visit

## TODO

- [ ] Test MIDI output to Logic Pro Alchemy via IAC Driver
- [ ] Evolution engine — slowly morphing instrumentation over 10-20 minute cycles
- [ ] Custom user presets (save/load to localStorage)
- [ ] Mobile touch support for synth knobs
- [ ] Update MUSIC.md to reflect current synth architecture

## Troubleshooting

### I2C scan shows "Found no devices"
- Double-check SDA to GPIO21 and SCL to GPIO22 (not swapped)
- Verify ADS1115 ADDR pin is connected to GND
- Ensure ADS1115 VDD is connected to 3.3V (not 5V)

### No signal data in browser
- Check that the Flask server can reach the MQTT broker (they must share a Docker network)
- Verify MQTT credentials in `.env` match the broker's password file
- Check server logs: `docker logs plantpulse`

### ESP32 becomes unresponsive
- Keep `logger: level: WARN` (debug logging over WiFi causes lag)
- 250ms update interval is the sweet spot for WiFi stability

### Signal reads ~0mV with no plant
- This is correct! The noise floor is ~0.015 mV — essentially zero without a biological signal source

### Audio clipping or distortion
- Each preset has a calibrated amp_level. If you've tweaked knobs, use "Reset" to restore defaults
- The master limiter prevents hard clipping, but stacking effects (high reverb + delay feedback) can cause density buildup

## License

MIT
