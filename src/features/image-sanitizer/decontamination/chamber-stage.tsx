"use client";

import { CircleAlert, CircleCheck, ImagePlus, Info, Plus, ShieldCheck, Square } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { preload } from "react-dom";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import type { PublicLimits } from "@/lib/config/limits";
import { SUPPORTED_FORMATS, acceptMap } from "@/lib/image/capabilities";
import { cn } from "@/lib/utils";
import type { ExperienceView } from "../hooks/use-decontamination";
import { copy } from "../strings";
import { prefersLightweight, useCoarsePointer } from "@/lib/device/device-hints";
import { holdPerfProbe, usePerfTier } from "@/lib/perf/perf-tier";
import { useIntake } from "../intake";
import { formatBytes } from "../utils/format";
import { playSound } from "@/lib/audio/sound-engine";
import { WASHER_MODEL_URL, pickTier } from "./chamber-config";
import { ChamberFallback } from "./chamber-fallback";
import { StagePreloader } from "./stage-preloader";
import type { ChamberSubject, StageMode } from "./washer-scene";
import type { DecontaminationRun } from "./run";
import { nominalDuration } from "./timeline";

/** WebGL scene is client-only and code-split: three.js never blocks first paint or runs on the server. */
const ChamberCanvas = dynamic(() => import("./chamber-canvas"), { ssr: false, loading: () => null });

/**
 * The frame-rate probe must time the washer actually rendering, not a page still
 * downloading the model (which would always read "fast"). Held from module load
 * until the stage has booted; there is one stage per page.
 */
const releasePerfProbe = typeof window === "undefined" ? () => undefined : holdPerfProbe();

const FORMAT_LIST = SUPPORTED_FORMATS.map((f) => f.label.split(" ")[0]).join(", ");
const ACCEPT_ATTR = Object.entries(acceptMap())
  .flatMap(([mime, exts]) => [mime, ...exts])
  .join(",");

let webglSupport: boolean | null = null;
/**
 * WebGL is used only when it works AND the user isn't saving data: the 3D washer costs
 * ~3 MB of model plus ~900 KB of three.js, which the CSS chamber doesn't need at all.
 */
