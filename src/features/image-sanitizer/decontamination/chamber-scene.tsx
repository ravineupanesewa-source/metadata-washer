"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import { CHAMBER, PALETTE, TIER_BUDGETS, type QualityTier, type TierBudget } from "./chamber-config";
import { fitPhoto, loadPhotoTexture, sampleTexture, type PhotoTexture } from "./image-texture";
import { createParticleAttributes, particleGeometry } from "./particle-seeds";
import type { DecontaminationRun } from "./run";
import {
  beamFragment,
  beamVertex,
  floorFragment,
  floorVertex,
  glassFragment,
  glassVertex,
  particleFragment,
  particleVertex,
} from "./shaders";
import { TIMELINE, type TimelineSample } from "./timeline";

/**
 * The Digital Decontamination Chamber as React Three Fiber components.
 * React renders the structure; all motion happens in useFrame through refs
 * and shader uniforms. A single driver samples the run's timeline once per
 * frame and every part reads that shared snapshot.
 */

export type StageMode = "idle" | "drag" | "ready" | "run" | "finished";

export interface ChamberSubject {
  /** Changes when the subject changes (queue item id). */
  key: string;
  file: Blob;
  label: string;
}

export interface ChamberSceneProps {
  mode: StageMode;
  run: DecontaminationRun | null;
  subject: ChamberSubject | null;
  tier: QualityTier;
}

/** Per-frame snapshot shared by all parts (mutated in place, never React state). */
interface FrameState {
  sample: TimelineSample | null;
  /** Scene clock for idle motion (seconds). */
  clock: number;
  /** Smoothed 0..1 drag-over excitement. */
  drag: number;
  /** Smoothed 0..1 "has a real photo" standby lighting. */
  standby: number;
  accent: THREE.Color;
  photo: { width: number; height: number };
  budget: TierBudget;
  /** End of the first scan pass for the current run's timeline (s). */
  scanEnd: number;
}

type Frame = RefObject<FrameState>;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3;
const easeInOut = (t: number) => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
};
const easeIn = (t: number) => clamp01(t) ** 2;
const deg = THREE.MathUtils.degToRad;
const damp = THREE.MathUtils.damp;

const COLORS = {
  accent: new THREE.Color(PALETTE.accent),
  mint: new THREE.Color(PALETTE.mint),
  fault: new THREE.Color(PALETTE.fault),
  glass: new THREE.Color(PALETTE.glass),
};

const HALF_W = CHAMBER.width / 2;
const HALF_H = CHAMBER.height / 2;
const HALF_D = CHAMBER.depth / 2;
const BASE_Y = CHAMBER.centerY - HALF_H;
const CORNERS: readonly [number, number][] = [
  [-HALF_W, -HALF_D],
  [HALF_W, -HALF_D],
  [HALF_W, HALF_D],
  [-HALF_W, HALF_D],
];

/** Disposes a GPU resource created outside React's declarative tree when it changes or unmounts. */
function useDispose(value: { dispose(): void } | null) {
  useEffect(() => () => value?.dispose(), [value]);
}

/* Uniform factories: objects handed to <shaderMaterial uniforms>, then updated via the material ref. */
const floorUniforms = () => ({
  uTime: { value: 0 },
  uColor: { value: COLORS.accent.clone() },
  uIntensity: { value: 0.4 },
  uSweep: { value: 0 },
  uRings: { value: 7 },
});
const glassUniforms = () => ({
  uTime: { value: 0 },
  uEdgeColor: { value: COLORS.glass.clone() },
  uOpacity: { value: 0.012 },
  uFresnelPower: { value: 2.4 },
  uGlow: { value: 0.16 },
  uPulse: { value: 1 },
});
const beamUniforms = () => ({
  uTime: { value: 0 },
  uScanProgress: { value: 0 },
  uBeamWidth: { value: 0.01 },
  uBeamIntensity: { value: 1.1 },
  uActive: { value: 0 },
  uColor: { value: COLORS.accent.clone() },
});
const particleUniforms = () => ({
  uTime: { value: 0 },
  uPhoto: { value: new THREE.Vector3(2.4, 1.8, CHAMBER.photoY) },
  uCore: { value: new THREE.Vector3(CHAMBER.core.x, CHAMBER.core.y, CHAMBER.core.z) },
  uRelease: { value: -1 },
  uPurge: { value: 0 },
  uDissipate: { value: 0 },
  uFade: { value: 1 },
  uRunMix: { value: 0 },
  uDrag: { value: 0 },
  uSizeScale: { value: 400 },
  uColor: { value: COLORS.accent.clone() },
});

function glowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const c = canvas.getContext("2d")!;
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2);
  s.lineTo(w / 2 - r, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2);
  s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  s.lineTo(-w / 2, -h / 2 + r);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  return s;
}

function outlineGeometry(w: number, h: number, thickness: number): THREE.ShapeGeometry {
  const r = Math.min(w, h) * 0.06;
  const outer = roundedRectShape(w + thickness, h + thickness, r + thickness / 2);
  const inner = roundedRectShape(w - thickness, h - thickness, Math.max(0.001, r - thickness / 2));
  outer.holes.push(new THREE.Path(inner.getPoints(12).reverse()));
  return new THREE.ShapeGeometry(outer, 12);
}

/* ================================================================ root === */

export function ChamberScene({ mode, run, subject, tier }: ChamberSceneProps) {
  const budget = TIER_BUDGETS[tier];
  const [photo, setPhoto] = useState<PhotoTexture | null>(null);
  const placeholder = useMemo(() => sampleTexture(), []);
  const glow = useMemo(() => glowTexture(), []);
  useDispose(placeholder);
  useDispose(glow);

  // Decode the subject once per subject; dispose the previous texture and bitmap.
  useEffect(() => {
    if (!subject) return;
    let cancelled = false;
    let loaded: PhotoTexture | null = null;
    void loadPhotoTexture(subject.file, subject.label).then((result) => {
      if (cancelled) {
        result.dispose();
        return;
      }
      loaded = result;
      setPhoto(result);
    });
    return () => {
      cancelled = true;
      loaded?.dispose();
      setPhoto(null);
    };
  }, [subject]);

  const active = subject ? photo : placeholder;
  const size = fitPhoto(active?.aspect ?? 4 / 3, CHAMBER.photoMaxWidth, CHAMBER.photoMaxHeight);

  const frame = useRef<FrameState>({
    sample: null,
    clock: 0,
    drag: 0,
    standby: 0,
    accent: COLORS.accent.clone(),
    photo: size,
    budget,
    scanEnd: TIMELINE.scanEnd,
  });
  // Props → frame snapshot (outside render, as refs must not be written while rendering).
  const scanEnd = run?.config.scanEnd ?? TIMELINE.scanEnd;
  useEffect(() => {
    frame.current.photo = { width: size.width, height: size.height };
    frame.current.budget = budget;
    frame.current.scanEnd = scanEnd;
  }, [size.width, size.height, budget, scanEnd]);

  // Driver: one timeline sample per frame, before any part updates.
  useFrame((_, dt) => {
    const f = frame.current;
    f.clock += dt;
    f.sample = run && (mode === "run" || mode === "finished") ? run.sample() : null;
    f.drag = damp(f.drag, mode === "drag" ? 1 : 0, 6, dt);
    f.standby = damp(f.standby, mode === "idle" || mode === "drag" ? 0 : 1, 3, dt);
    const s = f.sample;
    if (!s) f.accent.copy(COLORS.accent);
    else if (s.fault > 0) f.accent.copy(COLORS.accent).lerp(COLORS.fault, easeOut(s.fault * 1.6));
    else if (s.outcome === "clean" && s.clear > 0) f.accent.copy(COLORS.accent).lerp(COLORS.mint, easeOut(s.clear));
    else if (s.outcome === "clean" && s.purge > 0.75) f.accent.copy(COLORS.accent).lerp(COLORS.mint, (s.purge - 0.75) * 1.2);
    else f.accent.copy(COLORS.accent);
  }, -1);

  return (
    <>
      <CameraRig frame={frame} />
      <hemisphereLight args={["#f0ffd8", PALETTE.stageDeep, 0.55]} />
      <directionalLight position={[3, 4.5, 5]} intensity={1.5} color="#f6ffe8" />
      <directionalLight position={[-4, 1, 2.5]} intensity={0.5} color={PALETTE.blue} />
      <directionalLight position={[0.5, 3, -5]} intensity={1.1} color={PALETTE.accent} />

      <Platform frame={frame} />
      <Enclosure frame={frame} glow={glow} />
      <Gantry frame={frame} glow={glow} />
      <PhotoFrame frame={frame} texture={active?.texture ?? null} idle={!subject} width={size.width} height={size.height} />
      <Scanner frame={frame} />
      <Particles frame={frame} run={run} count={budget.particles} />
      <Core frame={frame} glow={glow} />
      <AdaptiveQuality />
    </>
  );
}

/* ============================================================== camera === */

