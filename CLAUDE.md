# PlantPulse — Claude Code Context

## What This Is

PlantPulse reads bioelectrical signals from living plants via an ESP32 + ADS1115 ADC and transforms them in real-time into generative music. The plant is heard as four signals ranked against its own day (energy, stability, center, tilt, plus the day's weather) and a composer in the browser plays from them: two rooms, drift (a breathing drone) and piano (a pianist with two hands, sometimes a cellist). The live site `plantpulse.hook.technology` runs the same decisions on the project's SuperCollider engine with a third, licensed-sample room; this repo is the free browser port.

## Architecture

**Signal chain:**
```
Plant leaf → alligator clips → ADS1115 (16-bit I2C ADC, ±256mV)
  → ESP32-WROOM-32D (WiFi + MQTT)
  → Mosquitto broker
  → Flask server (SSE proxy, sample packs)
  → Browser (the composer, plain Web Audio)
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
├── static/index.html   # THE page (served at /): the live project's roll page; static/js/ui/page.js mounts it, static/js/ui/roll.js draws the roll
├── static/js/app.js    # boot(): the composer (static/js/composer + audio = the engine), returns the app the page drives
├── static/rooms/       # drift.jpg, piano.jpg: the room's picture behind the stage
├── static/vendor/      # fonts/ (Instrument Serif, Share Tech Mono, OFL): the page makes no third-party requests
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

## The composer (`static/js/`)

The 2.0 engine: a JavaScript port of the live project's SuperCollider composer, one module per `.scd` file so the spec's names carry over (`composer/energy.js`, `harmony.js`, `arc.js`, `lifecycle.js`, `voices.js`, `improv.js`, `lefthand.js`, `strings.js`). `signal.js` is the bridge's feature maths in the browser; `composer/clock.js` is a TempoClock (routines are generators, `yield 4` waits four beats, `yield {sec: 30}` waits on the wall; a tempo change re-anchors at the current beat; routines start on `quant [4, phase]`; an error in one routine ends it and is reported, the tick goes on). `composer/state.js` is the one context every module installs onto (sclang's `~globals`). The audio layer (`audio/context.js`, `master.js`, `breath.js`, `sampler.js`, `piano.js`, `cello.js`, `player.js`) is the live engine's SynthDefs node for node in plain Web Audio on a native `AudioContext`. **Tone.js is not used**: the repo's name is history (the 1.0 engine was Tone.js; that engine is release v1.0.0). Data: `static/composer/{moods,mood-schema,rooms}.json` via `tools/sync-composer-data` from the live project (drift and piano only).

Laws, kept by `tools/gate`: the closed mood schema (every key read by its consumer module, every read key in the schema; the drummer is a typed hole); raw plant-feature names only in `energy.js` and `signal.js`; no `mood.name ===` branching; comments in `static/js/composer/` are receipts (`//!`) or absent; no third-party requests from the page (`static/vendor/` holds the fonts). Tests: `node --test "tests/*.test.mjs"` on a virtual clock (`tests/harness.mjs` seats the band with a fake audio layer).

## The page (`static/index.html` + `static/js/ui/`)

The live project's front page, driven by the local composer instead of the bridge (2026-09-22, Anthony: "can we do more of the current interface versus this old crusty one?"). The stage: the room's picture, the raw trace as the backdrop (120 s), the plant as the headliner, room pills (a swap reloads with `?room=`; the composer is one room for life), one deck card ("Watch her play", copper ▶: the live site's second card is its radio stream, which has no browser equivalent), volume (position squared, localStorage `pp.volume`, hidden on iOS), record (a .webm of what you hear), the last take's note log once a track has ended, a now-playing line (key · room · bpm), the pianist's and cellist's words, and the track's progress bar. Pressing ▶ adds `body.watching` (the stage shrinks) and opens the roll (`ui/roll.js`, lifted from the live page): the leaf's voltage above the notes on one time axis, one play line at 24% width, section / hook / cello markers, the drone's knobs strip for a breathing-bed room, note bars per role in the live palette, the legend revealing exactly the roles playing. Timing: the composer runs `LEAD` (3 s) ahead of the audio clock (`boot({lead})` widens the ticker's lookahead), so every note is on the ring before it sounds and the roll shows it arriving; the leaf reading and the conductor's state are pushed with the same lead. Held voices (`*Held` synths) draw to the next chord mark. Under the fold: the about band and the five signal meters. UI state: room in `pp.room`; the energy model's day memory in `plantpulse_energy_history_<room>`.

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
