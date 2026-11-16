import type { RunOutcome, VisualPhase } from "@/features/image-sanitizer/decontamination/timeline";

/**
 * Which sounds to play when the app's state changes. Pure, so it's unit-testable and the
 * synthesizer (sound-engine.ts) never needs to know about React or the queue.
 *
 * The cues follow the same timeline the washer animates from, so every sound lands on
 * the moment it belongs to (door, water, drain, chime) and never claims a result the
 * server hasn't returned.
 */

export type Cue =
  | "drop" //       photo pinned to the line
  | "start" //      "Remove metadata" pressed
  | "doorOpen" //   door swings open
  | "doorClose" //  door thuds shut
  | "washStart" // water fills, motor spins up (a loop until washStop)
  | "drain" //      clean outcome: water flushes away
  | "rinse" //      nothing to remove: water just clears
  | "washStop" //   loop ends (cycle done, jam, or cancel)
  | "sparkle" //    clean and back on the line
  | "fault" //      the drum jams
  | "cancel" //     user stopped the run
  | "download" //   a cleaned file downloaded
  | "thanks" //     support sent
  // Interface actions (played directly by the components that own them):
  | "dragEnter" //  files dragged over the washer
  | "dragLeave" //  dragged back off without dropping
  | "pick" //       file picker opened
  | "reject" //     a file the washer can't take
  | "remove" //     one photo taken off the line
  | "clear" //      the whole line cleared
  | "reveal" //     results shown
  | "zip" //        "Download all" (a ZIP)
  | "dialogOpen"
  | "dialogClose"
  | "toggleOn"
  | "toggleOff"
  | "select" //     a radio choice or thumbnail picked
  | "copy"; //      copied to the clipboard

/** What the background music should feel like (see ambience.ts). */
export type Mood = "idle" | "wash" | "clean" | "fault";

export interface SoundSnapshot {
  mode: "idle" | "ready" | "run" | "finished";
  /** The run's visual phase (meaningful while mode is run). */
  phase: VisualPhase | null;
  outcome: RunOutcome | null;
  /** Files in the queue. */
  items: number;
}

const PHASE_CUES: Partial<Record<VisualPhase, Cue[]>> = {
  activate: ["doorOpen"],
  scan: ["doorClose", "washStart"],
  purge: ["drain"],
  dissipate: ["rinse"],
  clear: ["washStop", "doorOpen", "sparkle"],
  fault: ["washStop", "fault"],
};

export function cuesBetween(prev: SoundSnapshot, next: SoundSnapshot): Cue[] {
  const cues: Cue[] = [];
  const wasRunning = prev.mode === "run";
  const running = next.mode === "run";

  if (next.items > prev.items && !running) cues.push("drop");
  if (!wasRunning && running) cues.push("start");

  if (running && next.phase !== prev.phase && next.phase) {
    cues.push(...(PHASE_CUES[next.phase] ?? []));
  }

  // Leaving a run before it reached its own end (cancel, or results shown early).
  if (wasRunning && !running) {
    const ended = prev.phase === "clear" || prev.phase === "fault" || prev.phase === "complete";
    if (!ended) cues.push("washStop");
    if (next.mode !== "finished") cues.push("cancel");
  }
  return cues;
}

/** The music follows the wash: ducked while it runs, bright when clean, dark on a jam. */
export function moodFor({ mode, phase, outcome }: SoundSnapshot): Mood {
  if (phase === "fault" || (mode === "finished" && outcome === "error")) return "fault";
  if (mode === "run") return phase === "clear" || phase === "complete" ? (outcome === "error" ? "fault" : "clean") : "wash";
  if (mode === "finished") return "clean";
  return "idle";
}
