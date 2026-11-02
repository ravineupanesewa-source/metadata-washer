import { CircleCheck, CircleHelp, CircleX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { FORMAT_CAPABILITIES } from "@/lib/image/capabilities";
import type { MetadataCategory, ProcessingReport } from "@/lib/image/types";
import { CATEGORY_LABELS, CHECK_LABELS, NOTICE_TEXT, copy } from "../strings";
import { formatBytes, formatDimensions, formatSizeDelta } from "../utils/format";

const PIXEL_TEXT: Record<ProcessingReport["pixelData"]["integrity"], string> = {
  identical: "Unchanged (hash verified)",
  "not-verifiable": "Not verifiable for this format",
  transformed: "Rotated for orientation",
  mismatch: "Changed unexpectedly",
};

/** Renders a processing report. All values come from the typed report; nothing is HTML. */
export function ReportView({ report }: { report: ProcessingReport }) {
  const { metadata } = report;
  return (
    <div className="space-y-5 text-sm">
      <section aria-labelledby="report-categories" className="space-y-3">
        <h3 id="report-categories" className="sr-only">
          Metadata categories
        </h3>
        {metadata.noMetadataDetected ? (
          <p className="rounded-lg bg-muted p-3">{copy.report.noMetadata}</p>
        ) : (
          <>
            <CategoryList
              title={copy.report.before}
              items={metadata.before.map((c) => ({ category: c.category, detail: String(c.count) }))}
            />
            <CategoryList title={copy.report.removed} tone="success" items={metadata.removed.map((category) => ({ category }))} />
            {metadata.retained.length > 0 && (
              <CategoryList
                title={copy.report.retained}
                tone="warning"
                items={metadata.retained.map((r) => ({
                  category: r.category,
                  detail: r.reason === "color-rendering" ? "for colour" : "keeps photo upright",
                }))}
              />
            )}
            {metadata.stillPresent.length > 0 && (
              <CategoryList title={copy.report.stillPresent} tone="destructive" items={metadata.stillPresent.map((category) => ({ category }))} />
            )}
          </>
        )}
      </section>

      <Separator />

      <dl className="grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-2">
        <span />
        <dt className="text-xs font-medium text-muted-foreground">{copy.report.original}</dt>
        <dt className="text-xs font-medium text-muted-foreground">{copy.report.cleaned}</dt>
        <ComparisonRow
          label={copy.report.format}
          before={FORMAT_CAPABILITIES[report.input.format].label}
          after={report.output ? FORMAT_CAPABILITIES[report.output.format].label : "—"}
        />
        <ComparisonRow
          label={copy.report.dimensions}
          before={formatDimensions(report.input.width, report.input.height)}
          after={report.output ? formatDimensions(report.output.width, report.output.height) : "—"}
        />
        {(report.input.frameCount > 1 || (report.output?.frameCount ?? 1) > 1) && (
          <ComparisonRow label={copy.report.frames} before={String(report.input.frameCount)} after={String(report.output?.frameCount ?? "—")} />
        )}
        <ComparisonRow
          label={copy.report.size}
          before={formatBytes(report.input.size)}
          after={report.output ? `${formatBytes(report.output.size)} (${formatSizeDelta(report.input.size, report.output.size)})` : "—"}
        />
      </dl>
      <p>
        <span className="font-medium">{copy.report.pixelData}: </span>
        {PIXEL_TEXT[report.pixelData.integrity]}
        {report.pixelData.reencoded && " (re-encoded)"}
      </p>

      <Separator />

      <section aria-labelledby="report-checks" className="space-y-2">
        <h3 id="report-checks" className="font-medium">
          {copy.report.checksTitle}
        </h3>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {report.verification.checks.map((check) => (
            <li key={check.id} className="flex items-center gap-2">
              {check.status === "pass" ? (
                <CircleCheck className="size-4 text-success" aria-hidden />
              ) : check.status === "fail" ? (
                <CircleX className="size-4 text-destructive" aria-hidden />
              ) : (
                <CircleHelp className="size-4 text-warning" aria-hidden />
              )}
              <span>{CHECK_LABELS[check.id]}</span>
              <span className="sr-only">: {check.status}</span>
            </li>
          ))}
        </ul>
      </section>

      {report.notices.length > 0 && (
        <ul className="space-y-1.5 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          {report.notices.map((notice) => (
            <li key={notice}>{NOTICE_TEXT[notice]}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryList({
  title,
  items,
  tone,
}: {
  title: string;
  items: { category: MetadataCategory; detail?: string }[];
  tone?: "success" | "warning" | "destructive";
}) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h4>
      {items.length === 0 ? (
        <p className="text-muted-foreground">{copy.report.nothingRemoved}</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {items.map(({ category, detail }) => (
            <li key={category}>
              <Badge variant={tone ?? "outline"}>
                {CATEGORY_LABELS[category]}
                {detail && <span className="opacity-70">· {detail}</span>}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ComparisonRow({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <>
      <dt className="font-medium">{label}</dt>
      <dd className="tabular-nums">{before}</dd>
      <dd className="tabular-nums">{after}</dd>
    </>
  );
}
