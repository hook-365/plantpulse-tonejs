# PlantPulse — Claude Code Context

## What This Is

PlantPulse reads bioelectrical signals from living plants via an ESP32 + ADS1115 ADC and transforms them in real-time into generative music. The plant acts as a live conductor — seeding melodic motifs, controlling ensemble dynamics, triggering section changes, and crossfading between instruments. It's running live at `plantpulse.hook.technology` with a hibiscus tree performing continuously.

## Architecture

**Signal chain:**
```
Plant leaf → alligator clips → ADS1115 (16-bit I2C ADC, ±256mV)
  → ESP32-WROOM-32D (WiFi + MQTT)
  → Mosquitto broker
  → Flask server (SSE proxy, history API, TimescaleDB)
  → Browser (Tone.js / Web Audio API synth engine)
```

**Key design principle: Dumb sensor, secure server, smart client.**
- ESP32 publishes raw voltage only. No credentials on the device.
- Flask server holds MQTT credentials, bridges to SSE, serves the UI.
- All synthesis, visualization, and music logic runs client-side in the browser.
- Plant data never leaves the local network unless the dashboard is intentionally exposed.

## Repository Structure

```
plantpulse/
├── index.html          # MAIN FRONTEND — entire synth engine (~144KB, all client-side)
├── server.py           # Flask: SSE bridge, TimescaleDB history API
├── simulate.py         # Signal simulator for dev/testing without hardware
├── plantpulse.yaml     # ESPHome config for the ESP32
├── docker-compose.yml  # Deployment: Flask + TimescaleDB + Mosquitto
├── Dockerfile          # Flask container
├── config.json         # Plant identity config (name, type, location) — served publicly
├── secrets.yaml        # MQTT credentials (gitignored)
├── secrets.yaml.example
├── requirements.txt
├── static/             # Static assets served by Flask
├── docs/               # Screenshots, documentation assets
├── history/            # Historical data exports
├── MUSIC.md            # Full music engine parameter reference (signal math, layer logic, presets)
└── README.md           # Full project documentation including hardware wiring
```

> **Note:** `index.html` is currently at the repo root but is served from `static/` by Flask. Check `server.py` `send_from_directory` calls if the static layout changes.

## Server (`server.py`)

Flask app on port `8286`.

**Routes:**
- `GET /` → `static/index.html` (main dashboard)
- `GET /history` → `static/history.html`
- `GET /stream` → `static/stream.html` (OBS browser source, no controls)
- `GET /api/stream` → SSE stream (MQTT → browser fan-out via per-client Queue)
- `GET /api/data` → TimescaleDB signal history (auto-resolution based on time range)
- `GET /api/range` → Available data time range
- `GET /api/stats` → Summary stats for a time range
- `GET /api/hourly` → Hourly aggregates
- `POST /api/music-log` / `GET /api/music-log` → Circular buffer of note events from client
- `GET /api/music-log/stats` → Note frequency, timing stats
- `POST /api/signal-log` / `GET /api/signal-log` → Signal snapshot buffer
- `GET /config.json` → Plant config (no credentials)

**MQTT topics:**
- `plantpulse/sensor/plant_signal/state` → `ch1` (Chip 1 A0–A1)
- `plantpulse/sensor/plant_signal_2/state` → `ch2` (Chip 1 A2–A3)
- `plantpulse/sensor/plant_signal_3/state` → `ch3` (Chip 2 A0–A1, TENS pads)

**SSE heartbeat:** Sends `{"hb": 1}` every 5s when MQTT is quiet so the client watchdog doesn't false-positive on silent plant periods.

**Workers:** Compatible with gunicorn gevent workers (uses `gevent.queue.Queue` when available).

## Synth Engine (`index.html`)

The entire music system is client-side JavaScript using Tone.js and the Web Audio API.

