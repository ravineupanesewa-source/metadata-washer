"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, memo, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { IDLE_FPS, TIER_BUDGETS, type QualityTier } from "./chamber-config";
import { CAMERA_FOV, WasherScene, type ChamberSceneProps, type StageMode } from "./washer-scene";

/**
 * Client-only R3F canvas for the laundromat washer (loaded with next/dynamic, ssr: false).
 * Rendering policy:
 *   run / drag              → every frame
 *   idle / ready, motion on → every frame (vsync-paced; a timer-driven low rate reads as stutter,
 *                             most visibly in the pointer parallax)
 *   idle / ready, motion off→ a short settle, then a static frame (slow devices, reduced motion)
 *   finished                → a short settle, then no rendering until something changes
 *   off-screen/hidden       → nothing
 */

export interface ChamberCanvasProps extends ChamberSceneProps {
  reduced: boolean;
  /** Idle/ready gentle motion; off on slow devices (a static frame instead). */
  idleMotion: boolean;
  /** Fast device: reflections, shadows and the richer room shader. */
  rich: boolean;
  /** The two neighbouring machines. */
  neighbours: boolean;
  onFailure: () => void;
  /** Fires once, after the scene has drawn its first frame (the preloader can go). */
  onReady?: () => void;
}

function ChamberCanvas({ mode, run, garments, tier, reduced, idleMotion: idleMotionAllowed, rich, neighbours, onFailure, onReady }: ChamberCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const idleMotion = idleMotionAllowed && !reduced && (mode === "idle" || mode === "ready");
  const continuous = mode === "run" || mode === "drag" || idleMotion;
  const frameloop = !visible ? "never" : continuous ? "always" : "demand";

  return (
    <div ref={host} className="absolute inset-0" aria-hidden>
      <CanvasErrorBoundary onError={onFailure}>
        <Canvas
          frameloop={frameloop}
          dpr={[1, TIER_BUDGETS[tier].maxDpr]}
          shadows={tier === "full" && rich}
          camera={{ fov: CAMERA_FOV, near: 0.1, far: 40, position: [0, 1.6, 6.6] }}
          gl={{ antialias: true, powerPreference: "high-performance" }}
          onCreated={({ gl }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.25;
            gl.domElement.addEventListener("webglcontextlost", (event) => {
              event.preventDefault();
              onFailure();
            });
          }}
          tabIndex={-1}
          style={{ pointerEvents: "none" }}
        >
          {/* The washer model streams in; the stage preloader stays up until its first frame. */}
          <Suspense fallback={null}>
            <WasherScene mode={mode} run={run} garments={garments} tier={tier} rich={rich} neighbours={neighbours} />
            {onReady && <FirstFrame onReady={onReady} />}
          </Suspense>
          <Ticker mode={mode} continuous={continuous} visible={visible} />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}

/**
 * On "demand" stages, renders a short settle after each change so damped values
 * (drag release, standby lighting, the door spring) come to rest, then stops.
 * Frames are requested from requestAnimationFrame so they stay vsync-aligned.
 */
function Ticker({ mode, continuous, visible }: { mode: StageMode; continuous: boolean; visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!visible || continuous) return;
    const settleUntil = performance.now() + SETTLE_MS;
    let last = 0;
    let frame = requestAnimationFrame(function tick(now) {
      if (now >= settleUntil) return;
      // The settle doesn't need the display's full rate: IDLE_FPS is plenty for damping to finish.
      if (now - last >= 1000 / IDLE_FPS) {
        last = now;
        invalidate();
      }
      frame = requestAnimationFrame(tick);
    });
    invalidate();
    return () => cancelAnimationFrame(frame);
  }, [mode, continuous, visible, invalidate]);
  return null;
}

const SETTLE_MS = 1200;

/** Reports the first rendered frame: by then the chunk, shaders and textures are all in. */
function FirstFrame({ onReady }: { onReady: () => void }) {
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    done.current = true;
    // Let this frame reach the screen before the preloader starts fading.
    requestAnimationFrame(() => onReady());
  });
  return null;
}

class CanvasErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default memo(ChamberCanvas);

export type { QualityTier };
