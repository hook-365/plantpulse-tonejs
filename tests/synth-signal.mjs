//! A synthetic plant in volts, the shape tools/simulate-signal publishes:
//! a diurnal drift, a random walk, pink-ish noise and bursts whose rate
//! rises through an afternoon and falls through a night. Enough for the
//! ranks to have something to rank; not a plant.
import { mulberry32 } from "./rng.mjs";

export function makeSignal({ seed = 1, daySeconds = 86400, quiet = false } = {}) {
  const rnd = mulberry32(seed);
  const gauss = () => { const u = Math.max(rnd(), 1e-12); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const st = { walk: 0, burst: 0, pink: [0, 0, 0, 0, 0] };
  const pink = () => {
    const w = gauss();
    [0.02, 0.06, 0.15, 0.35, 0.7].forEach((a, i) => { st.pink[i] += (w - st.pink[i]) * a; });
    return st.pink.reduce((a, b) => a + b, 0) / 5;
  };
  return (t) => {
    if (quiet) return 0.05;   //! a dead-flat day: no activity, no volatility, weather must read neutral
    const day = (t % daySeconds) / daySeconds;
    const diurnal = 0.012 * Math.sin(2 * Math.PI * (day - 0.25));
    const live = quiet ? 0.05 : 0.5 + 0.5 * Math.sin(2 * Math.PI * (day - 0.2));
    st.walk += gauss() * 0.00025;
    st.walk *= 0.999;
    if (rnd() < 0.004 + 0.05 * live ** 3) st.burst = (rnd() < 0.5 ? -1 : 1) * (0.008 + rnd() * 0.032) * (0.4 + live);
    st.burst *= 0.90;
    return 0.05 + diurnal + st.walk + st.burst + pink() * (0.0015 + 0.004 * live);
  };
}

//! feed(clock, proc, onFeature, signal, {rate}): a routine on the clock's
//! wall timeline that pushes one reading per tick through the processor.
export function feed(clock, proc, onFeature, signal, { rate = 4 } = {}) {
  return clock.play(function* () {
    for (;;) {
      onFeature(proc.process(signal(clock.now()) * 1000));
      yield { sec: 1 / rate };
    }
  }, { sec: true, name: "feed" });
}
