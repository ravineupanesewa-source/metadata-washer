"use client";

import { Check, Copy, Download, Heart, MapPin, Sparkles, X } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useCoarsePointer } from "@/lib/device/device-hints";
import { cn } from "@/lib/utils";
import { playSound } from "@/lib/audio/sound-engine";
import { support as t } from "@/features/image-sanitizer/strings";
import { SUPPORT, SUPPORT_AMOUNTS, SUPPORT_DEFAULT_AMOUNT } from "./support-config";
import { closeSupport, dismissSupport, markSupported, useSupport, type SupportImpact } from "./support-store";

/**
 * Optional eSewa support modal, opened shortly after a download (never instead of it).
 * Persuasive through honesty: the user's own real results, a friendly suggested tip and
 * a frictionless way to pay. Always easy to leave: close button, "Maybe later", Escape
 * and a click outside all dismiss it (and snooze it on this device).
 */
export function SupportModal() {
  const { open, impact } = useSupport();
  const [view, setView] = useState<"ask" | "thanks">("ask");
  // Each opening starts on the ask view. Reset on open (while rendering), not on close,
  // so the thank-you view doesn't flash back to "ask" during the closing fade.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setView("ask");
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        if (view === "thanks") closeSupport();
        else dismissSupport();
      }}
    >
      <DialogContent
        showCloseButton={false}
        data-testid="support-modal"
        className="dark max-h-[92svh] max-w-[calc(100%-1.5rem)] gap-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-stage-raised p-0 text-white shadow-[0_0_80px_-20px] shadow-ember/50 ring-1 ring-ember/30 sm:max-w-[46rem]"
      >
        <DialogClose asChild>
          <Button variant="ghost" size="icon-sm" aria-label={t.close} className="absolute top-3 right-3 z-10 text-white/60 hover:bg-white/10 hover:text-white">
            <X aria-hidden />
          </Button>
        </DialogClose>
        {view === "ask" ? (
          <Ask
            impact={impact}
            onPaid={() => {
              playSound("thanks");
              markSupported();
              setView("thanks");
            }}
          />
        ) : (
          <Thanks />
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ================================================================= ask === */

function Ask({ impact, onPaid }: { impact: SupportImpact | null; onPaid: () => void }) {
  const [selected, setSelected] = useState<number>(SUPPORT_DEFAULT_AMOUNT);
  const [qrMissing, setQrMissing] = useState(!SUPPORT.qrImage);
  const touch = useCoarsePointer();
  const amount = SUPPORT_AMOUNTS[selected].amount;

  return (
    <>
      {/* Phones: one column. Wider screens: the pitch on the left, the QR on the right, both above the fold. */}
      <div className="sm:grid sm:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="relative overflow-hidden">
          <div aria-hidden className="pointer-events-none absolute -top-28 left-1/2 size-72 -translate-x-1/2 rounded-full bg-ember/25 blur-3xl" />
          <div className="relative px-6 pt-6 pb-5 text-center sm:pt-8">
            <Porthole />
            <p className="mt-4 font-mono text-[11px] tracking-[0.3em] text-ember uppercase">{t.eyebrow}</p>
            <DialogTitle className="mt-2 font-heading text-xl leading-tight font-semibold text-balance sm:text-2xl">{t.title}</DialogTitle>
            <DialogDescription className="mt-2 text-[13px] leading-relaxed text-white/65 text-pretty sm:text-sm">{t.body}</DialogDescription>
            {impact && impact.fieldsRemoved > 0 && (
              <p
                data-testid="support-impact"
                className="mx-auto mt-4 inline-flex max-w-full flex-wrap items-center justify-center gap-x-1.5 gap-y-0.5 rounded-2xl bg-stage-clean/10 px-3.5 py-2 text-xs text-stage-clean ring-1 ring-stage-clean/30"
              >
                <Sparkles className="size-3.5 shrink-0" aria-hidden />
                <span>{t.impact(impact.fieldsRemoved, impact.images)}</span>
                {impact.location && (
                  <span className="inline-flex items-center gap-1 font-semibold text-ember">
                    <MapPin className="size-3" aria-hidden />
                    {t.impactLocation}
                  </span>
                )}
              </p>
            )}
          </div>

          <div className="relative space-y-5 px-6 pb-5 sm:pb-8">
            {/* Suggested tips */}
            <div role="radiogroup" aria-label={t.amountsLabel} className="grid grid-cols-3 gap-2">
              {SUPPORT_AMOUNTS.map((option, i) => {
                const active = i === selected;
                return (
                  <button
                    key={option.amount}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => {
                      if (i !== selected) playSound("select");
                      setSelected(i);
                    }}
                    className={cn(
                      "flex min-h-16 flex-col items-center justify-center rounded-2xl px-2 py-2.5 ring-1 transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none",
                      active
                        ? "scale-[1.03] bg-ember text-ember-foreground shadow-[0_8px_30px_-8px] shadow-ember/70 ring-ember"
                        : "bg-white/[0.04] text-white ring-white/10 hover:bg-white/[0.08] hover:ring-white/20",
                    )}
                  >
                    <span className="font-heading text-lg leading-none font-semibold tabular-nums">Rs {option.amount}</span>
                    <span className={cn("mt-1 text-[11px]", active ? "text-ember-foreground/80" : "text-white/50")}>{option.label}</span>
                  </button>
                );
              })}
            </div>

            {/* How to pay. Hidden on phones, where Copy ID / Save QR below already make the flow obvious. */}
            <ol className="hidden grid-cols-3 sm:grid gap-2 text-center text-[11px] leading-snug text-white/60">
              {t.steps.map((step, i) => (
                <li key={step} className="flex flex-col items-center gap-1.5">
                  <span className="grid size-6 place-items-center rounded-full bg-ember/15 font-mono text-xs text-ember ring-1 ring-ember/40">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Pay */}
        <div className="space-y-4 px-6 pb-5 sm:flex sm:flex-col sm:justify-center sm:border-l sm:border-white/10 sm:bg-black/20 sm:py-8">
          {/* On a phone you can't scan your own screen: the copyable ID comes first there. */}
          {touch && SUPPORT.esewaId && <EsewaId first />}
          {!qrMissing && (
            <figure className="space-y-2.5 text-center">
              <div className="relative mx-auto w-fit rounded-[22px] p-[3px]">
                {/* A slowly turning ember/cyan ring around the code. */}
                <div aria-hidden className="absolute inset-0 overflow-hidden rounded-[22px]">
                  <div className="absolute -inset-1/2 animate-spin bg-[conic-gradient(from_0deg,var(--color-ember),transparent_30%,var(--color-stage-clean),transparent_70%,var(--color-ember))] [animation-duration:6s] motion-reduce:animate-none" />
                </div>
                {/* White tile: QR scanners need a light quiet zone around the code. */}
                <div className="relative overflow-hidden rounded-[20px] bg-white p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element -- static same-origin QR; no optimisation needed */}
                  <img
                    src={SUPPORT.qrImage}
                    alt={t.qrAlt(SUPPORT.name)}
                    className="h-48 w-auto max-w-full object-contain sm:h-56"
                    draggable={false}
                    // A missing QR file drops the QR; the eSewa ID below still works.
                    onError={() => setQrMissing(true)}
                  />
                  {/* A thin sweeping scan line: never a tint over the code, so contrast stays scannable. */}
                  <div aria-hidden className="pointer-events-none absolute inset-3 overflow-hidden rounded-xl motion-reduce:hidden">
                    <div className="h-full w-full animate-ba-scan bg-[linear-gradient(to_bottom,transparent_calc(50%-1px),rgba(157,140,255,0.7)_50%,transparent_calc(50%+1px))]" />
                  </div>
                </div>
              </div>
              <figcaption className="text-xs text-white/60">
                {SUPPORT.name && <span className="block font-medium text-white">{SUPPORT.name}</span>}
                {t.scanHint} · <span className="font-medium text-ember" data-testid="support-amount-hint">{t.amountHint(amount)}</span>
              </figcaption>
            </figure>
          )}

          {!touch && SUPPORT.esewaId && <EsewaId />}

          {touch && !qrMissing && (
            <div className="space-y-1 text-center">
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <a href={SUPPORT.qrImage} download="esewa-qr.png">
                  <Download aria-hidden />
                  {t.saveQr}
                </a>
              </Button>
              <p className="text-[11px] text-white/50">{t.saveQrHint}</p>
            </div>
          )}
        </div>
      </div>

      {/* Actions stay in reach while the details scroll (the modal can be taller than a phone). */}
      <div className="sticky bottom-0 z-10 space-y-1 border-t border-white/10 bg-stage-raised px-6 pt-3 pb-4 shadow-[0_-16px_32px_-12px] shadow-black/60 sm:flex sm:flex-row-reverse sm:items-center sm:gap-2 sm:space-y-0 sm:py-4">
        <Button
          type="button"
          size="lg"
          onClick={onPaid}
          className="h-12 w-full rounded-2xl bg-ember px-8 text-base font-semibold text-ember-foreground shadow-[0_10px_40px_-10px] shadow-ember/80 hover:bg-ember/90 sm:w-auto"
        >
          <Heart aria-hidden className="fill-current" />
          {t.paid}
        </Button>
        <DialogClose asChild>
          <Button type="button" variant="ghost" className="h-10 w-full rounded-xl text-white/55 hover:bg-white/5 hover:text-white sm:w-auto sm:px-5">
            {t.later}
          </Button>
        </DialogClose>
      </div>
    </>
  );
}

function EsewaId({ first = false }: { first?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copyId() {
    try {
      await navigator.clipboard.writeText(SUPPORT.esewaId);
      playSound("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions, insecure context): the ID stays selectable by hand.
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-black/30 py-1.5 pr-1.5 pl-4 ring-1 ring-white/10">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] text-white/50">{first ? t.idLabelFirst : t.idLabel}</p>
        <p className="truncate font-mono text-base font-medium tracking-wider tabular-nums select-all">{SUPPORT.esewaId}</p>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={copyId} className="rounded-xl" aria-live="polite">
        {copied ? <Check aria-hidden className="text-stage-clean" /> : <Copy aria-hidden />}
        {copied ? t.copied : t.copy}
      </Button>
    </div>
  );
}

/** Heart inside a turning washer-door ring. */
function Porthole() {
  return (
    <div aria-hidden className="relative mx-auto size-16 sm:size-20">
      <div className="absolute inset-0 animate-spin rounded-full bg-[conic-gradient(from_0deg,var(--color-ember),transparent_35%,var(--color-stage-clean),transparent_75%,var(--color-ember))] [animation-duration:5s] motion-reduce:animate-none" />
      <div className="absolute inset-[3px] grid place-items-center rounded-full bg-stage-raised">
        <div className="grid size-10 place-items-center rounded-full bg-ember/15 ring-1 ring-ember/40 sm:size-12">
          <Heart className="size-5 sm:size-6 animate-pulse fill-ember text-ember motion-reduce:animate-none" />
        </div>
      </div>
    </div>
  );
}

/* ============================================================== thanks === */

const CONFETTI_COLORS = ["var(--color-ember)", "var(--color-stage-clean)", "#ffffff", "#ffd166"];
const CONFETTI = Array.from({ length: 28 }, (_, i) => {
  const angle = (i / 28) * Math.PI * 2;
  const distance = 90 + (i % 4) * 28;
  return {
    "--cx": `${Math.round(Math.cos(angle) * distance)}px`,
    "--cy": `${Math.round(Math.sin(angle) * distance * 0.8 + 50)}px`,
    "--cr": `${(i % 2 ? 1 : -1) * (240 + (i % 5) * 60)}deg`,
    background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    animationDelay: `${(i % 7) * 25}ms`,
  } as CSSProperties;
});

function Thanks() {
  return (
    <div data-testid="support-thanks" className="relative overflow-hidden px-6 pt-12 pb-7 text-center">
      <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 size-72 -translate-x-1/2 rounded-full bg-stage-clean/20 blur-3xl" />
      <div className="relative mx-auto size-24">
        {/* Confetti bursts out from behind the heart. */}
        <div aria-hidden className="absolute top-1/2 left-1/2 motion-reduce:hidden">
          {CONFETTI.map((style, i) => (
            <span key={i} style={style} className={cn("absolute h-3 w-1.5 animate-confetti rounded-sm", i % 3 === 0 && "h-2 w-2 rounded-full")} />
          ))}
        </div>
        <div className="relative grid size-24 animate-rise place-items-center rounded-full bg-ember shadow-[0_0_60px_-6px] shadow-ember/80 motion-reduce:animate-none">
          <Heart className="size-11 fill-ember-foreground text-ember-foreground" aria-hidden />
        </div>
      </div>
      <DialogTitle className="relative mt-6 font-heading text-2xl font-semibold">{t.thanksTitle}</DialogTitle>
      <DialogDescription className="relative mx-auto mt-2 max-w-xs text-sm leading-relaxed text-white/70">{t.thanksBody}</DialogDescription>
      <DialogClose asChild>
        <Button type="button" size="lg" className="relative mt-6 h-11 rounded-2xl bg-white px-6 text-stage hover:bg-white/90">
          {t.thanksClose}
        </Button>
      </DialogClose>
    </div>
  );
}
