//! A BeatClock on a virtual timeline: nothing waits on the wall. runUntil(t)
//! executes every routine due up to t in order, each seeing its logical
//! time, then moves "now" to t. A day of signal at 4 Hz is ~350k items and
//! runs in seconds.
import { BeatClock } from "../static/js/composer/clock.js";

export class VirtualClock extends BeatClock {
  constructor({ tempo = 1.0, start = 0 } = {}) {
    let vnow = start;
    super(() => vnow, { tempo });
    this._setNow = (t) => { vnow = t; };
  }
  runUntil(t) {
    const n = this.advance(t);
    this._setNow(t);
    return n;
  }
  //! runFor(seconds): relative to the current virtual now
  runFor(s) { return this.runUntil(this.wallNow() + s); }
}