function CameraRig({ frame }: { frame: Frame }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const target = useMemo(() => new THREE.Vector3(0, -0.2, 0), []);
  const direction = useMemo(() => new THREE.Vector3(1.35, 1.8, 6.7).normalize(), []); // elevated three-quarter view: the gantry reads as a ring
  const offset = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const f = frame.current;
    const aspect = size.width / Math.max(1, size.height);
    const vHalf = deg(camera.fov / 2);
    // Fit the platform and gantry: by height on wide stages, by width on narrow (phones).
    const base = Math.max(4.7 / 2 / Math.tan(vHalf), 6.2 / 2 / (Math.tan(vHalf) * aspect)) + 1.2;
    const s = f.sample;
    let distance = base * (1 - 0.03 * f.drag);
    let azimuth = 0;
    if (f.budget.cameraMotion) {
      if (s) {
        distance *= 1 + 0.07 * (1 - easeOut(s.materialize));
        if (s.phase === "awaiting") azimuth = Math.sin(s.t * 0.35) * deg(2);
      } else {
        azimuth = Math.sin(f.clock * 0.15) * deg(3); // idle: slow, barely-there drift
      }
    }
    offset.copy(direction).applyAxisAngle(THREE.Object3D.DEFAULT_UP, azimuth).multiplyScalar(distance);
    camera.position.copy(target).add(offset);
    camera.lookAt(target);
  });
  return null;
}

/* ============================================================ platform === */

function Platform({ frame }: { frame: Frame }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => floorUniforms(), []);

  useFrame(() => {
    if (!material.current) return;
    const f = frame.current;
    const s = f.sample;
    const u = material.current.uniforms;
    u.uTime.value = f.clock;
    u.uColor.value.copy(f.accent);
    u.uRings.value = f.budget.floorRings;
    if (s) {
      u.uIntensity.value = 0.25 + 0.35 * easeOut(s.materialize) + 0.25 * easeOut(s.activate) - 0.3 * s.fault;
      u.uSweep.value = s.beam > 0 ? 0.6 : s.clear > 0 ? 0.3 * (1 - s.clear) : 0;
    } else {
      u.uIntensity.value = 0.3 + 0.2 * f.standby + 0.35 * f.drag;
      u.uSweep.value = 0.15 + 0.4 * f.drag;
    }
  });

  return (
    <group>
      <mesh position={[0, BASE_Y - 0.1, 0]}>
        <cylinderGeometry args={[CHAMBER.platformRadius, CHAMBER.platformRadius + 0.08, 0.08, 72]} />
        <meshStandardMaterial color={PALETTE.metal} metalness={0.75} roughness={0.38} />
      </mesh>
      <mesh position={[0, BASE_Y - 0.02, 0]}>
        <boxGeometry args={[CHAMBER.width + 0.22, 0.1, CHAMBER.depth + 0.22]} />
        <meshStandardMaterial color={PALETTE.metalLight} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, BASE_Y - 0.055, 0]} rotation-x={-Math.PI / 2} renderOrder={2}>
        <planeGeometry args={[CHAMBER.platformRadius * 2, CHAMBER.platformRadius * 2]} />
        <shaderMaterial
          ref={material}
          vertexShader={floorVertex}
          fragmentShader={floorFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}

/* =========================================================== enclosure === */

const STRIPS: readonly [axis: "x" | "z", x: number, y: number, z: number][] = [
  ["x", 0, -HALF_H, HALF_D],
  ["z", HALF_W, -HALF_H, 0],
  ["x", 0, -HALF_H, -HALF_D],
  ["z", -HALF_W, -HALF_H, 0],
  ["x", 0, HALF_H, HALF_D],
  ["z", HALF_W, HALF_H, 0],
  ["x", 0, HALF_H, -HALF_D],
  ["z", -HALF_W, HALF_H, 0],
];

const SHELL_PANES: readonly { position: [number, number, number]; rotation: [number, number, number]; size: [number, number] }[] = [
  { position: [0, 0, -HALF_D], rotation: [0, 0, 0], size: [CHAMBER.width, CHAMBER.height] },
  { position: [-HALF_W, 0, 0], rotation: [0, Math.PI / 2, 0], size: [CHAMBER.depth, CHAMBER.height] },
  { position: [HALF_W, 0, 0], rotation: [0, -Math.PI / 2, 0], size: [CHAMBER.depth, CHAMBER.height] },
  { position: [0, HALF_H, 0], rotation: [Math.PI / 2, 0, 0], size: [CHAMBER.width, CHAMBER.depth] },
];

