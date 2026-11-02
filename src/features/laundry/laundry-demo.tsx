"use client";

import { Download, ImageUp, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CLOSE_MS, LOAD_MS, MIN_WASH_MS, UNLOAD_MS, type WashPhase } from "./timeline";

const LaundryCanvas = dynamic(() => import("./laundry-scene"), { ssr: false, loading: () => null });

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"];

const LINES: Record<WashPhase | "drag" | "reject", string> = {
  idle: "Hi, I'm Suds! Drop a picture and I'll wash the background off.",
  drag: "Ooh, a picture! Let go!",
  reject: "I only wash pictures (PNG, JPEG, WebP, AVIF or GIF).",
  loading: "In you go…",
  washing: "Scrub, scrub… rinsing that background away…",
  unloading: "Squeaky clean!",
  done: "All done. Want another wash?",
  closing: "Next!",
};

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Placeholder for the real background remover: resolves with the original
 * picture after a short delay so the animation can be judged on its own.
 */
async function removeBackground(file: File): Promise<string> {
  await wait(3000);
  return URL.createObjectURL(file);
}

export function LaundryDemo() {
  const [phase, setPhase] = useState<WashPhase>("idle");
  const [source, setSource] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const run = useRef(0);

  useEffect(() => () => void (run.current = -1), []);

  const start = useCallback(
    async (file: File | undefined) => {
      if (!file || phase !== "idle") return;
      if (!ACCEPTED.includes(file.type)) {
        setRejected(true);
        return;
      }
      setRejected(false);
      const id = ++run.current;
      const alive = () => run.current === id;

      setSource(URL.createObjectURL(file));
      setResult(null);
      setPhase("loading");
      const processing = removeBackground(file);

      await wait(LOAD_MS);
      if (!alive()) return;
      setPhase("washing");

      const [out] = await Promise.all([processing, wait(MIN_WASH_MS)]);
      if (!alive()) return URL.revokeObjectURL(out);
      setResult(out);
      setPhase("unloading");

      await wait(UNLOAD_MS);
      if (alive()) setPhase("done");
    },
    [phase],
  );

  async function reset() {
    const id = ++run.current;
    setPhase("closing");
    await wait(CLOSE_MS);
    if (run.current !== id) return;
    if (source) URL.revokeObjectURL(source);
    if (result) URL.revokeObjectURL(result);
    setSource(null);
    setResult(null);
    setPhase("idle");
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragOver(false);
    void start(event.dataTransfer.files[0]);
  }

  const line = rejected ? LINES.reject : dragOver && phase === "idle" ? LINES.drag : LINES[phase];

  return (
    <div
      className={cn(
        "relative isolate min-h-[560px] flex-1 overflow-hidden bg-[#140e0c] text-white",
        "h-[calc(100dvh-4rem)]",
      )}
      onDragEnter={(e) => {
        e.preventDefault();
        dragDepth.current++;
        setDragOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        if (--dragDepth.current <= 0) setDragOver(false);
      }}
      onDrop={onDrop}
    >
      {!failed && (
        <LaundryCanvas
          phase={phase}
          sourceUrl={source}
          resultUrl={result}
          dragOver={dragOver}
          onFailure={() => setFailed(true)}
        />
      )}
      {failed && (
        <p className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-white/70">
          3D isn&apos;t available in this browser.
        </p>
      )}

      {/* Drop highlight. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-3 rounded-2xl border-2 border-dashed border-[#7dffcf]/70 transition-opacity duration-200",
          dragOver && phase === "idle" ? "opacity-100" : "opacity-0",
        )}
      />

      <div className="pointer-events-none absolute top-4 left-4 font-mono text-[11px] leading-relaxed tracking-wider text-white/70 uppercase sm:top-6 sm:left-6">
        Suds laundromat
        <br />
        Background wash · demo
      </div>

      {/* Speech line. */}
      <div className="pointer-events-none absolute inset-x-4 bottom-24 flex justify-center sm:bottom-28" aria-live="polite">
        <p
          key={line}
          className="max-w-md animate-in rounded-lg bg-black/75 px-4 py-2.5 text-center font-mono text-sm text-[#7dffcf] fade-in slide-in-from-bottom-1"
        >
          {line}
        </p>
      </div>

      {phase === "idle" && (
        <div className="absolute inset-x-4 bottom-6 flex justify-center sm:bottom-8">
          <Button size="lg" onClick={() => input.current?.click()} className="gap-2 bg-[#7dffcf] text-black hover:bg-[#a9ffe0]">
            <ImageUp /> Upload or drop a picture
          </Button>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          void start(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {phase === "done" && result && (
        <div className="absolute inset-0 grid place-items-center bg-black/30 p-4 animate-in fade-in zoom-in-95">
          <div className="w-full max-w-sm rounded-2xl bg-[#1d1714] p-3 shadow-2xl ring-1 ring-white/10">
            <div className="aspect-square overflow-hidden rounded-xl bg-[conic-gradient(#3a3330_25%,#2a2421_0_50%,#3a3330_0_75%,#2a2421_0)] bg-[length:24px_24px]">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob URL */}
              <img src={result} alt="Picture with the background removed" className="size-full object-contain" />
            </div>
            <div className="mt-3 flex gap-2">
              <Button asChild className="flex-1 gap-2 bg-[#7dffcf] text-black hover:bg-[#a9ffe0]">
                <a href={result} download="clean.png">
                  <Download /> Download
                </a>
              </Button>
              <Button variant="outline" onClick={reset} className="flex-1 gap-2 border-white/20 bg-transparent text-white">
                <RotateCcw /> Wash another
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
