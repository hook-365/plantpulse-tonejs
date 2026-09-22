//! app.js: the page. Loads the rooms and moods, wires the plant's stream
//! through signal.js into the energy model, runs the clock, and on the
//! listener's press of play opens the audio and seats the band. The page
//! is the chrome around it: the plant's identity, the four signals as
//! meters, the raw trace, the room cards, the deck, and the now-playing
//! line with the players' words.
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

const UI_KEY = "plantpulse_v2_ui";
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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
  app.ticker = startTicker(clock, { workerUrl: "/static/js/composer/tick-worker.js" });
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

//! ---- the page
const $ = (id) => document.getElementById(id);
const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "--" : x.toFixed(d));

function readUi() { try { return JSON.parse(localStorage.getItem(UI_KEY) || "{}"); } catch { return {}; } }
function writeUi(patch) { try { localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch })); } catch { return; } }

async function mountPage() {
  const ui = readUi();
  const params = new URLSearchParams(location.search);
  const app = await boot({ room: params.get("room") ?? ui.room ?? null });
  const { C } = app;
  globalThis.__pp = app;

  //! the plant's identity
  try {
    const cfg = await fetch("/config.json").then((r) => r.json());
    $("plantName").textContent = cfg.plantName || "My Plant";
    $("plantType").textContent = [cfg.plantType, cfg.location].filter(Boolean).join(" · ") || "";
  } catch { $("plantName").textContent = "My Plant"; }

  //! the rooms
  const roomsEl = $("rooms");
  for (const r of app.rooms.rooms) {
    const d = document.createElement("div");
    d.className = "room" + (r.name === app.room.name ? " active" : "");
    d.innerHTML = `<div class="name">${r.label}</div><div class="blurb">${r.blurb}</div>`;
    d.onclick = () => {
      if (r.name === app.room.name) return;
      writeUi({ room: r.name });
      const u = new URL(location.href); u.searchParams.set("room", r.name); location.href = u.toString();
    };
    roomsEl.appendChild(d);
  }
  writeUi({ room: app.room.name });

  //! the deck
  const playBtn = $("playBtn"), vol = $("volume"), recBtn = $("recBtn"), takeBtn = $("takeBtn");
  vol.value = ui.volume ?? 0.8;
  app.setVolume(Number(vol.value));
  vol.oninput = () => { app.setVolume(Number(vol.value)); writeUi({ volume: Number(vol.value) }); };
  playBtn.onclick = async () => {
    if (app.playing) { app.stop(); playBtn.textContent = "▶ play"; playBtn.classList.remove("on"); return; }
    playBtn.disabled = true; playBtn.textContent = "loading…";
    try { await app.play(); playBtn.textContent = "■ stop"; playBtn.classList.add("on"); }
    catch (e) { console.error("[app] play failed", e); playBtn.textContent = "▶ play"; }
    playBtn.disabled = false;
  };
  recBtn.onclick = () => {
    if (app.recorder) app.stopRecord();
    else if (!app.record()) recBtn.title = "press play first";
  };
  app.onRecord = (on) => { recBtn.textContent = on ? "■ stop rec" : "● rec"; recBtn.style.borderColor = on ? "var(--rose)" : ""; };
  takeBtn.onclick = () => { if (C.lastTake) notelog.downloadTake(C.lastTake); };
  app.onTake = () => { takeBtn.disabled = false; };
  app.onSamples = (n, total) => { $("libraryHint").textContent = n < total ? `loading samples ${n}/${total}` : ""; };

  //! status
  const dot = $("statusDot"), statusText = $("statusText");
  app.onStatus = (s) => { dot.className = "status-dot" + (s === "connected" ? " connected" : s === "reconnecting" ? " error" : ""); statusText.textContent = s; };
  setInterval(() => {
    if (app.connected && performance.now() - app.lastSignal > 15000) { dot.className = "status-dot error"; statusText.textContent = "no signal"; }
    else if (app.connected) { dot.className = "status-dot connected"; statusText.textContent = "connected"; }
  }, 2000);

  //! the chart: the raw trace and the smoothed one over the chosen window
  const hist = [];
  let win = ui.win ?? 30;
  const chart = new Chart($("plantChart").getContext("2d"), {
    type: "line",
    data: { datasets: [
      { label: "raw (mV)", data: [], borderColor: "#34d399", backgroundColor: "rgba(52,211,153,0.06)", borderWidth: 1.5, pointRadius: 0, tension: 0.3, fill: true, parsing: false },
      { label: "smoothed", data: [], borderColor: "#d4956a", backgroundColor: "transparent", borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false, parsing: false },
    ] },
    options: { animation: false, responsive: true, maintainAspectRatio: false,
      scales: { x: { type: "linear", min: -win, max: 0, ticks: { color: "#4d5d78", callback: (v) => (v === 0 ? "now" : `${v}s`) }, grid: { color: "#1a2540" } },
                y: { ticks: { color: "#4d5d78" }, grid: { color: "#1a2540" }, title: { display: true, text: "mV", color: "#4d5d78" } } },
      plugins: { legend: { labels: { color: "#8896b0", boxWidth: 10 } } } },
  });
  const winButtons = [...document.querySelectorAll(".window-selector button")];
  const setWin = (w) => { win = w; chart.options.scales.x.min = -w; winButtons.forEach((x) => x.classList.toggle("active", Number(x.dataset.win) === w)); };
  for (const b of winButtons) b.onclick = () => { setWin(Number(b.dataset.win)); writeUi({ win }); };
  setWin(win);
  app.onSignal = (f) => {
    const t = performance.now() / 1000;
    hist.push({ t, raw: f.raw, smooth: f.smoothed });
    while (hist.length && t - hist[0].t > 300) hist.shift();
    $("rawValue").innerHTML = `${fmt(f.raw, 3)} <span class="unit">mV</span>`;
    $("smoothedValue").innerHTML = `${fmt(f.smoothed, 3)} <span class="unit">mV</span>`;
  };
  setInterval(() => {
    const t = performance.now() / 1000;
    const pts = hist.filter((h) => t - h.t <= win);
    chart.data.datasets[0].data = pts.map((h) => ({ x: h.t - t, y: h.raw }));
    chart.data.datasets[1].data = pts.map((h) => ({ x: h.t - t, y: h.smooth }));
    chart.update("none");
  }, 500);

  //! the four signals and the now-playing line
  setInterval(() => {
    const s = C.sig;
    $("energyValue").textContent = fmt(s.energy); $("energyMeter").style.width = `${s.energy * 100}%`;
    $("stabValue").textContent = fmt(s.stability); $("stabMeter").style.width = `${s.stability * 100}%`;
    $("centerValue").textContent = fmt(s.center); $("centerMeter").style.width = `${(s.center + 1) * 50}%`;
    $("tiltValue").textContent = fmt(s.tilt); $("tiltMeter").style.width = `${(s.tilt + 1) * 50}%`;
    $("weatherValue").textContent = fmt(s.weather); $("weatherMeter").style.width = `${s.weather * 100}%`;
    const n = C.rawSorted.x.length;
    $("dayHint").textContent = n >= 480 ? "ranked against the plant's own day" : n >= 240 ? `ranks warming: ${Math.round((n - 240) / 2.4)}% of the way from the fixed ceiling` : `warming up: ${Math.round(n / 2.4)}% toward the first ranks (two hours)`;
    if (app.playing && C.chordNow) {
      const path = C.chordPath.slice(-4).join(" ");
      const pianist = C.touchNow?.words ? `<span class="words">${C.wordsTop(C.touchNow.words)}</span>` : "";
      const cellist = C.stringsNow?.on ? ` · cello: <span class="words cellist">${C.wordsTop(C.stringsNow.words)}</span>` : "";
      const sec = C.sectionNow ? ` · <b>${C.sectionNow === "B" ? "chorus" : C.sectionNow === "A" ? "verse" : C.sectionNow}</b>` : "";
      $("now").innerHTML = `<b>${app.room.label}</b> · bar ${C.barIdx}/${C.barsTotal ?? "?"} · ${C.scaleName} on ${NOTE_NAMES[C.rootMidi % 12]} · <span class="path">${path}</span> · ${C.arcPhase ?? ""}${sec}<br>`
        + (pianist ? `pianist: ${pianist}${cellist}` : `<span class="tag">the drone breathes with the plant: energy opens the timbre, centre and tilt sweep the vowel</span>`)
        + (app.library && !app.library.piano && app.room.mood === "piano" ? `<br><span class="tag">piano samples not fetched: run tools/fetch-samples (drift plays without any)</span>` : "");
    }
  }, 1000);

  //! about
  $("aboutOpen").onclick = () => $("aboutModal").classList.add("show");
  $("aboutClose").onclick = () => $("aboutModal").classList.remove("show");
  $("aboutModal").onclick = (e) => { if (e.target === $("aboutModal")) $("aboutModal").classList.remove("show"); };
}

if (globalThis.document && document.getElementById("playBtn")) {
  mountPage().catch((e) => console.error("[app] boot failed", e));
}
