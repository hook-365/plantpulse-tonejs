//! signal.js: the plant's raw features from its readings. A port of the live
//! project's bridge/signal_processor.py (itself "a Python port of the JS
//! math in static/index.html", so this is the maths coming home). Reads
//! arrive as volts from /api/stream; the model works in millivolts.
//! This file and composer/energy.js are the only two allowed to name the
//! raw features (activity, volatility, trend, signal_norm); everything
//! downstream reads the four signals energy.js makes of them (tools/gate).

export const EMA_ALPHA = 0.1;
export const RAW_WINDOW_SIZE = 5;
export const VOLATILITY_WINDOW = 30;
//! Recalibrated 2026-04-20 on a single-leaf placement: 5-min stddev 57 mV,
//! range +-135 mV. Without the retune volatility capped ~57% and activity
//! deltas shrank in proportion.
export const VOLATILITY_SCALE_MV = 75.0;
export const ACTIVITY_DELTA_CLIP_MV = 50.0;
export const ACTIVITY_DELTA_FULL_MV = 70.0;
//! signal_norm's min/max window: 2400 samples at ~4 Hz = 10 min. All-time
//! min/max compressed the range for good after one storm peak.
export const SIGNAL_NORM_WINDOW = 2400;

function popStd(xs) {
  const n = xs.length;
  if (!n) return 0;
  let m = 0;
  for (const v of xs) m += v;
  m /= n;
  let s = 0;
  for (const v of xs) s += (v - m) * (v - m);
  return Math.sqrt(s / n);
}

export class SignalProcessor {
  constructor() {
    this.rawWindow = [];
    this.volBuffer = [];
    this.normWindow = [];
    this.ema = null;
    this.lastRawForActivity = 0.0;
    this.activity = 0.0;
    this.volatility = 0.0;
    this.trendSmoothed = 0.0;
    this.trend = 0.0;
  }

  //! process(mv) -> {raw, smoothed, activity, volatility, trend, signal_norm}
  process(mv) {
    this.rawWindow.push(mv);
    if (this.rawWindow.length > RAW_WINDOW_SIZE) this.rawWindow.shift();
    let avg = 0;
    for (const v of this.rawWindow) avg += v;
    avg /= this.rawWindow.length;

    this.normWindow.push(avg);
    if (this.normWindow.length > SIGNAL_NORM_WINDOW) this.normWindow.shift();

    this.ema = this.ema == null ? avg : EMA_ALPHA * avg + (1.0 - EMA_ALPHA) * this.ema;

    const rawDelta = Math.abs(avg - this.lastRawForActivity);
    this.lastRawForActivity = avg;
    const delta = Math.min(rawDelta, ACTIVITY_DELTA_CLIP_MV);
    const pct = Math.min(100.0, (delta / ACTIVITY_DELTA_FULL_MV) * 100.0);
    this.activity += (pct - this.activity) * 0.3;

    this.volBuffer.push(avg);
    if (this.volBuffer.length > VOLATILITY_WINDOW) this.volBuffer.shift();
    if (this.volBuffer.length >= 5) {
      const buf = this.volBuffer;
      const vnorm = Math.min(100.0, (popStd(buf) / VOLATILITY_SCALE_MV) * 100.0);
      this.volatility += (vnorm - this.volatility) * 0.1;
      const half = Math.floor(buf.length / 2);
      if (half >= 3) {
        const oStd = popStd(buf.slice(0, half));
        const nStd = popStd(buf.slice(half));
        const denom = Math.max(1.0, (nStd + oStd) / 2);
        const rawTrend = (nStd - oStd) / denom;
        this.trendSmoothed += (rawTrend - this.trendSmoothed) * 0.05;
        this.trend = Math.max(-1.0, Math.min(1.0, this.trendSmoothed));
      }
    }

    let nwMin = Infinity, nwMax = -Infinity;
    for (const v of this.normWindow) { if (v < nwMin) nwMin = v; if (v > nwMax) nwMax = v; }
    const span = Math.max(1e-6, nwMax - nwMin);
    const center = (nwMax + nwMin) / 2;
    const signal_norm = Math.max(-1.0, Math.min(1.0, (this.ema - center) / (span / 2)));

    return {
      raw: avg,
      smoothed: this.ema,
      activity: this.activity,
      volatility: this.volatility,
      trend: this.trend,
      signal_norm,
    };
  }
}

//! wireStream(url, onFeature, {channel}): the browser's ear. Opens the SSE
//! stream, keeps one processor per channel, and calls onFeature(snapshot)
//! for the chosen channel (ch1, the clips). {"hb":1} frames only prove the
//! server is alive. Reconnects itself; EventSource retries on its own.
export function wireStream(url, onFeature, { channel = "ch1", EventSourceImpl = globalThis.EventSource } = {}) {
  const procs = new Map();
  const es = new EventSourceImpl(url);
  es.onmessage = (ev) => {
    let d;
    try { d = JSON.parse(ev.data); } catch { return; }
    if (d == null || d.hb) return;
    const ch = d.ch ?? "ch1";
    if (ch !== channel) return;
    if (!procs.has(ch)) procs.set(ch, new SignalProcessor());
    onFeature(procs.get(ch).process(Number(d.v) * 1000.0));
  };
  return { close: () => es.close(), source: es };
}
