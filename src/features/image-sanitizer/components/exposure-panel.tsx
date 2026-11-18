"use client";

import {
  Aperture,
  AppWindow,
  CalendarClock,
  Eye,
  EyeOff,
  Fingerprint,
  Hash,
  History,
  ImageIcon,
  type LucideIcon,
  MapPin,
  MapPinned,
  MessageSquareText,
  Monitor,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Tags,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { FindingFate, FindingKind, GpsFinding, MetadataFindings, ProcessingReport } from "@/lib/image/types";
import { CATEGORY_LABELS, FINDING_TEXT, exposure, type Sensitivity } from "../strings";
import { useReducedMotion } from "../visuals/use-reduced-motion";

/**
 * "What your photo was giving away": the personal details found in the original,
 * revealed and then washed out one by one. Every value is plain text from the
 * validated findings header, rendered by React (never as HTML).
 */

const ICONS: Record<FindingKind, LucideIcon> = {
  place: MapPin,
  serial: Hash,
  owner: UserRound,
  "unique-id": Fingerprint,
  thumbnail: ImageIcon,
  captured: CalendarClock,
  device: Smartphone,
  description: MessageSquareText,
  keywords: Tags,
  host: Monitor,
  lens: Aperture,
  software: AppWindow,
  "edit-history": History,
};

const SENSITIVITY_ORDER: Record<Sensitivity, number> = { high: 0, medium: 1, low: 2 };
/** Pause before the first item is washed, then the gap between items; the whole wash stays ~3 s (ms). */
const FIRST_WASH_MS = 700;
const MAX_WASH_STEP_MS = 340;
const TOTAL_WASH_MS = 3000;
const RISE_STAGGER_MS = 70;

type Entry =
  | { key: string; type: "gps"; gps: GpsFinding; fate: FindingFate; sensitivity: Sensitivity }
  | { key: string; type: "item"; kind: FindingKind; value: string; fate: FindingFate; sensitivity: Sensitivity };

export function buildEntries(findings: MetadataFindings): Entry[] {
  const items: Entry[] = findings.items.map((item) => ({
    key: item.kind,
    type: "item",
    kind: item.kind,
    value: FINDING_TEXT[item.kind].format?.(item.value) ?? item.value,
    fate: item.fate,
    sensitivity: FINDING_TEXT[item.kind].sensitivity,
  }));
  items.sort((a, b) => SENSITIVITY_ORDER[a.sensitivity] - SENSITIVITY_ORDER[b.sensitivity]);
  return findings.gps ? [{ key: "gps", type: "gps", gps: findings.gps, fate: findings.gps.fate, sensitivity: "high" }, ...items] : items;
}

/** Technical categories that were removed but have no headline finding, with their tag counts. */
export function leftoverSummary(findings: MetadataFindings, report: ProcessingReport): { count: number; labels: string[] } {
  const covered = new Set(findings.items.map((i) => i.category));
  if (findings.gps) covered.add("location");
  const removed = new Set(report.metadata.removed);
  const rest = report.metadata.before.filter((c) => removed.has(c.category) && !covered.has(c.category));
  return { count: rest.reduce((n, c) => n + c.count, 0), labels: rest.map((c) => CATEGORY_LABELS[c.category]) };
}

export function ExposurePanel({ findings, report, className }: { findings: MetadataFindings; report: ProcessingReport; className?: string }) {
  const reduced = useReducedMotion();
  const entries = useMemo(() => buildEntries(findings), [findings]);
  const removable = entries.filter((e) => e.fate === "removed");
  const stuck = entries.filter((e) => e.fate === "still-present").length;
  const total = removable.length + stuck;
  const leftovers = leftoverSummary(findings, report);

  const root = useRef<HTMLElement>(null);
  const [started, setStarted] = useState(false);
  const [washedCount, setWashedCount] = useState(0);
  const [run, setRun] = useState(0);
  const [hidden, setHidden] = useState(false);

  // Start once the panel is actually on screen, so nobody misses the wash.
  useEffect(() => {
    const node = root.current;
    if (!node || started) return;
    if (typeof IntersectionObserver === "undefined") {
      const id = requestAnimationFrame(() => setStarted(true));
      return () => cancelAnimationFrame(id);
    }
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((r) => r.isIntersecting)) {
          setStarted(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started || reduced) return;
    const first = FIRST_WASH_MS + entries.length * RISE_STAGGER_MS;
    const step = Math.min(MAX_WASH_STEP_MS, TOTAL_WASH_MS / Math.max(1, removable.length));
    const timers = removable.map((_, i) => window.setTimeout(() => setWashedCount(i + 1), first + i * step));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // `run` restarts the sequence on replay.
  }, [started, reduced, removable.length, entries.length, run]); // eslint-disable-line react-hooks/exhaustive-deps

  const washed = reduced ? removable.length : washedCount;
  const washedKeys = new Set(removable.slice(0, washed).map((e) => e.key));
  const left = total - washed;
  const anyKept = entries.some((e) => e.fate !== "removed");

  function replay() {
    setWashedCount(0);
    setRun((r) => r + 1);
  }

  return (
    <section
      ref={root}
      aria-labelledby="exposure-title"
      data-testid="exposure-panel"
      data-washed={washed}
      data-total={removable.length}
      className={cn("@container space-y-4", className)}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 id="exposure-title" className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <ShieldCheck className="size-4 text-success" aria-hidden />
            {exposure.title}
          </h3>
          <p className="text-sm text-muted-foreground">{anyKept ? exposure.subtitleKept : exposure.subtitle}</p>
        </div>
        {entries.length > 0 && (
          <div className="flex gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={hidden}
              title={exposure.hideHint}
              onClick={() => setHidden((h) => !h)}
              data-testid="exposure-hide"
            >
              {hidden ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
              {hidden ? exposure.show : exposure.hide}
            </Button>
            {!reduced && removable.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={replay} disabled={washed < removable.length}>
                <RotateCcw aria-hidden />
                {exposure.replay}
              </Button>
            )}
          </div>
        )}
      </header>

      {total > 0 && <ExposureMeter left={left} total={total} />}

      {entries.length === 0 ? (
        <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">{exposure.noHighlights}</p>
      ) : (
        <ul key={run} className="grid gap-2.5 @lg:grid-cols-2" aria-label={exposure.title}>
          {entries.map((entry, index) => {
            const state = entry.fate === "removed" ? (washedKeys.has(entry.key) ? "washed" : "exposed") : entry.fate;
            const style = { animationDelay: `${index * RISE_STAGGER_MS}ms` } as CSSProperties;
            return entry.type === "gps" ? (
              <GpsCard key={entry.key} gps={entry.gps} state={state} hidden={hidden} reduced={reduced} style={style} />
            ) : (
              <FindingCard key={entry.key} entry={entry} state={state} hidden={hidden} style={style} />
            );
          })}
        </ul>
      )}

      {leftovers.count > 0 && (
        <p className="text-xs text-muted-foreground">{exposure.more(leftovers.count, leftovers.labels.join(", "))}</p>
      )}
    </section>
  );
}

type CardState = "exposed" | "washed" | "kept" | "still-present";

function ExposureMeter({ left, total }: { left: number; total: number }) {
  const ratio = total === 0 ? 0 : left / total;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium tracking-wide text-muted-foreground uppercase">{exposure.meterLabel}</span>
        <span className={cn("font-medium tabular-nums transition-colors duration-500", left === 0 ? "text-success" : "text-destructive")}>
          {exposure.meter(left, total)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={exposure.meterLabel}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={left}
        aria-valuetext={exposure.meter(left, total)}
        className="relative h-2 overflow-hidden rounded-full bg-success/15"
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-warning to-destructive transition-[width] duration-500 ease-out",
            left > 0 && "animate-exp-blink",
          )}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  );
}