function detectWebGL(): boolean {
  if (webglSupport === null) {
    if (prefersLightweight()) return (webglSupport = false);
    try {
      const canvas = document.createElement("canvas");
      webglSupport = !!(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}
const noopSubscribe = () => () => undefined;

export interface StageSubject extends ChamberSubject {
  /** Untrusted filename; text only. */
  name: string;
  previewUrl: string | null;
  extra: number;
}

interface ChamberStageProps {
  limits: PublicLimits;
  /** idle | ready | run | finished. Drag is detected here. */
  mode: Exclude<StageMode, "drag">;
  run: DecontaminationRun | null;
  view: ExperienceView;
  subject: StageSubject | null;
  /** Every photo the washer should show: the ready batch, or the run's files with their own results. */
  garments: readonly ChamberSubject[];
  reduced: boolean;
  readyCount: number;
  /** Anything in the queue (ready, invalid, cancelled…): the start button stays in place. */
  hasItems: boolean;
  modeLabel: string;
  progress: { done: number; total: number };
  partial: boolean;
  firstError: string | null;
  onFiles: (files: File[]) => void;
  onStart: () => void;
  onCancel: () => void;
  onShowResults: () => void;
  /** Small icon controls in the dock (settings, privacy). */
  tools?: ReactNode;
  /** Side panel: results and the queue. */
  children?: ReactNode;
}

export function ChamberStage(props: ChamberStageProps) {
  const { limits, mode, run, view, subject, reduced, readyCount, hasItems, modeLabel, progress, partial, firstError } = props;
  const running = mode === "run";
  const resolved = running && view.outcome !== null;
  const showResult = mode === "finished" || (running && (view.outcome === "error" || view.phase === "clear" || view.phase === "complete"));

  const dropped = useRef(false);
  const { getRootProps, getInputProps, isDragActive, open: openPicker } = useDropzone({
    onDrop: (accepted) => {
      dropped.current = true;
      if (accepted.length > 0) props.onFiles(accepted);
    },
    noClick: true,
    noKeyboard: true,
    // `noDrag`, not `disabled`: dropzone's disabled state sets aria-disabled on the whole stage,
    // which would announce the Cancel button inside it as disabled.
    noDrag: running,
    multiple: true,
  });
  const dragging = isDragActive && !running;
  const stageMode: StageMode = dragging ? "drag" : mode;
  // Files hovering over the washer swell in; dragging them away again falls off (a drop has its own sound).
  const wasDragging = useRef(false);
  useEffect(() => {
    if (dragging === wasDragging.current) return;
    wasDragging.current = dragging;
    if (dragging) {
      dropped.current = false;
      playSound("dragEnter");
    } else if (!dropped.current) {
      playSound("dragLeave");
    }
  }, [dragging]);
  const open = useCallback(() => {
    playSound("pick");
    openPicker();
  }, [openPicker]);
  // The hero pill and header CTA can open this picker (only while not mid-run).
  useIntake({ onOpenPicker: () => !running && open() });
  const perf = usePerfTier();

  // Renderer: WebGL when available and healthy; otherwise the CSS chamber.
  const webgl = useSyncExternalStore(noopSubscribe, detectWebGL, () => null);
  const [failed, setFailed] = useState(false);
  // Stable callbacks: the canvas is memoised and must not re-render on every queue tick.
  const handleFailure = useCallback(() => setFailed(true), []);
  const renderer = webgl === null ? "pending" : webgl && !failed ? "webgl" : "fallback";
  // Start the model download now, in parallel with the three.js chunk, but only when the
  // 3D washer will actually render (not for the CSS fallback or data-saving users).
  // Matches GLTFLoader's request (CORS mode, same-origin credentials) so the preload is reused.
  if (renderer === "webgl") preload(WASHER_MODEL_URL, { as: "fetch", crossOrigin: "anonymous" });
  const touch = useCoarsePointer();

  // Preloader: covers the stage until the washer has drawn (or we fell back to CSS).
  // A slow GPU never locks people out: after a few seconds the controls appear anyway.
  const [sceneReady, setSceneReady] = useState(false);
  const handleReady = useCallback(() => setSceneReady(true), []);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoadTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  const booted = renderer === "fallback" || sceneReady || loadTimedOut;
  useEffect(() => {
    if (booted) releasePerfProbe();
  }, [booted]);

  // Quality tier from the stage width (phones get a lighter scene).
  const viewport = useRef<HTMLDivElement | null>(null);
  const setViewport = useCallback((element: HTMLDivElement | null) => {
    viewport.current = element;
  }, []);
  const [width, setWidth] = useState(960);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 960)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tier = pickTier(reduced, width);

  // Focus follows the action: Cancel while working, then "Show results".
  const cancelRef = useRef<HTMLButtonElement>(null);
  const showRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (running && !resolved) cancelRef.current?.focus();
  }, [running, resolved]);
  useEffect(() => {
    if (resolved) showRef.current?.focus();
  }, [resolved]);

  const status = running
    ? showResult
      ? resultTitle(view.outcome)
      : copy.decon.phases[view.phase]
    : mode === "finished"
      ? resultTitle(view.outcome)
      : readyCount > 0
        ? copy.stage.ready(readyCount, modeLabel)
        : stageMode === "drag"
          ? copy.stage.drag
          : touch
            ? copy.stage.idleTouch
            : copy.stage.idle;

  const line = washerLine(stageMode, running || mode === "finished", view, showResult);

  return (
    <section
      {...getRootProps({
        className: "dark relative isolate flex min-h-svh flex-col overflow-hidden bg-stage text-white lg:block",
      })}
      id="top"
      aria-labelledby="hero-title"
    >
      <input {...getInputProps({ accept: ACCEPT_ATTR })} aria-label={copy.dropzone.label} data-testid="file-input" />
      <h1 id="hero-title" className="sr-only">
        {copy.heading}
      </h1>

      {/* The stage: the washer fills the screen; one control dock sits under it. */}
      <div
        className="contents"
        data-testid="chamber-stage"
        data-mode={stageMode}
        data-phase={running || mode === "finished" ? view.phase : "idle"}
        data-outcome={view.outcome ?? "pending"}
        data-reduced={reduced}
        data-renderer={renderer}
        data-booted={booted}
        data-duration={run ? nominalDuration(run.config) : undefined}
      >
        {/* min-h stays below a landscape phone's height (~360 px) so the dock never drops off-screen. */}
        <div ref={setViewport} className="relative h-svh min-h-[320px] shrink-0">
          {renderer === "webgl" && (
            <ChamberCanvas
              mode={stageMode}
              run={run}
              garments={props.garments}
              tier={tier}
              reduced={reduced}
              // Animate while the probe measures (pending) so it times real frames.
              // The neighbouring machines are there from the first frame, so the preloader
              // reveals the whole row (none popping in seconds later); they go only if the
              // probe says "low". The costly extras (shadow maps, the reflection environment,
              // the richer room shader) wait for "high": they would slow the first frame on
              // weak GPUs, and they ease in where a pop wouldn't be noticed.
              idleMotion={perf !== "low"}
              rich={perf === "high"}
              neighbours={perf !== "low"}
              onFailure={handleFailure}
              onReady={handleReady}
            />
          )}
          {renderer === "fallback" && (
            <ChamberFallback
              mode={stageMode}
              phase={view.phase}
              outcome={view.outcome}
              previewUrl={subject?.previewUrl ?? null}
              reduced={reduced}
            />
          )}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-stage to-transparent" />
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-3 rounded-[28px] border-2 border-dashed border-ember/70 transition-opacity duration-200",
              stageMode === "drag" ? "opacity-100" : "opacity-0",
            )}
          />

          <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 px-4 pb-5 sm:pb-8">
            <p
              key={line}
              aria-hidden
              className="pointer-events-none max-w-sm rounded-xl bg-black/80 px-4 py-2 text-center font-mono text-[13px] leading-snug tracking-wide text-ember uppercase ring-1 ring-ember/30 animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
            >
              {line}
            </p>

            {/* Control dock. Solid-ish fill, no backdrop blur: the canvas behind it repaints every
                frame, and a blur over it would be recomputed by the compositor on each one. */}
            <div className="flex w-full max-w-xl flex-col gap-3 rounded-2xl bg-stage-raised/95 p-3 shadow-[0_0_48px_-16px] shadow-ember/40 ring-1 ring-ember/25 sm:flex-row sm:items-center sm:pl-5">
              <div className="min-w-0 flex-1">
                {subject && (
                  <p className="truncate text-xs text-white/55" title={subject.name}>
                    {subject.name}
                    {subject.extra > 0 && <span> · {copy.decon.more(subject.extra)}</span>}
                  </p>
                )}
                <p
                  role="status"
                  aria-live="polite"
                  data-testid="decon-status"
                  className="flex min-w-0 items-center gap-2 text-sm font-medium"
                >
                  <StatusIcon running={running} showResult={showResult} outcome={view.outcome} />
                  <span
                    className={cn(
                      "truncate",
                      showResult && view.outcome === "clean" && "text-stage-clean",
                      showResult && view.outcome === "error" && "text-stage-fault",
                      running && !showResult && "text-ember",
                    )}
                  >
                    {status}
                  </span>
                  {(running || mode === "finished") && progress.total > 1 && (
                    <span className="shrink-0 font-normal text-white/50 tabular-nums">
                      {progress.done}/{progress.total}
                    </span>
                  )}
                </p>
                {/* Only failures need an explanation; success speaks for itself. */}
                {showResult && view.outcome === "error" && (
                  <p className="mt-0.5 text-xs text-stage-fault/85">{resultBody(view.outcome, partial, firstError)}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {!subject && !running && (
                  <Button
                    type="button"
                    size="lg"
                    onClick={open}
                    title={copy.dropzone.limits(FORMAT_LIST, formatBytes(limits.maxFileSizeBytes), limits.maxFilesPerBatch)}
                    className="h-10 flex-1 rounded-xl bg-ember px-4 text-ember-foreground hover:bg-ember/90"
                  >
                    <ImagePlus aria-hidden />
                    {copy.dropzone.browse}
                  </Button>
                )}
                {subject && !running && (
                  <Button type="button" size="icon-lg" variant="ghost" onClick={open} aria-label={copy.stage.addMore} className="rounded-xl text-white/80 hover:bg-white/10">
                    <Plus aria-hidden />
                  </Button>
                )}
                {running && !resolved && (
                  <Button ref={cancelRef} type="button" variant="outline" onClick={props.onCancel} className="h-10 flex-1 rounded-xl">
                    <Square aria-hidden />
                    {copy.actions.cancel}
                  </Button>
                )}
                {resolved && (
                  <Button ref={showRef} type="button" variant="outline" onClick={props.onShowResults} className="h-10 flex-1 rounded-xl">
                    {copy.stage.showResults}
                  </Button>
                )}
                {!running && (
                  <Button
                    type="button"
                    size="lg"
                    onClick={props.onStart}
                    disabled={readyCount === 0}
                    className={cn(
                      "h-10 flex-1 rounded-xl bg-ember px-4 text-ember-foreground hover:bg-ember/90",
                      !hasItems && "hidden",
                    )}
                  >
                    <ShieldCheck aria-hidden />
                    {copy.actions.start}
                  </Button>
                )}
                {props.tools}
              </div>
            </div>
          </div>

          <StagePreloader done={booted} />
        </div>
      </div>

      {/* Results and the queue: only once there is something to show. */}
      {hasItems && (
        <div className="space-y-4 px-4 pb-10 lg:absolute lg:top-6 lg:right-6 lg:max-h-[calc(100svh-3rem)] lg:w-[24rem] lg:overflow-y-auto lg:overscroll-contain lg:p-0 lg:pr-1">
          {props.children}
        </div>
      )}
    </section>
  );
}

