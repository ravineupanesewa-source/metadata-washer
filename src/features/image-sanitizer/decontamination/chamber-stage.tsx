"use client";

import { CircleAlert, CircleCheck, ImagePlus, Info, Plus, ShieldCheck, Square } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import type { PublicLimits } from "@/lib/config/limits";
import { SUPPORTED_FORMATS, acceptMap } from "@/lib/image/capabilities";
import { cn } from "@/lib/utils";
import type { ExperienceView } from "../hooks/use-decontamination";
import { copy } from "../strings";
import { usePerfTier } from "@/lib/perf/perf-tier";
import { useIntake } from "../intake";
import { formatBytes } from "../utils/format";
import { pickTier } from "./chamber-config";
import { ChamberFallback } from "./chamber-fallback";
import type { ChamberSubject, StageMode } from "./washer-scene";
import type { DecontaminationRun } from "./run";
import { nominalDuration } from "./timeline";

/** WebGL scene is client-only and code-split: three.js never blocks first paint or runs on the server. */
const ChamberCanvas = dynamic(() => import("./chamber-canvas"), { ssr: false, loading: () => null });

const FORMAT_LIST = SUPPORTED_FORMATS.map((f) => f.label.split(" ")[0]).join(", ");
const ACCEPT_ATTR = Object.entries(acceptMap())
  .flatMap(([mime, exts]) => [mime, ...exts])
  .join(",");

let webglSupport: boolean | null = null;
function detectWebGL(): boolean {
  if (webglSupport === null) {
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

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop: (accepted) => accepted.length > 0 && props.onFiles(accepted),
    noClick: true,
    noKeyboard: true,
    // `noDrag`, not `disabled`: dropzone's disabled state sets aria-disabled on the whole stage,
    // which would announce the Cancel button inside it as disabled.
    noDrag: running,
    multiple: true,
  });
  const stageMode: StageMode = isDragActive && !running ? "drag" : mode;
  // The hero pill and header CTA can open this picker (only while not mid-run).
  useIntake({ onOpenPicker: () => !running && open() });
  const perf = usePerfTier();

  // Renderer: WebGL when available and healthy; otherwise the CSS chamber.
  const webgl = useSyncExternalStore(noopSubscribe, detectWebGL, () => null);
  const [failed, setFailed] = useState(false);
  const renderer = webgl === null ? "pending" : webgl && !failed ? "webgl" : "fallback";

  // Preloader: covers the stage until the washer has drawn (or we fell back to CSS).
  // A slow GPU never locks people out: after a few seconds the controls appear anyway.
  const [sceneReady, setSceneReady] = useState(false);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setLoadTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, []);
  const booted = renderer === "fallback" || sceneReady || loadTimedOut;

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

  // Stable per queue item, so the scene decodes each photo exactly once.
  const subjectKey = subject?.key;
  const subjectFile = subject?.file;
  const subjectLabel = subject?.label;
  const chamberSubject = useMemo<ChamberSubject | null>(
    () => (subjectKey && subjectFile && subjectLabel ? { key: subjectKey, file: subjectFile, label: subjectLabel } : null),
    [subjectKey, subjectFile, subjectLabel],
  );

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
        <div ref={setViewport} className="relative h-svh min-h-[520px] shrink-0">
          {renderer === "webgl" && (
            <ChamberCanvas
              mode={stageMode}
              run={run}
              subject={chamberSubject}
              tier={tier}
              reduced={reduced}
              idleMotion={perf === "high"}
              onFailure={() => setFailed(true)}
              onReady={() => setSceneReady(true)}
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
              className="pointer-events-none max-w-sm rounded-xl bg-black/70 px-4 py-2 text-center font-mono text-[13px] leading-snug tracking-wide text-ember uppercase ring-1 ring-ember/30 backdrop-blur animate-in fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
            >
              {line}
            </p>

            {/* Control dock */}
            <div className="flex w-full max-w-xl flex-col gap-3 rounded-2xl bg-stage-raised/85 p-3 shadow-[0_0_48px_-16px] shadow-ember/40 ring-1 ring-ember/25 backdrop-blur-xl sm:flex-row sm:items-center sm:pl-5">
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

/** Washer-door loader shown while three.js and the scene load; fades out, then unmounts. */
function StagePreloader({ done }: { done: boolean }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setGone(true), 600); // after the fade
    return () => clearTimeout(timer);
  }, [done]);
  if (gone) return null;
  return (
    <div
      data-testid="stage-preloader"
      className={cn(
        "absolute inset-0 z-20 grid place-items-center bg-stage transition-opacity duration-500 ease-out motion-reduce:transition-none",
        done ? "pointer-events-none opacity-0" : "opacity-100",
      )}
    >
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-6">
        <div className="relative size-28" aria-hidden>
          {/* Door rim */}
          <div className="absolute inset-0 rounded-full bg-stage-raised ring-1 ring-white/10 shadow-[0_0_60px_-10px] shadow-ember/30" />
          {/* Spinning drum arc */}
          <div className="absolute inset-2 animate-spin rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,var(--color-ember)_80deg,transparent_140deg)] [animation-duration:1.1s] motion-reduce:animate-none" />
          {/* Glass */}
          <div className="absolute inset-3.5 overflow-hidden rounded-full bg-[radial-gradient(circle_at_35%_30%,#3a2416,#0d0a08_70%)] ring-1 ring-white/10">
            {[
              { left: "28%", delay: "0s", size: "size-2" },
              { left: "52%", delay: "0.8s", size: "size-1.5" },
              { left: "68%", delay: "1.5s", size: "size-2.5" },
            ].map((b) => (
              <span
                key={b.left}
                className={cn("absolute bottom-2 animate-bubble rounded-full border border-ember/60 bg-ember/10 motion-reduce:hidden", b.size)}
                style={{ left: b.left, animationDelay: b.delay }}
              />
            ))}
          </div>
        </div>
        <p className="font-mono text-[13px] tracking-widest text-ember/90 uppercase">{copy.stage.loading}</p>
      </div>
    </div>
  );
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
