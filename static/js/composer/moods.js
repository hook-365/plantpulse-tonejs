//! moods.js: loader for static/composer/moods.json (composer/moods.scd in
//! the live project). The closed-schema law lives in tools/gate; this is
//! belt and braces at boot: an unknown mood name fails loudly and nothing
//! runs without data. Rooms are moods: applyMood(name) sets C.mood and the
//! tempo, and tells the audio layer (C.onMoodApplied) about the master
//! chain's room, mix, damp, low-cut, ceiling and trim.

export function loadMoods(C, data) {
  const moods = data && data.moods;
  if (!Array.isArray(moods) || !moods.length) throw new Error("moods.json: no moods");
  C.moods = {};
  C.moodOrder = [];
  for (const m of moods) {
    if (typeof m.name !== "string") throw new Error("moods.json: a mood has no name");
    if (C.moods[m.name]) throw new Error(`moods.json: duplicate mood ${m.name}`);
    C.moods[m.name] = m;
    C.moodOrder.push(m.name);
  }
  C.log(`[moods] loaded: ${C.moodOrder.join(", ")}`);
  return C.moodOrder;
}

export function applyMood(C, name) {
  const mood = C.moods[name];
  if (!mood) throw new Error(`moods: unknown mood ${name} (have ${C.moodOrder.join(", ")})`);
  C.mood = mood;
  C.clock.tempo = mood.bpm / 60.0;
  C.onMoodApplied?.(mood);
  C.log(`[moods] applied ${name} (bpm ${mood.bpm})`);
  return mood;
}

//! the room table (static/composer/rooms.json): name, mood, label, blurb,
//! image; the live project's stream fields (host, oscPort, mounts, art)
//! are ignored here, and lofi is not offered: its kits and voices are
//! licensed packs (NOTICE.md).
export function loadRooms(data, { exclude = ["lofi"] } = {}) {
  const rooms = (data && data.rooms) || [];
  return {
    default: exclude.includes(data.default) ? (rooms.find((r) => !exclude.includes(r.name))?.name ?? null) : data.default,
    rooms: rooms.filter((r) => !exclude.includes(r.name)).map(({ name, mood, label, blurb, image }) => ({ name, mood, label, blurb, image })),
  };
}
