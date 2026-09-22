//! tick-worker.js: a metronome that a background tab cannot throttle to
//! 1 Hz. Posts an empty message every `interval` ms; the page's clock runs
//! what is due within its lookahead on each one.
let timer = null;
self.onmessage = (ev) => {
  const interval = (ev.data && ev.data.interval) || 25;
  if (timer) clearInterval(timer);
  timer = setInterval(() => self.postMessage(0), interval);
};
