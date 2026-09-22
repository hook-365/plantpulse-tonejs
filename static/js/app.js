//! app.js: boot(). Loads the rooms and moods, wires the plant's stream
//! through signal.js into the energy model, runs the clock, and on the
//! listener's press of play opens the audio and seats the band. The page
//! around it is ui/page.js (the stage, the roll, the meters).
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


export async function boot({ room = null, log = console.log, lead = 0.15 } = {}) {
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
  const app = { C, clock, rooms, room: roomRec, playing: false, connected: false, lastSignal: 0 };
  loadMoods(C, moodsData);
  energy.install(C, { persist: energy.localStoragePersist() });
  notelog.install(C, { onTake: (take) => { C.lastTake = take; app.onTake?.(take); notelog.postTake(take); } });
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
  const stream = wireStream("/api/stream", (f) => { C.onFeature(f); app.lastSignal = performance.now(); app.onSignal?.(f); });
  stream.source.onopen = () => { app.connected = true; app.onStatus?.("connected"); };
  stream.source.onerror = () => { app.connected = false; app.onStatus?.("reconnecting"); };
  app.stream = stream;
  //! the composer runs `lead` seconds ahead of the audio: the roll sees
  //! every note coming, and a hidden tab's throttled ticks never miss one
  app.ticker = startTicker(clock, { workerUrl: "/static/js/composer/tick-worker.js", foreground: lead, hidden: Math.max(lead, 1.5) });
  log(`[app] composer ${roomName}: signals warming (rank buffer ${C.rawSorted.x.length}/480)`);

  app.play = async () => {
    if (app.playing) return;
    if (!C.audio) {
      const audio = await createAudio({ volume: app.volume ?? 0.8 });
      installAudio(C, audio, { onSamples: (n, total) => { app.samples = { n, total }; app.onSamples?.(n, total); } });
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
  //! record what you hear: the page's output to a .webm (Opus)
  app.record = () => {
    if (!C.audio || app.recorder) return false;
    const ctx = C.audio.ctx;
    const tap = ctx.createMediaStreamDestination();
    C.audio.pageOut.connect(tap);
    const rec = new MediaRecorder(tap.stream, { mimeType: "audio/webm;codecs=opus" });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = () => {
      C.audio.pageOut.disconnect(tap);
      const blob = new Blob(chunks, { type: "audio/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `plantpulse-${roomName}-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      app.recorder = null; app.onRecord?.(false);
    };
    rec.start(1000);
    app.recorder = rec; app.onRecord?.(true);
    return true;
  };
  app.stopRecord = () => { app.recorder?.stop(); };
  return app;
}

