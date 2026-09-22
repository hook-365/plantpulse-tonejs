//! energy.js: THE energy model, a port of the live project's
//! composer/energy.scd: the one place the plant's raw features become
//! musical signals (docs/COMPOSER.md, "The signal vocabulary"). Raw
//! feature names are gate-banned in every other composer file.
import { clip, mean } from "../sc.js";

export const sigTaus = { energy: 4.0, stability: 30.0, center: 60.0, tilt: 10.0 };

//! activity/volatility arrive 0..100. 40 stays only as the cold-start
//! ceiling: once the day buffer holds two hours, liveliness is the RANK of
//! the raw reading against the plant's own trailing 24h (fraction of
//! samples strictly below), so energy's median is 0.5 by construction and
//! electrode/baseline drift cancels. Receipt 2026-08-25 (the live project's
//! three-rooms review): 600 takes per room under the fixed ceiling, energy
//! median 0.08, p90 0.32, stability median 0.92; every downstream "0.5 is
//! neutral" law sat idle. Energy ranks x = max(activity, volatility) as ONE
//! statistic; stability is 1 - rank(volatility). Crossfade 2h..4h, no step.
export const sigNormCeil = 40.0;
export const sigRankWarm = 240;
export const sigRankFull = 480;
export const sigHistoryMax = 1200;
export const dayHistMax = 2880;

//! rankBelow(sorted, x): fraction of sorted strictly below x; 0.5 when empty.
export function rankBelow(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x) lo = mid + 1; else hi = mid;
  }
  return sorted.length === 0 ? 0.5 : lo / sorted.length;
}

const sortNum = (xs) => xs.slice().sort((a, b) => a - b);