function Enclosure({ frame, glow }: { frame: Frame; glow: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const front = useRef<THREE.Mesh>(null);
  const strips = useRef<(THREE.MeshBasicMaterial | null)[]>([]);
  const traces = useRef<(THREE.Sprite | null)[]>([]);
  const edges = useRef<THREE.LineBasicMaterial>(null);

  // Shell panes share one uniforms object; the front pane has its own so it can fade while opening.
  const shellUniforms = useMemo(() => glassUniforms(), []);
  const frontUniforms = useMemo(() => glassUniforms(), []);
  const shell = useRef<THREE.ShaderMaterial>(null);
  const frontGlass = useRef<THREE.ShaderMaterial>(null);
  const edgeGeometry = useMemo(() => {
    const box = new THREE.BoxGeometry(CHAMBER.width, CHAMBER.height, CHAMBER.depth);
    const edgesOfBox = new THREE.EdgesGeometry(box);
    box.dispose();
    return edgesOfBox;
  }, []);
  useDispose(edgeGeometry);

  useFrame(() => {
    const f = frame.current;
    const s = f.sample;
    const m = s ? easeOut(s.materialize) : 1;
    const activation = s ? easeOut(s.activate) : 0;

    for (const material of [shell.current, frontGlass.current]) {
      if (!material) continue;
      material.uniforms.uTime.value = f.clock;
      material.uniforms.uEdgeColor.value.copy(f.accent).lerp(COLORS.glass, 0.55);
      material.uniforms.uGlow.value = 0.12 + 0.08 * activation + 0.12 * f.drag;
      material.uniforms.uPulse.value = f.budget.cameraMotion ? 1 : 0;
    }
    // Drag-over: the front pane lifts and the enclosure breathes open a little.
    if (front.current) front.current.position.y = 0.55 * easeOut(f.drag);
    if (frontGlass.current) frontGlass.current.uniforms.uOpacity.value = 0.012 * (1 - f.drag);
    if (group.current) group.current.scale.setScalar(1 + 0.025 * f.drag);

    const lit = s ? s.materialize * STRIPS.length : STRIPS.length;
    strips.current.forEach((material, i) => {
      if (!material) return;
      material.color.copy(f.accent);
      const base = s ? clamp01(lit - i) * (0.35 + 0.45 * activation) * (1 - 0.5 * s.fault) : 0.22 + 0.13 * f.standby + 0.55 * f.drag;
      material.opacity = base;
    });
    if (edges.current) {
      edges.current.color.copy(f.accent);
      edges.current.opacity = 0.1 + 0.12 * m + 0.1 * activation + 0.15 * f.drag;
    }
    traces.current.forEach((trace, i) => {
      if (!trace) return;
      const k = s && f.budget.edgeTraces ? clamp01(s.activate * 1.25 - i * 0.08) : 0;
      trace.position.y = -HALF_H + CHAMBER.height * easeInOut(k);
      const material = trace.material as THREE.SpriteMaterial;
      material.opacity = Math.sin(k * Math.PI) * 0.85;
      material.color.copy(f.accent);
    });
  });

  return (
    <group ref={group} position={[0, CHAMBER.centerY, 0]}>
      {/* Glass shell: back, sides and top share uniforms; the front pane is separate so it can open. */}
      {SHELL_PANES.map(({ position, rotation, size }, i) => (
        <mesh key={i} position={position} rotation={rotation} renderOrder={10}>
          <planeGeometry args={size} />
          <shaderMaterial
            ref={i === 0 ? shell : undefined}
            vertexShader={glassVertex}
            fragmentShader={glassFragment}
            uniforms={shellUniforms}
            transparent
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
      <mesh ref={front} position={[0, 0, HALF_D]} renderOrder={11}>
        <planeGeometry args={[CHAMBER.width, CHAMBER.height]} />
        <shaderMaterial
          ref={frontGlass}
          vertexShader={glassVertex}
          fragmentShader={glassFragment}
          uniforms={frontUniforms}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      <lineSegments geometry={edgeGeometry} renderOrder={12}>
        <lineBasicMaterial ref={edges} transparent opacity={0.18} toneMapped={false} />
      </lineSegments>

      {CORNERS.map(([x, z]) => (
        <mesh key={`${x}:${z}`} position={[x, 0, z]}>
          <boxGeometry args={[0.07, CHAMBER.height + 0.04, 0.07]} />
          <meshStandardMaterial color={PALETTE.metalLight} metalness={0.7} roughness={0.3} />
        </mesh>
      ))}

      {STRIPS.map(([axis, x, y, z], i) => (
        <mesh key={i} position={[x, y, z]}>
          <boxGeometry args={axis === "x" ? [CHAMBER.width - 0.08, 0.018, 0.018] : [0.018, 0.018, CHAMBER.depth - 0.08]} />
          <meshBasicMaterial
            ref={(m) => {
              strips.current[i] = m;
            }}
            transparent
            opacity={0}
            toneMapped={false}
          />
        </mesh>
      ))}

      {CORNERS.map(([x, z], i) => (
        <sprite
          key={`trace-${i}`}
          ref={(sp) => {
            traces.current[i] = sp;
          }}
          position={[x, -HALF_H, z]}
          scale={0.32}
        >
          <spriteMaterial map={glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
        </sprite>
      ))}
    </group>
  );
}

/* ============================================================== photo === */

interface PhotoFrameProps {
  frame: Frame;
  texture: THREE.Texture | null;
  idle: boolean;
  width: number;
  height: number;
}

function PhotoFrame({ frame, texture, idle, width, height }: PhotoFrameProps) {
  const group = useRef<THREE.Group>(null);
  const photo = useRef<THREE.Mesh>(null);
  const backing = useRef<THREE.Mesh>(null);
  const shield = useRef<THREE.Mesh>(null);
  const echo = useRef<THREE.Mesh>(null);
  const photoMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const shieldMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const echoMaterial = useRef<THREE.MeshBasicMaterial>(null);

  const outline = useMemo(() => outlineGeometry(width + 0.22, height + 0.22, 0.022), [width, height]);
  useDispose(outline);

  useFrame(() => {
    const f = frame.current;
    const s = f.sample;
    const g = group.current;
    if (!g || !photoMaterial.current) return;
    photo.current?.scale.set(f.photo.width, f.photo.height, 1);
    backing.current?.scale.set(f.photo.width + 0.1, f.photo.height + 0.1, 1);

    if (s) {
      // Phase 1: rise and settle into the processing position (the photo itself is never altered).
      const m = easeOut(s.materialize);
      photoMaterial.current.opacity = Math.max(m, f.standby);
      g.position.y = CHAMBER.photoY - 0.12 * (1 - m);
      g.rotation.y = 0;
      g.scale.setScalar(0.95 + 0.05 * m);
    } else {
      // Idle/ready: float gently a little lower, waiting for processing.
      const bob = f.budget.cameraMotion ? Math.sin(f.clock * 1.1) * 0.03 : 0;
      photoMaterial.current.opacity = idle ? 0.55 + 0.25 * f.drag : 1;
      g.position.y = CHAMBER.photoY - 0.12 + bob + 0.08 * f.drag;
      g.rotation.y = f.budget.cameraMotion ? Math.sin(f.clock * 0.5) * 0.06 : 0;
      g.scale.setScalar(0.95 + 0.03 * f.drag);
    }

    const showShield = s && s.outcome !== "error" && (s.clear > 0 || s.phase === "complete");
    if (shieldMaterial.current && echoMaterial.current) {
      shieldMaterial.current.color.copy(f.accent);
      echoMaterial.current.color.copy(f.accent);
      if (showShield) {
        const c = easeOut(s.clear);
        shieldMaterial.current.opacity = 0.75 * c;
        shield.current?.scale.setScalar(1.06 - 0.06 * c);
        echoMaterial.current.opacity = 0.5 * (1 - c) * Math.min(1, s.clear * 6);
        echo.current?.scale.setScalar(1 + 0.12 * c);
      } else {
        shieldMaterial.current.opacity = 0;
        echoMaterial.current.opacity = 0;
      }
    }
  });

  return (
    <group ref={group} position={[0, CHAMBER.photoY, 0]}>
      <mesh ref={backing} position-z={-0.032}>
        <boxGeometry args={[1, 1, 0.05]} />
        <meshStandardMaterial color={PALETTE.metalLight} metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh ref={photo}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial ref={photoMaterial} map={texture} color={texture ? "#ffffff" : PALETTE.metal} transparent toneMapped={false} />
      </mesh>
      <mesh ref={shield} geometry={outline} position-z={0.03}>
        <meshBasicMaterial ref={shieldMaterial} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={echo} geometry={outline} position-z={0.03}>
        <meshBasicMaterial ref={echoMaterial} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  );
}

/* ============================================================ scanner === */

function Scanner({ frame }: { frame: Frame }) {
  const beam = useRef<THREE.Mesh>(null);
  const carriages = useRef<(THREE.Mesh | null)[]>([]);
  const carriageMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => beamUniforms(), []);

  useFrame(() => {
    const f = frame.current;
    const s = f.sample;
    const height = f.photo.height + 0.3;
    if (beam.current) {
      beam.current.scale.set(f.photo.width + 0.5, height, 1);
      beam.current.position.y = CHAMBER.photoY;
    }
    const progress = s ? easeInOut(s.scanLine) : 0;
    if (material.current) {
      const u = material.current.uniforms;
      u.uTime.value = f.clock;
      u.uScanProgress.value = progress;
      u.uBeamWidth.value = 0.015 / height; // ~0.015 world units regardless of photo height
      u.uActive.value = s ? s.beam : 0;
      u.uColor.value.copy(f.accent);
    }

    const lineY = CHAMBER.photoY + height / 2 - height * progress;
    const activation = s ? easeOut(s.activate) : 0;
    carriages.current.forEach((c) => {
      if (c) c.position.y = s && s.beam > 0 ? lineY : CHAMBER.photoY - 0.6 + 0.4 * activation;
    });
    carriageMaterial.current?.color.copy(f.accent);
    if (light.current) {
      light.current.position.set(0, lineY, 0.75);
      light.current.intensity = (s ? s.beam : 0) * 3.2;
      light.current.color.copy(f.accent);
    }
  });

  return (
    <group>
      <mesh ref={beam} position-z={0.06} renderOrder={15}>
        <planeGeometry args={[1, 1]} />
        <shaderMaterial
          ref={material}
          vertexShader={beamVertex}
          fragmentShader={beamFragment}
          uniforms={uniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {[-1, 1].map((side, i) => (
        <mesh
          key={side}
          ref={(m) => {
            carriages.current[i] = m;
          }}
          position={[side * HALF_W, 0, HALF_D]}
        >
          <boxGeometry args={[0.12, 0.07, 0.12]} />
          <meshBasicMaterial ref={i === 0 ? carriageMaterial : undefined} color={PALETTE.accent} toneMapped={false} />
        </mesh>
      ))}
      <pointLight ref={light} intensity={0} distance={3.2} decay={1.6} />
    </group>
  );
}

/* ============================================================= gantry === */

function Gantry({ frame, glow }: { frame: Frame; glow: THREE.Texture }) {
  const mounts = useRef<(THREE.Group | null)[]>([]);
  const pitches = useRef<(THREE.Group | null)[]>([]);
  const beams = useRef<(THREE.Mesh | null)[]>([]);
  const tips = useRef<(THREE.Mesh | null)[]>([]);
  const glows = useRef<(THREE.Sprite | null)[]>([]);
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const tipMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const armGeometry = useMemo(() => {
    const g = new THREE.CylinderGeometry(0.018, 0.018, 1, 10);
    g.rotateX(Math.PI / 2);
    g.translate(0, 0, 0.5); // extends along +Z from the housing
    return g;
  }, []);
  useDispose(armGeometry);

  useFrame(() => {
    const f = frame.current;
    const s = f.sample;
    const travel = f.budget.armTravel;
    // One shared rig angle: the four arms move as a single coordinated mechanism.
    let angle = 0;
    let extension = 0.1 + 0.25 * f.drag;
    let pitch = 0;
    let tip = 0.25 + 0.4 * f.drag;

    // Restrained sway while the server is still working; zero at the end of the first pass.
    const sway = (t: number) => (travel ? Math.sin(Math.max(0, t - f.scanEnd) * 0.9) * 14 : 0);
    if (s) {
      angle = travel ? easeInOut(s.activate) * 30 + easeInOut(s.scan) * 90 : 0;
      if (s.phase === "awaiting") angle += sway(s.t);
      extension = easeOut(s.activate);
      tip = 0.35 + extension * 0.45 + (s.beam > 0 ? 0.2 : 0);
      if (s.releaseAt !== null) {
        const converge = easeInOut(s.purge / 0.45);
        const from = travel ? 120 + sway(s.releaseAt) : 0;
        const to = travel ? 135 : 0;
        angle = from + (to - from) * converge;
        pitch = (s.outcome === "clean" ? 32 : 10) * easeInOut(s.purge / 0.55);
        tip = 0.8 + Math.sin(clamp01(s.purge / 0.8) * Math.PI) * (s.outcome === "clean" ? 0.9 : 0.2);
        if (s.clear > 0) {
          const settle = easeInOut(s.clear);
          angle = to + (travel ? 45 : 0) * settle; // 180° ≡ rest (4-fold symmetry)
          pitch *= 1 - settle;
          extension = 1 - 0.85 * settle;
          tip = 0.8 - 0.45 * settle;
        }
      }
      if (s.fault > 0) {
        extension *= 1 - 0.7 * easeOut(s.fault);
        tip *= 1 - 0.6 * s.fault;
      }
    }

    ring.current?.emissive.copy(f.accent);
    if (ring.current) ring.current.emissiveIntensity = 0.04 + 0.25 * (s ? easeOut(s.activate) : 0.3 * f.drag);
    tipMaterial.current?.color.copy(f.accent);

    for (let k = 0; k < 4; k++) {
      const mount = mounts.current[k];
      if (!mount) continue;
      const theta = deg(45 + k * 90 + angle);
      mount.position.set(Math.cos(theta) * CHAMBER.gantryRadius, CHAMBER.gantryY, Math.sin(theta) * CHAMBER.gantryRadius);
      mount.lookAt(0, CHAMBER.gantryY, 0);
      const p = pitches.current[k];
      if (p) p.rotation.x = deg(pitch);
      const length = 0.18 + 0.5 * extension;
      beams.current[k]?.scale.set(1, 1, length);
      tips.current[k]?.position.set(0, 0, length);
      const sprite = glows.current[k];
      if (sprite) {
        const material = sprite.material as THREE.SpriteMaterial;
        material.opacity = clamp01(tip) * 0.9;
        material.color.copy(f.accent);
        sprite.scale.setScalar(0.22 + tip * 0.18);
      }
    }
  });

  return (
    <group>
      <mesh position-y={CHAMBER.gantryY} rotation-x={Math.PI / 2}>
        <torusGeometry args={[CHAMBER.gantryRadius, 0.024, 10, 160]} />
        <meshStandardMaterial ref={ring} color={PALETTE.metalLight} metalness={0.8} roughness={0.3} emissiveIntensity={0.05} />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <group
          key={k}
          ref={(g) => {
            mounts.current[k] = g;
          }}
        >
          <mesh>
            <boxGeometry args={[0.2, 0.13, 0.2]} />
            <meshStandardMaterial color={PALETTE.metalLight} metalness={0.7} roughness={0.3} />
          </mesh>
          <group
            ref={(g) => {
              pitches.current[k] = g;
            }}
          >
            <mesh
              ref={(m) => {
                beams.current[k] = m;
              }}
              geometry={armGeometry}
            >
              <meshStandardMaterial color={PALETTE.metal} metalness={0.75} roughness={0.38} />
            </mesh>
            <mesh
              ref={(m) => {
                tips.current[k] = m;
              }}
            >
              <sphereGeometry args={[0.035, 16, 12]} />
              <meshBasicMaterial ref={k === 0 ? tipMaterial : undefined} color={PALETTE.accent} toneMapped={false} />
              <sprite
                ref={(sp) => {
                  glows.current[k] = sp;
                }}
                scale={0.3}
              >
                <spriteMaterial map={glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
              </sprite>
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/* ========================================================== particles === */

function Particles({ frame, run, count }: { frame: Frame; run: DecontaminationRun | null; count: number }) {
  const config = run?.config ?? TIMELINE;
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const dpr = useThree((s) => s.viewport.dpr);

  const geometry = useMemo(() => particleGeometry(createParticleAttributes(count, config)), [count, config]);
  useDispose(geometry);
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => particleUniforms(), []);

  useFrame((_, dt) => {
    if (!material.current) return;
    const f = frame.current;
    const s = f.sample;
    const u = material.current.uniforms;
    u.uSizeScale.value = (size.height * dpr) / (2 * Math.tan(deg(camera.fov / 2)));
    u.uPhoto.value.set(f.photo.width, f.photo.height, CHAMBER.photoY);
    u.uColor.value.copy(f.accent);
    u.uDrag.value = f.drag;
    u.uRunMix.value = damp(u.uRunMix.value, s ? 1 : 0, 5, dt);
    if (s) {
      u.uTime.value = s.t;
      u.uRelease.value = s.releaseAt ?? -1;
      u.uPurge.value = s.purge;
      u.uDissipate.value = s.outcome === "no-metadata" ? 1 : 0;
      u.uFade.value = (1 - s.fault) * (1 - s.clear);
    } else {
      u.uTime.value = f.clock;
      u.uRelease.value = -1;
      u.uFade.value = 1;
    }
  });

  return (
    <points geometry={geometry} frustumCulled={false} renderOrder={20}>
      <shaderMaterial
        ref={material}
        vertexShader={particleVertex}
        fragmentShader={particleFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

/* =============================================================== core === */

function Core({ frame, glow }: { frame: Frame; glow: THREE.Texture }) {
  const sphere = useRef<THREE.Mesh>(null);
  const sphereMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const halo = useRef<THREE.Sprite>(null);
  const ring = useRef<THREE.Mesh>(null);
  const ringMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const shock = useRef<THREE.Mesh>(null);
  const shockMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const light = useRef<THREE.PointLight>(null);
  const { x, y, z } = CHAMBER.core;

  useFrame(() => {
    const f = frame.current;
    const s = f.sample;
    const pulse = f.budget.pulse;
    let intensity = 0.1 + 0.15 * f.standby + 0.2 * f.drag;
    let scale = 1;
    let shockT = -1;

    if (s) {
      intensity = 0.06 + easeOut(s.activate) * 0.4;
      if (s.phase === "scan" || s.phase === "awaiting") intensity += Math.sin(s.t * 3) * 0.05;
      if (s.releaseAt !== null && s.outcome === "clean") {
        const p = s.purge;
        if (p < 0.72) {
          intensity = 0.45 + easeIn(p / 0.72) * 1.25 * pulse;
          scale = 1 + easeIn(p / 0.72) * 0.9 * pulse;
        } else if (p < 0.86) {
          const k = (p - 0.72) / 0.14;
          intensity = 0.45 + 1.25 * pulse + k * 0.4;
          scale = (1 + 0.9 * pulse) * (1 - 0.8 * easeIn(k)); // compress to a point
        } else {
          const k = (p - 0.86) / 0.14;
          intensity = (0.45 + 1.65 * pulse) * (1 - easeOut(k));
          scale = 0.2 * (1 - k);
          shockT = k;
        }
        if (s.clear > 0) {
          intensity = 0.18 * easeOut(s.clear); // re-arms, dim and calm
          scale = 0.6 + 0.4 * easeOut(s.clear);
        }
      } else if (s.releaseAt !== null) {
        intensity = 0.45 * (1 - easeOut(s.purge)) + 0.15 * s.clear; // nothing to extract: no pulse
      }
      if (s.fault > 0) intensity *= 1 - 0.8 * s.fault;
    }

    if (sphereMaterial.current) {
      sphereMaterial.current.color.copy(f.accent);
      sphereMaterial.current.opacity = clamp01(0.25 + intensity);
    }
    sphere.current?.scale.setScalar(Math.max(0.001, scale));
    if (halo.current) {
      const m = halo.current.material as THREE.SpriteMaterial;
      m.opacity = clamp01(intensity * 0.7);
      m.color.copy(f.accent);
      halo.current.scale.setScalar(0.7 + intensity * 0.55 * scale);
    }
    if (ringMaterial.current && ring.current) {
      ringMaterial.current.color.copy(f.accent);
      ringMaterial.current.opacity = clamp01(intensity * 0.6);
      const t = s ? s.t : f.clock;
      ring.current.rotation.set(Math.PI / 2 + Math.sin(t) * 0.3, t * 1.4, 0);
      ring.current.scale.setScalar(Math.max(0.2, scale));
    }
    if (light.current) {
      light.current.intensity = intensity * 2.4;
      light.current.color.copy(f.accent);
    }
    if (shockMaterial.current && shock.current) {
      shockMaterial.current.color.copy(f.accent);
      if (shockT >= 0) {
        shock.current.scale.setScalar(0.12 + easeOut(shockT) * 0.75 * pulse);
        shockMaterial.current.opacity = (1 - shockT) * 0.55 * pulse;
      } else {
        shockMaterial.current.opacity = 0;
      }
    }
  });

  return (
    <group>
      <mesh position={[x, BASE_Y + 0.07, z]}>
        <cylinderGeometry args={[0.12, 0.17, 0.2, 32]} />
        <meshStandardMaterial color={PALETTE.metalLight} metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh ref={sphere} position={[x, y, z]}>
        <sphereGeometry args={[0.075, 24, 16]} />
        <meshBasicMaterial ref={sphereMaterial} transparent toneMapped={false} />
      </mesh>
      <sprite ref={halo} position={[x, y, z]}>
        <spriteMaterial map={glow} transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </sprite>
      <mesh ref={ring} position={[x, y, z]}>
        <torusGeometry args={[0.17, 0.006, 8, 64]} />
        <meshBasicMaterial ref={ringMaterial} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      <mesh ref={shock} position={[x, y, z]} rotation-x={-Math.PI / 2.4}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial
          ref={shockMaterial}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
          side={THREE.DoubleSide}
        />
      </mesh>
      <pointLight ref={light} position={[x, y, z]} intensity={0} distance={2.6} decay={1.7} />
    </group>
  );
}

/* ========================================================== adaptive === */

/** Drops the pixel ratio once if the device can't hold ~40 fps while animating. */
function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const stats = useRef({ frames: 0, time: 0, degraded: false });
  useFrame((_, dt) => {
    const st = stats.current;
    if (st.degraded || dt > 0.5) return; // ignore tab switches / demand-mode gaps
    st.frames += 1;
    st.time += dt;
    if (st.time >= 2) {
      if (st.frames / st.time < 40 && dt < 0.1) {
        setDpr(1);
        st.degraded = true;
      }
      st.frames = 0;
      st.time = 0;
    }
  });
  return null;
}
