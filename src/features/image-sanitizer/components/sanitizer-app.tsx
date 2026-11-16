"use client";

import { SlidersHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { PrivacyDialog } from "@/components/layout/info-dialogs";
import { cn } from "@/lib/utils";
import type { PublicLimits } from "@/lib/config/limits";
import { FORMAT_CAPABILITIES } from "@/lib/image/capabilities";
import type { ProcessingOptions } from "@/lib/image/types";
import { ChamberStage, type StageSubject } from "../decontamination/chamber-stage";
import type { ChamberSubject } from "../decontamination/washer-scene";
import { isFinished } from "../decontamination/timeline";
import { createHttpEngine } from "../engine/http-engine";
import type { SanitizerEngine } from "../engine/types";
import { useDecontamination } from "../hooks/use-decontamination";
import { useIntake } from "../intake";
import { useSanitizerQueue } from "../hooks/use-sanitizer-queue";
import { copy, sound } from "../strings";
import type { QueueItem } from "../types/queue";
import { useReducedMotion } from "../visuals/use-reduced-motion";
import { BeforeAfter, BEFORE_AFTER_ID } from "./before-after";
import { showcaseItems } from "./before-after-model";
import { SupportModal } from "@/features/support/support-modal";
import { SoundToggle } from "@/lib/audio/sound-toggle";
import { useSoundCues } from "@/lib/audio/use-sound-cues";
import { playSound, setMusicEnabled, useMusicEnabled } from "@/lib/audio/sound-engine";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { FileRow } from "./file-row";
import { ProcessingSettings } from "./processing-settings";
import { ResultPanel } from "./result-panel";

const DEFAULT_OPTIONS: ProcessingOptions = { mode: "privacy", orientationPolicy: "preserve-tag" };

function toSubject(item: QueueItem, total: number): StageSubject {
  return {
    key: item.id,
    file: item.file,
    label: item.format ? FORMAT_CAPABILITIES[item.format].label : "Image",
    name: item.name,
    previewUrl: item.previewUrl,
    extra: Math.max(0, total - 1),
  };
}

export function SanitizerApp({ limits, engine: injected }: { limits: PublicLimits; engine?: SanitizerEngine }) {
  const engine = useMemo(() => injected ?? createHttpEngine(), [injected]);
  const queue = useSanitizerQueue(engine, limits);
  const [options, setOptions] = useState(DEFAULT_OPTIONS);
  const [announcement, setAnnouncement] = useState("");
  const [runIds, setRunIds] = useState<ReadonlySet<string>>(new Set());
  const reducedMotion = useReducedMotion();
  const busy = queue.summary.active > 0;

  // Items in the current run: the chamber mirrors their real results.
  const runItems = queue.items.filter((i) => runIds.has(i.id));
  const decon = useDecontamination(runItems, reducedMotion);
  const running = decon.state.status === "active";
  const revealing = !running;

  // What the chamber shows: the run's subject, or the most recently added valid image.
  const latestReady = [...queue.items].reverse().find((i) => i.status === "ready");
  const subject: StageSubject | null =
    decon.state.status !== "idle"
      ? (() => {
          const s = decon.state.subject;
          const item = queue.items.find((i) => i.file === s.file);
          return item ? toSubject(item, s.total) : null;
        })()
      : latestReady
        ? toSubject(latestReady, queue.summary.ready)
        : null;
  const stageMode = running ? "run" : decon.state.status === "finished" ? "finished" : subject ? "ready" : "idle";

  // Sound follows the same state the washer animates from.
  useSoundCues({
    mode: stageMode,
    phase: decon.state.status === "idle" ? null : decon.view.phase,
    outcome: decon.state.status === "idle" ? null : decon.view.outcome,
    items: queue.items.length,
  });

  // Every photo the washer shows: the run's files (each with its own result) or the whole ready batch.
  const garmentItems = decon.state.status !== "idle" ? runItems : queue.items.filter((i) => i.status === "ready");
  const garmentSignature = garmentItems.map((i) => `${i.id}:${i.status === "failed" || i.status === "cancelled" ? 1 : 0}`).join(",");
  const garments = useMemo<ChamberSubject[]>(
    () =>
      garmentItems.map((i) => ({
        key: i.id,
        file: i.file,
        label: i.format ? FORMAT_CAPABILITIES[i.format].label : "Image",
        failed: i.status === "failed" || i.status === "cancelled",
      })),
    // The signature captures everything the scene uses; item objects change on every status tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [garmentSignature],
  );

  async function handleFiles(files: File[]) {
    // New files start a new session: the chamber leaves its finished pose and the old
    // result panel goes away (earlier downloads stay available in the queue rows).
    if (decon.state.status === "finished") {
      decon.reset();
      setRunIds(new Set());
    }
    const { added, rejected } = await queue.addFiles(files);
    if (rejected) playSound("reject");
    setAnnouncement([added && copy.live.added(added), rejected && copy.live.rejected(rejected)].filter(Boolean).join(" "));
  }

  // Files dropped on the hero pill arrive here.
  useIntake({ onFiles: (files) => void handleFiles(files) });

  function beginRun(ids: readonly string[]) {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setRunIds(idSet);
    decon.begin(queue.items.filter((i) => idSet.has(i.id)));
  }

  function handleStart() {
    const ids = queue.start(options);
    beginRun(ids);
    if (ids.length > 0) setAnnouncement(copy.live.started(ids.length));
  }

  function handleCancel() {
    queue.cancel();
    decon.reset();
    setAnnouncement(copy.live.cancelled);
  }

  function handleClear() {
    playSound("clear");
    queue.clear();
    decon.reset();
    setRunIds(new Set());
    setAnnouncement(copy.live.cleared);
  }

  const finishedMessage =
    queue.summary.finished && revealing
      ? copy.live.finished(copy.summary.counts(queue.summary.success, queue.summary.partial, queue.summary.failed))
      : "";
  const showResults = revealing && runItems.length > 0 && runItems.every(isFinished);
  const showComparison = showResults && showcaseItems(runItems).length > 0;
  const runSummary = useMemo(() => {
    const count = (...statuses: QueueItem["status"][]) => runItems.filter((i) => statuses.includes(i.status)).length;
    const success = count("success");
    const partial = count("partial");
    const failed = count("failed", "cancelled");
    return { total: runItems.length, valid: runItems.length, ready: 0, active: 0, success, partial, failed, finished: true };
  }, [runItems]);

  // No backdrop blur: on wide screens this panel floats over the live canvas (see ChamberStage's dock).
  const panel = "rounded-3xl bg-stage-raised/95 p-4 ring-1 ring-ember/20";

  return (
    <>
      <ChamberStage
        limits={limits}
        mode={stageMode}
        run={decon.state.status === "idle" ? null : decon.state.run}
        view={decon.view}
        subject={subject}
        garments={garments}
        reduced={reducedMotion}
        readyCount={queue.summary.ready}
        modeLabel={copy.settings.modes[options.mode].title.replace(" (recommended)", "")}
        progress={{ done: runItems.filter(isFinished).length, total: runItems.length }}
        partial={runItems.some((i) => i.status === "partial")}
        firstError={runItems.find((i) => i.status === "failed")?.error?.message ?? null}
        onFiles={handleFiles}
        onStart={handleStart}
        onCancel={handleCancel}
        onShowResults={() => {
          playSound("reveal");
          decon.finish();
        }}
        hasItems={queue.items.length > 0}
        tools={
          <>
            <SoundToggle />
            <SettingsDialog value={options} onChange={setOptions} disabled={busy} />
            <PrivacyDialog iconOnly />
          </>
        }
      >
        {showResults && (
          <ResultPanel
            items={runItems}
            summary={runSummary}
            focusOnMount
            onRetryFailed={() => beginRun(queue.retryFailed(options))}
            onReset={handleClear}
            onCompare={showComparison ? () => scrollToComparison(reducedMotion) : undefined}
          />
        )}

        {queue.items.length > 0 && (
          <section aria-labelledby="queue-title" className={cn(panel, "space-y-3")}>
            <div className="flex items-center justify-between gap-2">
              <h2 id="queue-title" className="text-base font-semibold">
                {copy.queue.title}
                <span className="ml-2 rounded-full bg-ember/15 px-2 py-0.5 text-xs font-medium text-ember tabular-nums">
                  {queue.summary.total}
                </span>
              </h2>
              <Button variant="ghost" size="sm" onClick={handleClear} disabled={running}>
                {copy.queue.clear}
              </Button>
            </div>
            <ul className="@container divide-y overflow-hidden rounded-2xl border bg-card" aria-label={copy.queue.title}>
              {queue.items.map((item, index) => (
                <FileRow
                  key={item.id}
                  index={index}
                  item={item}
                  engine={engine}
                  busy={busy}
                  onRemove={(id) => {
                    playSound("remove");
                    queue.remove(id);
                  }}
                  onRetry={(id) => {
                    queue.retry(id, options);
                    beginRun([id]);
                  }}
                  onDimensions={queue.setDimensions}
                />
              ))}
            </ul>
          </section>
        )}
      </ChamberStage>

      {showComparison && <BeforeAfter items={runItems} />}
      {/* Optional eSewa support: opens shortly after a download, never instead of it. */}
      <SupportModal />

      <div role="status" aria-live="polite" className="sr-only" data-testid="live-region">
        {finishedMessage || announcement}
      </div>
    </>
  );
}

/** Brings the before/after section into view and moves focus to its heading. */
function scrollToComparison(reduced: boolean) {
  const section = document.getElementById(BEFORE_AFTER_ID);
  if (!section) return;
  section.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
  section.querySelector<HTMLElement>("h2")?.focus({ preventScroll: true });
}

/** Removal mode lives behind one icon in the dock. */
function SettingsDialog({ value, onChange, disabled }: { value: ProcessingOptions; onChange: (o: ProcessingOptions) => void; disabled: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon-lg" aria-label={copy.settings.title} className="rounded-xl text-white/80 hover:bg-white/10">
          <SlidersHorizontal aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{copy.settings.title}</DialogTitle>
          <DialogDescription>{copy.settings.modes[value.mode].title}</DialogDescription>
        </DialogHeader>
        <ProcessingSettings value={value} onChange={onChange} disabled={disabled} />
        <MusicSetting />
      </DialogContent>
    </Dialog>
  );
}

function MusicSetting() {
  const on = useMusicEnabled();
  return (
    <div className="flex items-start justify-between gap-4 border-t pt-4">
      <div className="space-y-1">
        <Label htmlFor="music-switch">{sound.music.title}</Label>
        <p id="music-hint" className="text-xs text-muted-foreground">
          {sound.music.description}
        </p>
      </div>
      <Switch id="music-switch" checked={on} onCheckedChange={setMusicEnabled} aria-describedby="music-hint" data-testid="music-switch" />
    </div>
  );
}
