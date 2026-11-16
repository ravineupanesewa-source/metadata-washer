"use client";

import { ChevronsLeftRight, CircleAlert, Fingerprint, HardDrive, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { playSound } from "@/lib/audio/sound-engine";
import { cn } from "@/lib/utils";
import { FORMAT_CAPABILITIES } from "@/lib/image/capabilities";
import { CATEGORY_LABELS, beforeAfter as t } from "../strings";
import type { QueueItem } from "../types/queue";
import { formatBytes } from "../utils/format";
import { useReducedMotion } from "../visuals/use-reduced-motion";
import { buildComparison, showcaseItems, type Comparison, type LedgerRow } from "./before-after-model";

/**
 * Before/after showcase under the washer. Both sides are the user's real files
 * (the original upload and the cleaned download), and every number comes from the
 * server's report. Pixels are identical by design, so the "before" side carries
 * an overlay of the metadata that was hidden in the file; dragging the divider
 * washes it away. Category names and counts only: values are never shown here.
 *
 * Motion: the intro plays once the section scrolls into view; loops pause off-screen;
 * the divider is driven through a CSS variable, so dragging never re-renders React.
 */

export const BEFORE_AFTER_ID = "before-after";

export function BeforeAfter({ items }: { items: readonly QueueItem[] }) {
  const shown = showcaseItems(items);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const item = shown.find((i) => i.id === selectedId) ?? shown[0];
  const reduced = useReducedMotion();

  // In view: plays the intro (once per image) and runs the loops.
  const root = useRef<HTMLElement>(null);
  // Without IntersectionObserver (very old browsers, jsdom) treat it as visible.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setInView(entry?.isIntersecting ?? false), { threshold: 0.2 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  if (!item) return null;

  return (
    <section
      ref={root}
      id={BEFORE_AFTER_ID}
      aria-labelledby="before-after-title"
      data-testid="before-after"
      data-ba-active={inView}
      className="dark relative overflow-hidden bg-stage px-4 py-16 text-white sm:py-24"
    >
      {/* Seam from the washer: a soft ember-to-cyan glow along the top edge. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-ember/60 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-80 w-[48rem] -translate-x-1/2 rounded-full bg-ember/10 blur-3xl" />

      <div className="relative mx-auto max-w-4xl space-y-10">
        <div className="mx-auto max-w-2xl space-y-3 text-center">
          <p className="font-mono text-xs tracking-[0.3em] text-ember uppercase">{t.eyebrow}</p>
          <h2 id="before-after-title" tabIndex={-1} className="font-heading text-2xl font-semibold tracking-wide text-balance outline-none sm:text-4xl">
            {t.title}
          </h2>
          <p className="text-sm leading-relaxed text-white/60 text-pretty sm:text-base">{t.subtitle}</p>
        </div>

        {shown.length > 1 && <Picker items={shown} selected={item.id} onSelect={setSelectedId} />}

        {/* Keyed by file: switching images replays the intro for the new one. */}
        <Showcase key={item.id} item={item} active={inView} reduced={reduced} />
      </div>
    </section>
  );
}

function Picker({ items, selected, onSelect }: { items: QueueItem[]; selected: string; onSelect: (id: string) => void }) {
  return (
    <div role="group" aria-label={t.picker} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:px-0">
      {items.map((i) => {
        const active = i.id === selected;
        return (
          <button
            key={i.id}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (!active) playSound("select");
              onSelect(i.id);
            }}
            className={cn(
              "flex max-w-56 shrink-0 items-center gap-2 rounded-xl p-1.5 pr-3 text-left text-xs ring-1 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ember",
              active ? "bg-ember/15 text-white ring-ember/60" : "bg-white/5 text-white/60 ring-white/10 hover:bg-white/10",
            )}
          >
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-black/40">
              {i.output && (
                // eslint-disable-next-line @next/next/no-img-element -- local blob of the cleaned output
                <img src={i.output.url} alt="" className="size-full object-cover" />
              )}
            </span>
            <span className="truncate">{i.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================ showcase === */

function Showcase({ item, active, reduced }: { item: QueueItem; active: boolean; reduced: boolean }) {
  const report = item.report!;
  const output = item.output!;
  const comparison = useMemo(() => buildComparison(report, output.blob.size), [report, output.blob.size]);
  // The intro plays once, the first time this image is on screen.
  // A latch, set while rendering (React's "adjust state on prop change" pattern), not in an effect.
  const [played, setPlayed] = useState(active);
  if (active && !played) setPlayed(true);
  const animate = played && !reduced;

  return (
    <div className="space-y-6">
      <CompareFrame item={item} comparison={comparison} played={played} reduced={reduced} />
      <Stats comparison={comparison} played={played} reduced={reduced} />
      {comparison.rows.length > 0 ? (
        <Ledger rows={comparison.rows} played={played} animate={animate} />
      ) : (
        <p className="rounded-2xl bg-white/5 p-5 text-center text-sm text-white/65 ring-1 ring-white/10">{t.noneFound}</p>
      )}
    </div>
  );
}

/* ======================================================= compare frame === */

/** Where the metadata chips float on the "before" side (percent of the frame). */
const CHIP_SLOTS: readonly [number, number][] = [
  [5, 9],
  [55, 6],
  [8, 76],
  [58, 82],
  [30, 30],
  [62, 40],
  [6, 46],
  [36, 62],
  [34, 12],
  [70, 20],
  [14, 26],
  [48, 70],
];
/** Phones show fewer chips so they don't bury the photo. */
const CHIPS_ON_PHONE = 5;

const INTRO_MS = 1900;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

function CompareFrame({ item, comparison, played, reduced }: { item: QueueItem; comparison: Comparison; played: boolean; reduced: boolean }) {
  const output = item.output!;
  const frame = useRef<HTMLDivElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const [broken, setBroken] = useState(false);
  const canPreview = !!item.previewUrl && !broken;
  const format = item.format ? FORMAT_CAPABILITIES[item.format].label : "This format";

  /** Divider position, 0 (all cleaned) .. 100 (all original). Written straight to the DOM. */
  const setPos = (pct: number) => {
    const value = Math.round(pct * 10) / 10;
    frame.current?.style.setProperty("--pos", String(value));
    const input = range.current;
    if (input) {
      input.value = String(value);
      input.setAttribute("aria-valuetext", t.sliderValue(Math.round(value)));
    }
  };

  // Intro: start fully "before", then sweep the wash across to the middle.
  const userMoved = useRef(false);
  const drag = useDividerDrag(frame, (pct) => {
    userMoved.current = true;
    setPos(pct);
  });
  useEffect(() => {
    // Never override a position the user chose (they may grab the slider before the intro runs).
    if (userMoved.current) return;
    if (reduced) {
      setPos(50);
      return;
    }
    // Waiting to come into view: fully "before", ready for the sweep.
    setPos(100);
    if (!played) return;
    let frameId = 0;
    const start = performance.now() + 250;
    const tick = (now: number) => {
      if (userMoved.current) return;
      const k = Math.min(1, Math.max(0, (now - start) / INTRO_MS));
      setPos(100 - 50 * easeInOutCubic(k));
      if (k < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [played, reduced]);

  const removed = comparison.rows.filter((r) => r.fate !== "kept");
  const kept = comparison.rows.filter((r) => r.fate === "kept");
  const hidden = comparison.fieldsRemoved + comparison.rows.filter((r) => r.fate === "remained").reduce((n, r) => n + r.after, 0);

  return (
    <div
      ref={frame}
      {...drag}
      // A fixed frame (taller on phones): both images are object-contain, so any photo letterboxes
      // identically on each side and a portrait shot never makes the section screen-tall.
      // touch-pan-y: vertical swipes still scroll the page; horizontal ones move the divider.
      className="group/frame relative aspect-[4/5] w-full cursor-ew-resize touch-pan-y overflow-hidden rounded-3xl bg-black/60 shadow-[0_30px_80px_-30px] shadow-ember/30 ring-1 ring-white/10 select-none sm:aspect-[16/10]"
      style={{ "--pos": 100 } as CSSProperties}
    >
      {/* AFTER (base layer): the cleaned download. */}
      <div className="absolute inset-0">
        {canPreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob of the cleaned output
          <img src={output.url} alt={`${t.after}: ${item.name}`} className="size-full object-contain" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <NoPreview label={t.noPreview(format)} />
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-tl from-stage-clean/15 via-transparent to-transparent" />
        {/* One glint across the clean side as the wash finishes. */}
        {played && !reduced && (
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 w-1/3 animate-ba-sheen bg-gradient-to-r from-transparent via-white/25 to-transparent"
              style={{ animationDelay: `${INTRO_MS * 0.7}ms` }}
            />
          </div>
        )}
        {/* What legitimately stays (ICC profile, orientation flag). */}
        {kept.length > 0 && (
          // Phones: no room beside the divider; the ledger below lists what was kept.
          <ul aria-hidden className="pointer-events-none absolute right-3 bottom-14 hidden flex-col items-end gap-1.5 sm:right-4 sm:flex">
            {kept.map((r) => (
              <li key={r.category} className="rounded-md bg-black/70 px-2 py-1 font-mono text-[10px] text-stage-clean/90 ring-1 ring-stage-clean/40 sm:text-[11px]">
                {CATEGORY_LABELS[r.category]} · {t.fate.kept.toLowerCase()}
              </li>
            ))}
          </ul>
        )}
        <SideLabel side="after">{t.after}</SideLabel>
        <span className="absolute right-3 bottom-3 inline-flex items-center gap-1.5 rounded-full bg-stage-clean/15 px-3 py-1 text-[11px] font-medium text-stage-clean ring-1 ring-stage-clean/40 sm:right-4 sm:bottom-4 sm:text-xs">
          <Sparkles className="size-3.5" aria-hidden />
          <span className="sm:hidden">{t.cleanShort}</span>
          <span className="hidden sm:inline">{t.cleanBadge(comparison.fieldsAfter)}</span>
        </span>
      </div>

      {/* BEFORE (clipped to the left of the divider): the original, with what was hiding in it. */}
      <div className="absolute inset-0" style={{ clipPath: "inset(0 calc(100% - var(--pos) * 1%) 0 0)" }}>
        {canPreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob of the original upload
          <img src={item.previewUrl!} alt={`${t.before}: ${item.name}`} className="size-full bg-black object-contain" draggable={false} onError={() => setBroken(true)} />
        ) : (
          <NoPreview label={t.noPreview(format)} />
        )}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {/* Contamination tint and a slow scan band. */}
          <div className="absolute inset-0 bg-gradient-to-br from-ember/25 via-ember/5 to-[#c9c46a]/15 mix-blend-screen" />
          <div className="absolute inset-0 bg-[repeating-linear-gradient(0deg,transparent_0_3px,rgba(157,140,255,0.06)_3px_4px)]" />
          {!reduced && (
            <div className="absolute inset-0 overflow-hidden">
              <div className="h-full w-full animate-ba-scan bg-gradient-to-b from-transparent via-ember/15 to-transparent" />
            </div>
          )}
          {comparison.hasLocation && <GpsPin reduced={reduced} />}
          {removed.slice(0, CHIP_SLOTS.length).map((row, i) => (
            <Chip key={row.category} row={row} index={i} reduced={reduced} />
          ))}
        </div>
        <SideLabel side="before">{t.before}</SideLabel>
        {hidden > 0 && (
          <span className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-ember/15 px-3 py-1 text-[11px] font-medium text-ember ring-1 ring-ember/40 sm:bottom-4 sm:left-4 sm:text-xs">
            <Fingerprint className="size-3.5" aria-hidden />
            {t.hiddenFields(hidden)}
          </span>
        )}
      </div>

      {/* Divider: a glowing seam with a handle. */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 w-0" style={{ left: "calc(var(--pos) * 1%)" }}>
        <div className="absolute inset-y-0 -left-px w-0.5 bg-gradient-to-b from-ember via-white to-stage-clean shadow-[0_0_18px_2px] shadow-white/40" />
        <div className="absolute top-1/2 left-0 grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-stage-raised text-white shadow-lg ring-2 ring-white/80 transition-transform group-focus-within/frame:scale-110 group-focus-within/frame:ring-ember">
          <ChevronsLeftRight className="size-5" />
        </div>
      </div>

      {/* The real control: a native range over the whole frame (pointer, touch and keyboard). */}
      <input
        ref={range}
        type="range"
        min={0}
        max={100}
        step={1}
        defaultValue={100}
        aria-label={t.slider}
        data-testid="before-after-slider"
        onInput={(e) => {
          userMoved.current = true;
          setPos(Number(e.currentTarget.value));
        }}
        // Keyboard and assistive tech only: pointers are handled by the frame (useDividerDrag),
        // because iOS range inputs ignore taps and swipes anywhere but on their thumb.
        className="pointer-events-none absolute inset-0 size-full appearance-none opacity-0"
      />
    </div>
  );
}

/** Horizontal travel before a touch gesture counts as a drag (vs. the start of a scroll). */
const TOUCH_SLOP = 8;

/**
 * Pointer handling for the divider. Mouse and pen: press anywhere to jump there, then drag.
 * Touch: a tap jumps; a drag starts only once the gesture is clearly horizontal, so starting
 * a vertical scroll over the frame never moves the divider (the browser keeps vertical pans
 * via touch-action: pan-y and cancels the pointer).
 */
function useDividerDrag(frame: React.RefObject<HTMLDivElement | null>, onMove: (pct: number) => void) {
  const gesture = useRef<{ id: number; x: number; y: number; dragging: boolean } | null>(null);
  const pctAt = (clientX: number) => {
    const rect = frame.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  };
  const move = (clientX: number) => {
    const pct = pctAt(clientX);
    if (pct !== null) onMove(pct);
  };
  return {
    onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const immediate = e.pointerType !== "touch";
      gesture.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dragging: immediate };
      if (immediate) {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }
    },
    onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      if (!g.dragging) {
        const dx = Math.abs(e.clientX - g.x);
        if (dx < TOUCH_SLOP || dx < Math.abs(e.clientY - g.y)) return;
        g.dragging = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      move(e.clientX);
    },
    onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
      const g = gesture.current;
      if (!g || g.id !== e.pointerId) return;
      // A touch tap (no real movement) jumps the divider to where it landed.
      if (!g.dragging && Math.hypot(e.clientX - g.x, e.clientY - g.y) < TOUCH_SLOP) move(e.clientX);
      gesture.current = null;
    },
    onPointerCancel() {
      // The browser took over (a vertical scroll): leave the divider where it was.
      gesture.current = null;
    },
  };
}

function SideLabel({ side, children }: { side: "before" | "after"; children: string }) {
  return (
    <span
      className={cn(
        "absolute top-3 rounded-full px-3 py-1 font-mono text-[11px] tracking-widest uppercase ring-1 backdrop-blur-sm sm:top-4 sm:text-xs",
        side === "before" ? "left-3 bg-black/60 text-ember ring-ember/40 sm:left-4" : "right-3 bg-black/60 text-stage-clean ring-stage-clean/40 sm:right-4",
      )}
    >
      {children}
    </span>
  );
}

function Chip({ row, index, reduced }: { row: LedgerRow; index: number; reduced: boolean }) {
  const [x, y] = CHIP_SLOTS[index];
  // Each chip drifts on its own path and phase.
  const style = {
    left: `${x}%`,
    top: `${y}%`,
    "--ba-dx": `${(index % 3) * 3 - 3}px`,
    "--ba-dy": `${-6 - (index % 4) * 2}px`,
    "--ba-tilt": `${((index * 7) % 5) - 2}deg`,
    animationDelay: `${-index * 0.9}s`,
  } as CSSProperties;
  return (
    <span
      style={style}
      className={cn(
        "absolute max-w-[46%] truncate rounded-md px-2 py-1 font-mono text-[10px] shadow-[0_0_16px_-4px] sm:text-[11px]",
        row.fate === "remained" ? "bg-black/75 text-stage-fault shadow-stage-fault/60 ring-1 ring-stage-fault/60" : "bg-black/75 text-ember shadow-ember/60 ring-1 ring-ember/50",
        !reduced && "animate-ba-drift",
        index >= CHIPS_ON_PHONE && "hidden sm:block",
      )}
    >
      {CATEGORY_LABELS[row.category]} · {row.before}
    </span>
  );
}

function GpsPin({ reduced }: { reduced: boolean }) {
  return (
    <span className="absolute top-[38%] left-[22%] grid size-8 place-items-center">
      {!reduced && <span className="absolute inset-0 animate-ba-ping rounded-full bg-ember/40" />}
      <span className="relative grid size-8 place-items-center rounded-full bg-ember text-ember-foreground shadow-[0_0_24px_4px] shadow-ember/50">
        <MapPin className="size-4" />
      </span>
    </span>
  );
}

function NoPreview({ label }: { label: string }) {
  return (
    <div className="grid size-full place-items-center bg-[radial-gradient(circle_at_50%_40%,#1d2027,#08090c_70%)] p-8">
      <p className="max-w-xs text-center text-sm text-white/55">{label}</p>
    </div>
  );
}

/* =============================================================== stats === */

function Stats({ comparison: c, played, reduced }: { comparison: Comparison; played: boolean; reduced: boolean }) {
  const pixelsOk = c.pixels === "identical" || c.pixels === "not-verifiable" || c.pixels === "transformed";
  const verified = c.verification === "verified";
  const saved = c.sizeBefore > 0 ? Math.round((1 - c.sizeAfter / c.sizeBefore) * 100) : 0;
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat
        label={t.stats.fields}
        icon={<Fingerprint className="size-4" aria-hidden />}
        srValue={`${c.fieldsBefore} → ${c.fieldsAfter}`}
        delay={0}
        played={played}
        reduced={reduced}
      >
        <span className="text-white/40 line-through decoration-ember/70">{c.fieldsBefore}</span>
        <span className="text-white/30">→</span>
        <Counter from={c.fieldsBefore} to={c.fieldsAfter} play={played && !reduced} className={c.fieldsAfter === 0 ? "text-stage-clean" : "text-white"} />
      </Stat>
      <Stat
        label={t.stats.size}
        icon={<HardDrive className="size-4" aria-hidden />}
        srValue={`${formatBytes(c.sizeBefore)} → ${formatBytes(c.sizeAfter)}`}
        delay={90}
        played={played}
        reduced={reduced}
      >
        <span className="text-base">{formatBytes(c.sizeAfter)}</span>
        {saved > 0 && <span className="rounded-full bg-stage-clean/15 px-2 py-0.5 text-xs text-stage-clean">−{saved}%</span>}
      </Stat>
      <Stat
        label={t.stats.pixels}
        icon={pixelsOk ? <ShieldCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
        srValue={t.pixels[c.pixels]}
        delay={180}
        played={played}
        reduced={reduced}
        tone={pixelsOk ? "clean" : "fault"}
      >
        <span className="text-sm">{t.pixels[c.pixels]}</span>
      </Stat>
      <Stat
        label={t.stats.verification}
        icon={verified ? <ShieldCheck className="size-4" aria-hidden /> : <CircleAlert className="size-4" aria-hidden />}
        srValue={t.verification[c.verification]}
        delay={270}
        played={played}
        reduced={reduced}
        tone={verified ? "clean" : "warn"}
      >
        <span className="text-sm">{t.verification[c.verification]}</span>
      </Stat>
    </dl>
  );
}

function Stat({
  label,
  icon,
  srValue,
  delay,
  played,
  reduced,
  tone = "neutral",
  children,
}: {
  label: string;
  icon: React.ReactNode;
  srValue: string;
  delay: number;
  played: boolean;
  reduced: boolean;
  tone?: "neutral" | "clean" | "warn" | "fault";
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10",
        !reduced && (played ? "animate-rise" : "opacity-0"),
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <dt
        className={cn(
          "flex items-center gap-1.5 text-xs text-white/50",
          tone === "clean" && "text-stage-clean/80",
          tone === "warn" && "text-warning",
          tone === "fault" && "text-stage-fault",
        )}
      >
        {icon}
        {label}
      </dt>
      <dd className="mt-2 flex items-baseline gap-2 font-heading text-2xl font-semibold tabular-nums">
        <span className="sr-only">{srValue}</span>
        <span aria-hidden className="flex items-baseline gap-2">
          {children}
        </span>
      </dd>
    </div>
  );
}

/** Counts from `from` to `to` once `play` turns on; its own state, so only it re-renders. */
function Counter({ from, to, play, className }: { from: number; to: number; play: boolean; className?: string }) {
  const [value, setValue] = useState(from);
  useEffect(() => {
    if (!play) return;
    let id = 0;
    const start = performance.now() + 400;
    const tick = (now: number) => {
      const k = Math.min(1, Math.max(0, (now - start) / INTRO_MS));
      setValue(Math.round(from + (to - from) * easeInOutCubic(k)));
      if (k < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [from, to, play]);
  // Not playing (reduced motion, or not yet in view): show the final value.
  return <span className={className}>{play ? value : to}</span>;
}

/* ============================================================== ledger === */

function Ledger({ rows, played, animate }: { rows: LedgerRow[]; played: boolean; animate: boolean }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-wide text-white/80">{t.ledgerTitle}</h3>
      <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl bg-white/[0.03] ring-1 ring-white/10" data-testid="before-after-ledger">
        {rows.map((row, i) => {
          // Rows land one after another, then each removal gets struck through.
          const enter = 200 + i * 80;
          const strike = INTRO_MS * 0.45 + i * 110;
          const struck = row.fate === "removed";
          return (
            <li
              key={row.category}
              data-fate={row.fate}
              className={cn("flex items-center gap-3 px-4 py-3 text-sm", animate ? "animate-rise" : !played && "opacity-0")}
              style={animate ? { animationDelay: `${enter}ms` } : undefined}
            >
              <span className="relative min-w-0 flex-1 truncate">
                <span className={cn(struck ? "text-white/45" : row.fate === "remained" ? "text-stage-fault" : "text-white/85")}>{CATEGORY_LABELS[row.category]}</span>
                {struck && (
                  <span
                    aria-hidden
                    className={cn("absolute inset-x-0 top-1/2 h-px origin-left bg-ember/80", animate ? "animate-ba-strike" : played ? "" : "scale-x-0")}
                    style={animate ? { animationDelay: `${strike}ms` } : undefined}
                  />
                )}
              </span>
              <span className="shrink-0 font-mono text-xs text-white/40 tabular-nums">
                {row.before} → <span className={cn(row.after === 0 ? "text-stage-clean" : row.fate === "remained" ? "text-stage-fault" : "text-white/70")}>{row.after}</span>
              </span>
              <span
                className={cn(
                  "hidden shrink-0 rounded-full px-2 py-0.5 text-[11px] ring-1 sm:inline",
                  row.fate === "removed" && "bg-stage-clean/10 text-stage-clean ring-stage-clean/30",
                  row.fate === "kept" && "bg-white/5 text-white/60 ring-white/15",
                  row.fate === "remained" && "bg-stage-fault/10 text-stage-fault ring-stage-fault/30",
                )}
                title={row.reason ? t.reasons[row.reason] : undefined}
              >
                {t.fate[row.fate]}
                {row.reason && <span className="text-white/40"> · {t.reasons[row.reason]}</span>}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
