"use client";

import { useEffect, useRef } from "react";
import { cuesBetween, moodFor, type SoundSnapshot } from "./sound-cues";
import { engine, playSound } from "./sound-engine";

/** Plays the sounds for each change of the app's state (see cuesBetween) and sets the music's mood (moodFor). */
export function useSoundCues({ mode, phase, outcome, items }: SoundSnapshot) {
  useEffect(() => engine.installUnlock(), []);
  const prev = useRef<SoundSnapshot>({ mode, phase, outcome, items });
  useEffect(() => {
    const next: SoundSnapshot = { mode, phase, outcome, items };
    const cues = cuesBetween(prev.current, next);
    prev.current = next;
    cues.forEach(playSound);
    engine.setMood(moodFor(next));
  }, [mode, phase, outcome, items]);
}
