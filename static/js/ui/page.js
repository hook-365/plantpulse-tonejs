//! page.js: the page, in the live project's shape: the stage (the room's
//! picture, the leaf's trace as the backdrop, the plant as the headliner,
//! the room pills, the deck, the now-playing line, the players' words, the
//! track's progress), the watch view (the roll) that opens under a
//! shrunken stage on play, the about band, and the signals as meters.
import { boot } from "../app.js";
import * as notelog from "../composer/notelog.js";
import { makeRoll, revealLegend } from "./roll.js";

const $ = (id) => document.getElementById(id);
const MIDI = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALE_PRETTY = { major: "major", minor: "minor", dorian: "dorian", lydian: "lydian", mixolydian: "mixolydian", wholeTone: "whole tone", pentatonic: "pentatonic" };
const fmtSec = (s) => (s == null || isNaN(s)) ? "—" : Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
const ROOM_KEY = "pp.room", VOL_KEY = "pp.volume";
export const LEAD = 3.0;   //! the composer runs this far ahead of the audio, so the roll sees notes coming

function setMeter(name, v, bipolar) {
  const fill = $("m-" + name), val = $("mv-" + name);
  if (!fill) return;
  if (v == null || isNaN(v)) { val.textContent = "—"; return; }
  if (bipolar) {
    const half = Math.min(Math.abs(v), 1) * 50;
    fill.style.left = (v < 0 ? 50 - half : 50) + "%"; fill.style.width = half + "%";
    val.textContent = (v >= 0 ? "+" : "") + v.toFixed(2);
  } else {
    fill.style.left = "0%"; fill.style.width = Math.min(Math.max(v, 0), 1) * 100 + "%";
    val.textContent = v.toFixed(2);
  }
}

