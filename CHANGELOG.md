# Changelog

## [2.0.0] - 2026-09-22

The composer, in your browser.

### Changed
- The music engine is replaced. The fourteen-preset motif-DNA engine with its Magenta models, patch bay and XY pad is gone; in its place a JavaScript port of the PlantPulse composer (the live project's SuperCollider engine): two rooms, drift and piano.
- The plant is heard as ranks against its own trailing 24 hours (energy, stability, center, tilt, weather), kept in the browser and remembered across reloads.
- The piano room plays the Salamander Grand Piano (CC BY 3.0) and the Philharmonia cello, fetched from their publishers by `tools/fetch-samples`; drift is synthesized end to end and needs no samples.
- `docker compose up` works on a fresh machine: no external networks, an optional bundled broker (`--profile broker`, `tools/broker-password`), an optional fake plant (`--profile demo`, `tools/simulate-signal`), a healthcheck.
- The server reconnects to a broker that comes up late (the old synchronous connect stayed deaf after one failure), serves the sample packs (`/api/samples/*`), spools each take's note log (`POST /api/take`), and sends no-cache for its static files so a browser never plays yesterday's engine.
- `plantpulse.yaml` takes the broker address and username from `secrets.yaml`; the second ADS1115 is an optional block.
- The page is the live project's front page (stage, room pills, deck, players' words, progress, and the piano roll with the leaf's trace on the same clock), driven by the local composer. No third-party requests: the two fonts are self-hosted.
- Tone.js is not used. The port's instruments are the live engine's SynthDefs node for node in plain Web Audio on the browser's own context. The repository's name is history.

### Removed
- TimescaleDB, the history pages and their routes (nothing in this repository ever wrote to that database).
- 24 MB of committed Magenta weights, the vinyl loop, the stale root `index.html`, the old sequencer replayer and the OBS overlay page. Git history keeps them for v1.0.0; the repository is not rewritten.
- WebMIDI output and the 14 presets (see v1.0.0).

### Added
- `LICENSE` (MIT; the README had claimed it without the file), `NOTICE.md`, `.env.example`, `.dockerignore`, `tools/gate`, `tools/take-review`, `tools/sync-composer-data`, `docs/COMPOSER.md` (the contract), a test suite on a virtual clock, CI.
- Recording what you hear to a `.webm`, and saving the song's note log.

### Not included, and why
- The lofi room: its drum kits and Loopcloud voices are licensed packs.
- Server-side recordings, posters, Icecast streams, casting and accounts: those belong to the live site's build.

### Upgrading from 1.0
No data to migrate. Write a new `.env` from `.env.example`; `secrets.yaml` gains `mqtt_broker` and `mqtt_username`.

## [1.0.0] - 2026-04-14

The Tone.js preset engine, as frozen: fourteen presets, motif DNA, the Magenta drummers, the patch bay. Known as published: five of the six Magenta checkpoints were never committed, the history pages need an external TimescaleDB, and the compose file declares two external networks. Archived as a release so it stays reachable.
