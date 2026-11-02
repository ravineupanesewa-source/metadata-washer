import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { StageMode } from "./washer-scene";
import type { RunOutcome, VisualPhase } from "./timeline";

interface ChamberFallbackProps {
  mode: StageMode;
  phase: VisualPhase;
  outcome: RunOutcome | null;
  previewUrl: string | null;
  reduced: boolean;
}

/**
 * DOM/CSS chamber used when WebGL is unavailable, fails, or loses its context.
 * Same visual language and the same phase-driven states, no GPU.
 */
export function ChamberFallback({ mode, phase, outcome, previewUrl, reduced }: ChamberFallbackProps) {
  const running = mode === "run";
  const scanning = running && (phase === "activate" || phase === "scan" || phase === "awaiting");
  const sealed = (mode === "finished" || (running && (phase === "clear" || phase === "complete"))) && outcome !== "error" && outcome !== null;
  const faulted = (running || mode === "finished") && outcome === "error";

  return (
    <div className="absolute inset-0 grid place-items-center p-6 pt-14 pb-36 data-[has-photo=true]:pb-8" data-renderer="fallback" data-has-photo={!!previewUrl} aria-hidden>
      <div
        className={cn(
          "relative flex aspect-[4/3] h-full max-h-72 max-w-full items-center justify-center rounded-2xl border bg-white/[0.03] p-4 transition-all duration-500",
          mode === "drag" && "scale-[1.03] border-stage-clean/80",
          faulted ? "border-stage-fault/50" : sealed && outcome === "clean" ? "border-stage-clean/70" : "border-stage-accent/35",
        )}
      >
        {["top-0 left-0", "top-0 right-0", "bottom-0 left-0", "bottom-0 right-0"].map((pos) => (
          <span key={pos} className={cn("absolute size-3 rounded-sm bg-stage-muted/50", pos)} />
        ))}
        <div className="relative max-h-full max-w-full overflow-hidden rounded-md ring-1 ring-white/10">
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- local blob: preview of the user's own file
            <img src={previewUrl} alt="" className="block max-h-52 max-w-full object-contain" />
          ) : (
            <div className="grid size-36 place-items-center bg-white/[0.04] text-stage-muted">
              <ImageIcon className="size-10" />
            </div>
          )}
          {scanning && (
            <span
              className={cn(
                "absolute inset-x-0 h-0.5 bg-stage-accent shadow-[0_0_14px_2px] shadow-stage-accent/70",
                reduced ? "top-1/2 opacity-70" : "animate-chamber-scan",
              )}
            />
          )}
        </div>
        {sealed && (
          <span
            className={cn(
              "pointer-events-none absolute inset-2 rounded-xl border-2",
              outcome === "clean" ? "border-stage-clean/70" : "border-stage-accent/60",
            )}
          />
        )}
      </div>
    </div>
  );
}
