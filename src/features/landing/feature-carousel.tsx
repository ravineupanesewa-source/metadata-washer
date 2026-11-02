"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { usePerfTier } from "@/lib/perf/perf-tier";
import { cn } from "@/lib/utils";
import { copy } from "../image-sanitizer/strings";
import { CARD_STYLES, getCardRenderer, type CardStyle } from "./card-art";

/** CSS stand-ins used until (or instead of) the shader art. */
const FALLBACK: Record<CardStyle, string> = {
  aurora: "bg-[radial-gradient(120%_80%_at_20%_110%,#7c4dff_0%,#1a0b46_45%,#07041a_100%)]",
  flame: "bg-[radial-gradient(120%_80%_at_70%_80%,#ff7a1a_0%,#4a1205_45%,#140402_100%)]",
  leaf: "bg-[radial-gradient(120%_90%_at_60%_70%,#c6f432_0%,#3f8a0c_50%,#173d03_100%)]",
  wave: "bg-[radial-gradient(120%_80%_at_50%_100%,#3b8cff_0%,#0a2266_45%,#030a24_100%)]",
  orb: "bg-[radial-gradient(90%_70%_at_75%_85%,#ff4fd8_0%,#4a0b52_45%,#120214_100%)]",
};

const SLOT = {
  // offset from the active card → transform
  0: "z-30 scale-100 opacity-100",
  1: "z-20 scale-[0.8] opacity-90",
  2: "z-10 scale-[0.68] opacity-70",
} as const;

export function FeatureCarousel() {
  const slides = copy.carousel.slides;
  const [active, setActive] = useState(2);
  const region = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const tier = usePerfTier();

  useEffect(() => {
    const el = region.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { rootMargin: "100px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const go = (delta: number) => setActive((i) => (i + delta + slides.length) % slides.length);
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      go(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      go(-1);
    }
  };

  return (
    <section
      ref={region}
      id="how"
      aria-roledescription="carousel"
      aria-labelledby="how-title"
      onKeyDown={onKey}
      className="relative isolate overflow-hidden bg-night py-20 text-white sm:py-24"
      data-testid="feature-carousel"
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-10 -z-10 mx-auto h-40 max-w-3xl bg-[radial-gradient(ellipse_at_center,rgb(198_244_50/0.28),transparent_70%)] blur-2xl" aria-hidden />
      <div className="mx-auto mb-12 max-w-2xl px-4 text-center">
        <p className="mb-3 text-xs font-medium tracking-[0.2em] text-ember uppercase">{copy.carousel.eyebrow}</p>
        <h2 id="how-title" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {copy.carousel.title}
        </h2>
      </div>

      <div className="relative mx-auto h-[380px] max-w-6xl [perspective:1400px] sm:h-[400px]">
        {slides.map((slide, i) => {
          // Signed distance from the active card, wrapped to -2..2.
          const offset = ((i - active + slides.length + 2) % slides.length) - 2;
          const distance = Math.abs(offset) as 0 | 1 | 2;
          const isActive = offset === 0;
          return (
            <div
              key={slide.title}
              role="group"
              aria-roledescription="slide"
              aria-label={copy.carousel.slideLabel(i + 1, slides.length, slide.title)}
              aria-hidden={!isActive && distance > 1 ? true : undefined}
              className={cn(
                "absolute top-1/2 left-1/2 h-[340px] w-[250px] transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none sm:h-[360px] sm:w-[260px]",
                SLOT[distance],
              )}
              style={{
                transform: `translate(-50%, -50%) translateX(calc(${Math.sign(offset)} * min(${[0, 27, 48][distance]}vw, ${[0, 268, 480][distance]}px))) rotateY(${offset * -8}deg) scale(${[1, 0.8, 0.68][distance]})`,
              }}
              data-active={isActive}
            >
              <button
                type="button"
                onClick={() => setActive(i)}
                tabIndex={isActive || distance === 1 ? 0 : -1}
                aria-current={isActive ? "true" : undefined}
                className={cn(
                  "relative size-full overflow-hidden rounded-[22px] border text-left outline-none focus-visible:ring-3 focus-visible:ring-ember/60",
                  isActive ? "border-ember/60 shadow-[0_30px_80px_-20px] shadow-ember/40" : "border-white/12",
                  FALLBACK[slide.style],
                )}
              >
                <CardArt style={slide.style} animate={isActive && visible && tier === "high"} />
                <span className="absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-transparent" aria-hidden />
                <span className="relative flex h-full flex-col p-5">
                  <span className="text-xs text-white/70 tabular-nums">0{i + 1}</span>
                  <span className="text-xs text-white/70">{slide.kicker}</span>
                  <span className="mt-6 text-2xl leading-tight font-medium tracking-tight">{slide.title}</span>
                  <span
                    className={cn(
                      "mt-auto text-sm leading-relaxed text-white/80 transition-opacity duration-300",
                      isActive ? "opacity-100" : "opacity-0",
                    )}
                  >
                    {slide.text}
                  </span>
                </span>
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => go(-1)}
          aria-label={copy.carousel.previous}
          className="absolute top-1/2 left-2 z-40 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition hover:border-ember/60 hover:text-ember focus-visible:ring-3 focus-visible:ring-ember/60 focus-visible:outline-none sm:left-4"
        >
          <ChevronLeft className="size-5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => go(1)}
          aria-label={copy.carousel.next}
          className="absolute top-1/2 right-2 z-40 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition hover:border-ember/60 hover:text-ember focus-visible:ring-3 focus-visible:ring-ember/60 focus-visible:outline-none sm:right-4"
        >
          <ChevronRight className="size-5" aria-hidden />
        </button>
      </div>

      <p className="sr-only" aria-live="polite" data-testid="carousel-status">
        {copy.carousel.slideLabel(active + 1, slides.length, slides[active].title)}
      </p>
    </section>
  );
}

/** Shader artwork: painted once, animated at ~30 fps only for the visible active card on capable devices. */
const noopSubscribe = () => () => undefined;

function CardArt({ style, animate }: { style: CardStyle; animate: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  // Without WebGL2 the card keeps its CSS gradient (no canvas at all).
  const supported = useSyncExternalStore(noopSubscribe, () => getCardRenderer() !== null, () => false);

  useEffect(() => {
    const el = canvas.current;
    const renderer = getCardRenderer();
    if (!el || !renderer) return;
    let raf = 0;
    let last = 0;
    let time = CARD_STYLES.indexOf(style) * 1.7;
    const paint = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.round(el.clientWidth * ratio);
      const h = Math.round(el.clientHeight * ratio);
      if (el.width !== w || el.height !== h) {
        el.width = w;
        el.height = h;
      }
      renderer.render(style, el, time);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(el);
    if (animate) {
      const tick = (now: number) => {
        if (now - last >= 33) {
          time += last ? (now - last) / 1000 : 0;
          last = now;
          paint();
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [style, animate, supported]);

  if (!supported) return null;
  return <canvas ref={canvas} className="absolute inset-0 size-full" aria-hidden data-card-art={style} />;
}
