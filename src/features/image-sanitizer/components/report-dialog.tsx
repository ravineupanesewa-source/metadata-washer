"use client";

import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { ProcessingReport } from "@/lib/image/types";
import { copy } from "../strings";
import { ReportView } from "./report-view";

export function ReportDialog({ name, report }: { name: string; report: ProcessingReport }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={copy.queue.details(name)} title={copy.queue.details(name)}>
          <FileText aria-hidden />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="break-all">{copy.report.title(name)}</DialogTitle>
          <DialogDescription>{copy.report.description}</DialogDescription>
        </DialogHeader>
        <ReportView report={report} />
      </DialogContent>
    </Dialog>
  );
}