function StatusPill({ state }: { state: CardState }) {
  const text = state === "washed" ? exposure.fate.removed : state === "exposed" ? exposure.fate.exposed : exposure.fate[state];
  return (
    <span
      key={state}
      data-testid="finding-status"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        state === "exposed" && "bg-destructive/10 text-destructive",
        state === "washed" && "animate-exp-stamp bg-success/12 text-success dark:bg-success/20",
        state === "kept" && "bg-muted text-muted-foreground",
        state === "still-present" && "bg-destructive/15 text-destructive",
      )}
    >
      {state === "exposed" && <span className="size-1.5 animate-exp-blink rounded-full bg-current" aria-hidden />}
      {text}
    </span>
  );
}

function SensitivityDot({ level }: { level: Sensitivity }) {
  return (
    <span
      title={exposure.sensitivity[level]}
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        level === "high" ? "bg-destructive" : level === "medium" ? "bg-warning" : "bg-muted-foreground/50",
      )}
    >
      <span className="sr-only">{exposure.sensitivity[level]}</span>
    </span>
  );
}

/** Soap sweep and bubbles, mounted only at the moment an item is washed. */
function WashEffect() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
      <span className="absolute inset-y-0 -left-1/4 w-[150%] animate-exp-sweep bg-gradient-to-r from-transparent via-success/25 to-transparent" />
      {[12, 34, 58, 80].map((x, i) => (
        <span
          key={x}
          className="absolute bottom-2 size-2 animate-exp-bubble rounded-full border border-success/60 bg-success/20"
          style={{ left: `${x}%`, animationDelay: `${120 + i * 90}ms` }}
        />
      ))}
    </span>
  );
}