//! install(C, {persist}): puts the model on the context. persist is
//! {load(room) -> {text, mtime}|null, save(room, text), siblings() -> [room]},
//! localStorage in the page (below), memory in tests.
export function install(C, { persist = null } = {}) {
  C.sig = { energy: 0.5, stability: 0.5, center: 0.0, tilt: 0.0, weather: 0.5 };
  C.sigHistory = [];        //! newest first, {t, energy, stability, center, tilt}
  C.rawLast = null;         //! {x, v}
  C.rawSorted = { x: [], v: [] };
  C.sigLastTick = null;
  C.dayHist = [];           //! newest first, {t, e, x, v}
  C.onSig = null;           //! (sig) -> the held voices (the ~sigBus mirror)

  //! sigOver(seconds, field): rolling mean of a signal over a longer window;
  //! the only sanctioned way to ask about slower timescales.
  C.sigOver = (seconds = 60, field = "energy") => {
    const cutoff = C.clock.now() - seconds;
    const vals = [];
    for (const s of C.sigHistory) { if (s.t >= cutoff) vals.push(s[field]); else break; }
    return vals.length < 8 ? C.sig[field] : mean(vals);
  };

  C.sigNormNow = (field, raw) => {
    const sorted = C.rawSorted[field];
    const fixed = clip(raw / sigNormCeil, 0, 1);
    const m = clip((sorted.length - sigRankWarm) / (sigRankFull - sigRankWarm), 0, 1);
    return m <= 0 ? fixed : fixed + (rankBelow(sorted, raw) - fixed) * m;
  };

  //! onFeature(f): the per-reading update. f is signal.js's snapshot
  //! {activity, volatility, trend, signal_norm}; this is the last time those
  //! names appear in the composer.
  C.onFeature = (f) => {
    const now = C.clock.now();
    const dt = C.sigLastTick == null ? 0.25 : clip(now - C.sigLastTick, 0.01, 5.0);
    const xRaw = Math.max(f.activity, f.volatility);
    const eNorm = C.sigNormNow("x", xRaw);
    const vNorm = C.sigNormNow("v", f.volatility);
    const targets = {
      energy: eNorm,
      stability: 1 - vNorm,
      center: clip(f.signal_norm, -1, 1),
      tilt: clip(f.trend, -1, 1),
    };
    C.rawLast = { x: xRaw, v: f.volatility };
    C.sigLastTick = now;
    for (const k of Object.keys(targets)) {
      const alpha = clip(dt / sigTaus[k], 0, 1);
      C.sig[k] = C.sig[k] + (targets[k] - C.sig[k]) * alpha;
    }
    //! mirror the products so held bed voices track the plant in real time
    C.onSig?.(C.sig);
    C.sigHistory.unshift({ t: now, energy: C.sig.energy, stability: C.sig.stability, center: C.sig.center, tilt: C.sig.tilt });
    if (C.sigHistory.length > sigHistoryMax) C.sigHistory.pop();
  };

  //! Weather: the plant's hours-scale character, the current hour's mean
  //! energy RANKED against the rolling one-hour means of the trailing day,
  //! so a typical hour reads 0.5. Neutral 0.5 on cold start (<2h) or a flat
  //! day. The day buffer holds one 30 s sample: {t, e, x, v}.
  C.weatherRank = () => {
    if (C.dayHist.length < 240) return 0.5;
    const es = C.dayHist.map((s) => s.e);
    const win = 120;
    const hour = mean(es.slice(0, Math.min(win, es.length)));
    const means = [];
    let acc = 0;
    for (let i = 0; i < es.length; i++) {
      acc += es[i];
      if (i >= win) acc -= es[i - win];
      if (i >= win - 1) means.push(acc / win);
    }
    means.sort((a, b) => a - b);
    const hi = means[Math.min(Math.trunc(means.length * 0.95), means.length - 1)];
    const lo = means[Math.trunc(means.length * 0.05)];
    return hi - lo < 0.03 ? 0.5 : rankBelow(means, hour);
  };

  const rebuildSorted = () => {
    C.rawSorted = {
      x: sortNum(C.dayHist.map((s) => s.x).filter((v) => v != null)),
      v: sortNum(C.dayHist.map((s) => s.v).filter((v) => v != null)),
    };
  };

  //! Day memory survives reloads: per room, lines "unixTime e x v" (-1 for a
  //! missing raw), the live project's file format. A room with no record
  //! (or a stale one, older than an hour) seeds from the freshest sibling:
  //! one plant, one day.
  C.weatherSave = () => {
    if (!persist) return;
    const unixNow = Date.now() / 1000, elNow = C.clock.now();
    const lines = C.dayHist.map((s) =>
      `${Math.round(unixNow - (elNow - s.t))} ${Math.round(s.e * 1e4) / 1e4} ${s.x == null ? -1 : Math.round(s.x * 100) / 100} ${s.v == null ? -1 : Math.round(s.v * 100) / 100}`);
    try { persist.save(C.roomName ?? "", lines.join("\n") + "\n"); } catch (e) { C.warn("[weather] save failed", e); }
  };

  C.weatherLoad = () => {
    if (!persist) return 0;
    try {
      const unixNow = Date.now() / 1000, elNow = C.clock.now();
      const own = C.roomName ?? "";
      const cands = [own, ...persist.siblings().filter((r) => r !== own)];
      const fresh = (r) => { const rec = persist.load(r); return rec && unixNow - rec.mtime < 3600 ? rec : null; };
      let rec = fresh(own);
      if (!rec) for (const r of cands) { rec = fresh(r); if (rec) break; }
      if (!rec) for (const r of cands) { rec = persist.load(r); if (rec) break; }
      if (!rec) return 0;
      let n = 0, oldest = 0;
      for (const line of rec.text.split("\n")) {
        const parts = line.trim().split(" ");
        if (parts.length !== 2 && parts.length !== 4) continue;
        const age = unixNow - parseFloat(parts[0]);
        const x = parts.length === 4 ? parseFloat(parts[2]) : -1;
        const v = parts.length === 4 ? parseFloat(parts[3]) : -1;
        if (age >= 0 && age < 86400) {
          C.dayHist.push({ t: elNow - age, e: parseFloat(parts[1]), x: x < 0 ? null : x, v: v < 0 ? null : v });
          n++;
          oldest = Math.max(oldest, age);
        }
      }
      C.dayHist.sort((a, b) => b.t - a.t);
      rebuildSorted();
      C.log(`[weather] restored ${n} samples spanning ${(oldest / 3600).toFixed(1)}h (rank buffer ${C.rawSorted.x.length})`);
      return n;
    } catch (e) { C.warn("[weather] load failed", e); return 0; }
  };

  //! weatherPoll: every 30 s push a day sample, re-sort the rank buffers,
  //! re-rank the weather; save every tenth tick.
  C.weatherPoll = function* () {
    let tick = 0;
    for (;;) {
      const now = C.clock.now();
      C.dayHist.unshift({ t: now, e: C.sigOver(30, "energy"), x: C.rawLast ? C.rawLast.x : null, v: C.rawLast ? C.rawLast.v : null });
      if (C.dayHist.length > dayHistMax) C.dayHist.pop();
      rebuildSorted();
      C.sig.weather = C.weatherRank();
      tick++;
      if (tick % 10 === 0) C.weatherSave();
      yield { sec: 30 };
    }
  };

  //! The one door consumers use: weatherDepth scales how far the session
  //! bends around neutral.
  C.weatherEff = () => 0.5 + ((C.sig.weather ?? 0.5) - 0.5) * (C.mood?.weatherDepth ?? 0.6);

  //! bedSig(): the four products for the held voices (the ~sigBus read).
  C.bedSig = () => ({ energy: C.sig.energy, stab: C.sig.stability, center: C.sig.center, tilt: C.sig.tilt });
}

//! localStoragePersist(): the page's day memory, one key per room.
export function localStoragePersist(storage = globalThis.localStorage, prefix = "plantpulse_energy_history_") {
  const key = (room) => prefix + room;
  return {
    load(room) {
      try {
        const text = storage.getItem(key(room));
        if (text == null) return null;
        const mtime = parseFloat(storage.getItem(key(room) + ".mtime") || "0");
        return { text, mtime };
      } catch { return null; }
    },
    save(room, text) {
      storage.setItem(key(room), text);
      storage.setItem(key(room) + ".mtime", String(Date.now() / 1000));
    },
    siblings() {
      const out = [];
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k && k.startsWith(prefix) && !k.endsWith(".mtime")) out.push(k.slice(prefix.length));
        }
      } catch { out.length = 0; }   //! storage unavailable: the model warms from the ceiling
      return out;
    },
  };
}

export function memoryPersist() {
  const store = new Map();
  return {
    load: (room) => store.get(room) ?? null,
    save: (room, text) => store.set(room, { text, mtime: Date.now() / 1000 }),
    siblings: () => [...store.keys()],
  };
}
