//! app.js: the page's entry for the composer port. Loads the rooms and
//! moods, wires the plant's stream through signal.js into the energy
//! model, and runs the clock. Until the cut-over the old engine stays the
//! page's default and this module only runs behind ?engine=v2, logging the
//! four signals so the model can be watched warming up on a real plant.
import { wireStream } from "./signal.js";
import { BeatClock, startTicker } from "./composer/clock.js";
import { makeContext } from "./composer/state.js";
import { loadMoods, loadRooms, applyMood } from "./composer/moods.js";
import * as energy from "./composer/energy.js";
import * as notelog from "./composer/notelog.js";

export async function boot({ room = null, log = console.log } = {}) {
  const [moodsData, roomsData] = await Promise.all([
    fetch("/static/composer/moods.json").then((r) => r.json()),
    fetch("/static/composer/rooms.json").then((r) => r.json()),
  ]);
  const rooms = loadRooms(roomsData);
  const roomName = room && rooms.rooms.some((r) => r.name === room) ? room : rooms.default;
  const roomRec = rooms.rooms.find((r) => r.name === roomName);

  //! the clock runs on performance.now() until audio starts; the audio
  //! layer swaps in the AudioContext's time when the listener presses play
  let nowFn = () => performance.now() / 1000;
  const clock = new BeatClock(() => nowFn());
  const C = makeContext({ clock, room: roomName, log });
  C.setNow = (f) => { nowFn = f; };
  loadMoods(C, moodsData);
  energy.install(C, { persist: energy.localStoragePersist() });
  notelog.install(C, { onTake: (take) => notelog.postTake(take) });
  applyMood(C, roomRec.mood);
  C.weatherLoad();
  clock.play(C.weatherPoll, { sec: true, name: "weather" });
  const stream = wireStream("/api/stream", C.onFeature);
  const ticker = startTicker(clock, { workerUrl: "/static/js/composer/tick-worker.js" });
  log(`[app] composer ${roomName}: signals warming (rank buffer ${C.rawSorted.x.length}/480)`);
  return { C, clock, rooms, room: roomRec, stream, ticker };
}

//! ?engine=v2 (&room=drift|piano): opt in until the cut-over
const params = new URLSearchParams(globalThis.location?.search ?? "");
if (params.get("engine") === "v2") {
  boot({ room: params.get("room") }).then(({ C }) => {
    globalThis.__pp = C;
    setInterval(() => {
      const s = C.sig;
      console.log(`[sig] energy ${s.energy.toFixed(2)} stability ${s.stability.toFixed(2)} center ${s.center.toFixed(2)} tilt ${s.tilt.toFixed(2)} weather ${s.weather.toFixed(2)} (rank ${C.rawSorted.x.length}/480)`);
    }, 5000);
  }).catch((e) => console.error("[app] boot failed", e));
}