function cardTone(state: CardState) {
  return cn(
    "relative animate-rise overflow-hidden rounded-2xl border p-3 transition-[background-color,border-color] duration-500",
    state === "exposed" && "border-destructive/30 bg-destructive/5",
    state === "washed" && "border-success/30 bg-success/5",
    state === "kept" && "border-border bg-card",
    state === "still-present" && "border-destructive/50 bg-destructive/10",
  );
}

/** Inline value with a strike-through that draws across every wrapped line. */
function Value({ text, state, hidden, mono }: { text: string; state: CardState; hidden: boolean; mono?: boolean }) {
  const struck = state === "washed";
  return (
    <p className={cn("text-sm font-medium break-words", mono && "font-mono tabular-nums")}>
      {hidden && <span className="sr-only">{exposure.hide}</span>}
      <span
        aria-hidden={hidden || undefined}
        data-testid="finding-value"
        className={cn(
          "box-decoration-clone bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_2px] bg-[position:0_55%] bg-no-repeat transition-[background-size,opacity,filter] duration-700 ease-out",
          struck && "bg-[length:100%_2px] opacity-55",
          hidden && "blur-[6px] select-none",
        )}
      >
        {text}
      </span>
    </p>
  );
}

function FindingCard({
  entry,
  state,
  hidden,
  style,
}: {
  entry: Extract<Entry, { type: "item" }>;
  state: CardState;
  hidden: boolean;
  style: CSSProperties;
}) {
  const Icon = ICONS[entry.kind];
  const text = FINDING_TEXT[entry.kind];
  return (
    <li data-testid="finding" data-kind={entry.kind} data-state={state} className={cardTone(state)} style={style}>
      {state === "washed" && <WashEffect />}
      <div className="relative flex items-start gap-3">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-xl transition-colors duration-500",
            state === "washed" ? "bg-success/12 text-success" : state === "kept" ? "bg-muted text-muted-foreground" : "bg-destructive/10 text-destructive",
          )}
        >
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <SensitivityDot level={entry.sensitivity} />
              <span className="truncate">{text.label}</span>
            </p>
            <StatusPill state={state} />
          </div>
          <Value text={entry.value} state={state} hidden={hidden} />
          <p className="text-xs text-muted-foreground">{text.hint}</p>
        </div>
      </div>
    </li>
  );
}

function formatCoordinate(value: number, positive: string, negative: string) {
  // Non-breaking space: a narrow card may wrap between coordinates, never inside one.
  return `${Math.abs(value).toFixed(5)}°\u00a0${value < 0 ? negative : positive}`;
}

