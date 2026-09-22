# PlantPulse — Claude Code Context

## What This Is

PlantPulse reads bioelectrical signals from living plants via an ESP32 + ADS1115 ADC and transforms them in real-time into generative music. The plant acts as a live conductor — seeding melodic motifs, controlling ensemble dynamics, triggering section changes, and crossfading between instruments. It's running live at `plantpulse.hook.technology` with a hibiscus tree performing continuously.

## Architecture

**Signal chain:**
```
Plant leaf → alligator clips → ADS1115 (16-bit I2C ADC, ±256mV)
  → ESP32-WROOM-32D (WiFi + MQTT)
  → Mosquitto broker
  → Flask server (SSE proxy, sample packs)
  → Browser (Tone.js / Web Audio API synth engine)
```

**Key design principle: Dumb sensor, secure server, smart client.**
- ESP32 publishes raw voltage only. No credentials on the device.
- Flask server holds MQTT credentials, bridges to SSE, serves the UI.
- All synthesis, visualization, and music logic runs client-side in the browser.
- Plant data never leaves the local network unless the dashboard is intentionally exposed.

## Repository Structure

```
plantpulse-tonejs/
├── server.py           # Flask: MQTT→SSE bridge, /config.json, /healthz, /api/samples/*, POST /api/take
├── static/index.html   # THE page (served at /): the Tone.js engine, being replaced by the composer port
├── static/config.json  # Plant identity (name, type, location) — served publicly, no credentials
├── tools/fetch-samples # Downloads Salamander (CC BY 3.0) + the Philharmonia cello into samples/ (never committed)
├── tools/simulate-signal # A fake plant on MQTT at 4 Hz (docker compose --profile demo)
├── tools/broker-password # Writes the bundled broker's password file from .env
├── mosquitto/          # mosquitto.conf for the optional bundled broker (--profile broker)
├── samples/            # gitignored; tools/fetch-samples output, mounted read-only into the container
├── recordings/         # gitignored; take receipts the browser posts (spool/*.notes.jsonl, takes.jsonl)
├── plantpulse.yaml     # ESPHome config for the ESP32 (broker + username from secrets.yaml)
├── secrets.yaml.example
├── docker-compose.yml  # plantpulse + optional mosquitto (broker/demo) + optional simulate (demo)
├── Dockerfile, .dockerignore, .env.example, requirements.txt
├── LICENSE (MIT), NOTICE.md (sample and library attributions)
├── docs/               # Screenshot
└── README.md
```

**Never add a `server/` package beside `server.py`:** gunicorn's target is `server:app`, and Python prefers a package over a module of the same name ("Failed to find attribute 'app' in 'server'").

## Server (`server.py`)

Flask app on port `8286`. No database: the composer keeps its own day of history in the browser.

**Routes:**
- `GET /` → `static/index.html`
- `GET /config.json` → plant identity (no credentials)
- `GET /logo.svg`
- `GET /healthz` → `{ok, sse_clients, mqtt_started}` (the compose healthcheck; no broker round-trip)
- `GET /api/stream` → SSE: `{"ch":"ch1","v":<volts>}` per reading, `{"hb":1}` every 5 s when quiet (a data frame, so the client watchdog sees it)
- `GET /api/samples/<pack>/manifest` → `{pack, version, baseUrl, urls, release, layers?, notes?, instrument?, extras?}`; 404 `unknown_pack` until `tools/fetch-samples` has run (the drift room plays regardless)
- `GET /api/samples/<pack>/<version>/<file>` → the sample, `Cache-Control: immutable` (the version is in the URL)
- `POST /api/take` → `{meta, lines}`: writes `recordings/spool/<stamp>__<room>__web.notes.jsonl` and appends `recordings/takes.jsonl`, the files `tools/take-review` reads; the name is validated, nothing is served back

**MQTT topics:**
- `plantpulse/sensor/plant_signal/state` → `ch1` (Chip 1 A0–A1)
- `plantpulse/sensor/plant_signal_2/state` → `ch2` (Chip 1 A2–A3)
- `plantpulse/sensor/plant_signal_3/state` → `ch3` (Chip 2 A0–A1, optional)

**MQTT connect:** `connect_async` + `loop_start`, so a broker that comes up after the server (the usual compose race) is picked up without a restart. The subscriber starts on the first `/api/stream` request, per gunicorn worker.

**Workers:** gunicorn gevent, 2 workers (`gevent.queue.Queue` when available).

## The composer port (`static/js/`)

The 2.0 engine: a JavaScript port of the live project's SuperCollider composer, one module per `.scd` file so the spec's names carry over (`composer/energy.js`, `harmony.js`, `arc.js`, `lifecycle.js`, `voices.js`, `improv.js`; `lefthand.js` and `strings.js` land with the pianist's left hand and the cello). `signal.js` is the bridge's feature maths in the browser; `composer/clock.js` is a TempoClock (routines are generators, `yield 4` waits four beats, `yield {sec: 30}` waits on the wall; a tempo change re-anchors at the current beat; routines start on `quant [4, phase]`). `composer/state.js` is the one context every module installs onto (sclang's `~globals`). The audio layer (`audio/master.js`, `breath.js`, `player.js`) is the live engine's SynthDefs node for node in Web Audio; Tone.js is the host context. Data: `static/composer/{moods,mood-schema,rooms}.json` via `tools/sync-composer-data` from the live project (drift and piano only).

Laws, kept by `tools/gate`: the closed mood schema (every key read by its consumer module, every read key in the schema; chairs not yet built are warned, the drummer is a typed hole); raw plant-feature names only in `energy.js` and `signal.js`; no `mood.name ===` branching; comments in `static/js/composer/` are receipts (`//!`) or absent. Tests: `node --test "tests/*.test.mjs"` on a virtual clock (`tests/harness.mjs` seats the band with a fake audio layer).

Until the cut-over the port runs behind `?engine=v2` (`&room=drift|piano`) with its own small deck; the old engine below stays the page's default.

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

(The engine and its presets are being replaced by the composer port; this section describes the page as it still is.)

### Multi-Channel Support
Up to 3 differential channels across 2 ADS1115 chips. Patch bay in UI routes any channel to any synth parameter.

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
cp secrets.yaml.example secrets.yaml      # WiFi, OTA, broker address, MQTT credentials
esphome run plantpulse.yaml

# Deploy server
cp .env.example .env && $EDITOR .env      # MQTT_* (+ PLANTPULSE_SAMPLES_DIR)
docker compose up -d                       # with your own broker (MQTT_HOST in .env), or:
tools/broker-password && docker compose --profile broker up -d   # the bundled mosquitto
docker compose --profile demo up           # no hardware: bundled broker + a fake plant
tools/fetch-samples                        # the piano room's samples (~580 MB; needs ffmpeg); drift needs none
# Dashboard: http://localhost:8286
```

## Dev Notes

- `tools/simulate-signal --dry-run` prints the fake plant's values without a broker
- `config.json` is `static/config.json` (served at `/config.json`): plant name/type/location only
- `secrets.yaml` and `.env` are gitignored; never commit credentials
- Samples are fetched, never committed (`samples/` is gitignored; licences in `NOTICE.md`)
