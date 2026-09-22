//! state.js: the composer's environment. sclang kept every ~global in one
//! Environment and the files read each other's at call time (a room that
//! seats no cellist never defines the cello hooks, and `~x !? { ~x.() }`
//! is how the phased build stays honest). The port keeps that shape: one
//! object C, every module installs its functions and state onto it, and
//! cross-file calls are `C.name?.(...)`. Fields listed here are the ones
//! more than one module reads; each module documents its own.

export function makeContext({ clock, room = null, log = console.log, warn = console.warn } = {}) {
  return {
    clock,
    roomName: room,
    log, warn,
    //! moods.js
    moods: {}, moodOrder: [], mood: null,
    //! energy.js
    sig: { energy: 0.5, stability: 0.5, center: 0.0, tilt: 0.0, weather: 0.5 },
    //! harmony.js
    rootMidi: 60, scale: null, scaleName: null, chordNow: null, chordNext: null, chordPath: [],
    //! lifecycle.js
    voiceGate: { bass: 0, pad: 0, melody: 0, arp: 0, drums: 0 },
    barIdx: 0, barsTotal: 0, barStartBeat: 0, trackTempo: 1, trackStart: 0, trackDur: 0,
    sectionNow: null, sectionNext: null, sectionBarsLeft: null,
    //! arc.js
    arcPhase: "body", arcIntensity: 0.75, arcPhaseElapsed: 0, arcPhaseDur: 1,
    //! voices.js and the sink
    fire: null,          //! (voice, midinote, amp, dur, pan, vel, extra, role) -> the audio layer, set by the page
    onNote: null,        //! (note record) -> the page's roll / player
    onMark: null,        //! (mark record)
  };
}
