//! roll.js: the watch view, lifted from the live project's roll page: the
//! leaf's voltage drawn above the piano roll on one time axis, one play
//! line through both, section / hook / cello markers, the drone's knobs
//! for a breathing-bed room, and the notes sounding as they cross the
//! line. The live page held everything LEAD seconds behind the bridge's
//! feed; here the composer runs LEAD seconds ahead of the audio clock
//! (clock.js's lookahead), so every note is on the ring before it sounds
//! and the roll shows it arriving.
const PX_PER_SEC = 120;
const LOW = 28, HIGH = 96;   //! E1..C7
const COLOR = { rh: "#d4885c", lh: "#e8c27a", bass: "#6e9bd2", pad: "#b7879c", duo: "#e0685c", cello: "#b48ee6", drum: "#a7b0b4", x: "#94a294" };
const SECTION_WORDS = { A: "VERSE", B: "CHORUS", breakdown: "BREAKDOWN", intro: "INTRO", outro: "ENDING", body: "PLAYING" };
const reduceMotion = globalThis.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

function hexA(hex, a) { const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return `rgba(${r},${g},${b},${a})`; }

export function makeRoll({ canvas, toolsEl, C, lead, now = () => performance.now() / 1000, onState = null }) {
  const ctx = canvas.getContext("2d");
  const trace = [];       //! {tPlay, v} the leaf's voltage
  const states = [];      //! {tPlay, energy, stability, center, tilt, section}
  let playLineX = 0, toolsH = 40, toolsHAt = 0, traceMin = -0.001, traceMax = 0.001, running = false, raf = 0;
  let seenSeq = 0;
  const hits = new Map();   //! seq -> hitAt (the flash when a note crosses the line)

  function resize() {
    const dpr = devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    playLineX = Math.floor(canvas.clientWidth * 0.24);
  }
  addEventListener("resize", resize);
  function toolsReserve(t) {
    if (t - toolsHAt > 1 && toolsEl) { toolsH = Math.max(40, toolsEl.offsetHeight + 6); toolsHAt = t; }
    return toolsH;
  }
  //! the leaf: a reading in volts, shown LEAD seconds later, beside the notes it decided
  function pushTrace(volts) {
    trace.push({ tPlay: now() + lead, v: volts });
    if (trace.length > 6000) trace.splice(0, trace.length - 6000);
  }
  //! the conductor's read, once a second, held on the same lead
  function pushState() {
    const s = C.sig;
    states.push({ tPlay: now() + lead, energy: s.energy, stability: s.stability, weather: s.weather, center: s.center, tilt: s.tilt, section: C.sectionNow });
    if (states.length > 120) states.shift();
  }
  function currentState(t) { let s = null; for (const st of states) { if (st.tPlay <= t) s = st; else break; } return s; }
  function currentSection(t) {
    let sec = null;
    for (const mk of C.noteRing) { if (mk.mark === "section" && mk.t <= t) sec = mk.text; }
    return sec;
  }
  function roundedRect(x, y, w, h, r) {
    if (h <= 0 || w <= 0) { ctx.beginPath(); return; }
    r = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  function draw() {
    if (!running) return;
    raf = requestAnimationFrame(draw);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const t = now();
    if (h < 160 || w < 100) return;
    const traceH = 104;
    const knobRows = w < 640 ? 2 : 1;
    const knobH = (C.mood && C.mood.padSynth === "ppBreath") ? 88 + (knobRows - 1) * 12 : 0;
    const rollTop = traceH + 8 + knobH;
    const floor = h - toolsReserve(t);
    const yFor = (m) => floor - ((m - LOW) / (HIGH - LOW)) * (floor - (rollTop + 12));
    ctx.clearRect(0, 0, w, h);
    const st = currentState(t);
    if (st) onState?.(st);
    const sec = currentSection(t) ?? (st && st.section) ?? null;

    //! ---- the leaf (top panel)
    let vmin = Infinity, vmax = -Infinity;
    for (const p of trace) { if (p.tPlay < t - 20) continue; if (p.v < vmin) vmin = p.v; if (p.v > vmax) vmax = p.v; }
    if (isFinite(vmin)) {
      vmin = Math.min(vmin, 0); vmax = Math.max(vmax, 0);
      const pad = Math.max(1e-5, (vmax - vmin) * 0.25);
      const lo = vmin - pad, hi = vmax + pad;
      traceMin += (lo - traceMin) * (lo < traceMin ? 0.5 : 0.04);
      traceMax += (hi - traceMax) * (hi > traceMax ? 0.5 : 0.04);
    }
    const yV = (v) => 14 + (1 - (v - traceMin) / Math.max(1e-9, traceMax - traceMin)) * (traceH - 28);
    ctx.font = '10px "Share Tech Mono", monospace';
    ctx.fillStyle = "rgba(123,201,106,0.7)";
    ctx.fillText("T H E   L E A F", 10, 16);
    ctx.strokeStyle = "rgba(233,237,230,0.06)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, traceH + 0.5); ctx.lineTo(w, traceH + 0.5); ctx.stroke();
    if (trace.length > 1) {
      const runs = []; let pts = [], prevOff = null, prevT = null, lastV = null;
      for (const p of trace) {
        const x = playLineX + (p.tPlay - t) * PX_PER_SEC;
        const gap = prevT != null && p.tPlay - prevT > 3;
        prevT = p.tPlay;
        if (gap) { if (pts.length) runs.push(pts.splice(0)); prevOff = null; }
        if (x < -10) { prevOff = [x, yV(p.v), p.v]; continue; }
        if (pts.length === 0 && prevOff) pts.push(prevOff);
        pts.push([x, yV(p.v), p.v]);
        if (x > w + 10) break;
      }
      if (pts.length) runs.push(pts.splice(0));
      let dotY = null;
      if (runs.some((r) => r.length >= 2)) {
        const L = playLineX;
        const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const evalQ = (p0, c, p1) => {
          let lo = 0, hi = 1;
          for (let k = 0; k < 24; k++) { const u = (lo + hi) / 2; const x = (1 - u) * (1 - u) * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0]; if (x < L) lo = u; else hi = u; }
          const u = (lo + hi) / 2;
          return [(1 - u) * (1 - u) * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1], (1 - u) * (1 - u) * p0[2] + 2 * (1 - u) * u * c[2] + u * u * p1[2]];
        };
        for (const run of runs) {
          for (let i = 0; i < run.length; i++) {
            const a = i === 0 ? run[0] : mid(run[i - 1], run[i]);
            const b = i === run.length - 1 ? run[i] : mid(run[i], run[i + 1]);
            if (a[0] <= L && L <= b[0]) {
              const f = (L - a[0]) / Math.max(1e-6, b[0] - a[0]);
              const r = (i === 0 || i === run.length - 1) ? [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f] : evalQ(a, run[i], b);
              dotY = r[0]; lastV = r[1];
              break;
            }
          }
          if (dotY != null) break;
        }
      }
      const path = (run) => {
        ctx.beginPath();
        if (run.length < 2) { for (const [x, y] of run) ctx.lineTo(x, y); return; }
        ctx.moveTo(run[0][0], run[0][1]);
        for (let i = 1; i < run.length - 1; i++) { const mx = (run[i][0] + run[i + 1][0]) / 2, my = (run[i][1] + run[i + 1][1]) / 2; ctx.quadraticCurveTo(run[i][0], run[i][1], mx, my); }
        ctx.lineTo(run[run.length - 1][0], run[run.length - 1][1]);
      };
      ctx.save();
      ctx.beginPath(); ctx.rect(0, 0, w, traceH); ctx.clip();
      for (const run of runs) {
        if (!run.length) continue;
        path(run);
        ctx.lineTo(run[run.length - 1][0], traceH); ctx.lineTo(run[0][0], traceH); ctx.closePath();
        const fg = ctx.createLinearGradient(0, 0, 0, traceH);
        fg.addColorStop(0, hexA("#7bc96a", 0.18)); fg.addColorStop(1, hexA("#7bc96a", 0));
        ctx.fillStyle = fg; ctx.fill();
        path(run);
        ctx.strokeStyle = hexA("#7bc96a", 0.9); ctx.lineWidth = 1.5; ctx.shadowColor = hexA("#7bc96a", 0.6); ctx.shadowBlur = 8; ctx.stroke(); ctx.shadowBlur = 0;
      }
      ctx.restore();
      const y0 = yV(0);
      ctx.setLineDash([3, 5]); ctx.strokeStyle = "rgba(233,237,230,0.26)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(w, y0 + 0.5); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "rgba(233,237,230,0.4)"; ctx.font = '9px "Share Tech Mono", monospace';
      ctx.fillText("0 mV", w - 34, y0 - 4);
      if (lastV != null && dotY != null) {
        const yl = Math.min(traceH - 6, Math.max(8, dotY));
        ctx.fillStyle = hexA("#7bc96a", 0.95);
        ctx.beginPath(); ctx.arc(playLineX, yl, 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(233,237,230,0.6)";
        ctx.fillText((lastV * 1000).toFixed(2) + " mV", playLineX + 8, yl - 6);
      }
    } else {
      ctx.fillStyle = "rgba(233,237,230,0.3)"; ctx.fillText("waiting for the signal…", 10, traceH / 2);
    }

    //! ---- the drone's knobs: four curves on their own minute-long clock
    if (knobH > 0 && states.length > 1) {
      const KNOB_PX_PER_SEC = (playLineX - 40) / 60;
      const kTop = traceH + 8, kBot = kTop + knobH - 26 - (knobRows - 1) * 12;
      const KNOBS = [
        { k: "energy", lab: "energy — breath, air", col: "#d4885c", lo: 0, hi: 1 },
        { k: "stability", lab: "stability — shimmer", col: "#94a294", lo: 0, hi: 1 },
        { k: "center", lab: "center — wah", col: "#b7879c", lo: -1, hi: 1 },
        { k: "tilt", lab: "tilt — vocal width", col: "#b48ee6", lo: -1, hi: 1 },
      ];
      ctx.font = '9px "Share Tech Mono", monospace';
      ctx.fillStyle = "rgba(233,237,230,0.35)";
      const kTitle = "T H E   D R O N E ’ S   K N O B S";
      ctx.fillText(kTitle, 10, kTop + 10);
      const kMin = "← the last minute", kMinW = ctx.measureText(kMin).width;
      if (playLineX - 8 - kMinW > 10 + ctx.measureText(kTitle).width + 16) { ctx.fillStyle = "rgba(233,237,230,0.25)"; ctx.fillText(kMin, playLineX - 8 - kMinW, kTop + 10); }
      ctx.strokeStyle = "rgba(233,237,230,0.05)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, kBot + 0.5); ctx.lineTo(w, kBot + 0.5); ctx.stroke();
      let keyX = 10, keyRow = 0;
      for (const kn of KNOBS) {
        const yOf = (v) => kBot - ((Math.max(kn.lo, Math.min(kn.hi, v)) - kn.lo) / (kn.hi - kn.lo)) * (kBot - (kTop + 16));
        let vNow = null, vThen = null, started = false, prevT = null;
        ctx.beginPath();
        for (const s of states) {
          const v = s[kn.k]; if (v == null) continue;
          if (s.tPlay <= t) vNow = v;
          if (s.tPlay <= t - 6) vThen = v;
          if (s.tPlay > t) break;
          const x = playLineX + (s.tPlay - t) * KNOB_PX_PER_SEC;
          const y = yOf(v);
          const gap = prevT != null && s.tPlay - prevT > 5; prevT = s.tPlay;
          if (!started || gap) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        const moving = vNow != null && vThen != null && Math.abs(vNow - vThen) / (kn.hi - kn.lo) > 0.03;
        ctx.strokeStyle = hexA(kn.col, moving ? 0.9 : 0.5); ctx.lineWidth = 1.3;
        if (started) { if (vNow != null) ctx.lineTo(playLineX, yOf(vNow)); ctx.stroke(); }
        ctx.fillStyle = hexA(kn.col, moving ? 1.0 : 0.7);
        if (vNow != null) { ctx.beginPath(); ctx.arc(playLineX, yOf(vNow), moving ? 3 : 2, 0, Math.PI * 2); ctx.fill(); }
        const txt = kn.lab + (moving ? " · moving" : "");
        if (keyX > 10 && keyX + 10 + ctx.measureText(txt).width > w - 8) { keyX = 10; keyRow += 1; }
        const keyY = kBot + 13 + keyRow * 12;
        ctx.beginPath(); ctx.arc(keyX + 3, keyY, 2.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hexA(kn.col, moving ? 0.95 : 0.6);
        ctx.fillText(txt, keyX + 10, keyY + 3);
        keyX += 10 + ctx.measureText(txt).width + 18;
      }
    }

    //! ---- the roll (bottom panel)
    ctx.font = '10px "Share Tech Mono", monospace';
    for (let m = LOW; m <= HIGH; m += 12) {
      const y = yFor(m);
      ctx.strokeStyle = "rgba(233,237,230,0.06)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(30, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
      ctx.fillStyle = "rgba(233,237,230,0.32)"; ctx.fillText("C" + (Math.floor(m / 12) - 1), 6, y + 3);
    }
    for (const mk of C.noteRing) {
      if (!mk.mark || !["section", "hook", "cello"].includes(mk.mark)) continue;
      const x = playLineX + (mk.t - t) * PX_PER_SEC;
      if (x < -240 || x > w + 10) continue;
      const g = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
      g.addColorStop(0, "rgba(236,232,220,0)"); g.addColorStop(0.5, "rgba(233,237,230,0.07)"); g.addColorStop(1, "rgba(236,232,220,0)");
      ctx.fillStyle = g; ctx.fillRect(x - 14, 0, 28, h);
      const col = mk.mark === "hook" ? "#e9ede6" : mk.mark === "cello" ? COLOR.cello : "#94a294";
      ctx.fillStyle = hexA(col, 0.85);
      const label = mk.mark === "section" ? (SECTION_WORDS[mk.text] ?? String(mk.text).toUpperCase())
        : mk.mark === "hook" ? `T H E   H O O K  ${mk.text}`
        : mk.text === "sings" ? "T H E   C E L L O   S I N G S" : "T H E   C E L L O   C O M E S   I N";
      ctx.fillText(label, x + 8, rollTop + 12);
    }
    //! held voices (the drone's bed, the sub) are logged once at entry and
    //! kept until the next chord: their bar runs to that change, or off the
    //! right edge while the chord is still the one sounding
    const chordTimes = C.noteRing.filter((m) => m.mark === "chord").map((m) => m.t);
    const heldEnd = (n) => { for (const ct of chordTimes) if (ct > n.t + 0.05) return ct; return Infinity; };
    for (const n of C.noteRing) {
      if (n.mark || n.m == null) continue;
      const x0 = playLineX + (n.t - t) * PX_PER_SEC;
      const held = /Held$/.test(n.syn ?? "");
      const endT = held ? heldEnd(n) : n.t + n.dur;
      const wN = held ? (isFinite(endT) ? Math.max(6, (endT - n.t) * PX_PER_SEC) : Math.max(6, w + 40 - x0)) : Math.max(6, n.dur * PX_PER_SEC);
      if (x0 + wN < -20 || x0 > w + 20) continue;
      const rowH = Math.max(2, yFor(n.m) - yFor(n.m + 1));
      const col = COLOR[n.r] ?? COLOR.x;
      const done = t > endT;
      const active = t >= n.t && !done;
      const vel = Math.min(1, Math.max(0.15, (n.v || 8) / 15));
      const yc = yFor(n.m + 0.5);
      let hN, grad;
      if (n.r === "pad") {
        hN = rowH * 1.6;
        grad = ctx.createLinearGradient(x0, 0, x0 + wN, 0);
        grad.addColorStop(0, hexA(col, 0.34)); grad.addColorStop(1, hexA(col, held ? 0.26 : 0.10));
        ctx.shadowColor = hexA(col, 0.35); ctx.shadowBlur = 14;
      } else if (n.r === "cello") {
        hN = rowH * (1.0 + 0.6 * vel);
        grad = ctx.createLinearGradient(x0, 0, x0 + wN, 0);
        grad.addColorStop(0, hexA(col, 0.15)); grad.addColorStop(0.35, hexA(col, 0.9)); grad.addColorStop(0.75, hexA(col, 0.8)); grad.addColorStop(1, hexA(col, 0.12));
        ctx.shadowColor = hexA(col, 0.5); ctx.shadowBlur = active ? 18 : 8;
      } else {
        hN = rowH * (0.9 + 0.7 * vel);
        grad = ctx.createLinearGradient(x0, 0, x0 + wN, 0);
        grad.addColorStop(0, hexA(col, 0.95)); grad.addColorStop(0.18, hexA(col, 0.85)); grad.addColorStop(1, hexA(col, 0.10));
        ctx.shadowColor = hexA(col, active ? 0.7 : 0.3); ctx.shadowBlur = active ? 16 : 6;
      }
      ctx.globalAlpha = done ? 0.55 : 1;
      ctx.fillStyle = grad;
      roundedRect(x0, yc - hN / 2, wN, hN, hN / 2); ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      if (n.r !== "pad") { ctx.fillStyle = hexA("#ffffff", active ? 0.9 : 0.35); ctx.beginPath(); ctx.arc(x0 + hN * 0.5, yc, hN * 0.32, 0, Math.PI * 2); ctx.fill(); }
      if (!reduceMotion && n.r !== "pad" && t >= n.t && t - n.t < 0.45) {
        const k = 1 - (t - n.t) / 0.45;
        const rg = ctx.createRadialGradient(playLineX, yc, 0, playLineX, yc, 26 + 30 * (1 - k));
        rg.addColorStop(0, hexA(col, 0.55 * k)); rg.addColorStop(1, hexA(col, 0));
        ctx.fillStyle = rg; ctx.beginPath(); ctx.arc(playLineX, yc, 60, 0, Math.PI * 2); ctx.fill();
      }
    }
    const pg = ctx.createLinearGradient(playLineX - 18, 0, playLineX + 18, 0);
    pg.addColorStop(0, "rgba(233,237,230,0)"); pg.addColorStop(0.5, "rgba(233,237,230,0.12)"); pg.addColorStop(1, "rgba(233,237,230,0)");
    ctx.fillStyle = pg; ctx.fillRect(playLineX - 18, 0, 36, h);
    ctx.strokeStyle = "rgba(233,237,230,0.55)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(playLineX + 0.5, 0); ctx.lineTo(playLineX + 0.5, h); ctx.stroke();
  }

  let stateTimer = null;
  return {
    pushTrace, pushState, currentState,
    start() { if (running) return; running = true; resize(); setTimeout(resize, 50); stateTimer = setInterval(pushState, 1000); raf = requestAnimationFrame(draw); },
    stop() { running = false; cancelAnimationFrame(raf); clearInterval(stateTimer); },
    get running() { return running; },
  };
}

//! the roles the room's feed reveals: exactly the players playing
export function revealLegend(legendEl, C) {
  const seen = new Set(C.noteRing.filter((n) => n.r).map((n) => n.r));
  for (const chip of legendEl.querySelectorAll(".key")) chip.hidden = !seen.has(chip.dataset.role);
  const padChip = legendEl.querySelector('[data-role="pad"]');
  if (padChip && C.mood) {
    const label = { ppLofiKeys: "keys", ppBreath: "the drone", ppPad: "pad" }[C.mood.padSynth] ?? "keys";
    padChip.childNodes.forEach((nd) => { if (nd.nodeType === 3) nd.textContent = label; });
  }
}
