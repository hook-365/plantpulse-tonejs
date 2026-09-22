//! notelog.js: the note feed and the take receipts. In the live project
//! every fired note goes two ways at once (composer/voices.scd
//! ~noteLogWrite): a JSONL line into the take's note log and an OSC /note
//! to the bridge, which the roll page polls. Here both are one ring in the
//! page: the audio layer and the roll consume records off it, and the same
//! lines are kept for the take so tools/take-review can grade browser
//! takes exactly as it grades the stream's.
//! Record shape (the bridge's): {seq, t, b, d, m, v, a, r, e, syn, bpm} with
//! t the note's audio time, b the beat since the take's bar 0, d the
//! duration in beats, m midi, v the sampler layer 1..16, a amp, r the role,
//! e the release seconds, syn the instrument. Marks: {seq, t, mark, b, text}.

export function install(C, { ringSize = 4096, onTake = null } = {}) {
  C.noteRing = [];
  C.noteSeq = 0;
  C.noteLogBeat0 = 0;
  C.noteLog = null;       //! {lines: [], meta} while a take is open
  C.chordMarkPending = false;

  const push = (rec) => {
    rec.seq = ++C.noteSeq;
    C.noteRing.push(rec);
    if (C.noteRing.length > ringSize) C.noteRing.shift();
    return rec;
  };

  //! noteLogWrite(role, midinote, amp, dur, vel, extra, synth): dur in
  //! seconds (the beat is the clock's logical beat, so the note's time is
  //! exact), extra an array like ['rel', 1.2, 'atk', 0.01] as in sclang.
  C.noteLogWrite = (role, midinote, amp, dur, vel, extra, synth) => {
    const clock = C.clock;
    const beat = clock.beats - (C.noteLogBeat0 ?? 0);
    let rel = 0;
    if (Array.isArray(extra)) {
      const i = extra.indexOf("rel");
      if (i >= 0) rel = extra[i + 1];
    }
    const line = `{"b":${r3(beat)},"d":${r3(dur / clock.beatDur)},"m":${r2(midinote)},"v":${vel},"a":${r4(amp)},"r":"${role ?? "x"}","e":${r2(rel)}}`;
    if (C.noteLog) C.noteLog.lines.push(line);
    const rec = push({
      t: clock.beatsToSecs(clock.beats), b: beat, d: dur / clock.beatDur, dur,
      m: midinote, v: vel, a: amp, r: role ?? "x", e: rel, syn: synth ?? "x",
      bpm: clock.tempo * 60, x: extra ?? null,
    });
    C.onNote?.(rec);
    return rec;
  };

  //! noteLogMark(kind, text): seams, hook freeze, the cello's entrance, the
  //! players' words; on the same stream so the ruler can show them.
  C.noteLogMark = (kind, text = "") => {
    const clock = C.clock;
    const beat = clock.beats - (C.noteLogBeat0 ?? 0);
    if (C.noteLog) C.noteLog.lines.push(`{"mark":"${kind}","b":${r3(beat)},"t":"${String(text).replace(/"/g, '\\"')}"}`);
    const rec = push({ t: clock.beatsToSecs(clock.beats), mark: kind, b: beat, text: String(text) });
    C.onMark?.(rec);
    return rec;
  };

  //! takeOpen(meta): a take = one track. The header line carries the tempo,
  //! mood, root and scale; the first chord's mark goes in right after it.
  C.takeOpen = (meta) => {
    C.takeClose();
    const clock = C.clock;
    C.noteLogBeat0 = clock.beats;
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    C.noteLog = {
      meta: { ...meta, wav_filename: `${stamp}__${meta.preset_name ?? "unknown"}__web` },
      lines: [`{"header":1,"bpm":${r2(clock.tempo * 60)},"mood":"${C.mood?.name ?? "unknown"}","root_midi":${C.rootMidi ?? 0},"scale":"${C.scaleName ?? "unknown"}"}`],
      opened: clock.now(),
    };
    C.chordMarkPending = true;
    if (C.chordMark) { C.chordMarkPending = false; C.chordMark(); }
    return C.noteLog.meta.wav_filename;
  };

  C.takeClose = () => {
    const take = C.noteLog;
    if (!take) return null;
    C.noteLog = null;
    take.meta.duration_s = Math.round((C.clock.now() - take.opened) * 10) / 10;
    onTake?.(take);
    return take;
  };

  //! notesSince(seq): what the roll polls, the bridge's answer shape.
  C.notesSince = (seq = 0) => C.noteRing.filter((r) => r.seq > seq);
}

const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;
const r4 = (x) => Math.round(x * 10000) / 10000;

//! postTake(take, url): the page's delivery; the server spools it under
//! recordings/ (server.py take_post). Best effort: a failed post is logged,
//! the music never waits on it.
export async function postTake(take, url = "/api/take", fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta: take.meta, lines: take.lines }) });
    return r.ok;
  } catch (e) { console.warn("[take] post failed", e); return false; }
}

//! downloadTake(take): the same file, saved by the browser (no server needed).
export function downloadTake(take, doc = globalThis.document) {
  const blob = new Blob([take.lines.join("\n") + "\n"], { type: "application/x-ndjson" });
  const a = doc.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${take.meta.wav_filename}.notes.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
