//! sampler.js: the sample packs on the page, lifted from the live project's
//! roll page. Packs come from /api/samples/<pack>/manifest (tools/fetch-samples
//! builds them): the Salamander piano at three velocity layers, the
//! Philharmonia cello, the piano's key-up resonances, hammer and pedal
//! noises. Files are fetched and decoded once (the route is immutable) and
//! kept resident.

export const PACKS = { piano: "piano_web_v1", cello: "cello_web_v1", release: "piano_release_web_v1" };

export function makeSampler(ctx, { fetchImpl = globalThis.fetch, onCount = null } = {}) {
  const manifests = {};
  const buffers = new Map();
  let loaded = 0, total = 0, ready = false;

  async function loadManifests() {
    for (const [inst, pack] of Object.entries(PACKS)) {
      try {
        const r = await fetchImpl(`/api/samples/${pack}/manifest`, { cache: "force-cache" });
        if (!r.ok) throw new Error(String(r.status));
        manifests[inst] = await r.json();
      } catch (e) { manifests[inst] = null; }
    }
    return manifests;
  }
  const has = (inst) => manifests[inst] != null && manifests[inst].notes != null;

  //! nearestSample(inst, midi, layerHint): the nearest recorded pitch and
  //! the two layers bracketing the engine's velocity (1..16), crossfaded so
  //! consecutive notes at nearby velocities are different blends
  function nearestSample(inst, midi, layerHint) {
    const m = manifests[inst];
    if (!m || !m.notes) return null;
    let best = null, bestD = 1e9;
    for (const [name, info] of Object.entries(m.notes)) {
      const d = Math.abs(info.midi - midi);
      if (d < bestD) { bestD = d; best = { name, info }; }
    }
    if (!best) return null;
    const layers = Object.keys(best.info.layers).map(Number).sort((a, b) => a - b);
    let lo = layers[0], hi = layers[layers.length - 1];
    for (const L of layers) { if (L <= layerHint) lo = L; }
    for (let i = layers.length - 1; i >= 0; i--) { if (layers[i] >= layerHint) hi = layers[i]; }
    const t = hi === lo ? 0 : Math.min(1, Math.max(0, (layerHint - lo) / (hi - lo)));
    return {
      url: m.baseUrl + encodeURIComponent(best.info.layers[String(lo)]),
      url2: hi !== lo ? m.baseUrl + encodeURIComponent(best.info.layers[String(hi)]) : null,
      blend: t, sampleMidi: best.info.midi,
    };
  }
  //! the key-up: the release resonance for a note (S below layer 6, L above),
  //! the chromatic hammer noise, the pedal noises
  function releaseSample(midi, layerHint) {
    const m = manifests.release; if (!m || !m.notes) return null;
    let best = null, bestD = 1e9;
    for (const info of Object.values(m.notes)) { const d = Math.abs(info.midi - midi); if (d < bestD) { bestD = d; best = info; } }
    if (!best) return null;
    const L = layerHint < 6 ? "S" : "L";
    const f = best.layers[L] || best.layers.L || best.layers.S;
    return { url: m.baseUrl + encodeURIComponent(f), sampleMidi: best.midi };
  }
  function hammerSample(midi) {
    const m = manifests.release; const ex = m && m.extras; if (!ex || !ex.rel) return null;
    const f = ex.rel[String(Math.min(108, Math.max(21, Math.round(midi))))];
    return f ? m.baseUrl + encodeURIComponent(f) : null;
  }
  function pedalSample(down) {
    const m = manifests.release; const ex = m && m.extras; if (!ex) return null;
    const list = down ? ex.pedalD : ex.pedalU; if (!list || !list.length) return null;
    return m.baseUrl + encodeURIComponent(list[Math.floor(Math.random() * list.length)]);
  }

  function getBuffer(url) {
    if (!url) return null;
    if (buffers.has(url)) return buffers.get(url);
    const p = fetchImpl(url, { cache: "force-cache" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.arrayBuffer(); })
      .then((ab) => ctx.decodeAudioData(ab))
      .then((buf) => { buffers.set(url, buf); loaded++; onCount?.(loaded, total); return buf; })
      .catch((e) => { buffers.delete(url); console.warn("sample failed", url, e); return null; });
    buffers.set(url, p);
    return p;
  }
  const bufferNow = (url) => { const b = url ? buffers.get(url) : null; return b && typeof b.then !== "function" ? b : null; };

  //! load the whole instrument before a note sounds: every piano layer and
  //! every cello bow, four at a time, plus the release pack
  async function warmCache() {
    const jobs = [];
    const pm = manifests.piano;
    if (pm && pm.notes) for (const info of Object.values(pm.notes)) for (const f of Object.values(info.layers)) jobs.push(pm.baseUrl + encodeURIComponent(f));
    const cm = manifests.cello;
    if (cm && cm.notes) for (const info of Object.values(cm.notes)) jobs.push(cm.baseUrl + encodeURIComponent(info.layers["1"]));
    const rm = manifests.release;
    if (rm && rm.urls) for (const f of Object.values(rm.urls)) jobs.push(rm.baseUrl + encodeURIComponent(f));
    if (rm && rm.extras) {
      for (const f of Object.values(rm.extras.rel ?? {})) jobs.push(rm.baseUrl + encodeURIComponent(f));
      for (const f of [...(rm.extras.pedalD ?? []), ...(rm.extras.pedalU ?? [])]) jobs.push(rm.baseUrl + encodeURIComponent(f));
    }
    const urls = [...new Set(jobs)];
    total = urls.length; loaded = 0;
    for (let i = 0; i < urls.length; i += 4) await Promise.all(urls.slice(i, i + 4).map(getBuffer));
    ready = urls.length > 0;
    return ready;
  }

  //! playOneShot(url, when, gain, rate, dest, holdSec, fadeSec)
  function playOneShot(url, when, gain, rate, dest, holdSec, fadeSec) {
    const b = bufferNow(url); if (!b) return;
    const src = ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = rate || 1;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, when);
    if (holdSec != null) { g.gain.setValueAtTime(gain, when + holdSec); g.gain.linearRampToValueAtTime(0.0001, when + holdSec + (fadeSec || 1)); }
    src.connect(g); g.connect(dest); src.start(when);
    src.stop(when + (holdSec != null ? holdSec + (fadeSec || 1) + 0.05 : Math.min(4, b.duration) + 0.05));
  }

  return { manifests, loadManifests, has, nearestSample, releaseSample, hammerSample, pedalSample, getBuffer, bufferNow, warmCache, playOneShot,
    get ready() { return ready; }, get loaded() { return loaded; }, get total() { return total; } };
}