function GpsCard({
  gps,
  state,
  hidden,
  reduced,
  style,
}: {
  gps: GpsFinding;
  state: CardState;
  hidden: boolean;
  reduced: boolean;
  style: CSSProperties;
}) {
  const lat = formatCoordinate(gps.latitude, "N", "S");
  const lon = formatCoordinate(gps.longitude, "E", "W");
  const coordinates = useScramble(`${lat}, ${lon}`, state === "washed", reduced);
  const live = state === "exposed" || state === "still-present";
  // Equirectangular position on a 360×180 grid.
  const x = gps.longitude + 180;
  const y = 90 - gps.latitude;

  return (
    <li data-testid="finding" data-kind="gps" data-state={state} className={cn(cardTone(state), "@lg:col-span-2")} style={style}>
      {state === "washed" && <WashEffect />}
      <div className="relative flex flex-col gap-3 @md:flex-row @md:items-center">
        <div
          className={cn(
            "relative aspect-[2/1] w-full shrink-0 overflow-hidden rounded-xl bg-stage-raised ring-1 ring-border @md:w-56",
            hidden && "[&_[data-pin]]:opacity-0",
          )}
          role="img"
          aria-label={hidden ? exposure.gps.label : exposure.gps.mapLabel(lat, lon)}
        >
          <svg viewBox="0 0 360 180" className="absolute inset-0 size-full" aria-hidden preserveAspectRatio="none">
            {Array.from({ length: 11 }, (_, i) => (
              <line key={`m${i}`} x1={(i + 1) * 30} y1={0} x2={(i + 1) * 30} y2={180} className="stroke-white/10" strokeWidth={0.6} />
            ))}
            {Array.from({ length: 5 }, (_, i) => (
              <line
                key={`p${i}`}
                x1={0}
                y1={(i + 1) * 30}
                x2={360}
                y2={(i + 1) * 30}
                className={i === 2 ? "stroke-white/25" : "stroke-white/10"}
                strokeWidth={i === 2 ? 0.9 : 0.6}
              />
            ))}
            <g data-pin className={cn("transition-opacity duration-700", state === "washed" ? "opacity-0" : "opacity-100")}>
              <line x1={x} y1={0} x2={x} y2={180} className="stroke-destructive/60" strokeWidth={0.8} strokeDasharray="3 3" />
              <line x1={0} y1={y} x2={360} y2={y} className="stroke-destructive/60" strokeWidth={0.8} strokeDasharray="3 3" />
              {live && (
                <circle
                  cx={x}
                  cy={y}
                  r={9}
                  className="animate-ba-ping fill-destructive/40"
                  style={{ transformBox: "fill-box", transformOrigin: "center" }}
                />
              )}
              <circle cx={x} cy={y} r={4.5} className="fill-destructive stroke-white" strokeWidth={1.4} />
            </g>
          </svg>
          {live && (
            <span
              aria-hidden
              data-pin
              className="pointer-events-none absolute size-40 -translate-x-1/2 -translate-y-1/2 animate-exp-radar rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,color-mix(in_oklch,var(--destructive)_45%,transparent)_50deg,transparent_52deg)] transition-opacity duration-700"
              style={{ left: `${(x / 360) * 100}%`, top: `${(y / 180) * 100}%` }}
            />
          )}
          {state === "washed" && (
            <span className="absolute inset-0 grid place-items-center">
              <span className="animate-exp-stamp rounded-full bg-success px-3 py-1 text-xs font-semibold text-success-foreground shadow-sm">
                {exposure.gps.erased}
              </span>
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <SensitivityDot level="high" />
              <MapPinned className="size-3.5" aria-hidden />
              {exposure.gps.label}
            </p>
            <StatusPill state={state} />
          </div>
          <Value text={coordinates} state={state} hidden={hidden} mono />
          {gps.altitude !== null && (
            <p className={cn("text-xs text-muted-foreground tabular-nums", hidden && "blur-[4px] select-none")}>
              {exposure.gps.altitude(Math.round(gps.altitude).toLocaleString("en-US"))}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{exposure.gps.hint}</p>
        </div>
      </div>
    </li>
  );
}

const GLYPHS = "0123456789#%*+=?";

/** Briefly scrambles digits left to right when `active` turns on, then settles on the real text. */
function useScramble(text: string, active: boolean, reduced: boolean): string {
  const [display, setDisplay] = useState(text);
  useEffect(() => {
    if (!active || reduced) {
      const id = requestAnimationFrame(() => setDisplay(text));
      return () => cancelAnimationFrame(id);
    }
    const duration = 750;
    const start = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      const settled = Math.floor(progress * text.length);
      setDisplay(
        Array.from(text, (ch, i) => (i < settled || !/[0-9]/.test(ch) ? ch : GLYPHS[Math.floor(Math.random() * GLYPHS.length)])).join(""),
      );
      if (progress < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [text, active, reduced]);
  return display;
}
