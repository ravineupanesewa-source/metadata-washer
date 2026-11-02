"use client";

import { Info, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { copy } from "@/features/image-sanitizer/strings";

export function PrivacyDialog({ compact = false, iconOnly = false }: { compact?: boolean; iconOnly?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size={iconOnly ? "icon-lg" : "sm"}
          aria-label={compact || iconOnly ? copy.tagline : undefined}
          className={iconOnly ? "rounded-xl text-white/80 hover:bg-white/10" : undefined}
        >
          <ShieldCheck aria-hidden className={iconOnly ? "text-ember" : "text-brand"} />
          {iconOnly ? null : compact ? (
            <span className="hidden lg:inline">{copy.header.privacy}</span>
          ) : (
            <>
              <span className="hidden sm:inline">{copy.tagline}</span>
              <span className="sm:hidden">{copy.header.privacy}</span>
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.privacyDialog.title}</DialogTitle>
          <DialogDescription>{copy.privacyNotice}</DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          {copy.privacyDialog.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

export function AboutDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          <Info aria-hidden />
          <span className="hidden sm:inline">{copy.header.about}</span>
          <span className="sr-only sm:hidden">{copy.header.about}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.about.title}</DialogTitle>
          <DialogDescription>{copy.intro}</DialogDescription>
        </DialogHeader>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          {copy.about.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{copy.about.guarantee}</p>
      </DialogContent>
    </Dialog>
  );
}
