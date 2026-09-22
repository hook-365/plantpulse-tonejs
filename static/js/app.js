//! app.js: the page's entry for the composer port. Loads the rooms and
//! moods, wires the plant's stream through signal.js into the energy
//! model, runs the clock, and on the listener's press of play opens the
//! audio and seats the band. Until the cut-over the old engine stays the
//! page's default and this module runs behind ?engine=v2 with its own
//! small deck (room, play, the take).
import { wireStream } from "./signal.js";
import { BeatClock, startTicker } from "./composer/clock.js";
import { makeContext } from "./composer/state.js";
import { loadMoods, loadRooms, applyMood } from "./composer/moods.js";
import * as energy from "./composer/energy.js";
import * as notelog from "./composer/notelog.js";
import * as harmony from "./composer/harmony.js";
import * as arc from "./composer/arc.js";
import * as lifecycle from "./composer/lifecycle.js";
import * as voices from "./composer/voices.js";
import * as improv from "./composer/improv.js";
import * as lefthand from "./composer/lefthand.js";
import * as strings from "./composer/strings.js";
import { createAudio } from "./audio/context.js";
import { installAudio } from "./audio/player.js";

export async function boot({ room = null, log = console.log } = {}) {
  const [moodsData, roomsData] = await Promise.all([
    fetch("/static/composer/moods.json").then((r) => r.json()),
    fetch("/static/composer/rooms.json").then((r) => r.json()),
  ]);
  const rooms = loadRooms(roomsData);
  const roomName = room && rooms.rooms.some((r) => r.name === room) ? room : rooms.default;
  const roomRec = rooms.rooms.find((r) => r.name === roomName);

  //! the composer's clock runs on performance.now(): it must keep time
  //! while the audio context is still locked (the signals warm up before
  //! play); the audio layer converts to the context's clock per note
  const clock = new BeatClock(() => performance.now() / 1000);
  const C = makeContext({ clock, room: roomName, log });
  loadMoods(C, moodsData);
  energy.install(C, { persist: energy.localStoragePersist() });
  notelog.install(C, { onTake: (take) => { C.lastTake = take; notelog.postTake(take); } });
  harmony.install(C);
  arc.install(C);
  lifecycle.install(C);
  voices.install(C);
  improv.install(C);
  lefthand.install(C);
  strings.install(C);
  applyMood(C, roomRec.mood);
  C.weatherLoad();
  clock.play(C.weatherPoll, { sec: true, name: "weather" });
  const stream = wireStream("/api/stream", C.onFeature);
  const ticker = startTicker(clock, { workerUrl: "/static/js/composer/tick-worker.js" });
  log(`[app] composer ${roomName}: signals warming (rank buffer ${C.rawSorted.x.length}/480)`);

  const app = { C, clock, rooms, room: roomRec, stream, ticker, playing: false };
  app.play = async () => {
    if (app.playing) return;
    if (!C.audio) {
      const audio = await createAudio({ volume: app.volume ?? 1 });
      installAudio(C, audio, { onSamples: (n, total) => { app.samples = { n, total }; } });
      //! the piano room waits for its library; drift plays with none
      app.library = await C.loadSamples();
      log(`[app] samples: piano ${app.library.piano} cello ${app.library.cello} (${app.library.files} files)`);
    }
    app.playing = true;
    C.startVoices();
    C.arcRoutine = clock.play(C.arcPoll, { sec: true, name: "arc" });
    C.playLifecycle();
    log(`[app] playing ${roomName}`);
  };
  app.stop = () => {
    if (!app.playing) return;
    app.playing = false;
    C.stopLifecycle();
    C.stopVoices();
    C.arcRoutine?.stop();
    log("[app] stopped");
  };
  app.setVolume = (v) => { app.volume = v; C.audio?.setVolume(v); };
  return app;
}

//! the v2 deck: a small fixed panel until the cut-over gives the page its
//! own room picker and play
function mountDeck(app) {
  const d = document.createElement("div");
  d.id = "pp-v2-deck";
  d.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;background:#111a;color:#eee;padding:12px 14px;border-radius:10px;font:13px system-ui,sans-serif;backdrop-filter:blur(6px);box-shadow:0 4px 18px #0008;min-width:220px";
  const roomOpts = app.rooms.rooms.map((r) => `<option value="${r.name}" ${r.name === app.room.name ? "selected" : ""}>${r.label}: ${r.blurb}</option>`).join("");
  d.innerHTML = `<div style="font-weight:600;margin-bottom:6px">composer v2</div>
    <select id="ppv2-room" style="width:100%;margin-bottom:8px">${roomOpts}</select>
    <div style="display:flex;gap:8px;align-items:center">
      <button id="ppv2-play" style="flex:1;padding:6px 10px">▶ play</button>
      <input id="ppv2-vol" type="range" min="0" max="1" step="0.01" value="1" style="width:80px">
    </div>
    <div id="ppv2-sig" style="margin-top:8px;opacity:.8;font-variant-numeric:tabular-nums"></div>
    <div id="ppv2-now" style="margin-top:4px;opacity:.8"></div>
    <button id="ppv2-take" style="margin-top:8px;width:100%;padding:4px" disabled>save last take (.jsonl)</button>`;
  document.body.appendChild(d);
  const $ = (id) => d.querySelector("#" + id);
  $("ppv2-play").onclick = async () => {
    if (app.playing) { app.stop(); $("ppv2-play").textContent = "▶ play"; }
    else { await app.play(); $("ppv2-play").textContent = "■ stop"; }
  };
  $("ppv2-vol").oninput = (e) => app.setVolume(Number(e.target.value));
  $("ppv2-room").onchange = (e) => { const u = new URL(location.href); u.searchParams.set("room", e.target.value); location.href = u.toString(); };
  $("ppv2-take").onclick = () => { if (app.C.lastTake) notelog.downloadTake(app.C.lastTake); };
  setInterval(() => {
    const C = app.C, s = C.sig;
    $("ppv2-sig").textContent = `energy ${s.energy.toFixed(2)} stability ${s.stability.toFixed(2)} center ${s.center.toFixed(2)} tilt ${s.tilt.toFixed(2)} weather ${s.weather.toFixed(2)} · day ${C.rawSorted.x.length}/480`;
    if (app.playing && C.chordNow) {
      const path = C.chordPath.slice(-3).join(" ");
      $("ppv2-now").textContent = `bar ${C.barIdx}/${C.barsTotal ?? "?"} · ${C.scaleName} on ${C.rootMidi} · ${path} · ${C.arcPhase ?? ""} ${(C.arcIntensity ?? 0).toFixed(2)}`;
    }
    $("ppv2-take").disabled = !C.lastTake;
    if (app.library && !app.library.piano && app.room.mood === "piano") $("ppv2-now").textContent = "piano samples not fetched: run tools/fetch-samples (drift plays without any)";
  }, 1000);
}

//! ?engine=v2 (&room=drift|piano): opt in until the cut-over
const params = new URLSearchParams(globalThis.location?.search ?? "");
if (params.get("engine") === "v2") {
  boot({ room: params.get("room") }).then((app) => {
    globalThis.__pp = app;
    mountDeck(app);
  }).catch((e) => console.error("[app] boot failed", e));
}
