"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { copy } from "../strings";

/** Metadata tags tumbling in the drum; each one dissolves in turn as the wash takes it. */
const TAGS = ["GPS", "EXIF", "ISO", "f/1.8", "XMP", "Make"];
/** Bubbles rising through the water: left offset, delay, size. */
const BUBBLES: [string, string, string][] = [
  ["18%", "0s", "size-1.5"],
  ["34%", "0.9s", "size-2"],
  ["52%", "0.4s", "size-1"],
  ["66%", "1.6s", "size-2.5"],
  ["80%", "1.1s", "size-1.5"],
];
/** Sparkles around the porthole: position and delay. */
const SPARKLES: [string, string, string][] = [
  ["-4%", "12%", "0s"],
  ["96%", "6%", "0.7s"],
  ["100%", "70%", "1.4s"],
  ["-8%", "78%", "2.1s"],
];
const WAVE = "M0 20 Q25 8 50 20 T100 20 T150 20 T200 20 T250 20 T300 20 T350 20 T400 20 V40 H0Z";

/**
 * Washer-door loader shown while three.js and the scene load: a porthole whose drum
 * tumbles the photo's metadata tags until they dissolve into the sloshing water.
 * Transform/opacity animations only. Fades out once `done`, then unmounts.
 */
export function StagePreloader({ done }: { done: boolean }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => setGone(true), 600); // after the fade
    return () => clearTimeout(timer);
  }, [done]);
  if (gone) return null;

  const steps = copy.stage.loadingSteps;
  return (
    <div
      data-testid="stage-preloader"
      className={cn(
        "absolute inset-0 z-20 grid place-items-center overflow-hidden bg-stage transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
        done ? "pointer-events-none scale-[1.04] opacity-0" : "opacity-100",
      )}
    >
      <div role="status" aria-live="polite" className="flex flex-col items-center gap-7">
        <span className="sr-only">{copy.stage.loading}</span>

        <div className="relative size-44" aria-hidden>
          {/* Lavender halo breathing behind the door */}
          <div className="absolute -inset-10 animate-wash-glow rounded-full bg-[radial-gradient(circle,color-mix(in_oklch,var(--color-ember)_32%,transparent),transparent_65%)] motion-reduce:animate-none" />

          {/* Sparkles: the "clean" promise */}
          {SPARKLES.map(([left, top, delay]) => (
            <svg
              key={left + top}
              viewBox="0 0 24 24"
              className="absolute size-4 animate-wash-twinkle text-stage-clean motion-reduce:hidden"
              style={{ left, top, animationDelay: delay }}
            >
              <path fill="currentColor" d="M12 0c.7 6.3 5 11.3 12 12-7 .7-11.3 5-12 12-.7-7-5-11.3-12-12C7 11.3 11.3 6.3 12 0Z" />
            </svg>
          ))}

          {/* Rim, dial and progress arcs */}
          <svg viewBox="0 0 200 200" className="absolute inset-0 size-full overflow-visible">
            <defs>
              <linearGradient id="wash-rim" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#2a2d34" />
                <stop offset="0.5" stopColor="#121418" />
                <stop offset="1" stopColor="#24272e" />
              </linearGradient>
            </defs>
            <circle cx="100" cy="100" r="97" fill="url(#wash-rim)" stroke="rgb(255 255 255 / 0.1)" />
            <circle cx="100" cy="100" r="78" fill="none" stroke="rgb(0 0 0 / 0.6)" strokeWidth="6" />
            <g className="origin-center animate-wash-dial motion-reduce:animate-none">
              {Array.from({ length: 48 }, (_, i) => (
                <line
                  key={i}
                  x1="100"
                  y1="6"
                  x2="100"
                  y2={i % 4 === 0 ? 13 : 10}
                  stroke={i % 4 === 0 ? "rgb(255 255 255 / 0.35)" : "rgb(255 255 255 / 0.14)"}
                  strokeWidth={i % 4 === 0 ? 1.6 : 1}
                  strokeLinecap="round"
                  transform={`rotate(${i * 7.5} 100 100)`}
                />
              ))}
            </g>
            <circle
              cx="100"
              cy="100"
              r="86"
              fill="none"
              stroke="var(--color-ember)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray="120 420"
              className="origin-center animate-spin drop-shadow-[0_0_6px_var(--color-ember)] [animation-duration:1.4s] motion-reduce:animate-none"
            />
            <circle
              cx="100"
              cy="100"
              r="86"
              fill="none"
              stroke="var(--color-stage-clean)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeDasharray="40 500"
              className="origin-center animate-wash-counter motion-reduce:animate-none"
            />
          </svg>

          {/* Glass */}
          <div className="absolute inset-[13%] overflow-hidden rounded-full bg-[radial-gradient(circle_at_40%_30%,#1c1630,#08070d_72%)] shadow-[inset_0_0_24px_rgb(0_0_0/0.9)] ring-1 ring-white/10">
            {/* Perforated drum, agitating */}
            <div className="absolute -inset-1/4 animate-wash-tumble bg-[radial-gradient(circle,rgb(255_255_255/0.09)_1px,transparent_1.6px)] bg-size-[9px_9px] motion-reduce:animate-none" />

            {/* Metadata tags tumbling with the drum */}
            <div className="absolute inset-0 animate-wash-tumble motion-reduce:animate-none">
              {TAGS.map((tag, i) => (
                <span
                  key={tag}
                  className="absolute top-1/2 left-1/2"
                  style={{ transform: `rotate(${(i * 360) / TAGS.length}deg) translateY(-36px)` } as CSSProperties}
                >
                  <span
                    className="block -translate-x-1/2 -translate-y-1/2 animate-wash-tag rounded-[4px] border border-ember/60 bg-ember/15 px-1 py-px font-mono text-[8px] leading-none font-semibold text-ember shadow-[0_0_8px_-2px_var(--color-ember)] motion-reduce:animate-none"
                    style={{ animationDelay: `${i * 0.6}s` }}
                  >
                    {tag}
                  </span>
                </span>
              ))}
            </div>

            {/* Water, sloshing */}
            <div className="absolute inset-x-[-20%] bottom-[-8%] h-[58%] origin-[50%_0%] animate-wash-slosh motion-reduce:animate-none">
              <svg viewBox="0 0 400 40" preserveAspectRatio="none" className="absolute -top-3 left-0 h-6 w-[200%] animate-wash-wave [animation-duration:3.2s] motion-reduce:animate-none">
                <path d={WAVE} fill="color-mix(in oklch, var(--color-stage-clean) 30%, transparent)" />
              </svg>
              <svg viewBox="0 0 400 40" preserveAspectRatio="none" className="absolute -top-2 left-0 h-6 w-[200%] animate-wash-wave [animation-direction:reverse] [animation-duration:2.1s] motion-reduce:animate-none">
                <path d={WAVE} fill="color-mix(in oklch, var(--color-stage-clean) 45%, transparent)" />
              </svg>
              <div className="absolute inset-x-0 top-3 bottom-0 bg-[linear-gradient(to_bottom,color-mix(in_oklch,var(--color-stage-clean)_45%,transparent),color-mix(in_oklch,var(--color-stage-blue)_35%,transparent))]" />
              {BUBBLES.map(([left, delay, size]) => (
                <span
                  key={left}
                  className={cn("absolute bottom-3 animate-bubble rounded-full border border-white/50 bg-white/10 motion-reduce:hidden", size)}
                  style={{ left, animationDelay: delay }}
                />
              ))}
            </div>

            {/* Glass reflections */}
            <div className="absolute inset-0 rounded-full bg-[radial-gradient(ellipse_60%_40%_at_30%_18%,rgb(255_255_255/0.22),transparent_70%)]" />
            <div className="absolute inset-y-0 -left-1/2 w-1/3 animate-wash-sheen bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.14),transparent)] motion-reduce:hidden" />
          </div>

          {/* Door hinge and latch */}
          <span className="absolute top-1/2 -left-1.5 h-10 w-2.5 -translate-y-1/2 rounded-full bg-stage-raised ring-1 ring-white/15" />
          <span className="absolute top-1/2 -right-1 h-6 w-1.5 -translate-y-1/2 rounded-full bg-ember/80 shadow-[0_0_8px_var(--color-ember)]" />
        </div>

        {/* Cycle readout */}
        <div className="flex flex-col items-center gap-3" aria-hidden>
          <div className="relative h-5 w-64 overflow-hidden text-center font-mono text-[13px] tracking-widest text-ember/90 uppercase">
            {steps.map((step, i) => (
              <span
                key={step}
                className="absolute inset-0 animate-wash-word opacity-0 motion-reduce:hidden"
                style={{ animationDelay: `${i * 2}s`, animationDuration: `${steps.length * 2}s` }}
              >
                {step}
              </span>
            ))}
            <span className="hidden motion-reduce:block">{copy.stage.loading}</span>
          </div>
          <div className="relative h-1 w-40 overflow-hidden rounded-full bg-white/8">
            <div className="absolute inset-y-0 w-1/3 animate-wash-bar rounded-full bg-[linear-gradient(90deg,transparent,var(--color-ember),var(--color-stage-clean))] motion-reduce:hidden" />
          </div>
        </div>
      </div>
    </div>
  );
}
