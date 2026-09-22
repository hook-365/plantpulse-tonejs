//! sc.js: the SuperCollider idioms the composer was written in, so the port
//! reads like the source (docs/COMPOSER.md, "The translation table").
//! Randomness is free by law (no plant-seeded RNG); tests inject a seeded
//! generator through setRng so a run is reproducible there and only there.

let rng = Math.random;
export function setRng(f) { rng = f ?? Math.random; }
export function rand1() { return rng(); }

//! rrand(a, b): uniform in [a, b]; on two integers an INTEGER draw, a..b
//! inclusive, as sclang does (trackDurRange, bar counts, run lengths).
export function rrand(a, b) {
  if (Number.isInteger(a) && Number.isInteger(b)) {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    return lo + Math.floor(rng() * (hi - lo + 1));
  }
  return a + rng() * (b - a);
}
export function exprand(a, b) { return a * Math.exp(Math.log(b / a) * rng()); }
//! p.coin: true with probability p; 0.coin is always false, 1.coin always true.
export function coin(p) { return rng() < p; }
//! array.choose: uniform. Empty array -> undefined (sclang: nil).
export function choose(xs) { return xs.length ? xs[Math.floor(rng() * xs.length)] : undefined; }
//! array.wchoose(weights): weights are normalised here (every sclang call
//! site did .normalizeSum first); returns the element.
export function wchoose(xs, ws) {
  let sum = 0;
  for (const w of ws) sum += w;
  if (!(sum > 0)) return choose(xs);
  let r = rng() * sum;
  for (let i = 0; i < xs.length; i++) {
    r -= ws[i];
    if (r < 0) return xs[i];
  }
  return xs[xs.length - 1];
}
//! mean.gauss(dev): sclang's Box-Muller, unbounded; callers clip.
export function gauss(mean, dev) {
  const u = Math.max(rng(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.sin(2 * Math.PI * rng()) * dev + mean;
}

export const clip = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const linlin = (x, a, b, c, d) => (x <= a ? c : x >= b ? d : (x - a) / (b - a) * (d - c) + c);
export const linexp = (x, a, b, c, d) => (x <= a ? c : x >= b ? d : Math.pow(d / c, (x - a) / (b - a)) * c);
export const explin = (x, a, b, c, d) => (x <= a ? c : x >= b ? d : Math.log(x / a) / Math.log(b / a) * (d - c) + c);
//! a div: b — integer division flooring toward -inf (sclang's div).
export const div = (a, b) => Math.floor(a / b);
//! a mod: b — always non-negative for b > 0 (JS % is not).
export const mod = (a, b) => ((a % b) + b) % b;
//! x.round(q): to the nearest multiple of q, halves up (sclang: floor(x/q + 0.5) * q).
export const roundTo = (x, q = 1) => Math.floor(x / q + 0.5) * q;
export const asInteger = (x) => Math.trunc(x);
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
export const normalizeSum = (ws) => { const s = sum(ws); return s > 0 ? ws.map((w) => w / s) : ws.map(() => 1 / ws.length); };
export const maxItem = (xs) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);
export const minItem = (xs) => xs.reduce((a, b) => (b < a ? b : a), Infinity);
export const dbamp = (db) => Math.pow(10, db / 20);
export const ampdb = (a) => 20 * Math.log10(a);
export const midicps = (m) => 440 * Math.pow(2, (m - 69) / 12);
export const cpsmidi = (f) => 69 + 12 * Math.log2(f / 440);
//! x.fold(lo, hi) and x.wrap(lo, hi) on numbers, as sclang.
export function wrap(x, lo, hi) { const r = hi - lo; return lo + mod(x - lo, r); }
export function fold(x, lo, hi) {
  const r = hi - lo, r2 = 2 * r;
  let y = mod(x - lo, r2);
  if (y > r) y = r2 - y;
  return lo + y;
}
//! sclang's `a ? b` replaces only nil; `??` matches (never store null for 0).
export const nilOr = (x, d) => (x == null ? d : x);
