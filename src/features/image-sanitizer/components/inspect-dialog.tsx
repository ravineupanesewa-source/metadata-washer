"use client";

import { ScanSearch } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { InspectionResult } from "@/lib/image/types";
import type { SanitizerEngine } from "../engine/types";
import { CATEGORY_LABELS, copy } from "../strings";

type State = { kind: "loading" } | { kind: "error" } | { kind: "done"; result: InspectionResult };

export function InspectDialog({ name, file, engine }: { name: string; file: File; engine: SanitizerEngine }) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setReveal(false);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={copy.queue.inspect(name)} title={copy.queue.inspect(name)}>
          <ScanSearch aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-all">{copy.inspect.title(name)}</DialogTitle>
          <DialogDescription>{copy.inspect.description}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <Switch id="reveal-values" checked={reveal} onCheckedChange={setReveal} aria-describedby="reveal-hint" />
          <div>
            <Label htmlFor="reveal-values">{copy.inspect.reveal}</Label>
            <p id="reveal-hint" className="text-xs text-muted-foreground">
              {copy.inspect.revealHint}
            </p>
          </div>
        </div>
        {open && <InspectBody key={String(reveal)} file={file} engine={engine} reveal={reveal} />}
      </DialogContent>
    </Dialog>
  );
}

function InspectBody({ file, engine, reveal }: { file: File; engine: SanitizerEngine; reveal: boolean }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    engine
      .inspect(file, reveal, controller.signal)
      .then((result) => setState({ kind: "done", result }))
      .catch(() => !controller.signal.aborted && setState({ kind: "error" }));
    return () => controller.abort();
  }, [engine, file, reveal]);

  if (state.kind === "loading") {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {copy.inspect.loading}
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-sm text-destructive">
        {copy.inspect.error}
      </p>
    );
  }
  const { result } = state;
  if (result.tags.length === 0) return <p className="text-sm">{copy.inspect.empty}</p>;

  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-1.5" aria-label="Categories">
        {result.categories.map((c) => (
          <li key={c.category}>
            <Badge variant="outline">
              {CATEGORY_LABELS[c.category]} <span className="opacity-70">· {c.count}</span>
            </Badge>
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <caption className="sr-only">Metadata tags</caption>
          <thead className="bg-muted text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Group</th>
              <th scope="col" className="px-3 py-2 font-medium">Tag</th>
              <th scope="col" className="px-3 py-2 font-medium">{reveal ? "Value" : "Category"}</th>
            </tr>
          </thead>
          <tbody>
            {result.tags.map((tag, index) => (
              <tr key={`${tag.group}:${tag.name}:${index}`} className="border-t align-top">
                <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{tag.group}</td>
                <td className="px-3 py-1.5 font-medium break-all">{tag.name}</td>
                <td className="px-3 py-1.5 break-all">{reveal ? tag.value : CATEGORY_LABELS[tag.category]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
