//! arc.js: the per-track intensity arc (the live project's composer/arc.scd).
//! One scalar: intro ramp over introBars, a body plateau modulated by the
//! plant's slow energy, outro ramp over outroBars. Voices read it only
//! through arcGainFor.
import { clip } from "../sc.js";

export function install(C) {
  C.arcPhase = null;
  C.arcPhaseElapsed = 0;
  C.arcPhaseDur = 0;
  C.arcIntensity = 1.0;

  C.arcGainFor = (voice) => {
    const i = C.arcIntensity ?? 1.0;
    switch (voice) {
      case "pad": return 0.6 + 0.4 * i;
      case "leftHand": return i < 0.35 ? 0 : 0.4 + 0.6 * i;
      case "rightHand": return i;
      case "drums": return i < 0.30 ? 0 : i;
      default: return 1.0;
    }
  };

  //! Phases ride the conductor's bar grid so the outro fade and the harmony
  //! cadence land on the same bars, ritardando included.
  C.arcPoll = function* () {
    for (;;) {
      if (C.barsTotal != null && (C.voiceGate.pad ?? 0) > 0) {
        const intro = C.mood.introBars ?? 8;
        const outro = C.mood.outroBars ?? 8;
        const remaining = C.barsTotal - C.barIdx;
        const spb = C.secondsPerBar();
        //! seamless (drift): the phases keep their names but the level never
        //! ramps: a drone that dips to nothing every eight minutes is not
        //! something to sleep to. The body's tide throughout.
        const seamless = (C.mood.seamless ?? 0) > 0;
        const bodyI = 0.75 + C.sigOver((C.mood.sectionBars ?? 0) === 0 ? 300 : 75, "energy") * 0.25;
        if (C.barIdx < intro) {
          C.arcPhase = "intro";
          C.arcPhaseElapsed = C.barIdx * spb;
          C.arcPhaseDur = intro * spb;
          C.arcIntensity = seamless ? bodyI : clip(C.barIdx / intro, 0, 1) * 0.7 + 0.3;
        } else if (remaining <= outro) {
          C.arcPhase = "outro";
          C.arcPhaseElapsed = (outro - remaining) * spb;
          C.arcPhaseDur = outro * spb;
          //! the big finish: this song's pianist may hold the outro at full
          C.arcIntensity = seamless ? bodyI : ((C.touchNow?.endBig ?? false) ? 1.0 : clip(remaining / outro, 0, 1) * 0.8 + 0.2);
        } else {
          C.arcPhase = "body";
          C.arcPhaseElapsed = (C.barIdx - intro) * spb;
          C.arcPhaseDur = Math.max(C.barsTotal - outro - intro, 0) * spb;
          C.arcIntensity = bodyI;
        }
      } else {
        C.arcPhase = null;
        C.arcIntensity = 1.0;
      }
      yield { sec: 1.0 };
    }
  };
}