/** The washer's speech line: decorative flavour that mirrors the real state. */
function washerLine(mode: StageMode, active: boolean, view: ExperienceView, showResult: boolean): string {
  const lines = copy.washer;
  if (!active) return mode === "drag" ? lines.drag : mode === "ready" ? lines.ready : lines.idle;
  if (view.outcome === "error" && showResult) return lines.error;
  switch (view.phase) {
    case "materialize":
    case "activate":
      return lines.loading;
    case "scan":
    case "awaiting":
      return lines.washing;
    case "purge":
      return lines.rinse;
    case "dissipate":
      return lines.noMetadata;
    default:
      return view.outcome === "no-metadata" ? lines.noMetadata : view.outcome === "error" ? lines.error : lines.clean;
  }
}

function resultTitle(outcome: ExperienceView["outcome"]): string {
  if (outcome === "error") return copy.decon.result.error.title;
  if (outcome === "no-metadata") return copy.decon.result["no-metadata"].title;
  return copy.decon.result.clean.title;
}

function resultBody(outcome: ExperienceView["outcome"], partial: boolean, error: string | null): string {
  if (outcome === "error") return error ?? copy.decon.result.error.body;
  if (outcome === "no-metadata") return copy.decon.result["no-metadata"].body;
  return partial ? `${copy.decon.result.clean.body} ${copy.decon.result.partial}` : copy.decon.result.clean.body;
}

function StatusIcon({ running, showResult, outcome }: { running: boolean; showResult: boolean; outcome: ExperienceView["outcome"] }) {
  // Icon + text, never colour alone.
  if (showResult && outcome === "clean") return <CircleCheck className="size-4 text-stage-clean" aria-hidden />;
  if (showResult && outcome === "no-metadata") return <Info className="size-4 text-ember" aria-hidden />;
  if (showResult && outcome === "error") return <CircleAlert className="size-4 text-stage-fault" aria-hidden />;
  if (!running) return <span className="size-2 rounded-full bg-ember" aria-hidden />;
  return (
    <span className="relative flex size-2.5" aria-hidden>
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-ember opacity-50 motion-reduce:hidden" />
      <span className="relative inline-flex size-2.5 rounded-full bg-ember" />
    </span>
  );
}
