"use client";

import { useCallback, useEffect, useState } from "react";
import { FORMAT_CAPABILITIES } from "@/lib/image/capabilities";
import { DecontaminationRun } from "../decontamination/run";
import { deriveOutcome, isFinished, type RunOutcome, type VisualPhase } from "../decontamination/timeline";
import type { QueueItem } from "../types/queue";

/** How long the final pose stays before results take over. */
export const FINAL_HOLD_MS = 700;

export interface DecontaminationSubject {
  /** Decoded once by the 3D scene for its texture. */
  file: File | null;
  previewUrl: string | null;
  /** Untrusted filename, rendered as text only. */
  name: string;
  formatLabel: string;
  total: number;
}

export type ExperienceState =
  | { status: "idle" }
  | { status: "active"; run: DecontaminationRun; subject: DecontaminationSubject }
  /** The run's visuals finished (or were skipped); results are shown, the chamber holds its final pose. */
  | { status: "finished"; run: DecontaminationRun; subject: DecontaminationSubject };

export interface ExperienceView {
  phase: VisualPhase;
  outcome: RunOutcome | null;
}

/**
 * Small state machine around a DecontaminationRun:
 *   idle → active(run) → [real results resolve the run] → complete → finished → (new files) idle
 * The queue stays the source of truth for cleaning; this hook only mirrors it.
 */
export function useDecontamination(runItems: readonly QueueItem[], reducedMotion: boolean) {
  const [state, setState] = useState<ExperienceState>({ status: "idle" });
  const [view, setView] = useState<ExperienceView>({ phase: "materialize", outcome: null });

  const begin = useCallback(
    (items: readonly QueueItem[]) => {
      if (items.length === 0) return;
      const focus = items.find((i) => i.previewUrl) ?? items[0];
      setState({
        status: "active",
        run: new DecontaminationRun(reducedMotion),
        subject: {
          file: focus.file,
          previewUrl: focus.previewUrl,
          name: focus.name,
          formatLabel: focus.format ? FORMAT_CAPABILITIES[focus.format].label : "Image",
          total: items.length,
        },
      });
      setView({ phase: "materialize", outcome: null });
    },
    [reducedMotion],
  );

  /** Reveal results now (skip the rest of the visuals). Cancelling uses `reset`. */
  const finish = useCallback(
    () => setState((s) => (s.status === "active" ? { status: "finished", run: s.run, subject: s.subject } : s)),
    [],
  );
  /** Forget the run entirely (cancel, new files, cleared queue). */
  const reset = useCallback(() => setState({ status: "idle" }), []);

  // Resolve the run from real results once every file in it has finished.
  // A newer run is a different object, so stale results can't complete it.
  useEffect(() => {
    if (state.status !== "active" || runItems.length === 0) return;
    if (runItems.every(isFinished)) state.run.resolve(deriveOutcome(runItems));
  }, [state, runItems]);

  // Mirror phase changes into React (a handful per run, never per frame).
  useEffect(() => {
    if (state.status !== "active") return;
    const { run } = state;
    let frame = 0;
    let holdTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPhase: VisualPhase | null = null;
    let lastOutcome: RunOutcome | null = null;

    const tick = () => {
      const sample = run.sample();
      if (sample.phase !== lastPhase || sample.outcome !== lastOutcome) {
        lastPhase = sample.phase;
        lastOutcome = sample.outcome;
        setView({ phase: sample.phase, outcome: sample.outcome });
      }
      if (sample.done) {
        holdTimer = setTimeout(
          () => setState((s) => (s.status === "active" && s.run === run ? { status: "finished", run, subject: s.subject } : s)),
          FINAL_HOLD_MS,
        );
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(holdTimer);
    };
  }, [state]);

  return { state, view, begin, finish, reset };
}