### Signal Processing
- Raw MQTT values → sliding window (size 5) → EMA smoothing (α=0.1)
- Activity = `min(100, (delta / 15) * 100)` where delta = abs(current − previous)
- BPM from zero-crossing detection, clamped 20–120, boosted by activity × bpmEnergy
- Effective BPM cap: 160

### Layers
- **Bass** — fires every 4 beats, only when note changes, maps smoothed signal to octave
- **Melody** — probabilistic per beat (15–55% based on activity), velocity 0.15–0.85
- **Arp** — activity threshold 15, speed tiers (quarter/8th/16th at 15/25/50 activity)
- **Chimes** — spike-triggered (10% of signal range), 1500ms min gap
- **Ambient pad** — updates every 8 beats, 2–3 note chords, brown noise bed
- **Drums** — 4-beat cycle, per-preset drumStyle (none/minimal/gentle)

### Motif DNA System
At each track start, plant state seeds a short melodic motif that becomes the shared identity for melody, bass, and phrase generation. Motif variations (transposed, inverted, fragmented, ornamented) rotate per section. After 5–12 minutes, the track ends, a new motif regenerates from current plant state, and the key modulates through a preset-defined pool.

### Presets (14 total)
Each preset defines: synth types, effect chains, drum kit, drummer personality (swing, ghost note probability, fill style), bass riff template, arrangement structure, key rotation pool, and track duration. No two presets share a musical identity.

Current presets: Default, Bells, Pad, Pluck, Wind, Glass, Ethereal, Organic, Synth Wave, Crystal Cave, Midnight, Circuit, Piano, Lo-Fi.

See `MUSIC.md` for full parameter tables.

### Multi-Channel Support
Up to 3 differential channels across 2 ADS1115 chips. Patch bay in UI routes any channel to any synth parameter.

## Active Development Focus

### Server-Gated Presets (Monetization Path)
The current concern: all 14 presets + the full synth engine are visible in `index.html` via view source. The planned approach is **server-gated presets**:
- Preset *configs* (synth params, effect chains, arrangement structures) move to the server behind an auth/tier check
- Synthesis engine stays client-side (latency matters for real-time plant music)
- Free tier: Default + 2–3 presets
- Paid tier: all presets + future preset packs
- The motif DNA system and core signal processing remain in the client

This is the primary architectural change being explored. When working on this:
- Preset configs should be extracted from `index.html` into a structured format (JSON per preset)
- A new Flask endpoint (e.g. `GET /api/presets`) serves configs based on auth token
- The client fetches available presets on load rather than having them hardcoded

## Hardware

| Part | Role | Cost |
|------|------|------|
| ESP32-WROOM-32D | WiFi MCU, ADC reader, MQTT publisher | ~$5 |
| ADS1115 | 16-bit I2C ADC, ±256mV gain | ~$3 |
| Alligator clips | Leaf electrodes | ~$2 |

Wiring: ADS1115 VDD→3.3V, GND→GND, SCL→GPIO22, SDA→GPIO21, ADDR→GND (0x48), A0/A1→clips.

## Deployment

```bash
# Flash ESP32
cp secrets.yaml.example secrets.yaml
# edit secrets.yaml
esphome run plantpulse.yaml

# Deploy server
echo "MQTT_USER=plantpulse\nMQTT_PASS=yourpass" > .env
docker compose up -d
# Dashboard: http://localhost:8286
```

Nginx SSE config requires `proxy_buffering off`, `proxy_cache off`, `proxy_read_timeout 86400`, `X-Accel-Buffering no` on the `/api/stream` location.

## Dev Notes

- `simulate.py` generates fake plant signals for local dev without hardware
- `config.json` is public (plant name/type/location only — no credentials)
- `secrets.yaml` is gitignored; never commit MQTT credentials
- Console telemetry logs every 10s while playing (per-layer trigger counts, gaps, skips)
- TimescaleDB auto-resolution: raw ≤10min, 5s ≤1h, 1min ≤6h, 5min ≤1d, 1hour else
