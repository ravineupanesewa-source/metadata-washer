"use client";

import { Archive, ArrowDown, CircleAlert, CircleCheck, Download, Info, RefreshCw, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { QueueSummary } from "../hooks/use-sanitizer-queue";
import { CATEGORY_LABELS, beforeAfter, copy } from "../strings";
import type { QueueItem } from "../types/queue";
import { formatBytes } from "../utils/format";
import { buildResultsZip, triggerDownload, zipFilename } from "../utils/zip";
import { impactOf } from "@/features/support/support-impact";
import { requestSupport } from "@/features/support/support-store";
import { playSound } from "@/lib/audio/sound-engine";

interface ResultPanelProps {
  items: readonly QueueItem[];
  summary: QueueSummary;
  /** Move focus here when the panel first appears after a run. */
  focusOnMount: boolean;
  onRetryFailed: () => void;
  onReset: () => void;
  /** Present when there is a before/after to show below the stage. */
  onCompare?: () => void;
}

/**
 * Real results only: the featured preview is the cleaned output blob, the
 * download is that exact blob, and categories come from the server report.
 */
export function ResultPanel({ items, summary, focusOnMount, onRetryFailed, onReset, onCompare }: ResultPanelProps) {
  const [zipping, setZipping] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const featured = items.find((i) => (i.status === "success" || i.status === "partial") && i.output && i.report);
  const downloadable = summary.success + summary.partial;
  const allFailed = downloadable === 0;
  const nothingFound = !allFailed && items.filter((i) => i.report && i.output).every((i) => i.report!.metadata.noMetadataDetected);
  const [previewBroken, setPreviewBroken] = useState(false);

  useEffect(() => {
    if (focusOnMount) heading.current?.focus();
  }, [focusOnMount]);

  async function downloadAll() {
    playSound("zip");
    setZipping(true);
    try {
      const blob = await buildResultsZip(items);
      const url = URL.createObjectURL(blob);
      triggerDownload(url, zipFilename());
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      playSound("download");
      requestSupport(impactOf(items));
    } finally {
      setZipping(false);
    }
  }

  const title = allFailed ? copy.decon.result.error.title : nothingFound ? copy.decon.result["no-metadata"].title : copy.decon.result.clean.title;
  const Icon = allFailed ? CircleAlert : nothingFound ? Info : CircleCheck;

  return (
    <section
      aria-labelledby="result-title"
      data-testid="batch-summary"
      className={cn(
        "@container overflow-hidden rounded-3xl border bg-card animate-rise",
        allFailed ? "border-destructive/30" : summary.failed > 0 || summary.partial > 0 ? "border-warning/40" : "border-success/30",
      )}
    >
      <div className="flex flex-col gap-5 p-5 @xl:flex-row @xl:p-6">
        {featured?.output && (
          <div className="relative grid aspect-[4/3] w-full shrink-0 place-items-center overflow-hidden rounded-2xl bg-mint-surface ring-1 ring-border @xl:w-56">
            {featured.previewUrl && !previewBroken ? (
              // eslint-disable-next-line @next/next/no-img-element -- local blob of the cleaned output
              <img
                src={featured.output.url}
                alt={copy.result.previewAlt(featured.name)}
                className="size-full object-contain"
                onError={() => setPreviewBroken(true)}
              />
            ) : (
              <p className="p-4 text-center text-xs text-muted-foreground">{copy.result.noPreview}</p>
            )}
            <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium text-success shadow-sm">
              <CircleCheck className="size-3" aria-hidden /> {copy.status.success}
            </span>
          </div>
        )}

        <div className="min-w-0 flex-1 space-y-4">
          <div className="space-y-1">
            <h2
              id="result-title"
              ref={heading}
              tabIndex={-1}
              className={cn(
                "flex items-center gap-2 text-lg font-semibold tracking-tight outline-none",
                allFailed ? "text-destructive" : "text-foreground",
              )}
            >
              <Icon className={cn("size-5", allFailed ? "text-destructive" : nothingFound ? "text-brand" : "text-success")} aria-hidden />
              {title}
            </h2>
            <p className="text-sm text-muted-foreground">{copy.summary.counts(summary.success, summary.partial, summary.failed)}</p>
          </div>

          {featured?.report && (
            <div className="space-y-2">
              <p className="truncate text-sm font-medium" title={featured.output!.filename}>
                {featured.output!.filename}
                <span className="ml-2 font-normal text-muted-foreground tabular-nums">
                  {copy.result.sizes(formatBytes(featured.report.input.size), formatBytes(featured.output!.blob.size))}
                </span>
              </p>
              {featured.report.metadata.removed.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5" aria-label={copy.result.removed}>
                  {featured.report.metadata.removed.map((c) => (
                    <li key={c}>
                      <Badge variant="success">{CATEGORY_LABELS[c]}</Badge>
                    </li>
                  ))}
                  {featured.report.metadata.retained.map((r) => (
                    <li key={r.category}>
                      <Badge variant="outline" title={copy.result.kept}>
                        {CATEGORY_LABELS[r.category]} · kept
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">{copy.result.noneRemoved}</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {featured?.output && (
              <Button asChild size="lg" className="h-11 rounded-xl px-5">
                {/* The download always happens; the optional support card can appear afterwards. */}
                <a href={featured.output.url} download={featured.output.filename} onClick={() => {
                    playSound("download");
                    requestSupport(impactOf([featured]));
                  }}
                >
                  <Download aria-hidden />
                  {copy.result.download}
                </a>
              </Button>
            )}
            {onCompare && (
              <Button variant="outline" size="lg" className="h-11 rounded-xl" onClick={onCompare} data-testid="compare-link">
                <ArrowDown aria-hidden />
                {beforeAfter.jump}
              </Button>
            )}
            {downloadable > 1 && (
              <Button variant="outline" size="lg" className="h-11 rounded-xl" onClick={downloadAll} disabled={zipping}>
                <Archive aria-hidden />
                {zipping ? copy.actions.preparingZip : copy.result.downloadAll}
              </Button>
            )}
            {summary.failed > 0 && (
              <Button variant="outline" size="lg" className="h-11 rounded-xl" onClick={onRetryFailed}>
                <RotateCcw aria-hidden />
                {copy.result.retryFailed}
              </Button>
            )}
            <Button variant="ghost" size="lg" className="h-11 rounded-xl" onClick={onReset}>
              <RefreshCw aria-hidden />
              {copy.result.another}
            </Button>
          </div>
          {downloadable > 1 && <p className="text-xs text-muted-foreground">{copy.summary.zipNote}</p>}
        </div>
      </div>
    </section>
  );
}
