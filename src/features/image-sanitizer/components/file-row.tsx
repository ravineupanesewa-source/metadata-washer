"use client";

import { Download, ImageOff, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FORMAT_CAPABILITIES } from "@/lib/image/capabilities";
import type { SanitizerEngine } from "../engine/types";
import { copy } from "../strings";
import type { QueueItem } from "../types/queue";
import { formatBytes, formatDimensions } from "../utils/format";
import { InspectDialog } from "./inspect-dialog";
import { ReportDialog } from "./report-dialog";
import { StatusBadge } from "./status-badge";
import { impactOf } from "@/features/support/support-impact";
import { requestSupport } from "@/features/support/support-store";
import { playSound } from "@/lib/audio/sound-engine";

interface FileRowProps {
  item: QueueItem;
  index: number;
  engine: SanitizerEngine;
  busy: boolean;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onDimensions: (id: string, width: number, height: number) => void;
}

export function FileRow({ item, index, engine, busy, onRemove, onRetry, onDimensions }: FileRowProps) {
  const formatLabel = item.format ? FORMAT_CAPABILITIES[item.format].label : "Unknown";
  const canRetry = (item.status === "failed" && item.error?.retryable !== false) || item.status === "cancelled";
  const canInspect = item.status !== "invalid" && item.format !== null;

  return (
    <li
      className={cn(
        "relative flex gap-4 p-4 transition-colors animate-rise @md:items-center",
        item.status === "success" && "bg-success/5",
        item.status === "failed" && "bg-destructive/5",
      )}
      style={{ animationDelay: `${Math.min(index, 8) * 50}ms` }}
      data-testid="queue-item"
      data-status={item.status}
    >
      {item.status === "processing" && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 animate-shimmer bg-gradient-to-r from-transparent via-brand to-transparent bg-[length:200%_100%]"
        />
      )}
      <div
        className={cn(
          "relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-muted shadow-sm ring-1 ring-border transition-shadow",
          item.status === "success" && "ring-2 ring-success/60 shadow-success/20",
        )}
      >
        {item.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob: preview, never optimised or uploaded
          <img
            src={item.previewUrl}
            alt=""
            className="size-full object-cover"
            onLoad={(e) => onDimensions(item.id, e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
          />
        ) : (
          <ImageOff className="size-5 text-muted-foreground" aria-label={copy.queue.noPreview} />
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium" title={item.name}>
          {item.name}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatLabel} · {formatBytes(item.size)}
          {(item.width || item.report) && ` · ${formatDimensions(item.report?.input.width ?? item.width, item.report?.input.height ?? item.height)}`}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={item.status} />
          {item.error && (
            <span role={item.status === "failed" ? "alert" : undefined} className="text-xs text-destructive">
              {item.error.message}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1 @md:flex-row @md:items-center">
        {item.output && (
          <Button asChild size="sm" variant="outline">
            <a href={item.output.url} download={item.output.filename} aria-label={copy.queue.download(item.name)} onClick={() => {
                playSound("download");
                requestSupport(impactOf([item]));
              }}
            >
              <Download aria-hidden />
              <span className="hidden @md:inline">Download</span>
            </a>
          </Button>
        )}
        <div className="flex items-center">
          {item.report && <ReportDialog name={item.name} report={item.report} findings={item.output ? item.findings : null} />}
          {canInspect && <InspectDialog name={item.name} file={item.file} engine={engine} />}
          {canRetry && (
            <Button variant="ghost" size="icon-sm" onClick={() => onRetry(item.id)} aria-label={copy.queue.retry(item.name)} title={copy.queue.retry(item.name)}>
              <RotateCcw aria-hidden />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onRemove(item.id)}
            disabled={busy && item.status === "processing"}
            aria-label={copy.queue.remove(item.name)}
            title={copy.queue.remove(item.name)}
          >
            <X aria-hidden />
          </Button>
        </div>
      </div>
    </li>
  );
}
