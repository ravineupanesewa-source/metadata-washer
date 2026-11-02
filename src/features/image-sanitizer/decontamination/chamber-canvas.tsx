"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { IDLE_FPS, TIER_BUDGETS, type QualityTier } from "./chamber-config";
import { WasherScene, type ChamberSceneProps, type StageMode } from "./washer-scene";

/**
 * Client-only R3F canvas for the laundromat washer (loaded with next/dynamic, ssr: false).
 * Rendering policy:
 *   run / drag        → every frame
 *   idle / ready      → IDLE_FPS (static single frame with reduced motion)
 *   finished          → a short settle, then no rendering until something changes
 *   off-screen/hidden → nothing
 */

export interface ChamberCanvasProps extends ChamberSceneProps {
  reduced: boolean;
  /** Idle/ready gentle motion; off on slow devices (a static frame instead). */
  idleMotion: boolean;
  onFailure: () => void;
  /** Fires once, after the scene has drawn its first frame (the preloader can go). */
  onReady?: () => void;
}

export default function ChamberCanvas({ mode, run, subject, tier, reduced, idleMotion, onFailure, onReady }: ChamberCanvasProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? true));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const continuous = mode === "run" || mode === "drag";
  const frameloop = !visible ? "never" : continuous ? "always" : "demand";

  return (
    <div ref={host} className="absolute inset-0" aria-hidden>
      <CanvasErrorBoundary onError={onFailure}>
        <Canvas
          frameloop={frameloop}
          dpr={[1, TIER_BUDGETS[tier].maxDpr]}
          shadows={tier === "full" && idleMotion}
          camera={{ fov: 35, near: 0.1, far: 40, position: [0, 1.6, 6.6] }}
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
          <WasherScene mode={mode} run={run} subject={subject} tier={tier} rich={idleMotion} />
          <Ticker mode={mode} reduced={reduced || !idleMotion} visible={visible} />
          {onReady && <FirstFrame onReady={onReady} />}
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}

/** Drives "demand" frames: low-rate idle motion, a short settle after changes. */
function Ticker({ mode, reduced, visible }: { mode: StageMode; reduced: boolean; visible: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!visible || mode === "run" || mode === "drag") return;
    // Always render a few frames so damped values (drag release, standby lighting) settle.
    const settleUntil = performance.now() + 1200;
    const idleMotion = !reduced && (mode === "idle" || mode === "ready");
    const timer = setInterval(() => {
      if (idleMotion || performance.now() < settleUntil) invalidate();
      else clearInterval(timer);
    }, 1000 / IDLE_FPS);
    invalidate();
    return () => clearInterval(timer);
  }, [mode, reduced, visible, invalidate]);
  return null;
}

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

export type { QualityTier };