export async function mountPage() {
  const params = new URLSearchParams(location.search);
  const wanted = (params.get("room") || localStorage.getItem(ROOM_KEY) || "").trim() || null;
  const app = await boot({ room: wanted, lead: LEAD });
  const { C } = app;
  globalThis.__pp = app;
  localStorage.setItem(ROOM_KEY, app.room.name);

  //! the plant's identity
  fetch("/config.json").then((r) => r.json()).then((c) => {
    if (c.plantName) { $("plant-name").textContent = c.plantName; document.title = c.plantName + " — live music from a living plant"; }
    if (c.plantType) $("plant-type").textContent = String(c.plantType).toLowerCase();
  }).catch(() => {});

  //! the rooms: pills; a swap reloads on the new room (the composer is one room for life)
  const host = $("rooms");
  for (const r of app.rooms.rooms) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "room-pill" + (r.name === app.room.name ? " on" : ""); b.textContent = r.label || r.name;
    b.setAttribute("role", "tab"); b.setAttribute("aria-selected", r.name === app.room.name ? "true" : "false"); b.title = r.blurb || "";
    b.addEventListener("click", () => {
      if (r.name === app.room.name) return;
      localStorage.setItem(ROOM_KEY, r.name);
      const u = new URL(location.href); u.searchParams.set("room", r.name); location.href = u.toString();
    });
    host.appendChild(b);
  }
  host.hidden = app.rooms.rooms.length < 2;
  $("room-blurb").textContent = app.room.blurb || "";
  //! the room's picture on the stage
  {
    const el = $("stage-art"), img = new Image();
    img.onload = () => { el.style.backgroundImage = `url("/static/rooms/${app.room.name}.jpg")`; el.classList.add("on"); };
    img.src = `/static/rooms/${app.room.name}.jpg`;
  }

  //! the stage trace: the raw signal, live, as the backdrop
  {
    const cv = $("signalChart"), cx = cv.getContext("2d");
    const data = []; const WINDOW = 120000;
    let vmin = -1, vmax = 1;
    app.onSignal = (f) => { const now = Date.now(); data.push({ t: now, v: f.raw }); while (data.length && data[0].t < now - WINDOW - 3000) data.shift(); $("chip-mv").textContent = f.raw.toFixed(2) + " mV"; roll.pushTrace(f.raw / 1000); };
    const frame = () => {
      const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.clearRect(0, 0, w, h);
      const now = Date.now(), t0 = now - WINDOW;
      const xFor = (t) => ((t - t0) / WINDOW) * w;
      if (data.length > 1) {
        let lo = Infinity, hi = -Infinity;
        for (const p of data) { if (p.v < lo) lo = p.v; if (p.v > hi) hi = p.v; }
        lo = Math.min(lo, 0); hi = Math.max(hi, 0);
        const pad = Math.max(0.05, (hi - lo) * 0.25);
        vmin += ((lo - pad) - vmin) * ((lo - pad) < vmin ? 0.4 : 0.03);
        vmax += ((hi + pad) - vmax) * ((hi + pad) > vmax ? 0.4 : 0.03);
        const yFor = (v) => h * 0.12 + (1 - (v - vmin) / Math.max(1e-9, vmax - vmin)) * h * 0.76;
        const pts = data.map((p) => [xFor(p.t), yFor(p.v)]);
        const path = () => {
          cx.beginPath(); cx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; cx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my); }
          cx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
        };
        path(); cx.lineTo(pts[pts.length - 1][0], h); cx.lineTo(pts[0][0], h); cx.closePath();
        cx.fillStyle = "rgba(123,201,106,0.05)"; cx.fill();
        path(); cx.strokeStyle = "rgba(123,201,106,0.85)"; cx.lineWidth = 1.6; cx.lineJoin = "round"; cx.stroke();
        const y0 = yFor(0);
        cx.setLineDash([3, 5]); cx.strokeStyle = "rgba(233,237,230,0.22)"; cx.lineWidth = 1;
        cx.beginPath(); cx.moveTo(0, y0 + 0.5); cx.lineTo(w, y0 + 0.5); cx.stroke(); cx.setLineDash([]);
        cx.fillStyle = "rgba(233,237,230,0.45)"; cx.font = '9px "Share Tech Mono", monospace'; cx.fillText("0 mV", 12, y0 - 5);
      }
      cx.fillStyle = "rgba(212,136,92,0.10)"; cx.fillRect(xFor(now - 5000), 0, xFor(now - 3000) - xFor(now - 5000), h);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  //! status
  app.onStatus = (s) => { $("sse-dot").className = "dot " + (s === "connected" ? "connected" : s === "reconnecting" ? "error" : ""); $("sse-status").textContent = s === "connected" ? "live" : s === "reconnecting" ? "offline" : "..."; };
  setInterval(() => { if (app.connected && performance.now() - app.lastSignal > 15000) { $("sse-dot").className = "dot error"; $("sse-status").textContent = "no signal"; } }, 2000);

  //! the roll
  const roll = makeRoll({ canvas: $("rollCanvas"), toolsEl: document.querySelector(".watch-tools"), C, lead: LEAD,
    onState: (st) => { if (watching) { setMeter("energy", st.energy, false); setMeter("stability", st.stability, false); setMeter("center", st.center, true); setMeter("tilt", st.tilt, true); setMeter("weather", st.weather, false); } } });

  //! volume: one slider, position squared, shared across the project's pages
  {
    const range = $("vol-range"), wrap = $("vol"), btn = $("vol-btn");
    const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    let v = parseFloat(localStorage.getItem(VOL_KEY)); if (!(v >= 0 && v <= 1)) v = 1;
    let lastOn = v > 0 ? v : 0.7;
    const paint = () => {
      range.style.background = "linear-gradient(to right, #d4885c 0 " + (v * 100) + "%, rgba(255,255,255,0.16) " + (v * 100) + "% 100%)";
      btn.classList.toggle("muted", v === 0);
    };
    const apply = () => { app.setVolume(v); range.value = v; paint(); };
    range.addEventListener("input", () => { v = parseFloat(range.value); if (v > 0) lastOn = v; localStorage.setItem(VOL_KEY, String(v)); apply(); });
    btn.addEventListener("click", () => { v = v > 0 ? 0 : lastOn; localStorage.setItem(VOL_KEY, String(v)); apply(); });
    if (ios) wrap.hidden = true; else apply();
  }

  //! the deck: play opens the roll and seats the band; pause closes it
  let watching = false;
  const playBtn = $("play-btn");
  const paintPlay = () => {
    playBtn.textContent = watching ? "❚❚" : "▶";
    playBtn.classList.toggle("playing", watching);
    const label = watching ? "Pause" : "Play here, and watch the notes as she plays them";
    playBtn.title = label; playBtn.setAttribute("aria-label", label);
    $("watch-status").textContent = watching ? "playing here" : "";
    $("way-watch").classList.toggle("on", watching);
  };
  const enterWatch = async () => {
    document.body.classList.add("watching");
    $("watch").hidden = false;
    $("loading").classList.add("show");
    watching = true; paintPlay();
    roll.start();
    try { await app.play(); } catch (e) { console.error("[page] play failed", e); }
    $("loading").classList.remove("show");
  };
  const leaveWatch = () => {
    watching = false; paintPlay();
    app.stop();
    roll.stop();
    document.body.classList.remove("watching");
    $("watch").hidden = true;
  };
  playBtn.addEventListener("click", () => { if (watching) leaveWatch(); else enterWatch(); });
  app.onSamples = (n, total) => { $("samples").textContent = n; $("samplesTotal").textContent = total; };
  $("rec-btn").addEventListener("click", () => { if (app.recorder) app.stopRecord(); else if (!app.record()) $("deck-hint").textContent = "press play first, then record"; });
  app.onRecord = (on) => { $("rec-btn").classList.toggle("on", on); $("rec-btn").textContent = on ? "■ stop recording" : "● record"; $("deck-hint").textContent = on ? "recording what you hear" : ""; };
  $("take-btn").hidden = true;
  $("take-btn").addEventListener("click", () => { if (C.lastTake) notelog.downloadTake(C.lastTake); });
  app.onTake = () => { $("take-btn").hidden = false; };

  //! now playing, the players, the progress, the meters (the held state while watching)
  setInterval(() => {
    const s = C.sig;
    if (!watching) { setMeter("energy", s.energy, false); setMeter("stability", s.stability, false); setMeter("center", s.center, true); setMeter("tilt", s.tilt, true); setMeter("weather", s.weather, false); }
    const n = C.rawSorted.x.length;
    $("day-hint").textContent = n >= 480 ? "" : n >= 240 ? "the ranks are warming: " + Math.round((n - 240) / 2.4) + "% of the way" : "warming up: " + Math.round(n / 2.4) + "% toward the first ranks (two hours of her day)";
    if (app.playing) {
      $("np-key").textContent = MIDI[C.rootMidi % 12] + " " + (SCALE_PRETTY[C.scaleName] ?? C.scaleName ?? "");
      $("np-mood").textContent = app.room.label;
      $("np-bpm").textContent = Math.round(C.clock.tempo * 60);
      const elapsed = C.trackStart != null ? Math.max(0, C.clock.wallNow() - LEAD - C.trackStart) : null;
      $("np-elapsed").textContent = fmtSec(elapsed); $("np-total").textContent = fmtSec(C.trackDur);
      if (C.trackDur > 0 && elapsed != null) $("np-fill").style.width = Math.min(100, (elapsed / C.trackDur) * 100) + "%";
      const pianist = C.touchNow?.words ? C.wordsTop(C.touchNow.words) : "";
      $("pianist").hidden = !pianist; $("pianist-words").textContent = pianist;
      const cellist = C.stringsNow?.on ? C.wordsTop(C.stringsNow.words) : "";
      $("cellist").hidden = !cellist; $("cellist-words").textContent = cellist;
      revealLegend($("roll-legend"), C);
      if (app.library && !app.library.piano && app.room.mood === "piano") $("deck-hint").textContent = "piano samples not fetched: run tools/fetch-samples (drift plays without any)";
    }
  }, 1000);
}

if (globalThis.document && document.getElementById("play-btn")) mountPage().catch((e) => console.error("[page] boot failed", e));
