"use client";

import { ArrowRight, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useSyncExternalStore, type DragEvent } from "react";
import { usePerfTier } from "@/lib/perf/perf-tier";
import { cn } from "@/lib/utils";
import { requestFilePicker, scrollToWorkbench, submitFiles } from "../image-sanitizer/intake";
import { copy } from "../image-sanitizer/strings";

const HeroCanvas = dynamic(() => import("./hero-scene"), { ssr: false, loading: () => null });

let webgl: boolean | null = null;
const detectWebGL = () => {
  if (webgl === null) {
    try {
      const c = document.createElement("canvas");
      webgl = !!(c.getContext("webgl2") ?? c.getContext("webgl"));
    } catch {
      webgl = false;
    }
  }
  return webgl;
};
const noop = () => () => undefined;

export function Hero() {
  const section = useRef<HTMLElement>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const [visible, setVisible] = useState(true);
  const [failed, setFailed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const tier = usePerfTier();
  const hasWebGL = useSyncExternalStore(noop, detectWebGL, () => null);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true));
    io.observe(el);
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      pointer.current = {
        x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)),
        y: Math.max(-1, Math.min(1, -(((e.clientY - r.top) / r.height) * 2 - 1))),
      };
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      io.disconnect();
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  const renderer = hasWebGL === null ? "pending" : hasWebGL && !failed ? "webgl" : "fallback";
  // Animate while measuring and on capable devices; static frame on slow ones; nothing off-screen.
  const animate = visible && tier !== "low";

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    submitFiles(files);
    scrollToWorkbench();
  }

  return (
    <section
      ref={section}
      id="top"
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[min(100svh,880px)] flex-col items-center justify-end overflow-hidden bg-[#050805] px-4 pt-24 pb-16 text-white sm:pb-20"
      data-testid="hero"
      data-renderer={renderer}
      data-animate={animate}
    >
      <div className="absolute inset-0 -z-10" aria-hidden>
        {renderer === "webgl" ? (
          <HeroCanvas animate={animate} pointer={pointer} onFailure={() => setFailed(true)} />
        ) : (
          <HeroFallback />
        )}
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-background" />
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 text-center">
        <h1 id="hero-title" className="text-5xl leading-[1.02] font-semibold tracking-tight text-balance animate-rise sm:text-6xl lg:text-7xl">
          {copy.hero.titleStart} <span className="text-ember">{copy.hero.titleAccent}</span>
          <span className="sr-only"> {copy.heading}</span>
        </h1>
        <p className="max-w-xl text-pretty text-white/70 animate-rise [animation-delay:80ms] sm:text-lg">{copy.hero.subtitle}</p>

        <button
          type="button"
          onClick={() => {
            scrollToWorkbench();
            requestFilePicker();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          data-testid="hero-pill"
          className={cn(
            "group mt-3 flex w-full max-w-md items-center gap-3 rounded-full border bg-white/[0.06] py-2 pr-2 pl-5 text-left text-sm text-white/70 shadow-[0_0_40px_-12px] shadow-ember/40 backdrop-blur-xl transition animate-rise [animation-delay:160ms] hover:border-ember/50 hover:bg-white/[0.09] focus-visible:ring-3 focus-visible:ring-ember/50 focus-visible:outline-none",
            dragging ? "border-ember bg-ember/10" : "border-white/15",
          )}
        >
          <Sparkles className="size-4 shrink-0 text-ember" aria-hidden />
          <span className="flex-1 truncate">{dragging ? copy.hero.pillDrop : copy.hero.pill}</span>
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ember text-ember-foreground transition-transform group-hover:translate-x-0.5">
            <ArrowRight className="size-4" aria-hidden />
          </span>
        </button>
        <p className="text-xs text-white/45 animate-rise [animation-delay:220ms]">{copy.hero.reassurance}</p>
      </div>
    </section>
  );
}

/** Without WebGL: the same composition in CSS (light beams, glow, a jelly blob with a face). */
function HeroFallback() {
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#050805]" data-renderer="fallback">
      <div className="absolute top-[30%] left-1/2 h-24 w-[140%] -translate-x-1/2 rotate-[-18deg] bg-[radial-gradient(ellipse_at_center,rgb(198_244_50/0.45),transparent_65%)] blur-2xl" />
      <div className="absolute top-[34%] left-1/2 h-20 w-[140%] -translate-x-1/2 rotate-[15deg] bg-[radial-gradient(ellipse_at_center,rgb(198_244_50/0.35),transparent_65%)] blur-2xl" />
      <div className="absolute top-[14%] left-1/2 h-44 w-36 -translate-x-1/2 rotate-[-24deg] rounded-[48%_52%_46%_54%/58%_58%_42%_42%] bg-[radial-gradient(circle_at_35%_28%,#f3ffc4,#c6f432_38%,#2f6b06_100%)] shadow-[0_0_80px_10px] shadow-ember/40">
        <span className="absolute top-[34%] left-[34%] h-3 w-2.5 rounded-full bg-[#0b1206]" />
        <span className="absolute top-[34%] left-[58%] h-3 w-2.5 rounded-full bg-[#0b1206]" />
        <span className="absolute top-[47%] left-[44%] h-2 w-5 rounded-b-full border-b-2 border-[#0b1206]" />
      </div>
    </div>
  );
}
