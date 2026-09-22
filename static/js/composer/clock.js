//! clock.js: TempoClock and SystemClock for the port. The composer's
//! Routines become generators: `yield 4` waits four beats on the beat
//! clock, `yield {sec: 30}` waits thirty seconds on the wall (SystemClock).
//! Semantics kept from sclang because the music depends on them:
//!  - a tempo change re-anchors at the current beat: elapsed beats stay
//!    where they were, only future beats move (the ritardando re-sets
//!    tempo eight times a bar from inside the conductor);
//!  - a routine started with quant [4, phase] begins at the next multiple
//!    of 4 beats plus phase (the pad at 0.02, the left hand at 0.05 ...);
//!  - inside a scheduled callback, `beats` and `now()` are LOGICAL (the
//!    due beat / its time), not wall time, so every note a routine fires
//!    lands sample-accurately at beatsToSecs(beats) however late the tick
//!    that ran it.
//! `now` is injected: the AudioContext's currentTime in the page, a virtual
//! clock in tests (tests/virtual-clock.mjs advances it to each due time).

class Heap {
  constructor() { this.a = []; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  push(item) {
    const a = this.a; a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].key <= a[i].key) break;
      [a[p], a[i]] = [a[i], a[p]]; i = p;
    }
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l].key < a[m].key) m = l;
        if (r < a.length && a[r].key < a[m].key) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  }
}

let routineSeq = 0;

export class BeatClock {
  constructor(now, { tempo = 1.0 } = {}) {
    this._now = now;
    this.beat0 = 0;
    this.time0 = now();
    this._tempo = tempo;
    this.beatQ = new Heap();   //! key: beat
    this.timeQ = new Heap();   //! key: seconds
    this._logical = null;      //! {beat, time} while running a callback
  }

  //! wall time, or the logical time inside a callback
  now() { return this._logical ? this._logical.time : this._now(); }
  wallNow() { return this._now(); }
  get tempo() { return this._tempo; }
  set tempo(v) {
    const t = this.now();
    this.beat0 = this.secsToBeats(t);
    this.time0 = t;
    this._tempo = v;
  }
  get beatDur() { return 1 / this._tempo; }
  get beats() { return this._logical ? this._logical.beat : this.secsToBeats(this._now()); }
  beatsToSecs(b) { return this.time0 + (b - this.beat0) / this._tempo; }
  secsToBeats(t) { return this.beat0 + (t - this.time0) * this._tempo; }

  //! nextTimeOnGrid(quant, phase): sclang's Quant rule for a routine start.
  nextTimeOnGrid(quant = 4, phase = 0) {
    const b = this.beats;
    let next = Math.ceil((b - phase) / quant) * quant + phase;
    if (next < b) next += quant;
    return next;
  }

  //! sched(beats, fn) / schedAbs(beat, fn): one-shot on the beat clock.
  sched(delta, fn) { return this.schedAbs(this.beats + delta, fn); }
  schedAbs(beat, fn) {
    const item = { key: beat, fn, kind: "beat", cancelled: false };
    this.beatQ.push(item);
    return item;
  }
  //! schedSec(seconds, fn): one-shot on the wall (SystemClock.sched).
  schedSec(delta, fn) {
    const item = { key: this.now() + delta, fn, kind: "sec", cancelled: false };
    this.timeQ.push(item);
    return item;
  }

  //! play(genFn, {quant, phase, sec}): run a generator as a routine.
  //! Yields: a number = wait that many beats; {sec: s} = wait s seconds;
  //! nothing/return = the routine ends. Returns a handle with stop().
  play(genFn, { quant = null, phase = 0, sec = false, name = null } = {}) {
    const gen = genFn();
    const handle = { id: ++routineSeq, name, gen, stopped: false, stop() { this.stopped = true; } };
    const step = () => {
      if (handle.stopped) return;
      let r;
      try { r = gen.next(); } catch (e) { handle.stopped = true; handle.error = e; throw e; }
      if (r.done || handle.stopped) { handle.stopped = true; return; }
      const w = r.value;
      if (typeof w === "number") this.schedAbs(this.beats + w, step);
      else if (w && typeof w.sec === "number") this.schedSec(w.sec, step);
      else if (w && typeof w.beat === "number") this.schedAbs(w.beat, step);
      else this.schedAbs(this.beats + 1, step);
    };
    if (sec) this.schedSec(0, step);
    else if (quant == null) this.schedAbs(this.beats, step);
    else this.schedAbs(this.nextTimeOnGrid(quant, phase), step);
    return handle;
  }

  //! the earliest due item across both queues, as [seconds, item]
  _peek() {
    let best = null, bestT = Infinity;
    while (this.beatQ.size && this.beatQ.peek().cancelled) this.beatQ.pop();
    while (this.timeQ.size && this.timeQ.peek().cancelled) this.timeQ.pop();
    if (this.beatQ.size) { const it = this.beatQ.peek(); const t = this.beatsToSecs(it.key); if (t < bestT) { bestT = t; best = it; } }
    if (this.timeQ.size) { const it = this.timeQ.peek(); if (it.key < bestT) { bestT = it.key; best = it; } }
    return best ? [bestT, best] : null;
  }

  //! advance(toSeconds): run everything due up to toSeconds, in order,
  //! each callback seeing its own logical beat and time. Returns the count.
  advance(toSeconds) {
    let n = 0;
    for (;;) {
      const p = this._peek();
      if (!p || p[0] > toSeconds) break;
      const [t, item] = p;
      if (item.kind === "beat") this.beatQ.pop(); else this.timeQ.pop();
      this._logical = { time: t, beat: item.kind === "beat" ? item.key : this.secsToBeats(t) };
      try { item.fn(); } finally { this._logical = null; }
      n++;
      if (n > 5000000) throw new Error("clock: runaway (5M items in one advance)");
    }
    return n;
  }

  //! tick(lookahead): the page's driver; runs what is due within lookahead.
  tick(lookahead = 0.15) { return this.advance(this._now() + lookahead); }

  //! nextDue(): seconds of the earliest item, or null (tests wait on it).
  nextDue() { const p = this._peek(); return p ? p[0] : null; }
}

//! startTicker(clock, {worker}): drive the clock from a Worker so a
//! background tab keeps time (main-thread timers are throttled to 1 Hz
//! there); lookahead widens when hidden so nothing due is missed.
export function startTicker(clock, { workerUrl = null, interval = 25, foreground = 0.15, hidden = 1.5, doc = globalThis.document } = {}) {
  const look = () => (doc && doc.hidden ? hidden : foreground);
  let stop;
  if (workerUrl && globalThis.Worker) {
    const w = new Worker(workerUrl);
    w.postMessage({ interval });
    w.onmessage = () => clock.tick(look());
    stop = () => w.terminate();
  } else {
    const id = setInterval(() => clock.tick(look()), interval);
    stop = () => clearInterval(id);
  }
  return { stop };
}
