"use client";

import { useFrame, useLoader, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { PALETTE, TIER_BUDGETS, WASHER_MODEL_URL, type QualityTier, type TierBudget } from "./chamber-config";
import { MAX_GARMENTS, lineSlots, staggered, type Slot } from "./garment-layout";
import { fitPhoto, loadPhotoTexture, type PhotoTexture } from "./image-texture";
import type { DecontaminationRun } from "./run";
import type { TimelineSample } from "./timeline";
import {
  DIAL_LEDS,
  clothFragment,
  clothVertex,
  dialFragment,
  dialVertex,
  floorFragment,
  floorVertex,
  glassFragment,
  glassVertex,
  grimeFragment,
  grimeVertex,
  moteFragment,
  moteVertex,
  sparkleFragment,
  sparkleVertex,
  wallFragment,
  wallVertex,
  waterFragment,
  waterVertex,
} from "./washer-shaders";

/**
 * The metadata laundromat: a front-loading washer that takes the photo off the
 * clothesline, washes the metadata out of it and hangs it back up, clean.
 *
 * React renders the structure once; all motion happens in useFrame. A single
 * pose is derived per frame from the run's timeline (which only advances to the
 * rinse after the server has really answered), so the washer can never show a
 * clean result that hasn't happened.
 *
 *   ready        photo hangs on the line, washer looks at it
 *   materialize  photo gets a tug
 *   activate     door swings open, photo is pulled in
 *   scan         door shuts, water fills, drum spins up, water turns murky
 *   awaiting     keeps washing until the server answers
 *   purge        grime is flushed out, water clears        (clean)
 *   dissipate    water simply clears, nothing to flush    (no metadata)
 *   clear        water drains, door opens, photo goes back on the line, sparkles
 *   fault        drum jams, red light, error face; photo stays inside
 */

export type StageMode = "idle" | "drag" | "ready" | "run" | "finished";

export interface ChamberSubject {
  /** Changes when the subject changes (queue item id). */
  key: string;
  file: Blob;
  label: string;
  /** This file's own processing failed: it stays in the drum when the others come out. */
  failed?: boolean;
}

export interface ChamberSceneProps {
  mode: StageMode;
  run: DecontaminationRun | null;
  /** Every photo in view: the ready batch, or the current run's files (the scene shows up to MAX_GARMENTS). */
  garments: readonly ChamberSubject[];
  tier: QualityTier;
  /** Fast device (frame-rate probe passed): reflections, shadows and the richer room shader. */
  rich?: boolean;
  /** Draw the two dimmed neighbouring machines (wide stages only; see below). */
  neighbours?: boolean;
}

/* ============================================================ layout === */

const MODEL_URL = WASHER_MODEL_URL;
/** Accepts meshopt-compressed exports (see assets/source/README.md); a plain GLB loads unchanged. */
const withMeshopt = (loader: GLTFLoader) => void loader.setMeshoptDecoder(MeshoptDecoder);
useLoader.preload(GLTFLoader, MODEL_URL, withMeshopt);

const BODY_W = 2;
const BODY_H = 2.4;
const BODY_Y = BODY_H / 2;
/** Clothesline in front of the washer (world). */
const LINE_Z = 2.6;
const LINE_Y = 1.86;
const LINE_SAG = 0.07;
const HANG_MAX = { width: 1.15, height: 1.2 };
const CAMERA_Z = 6.6;
/** Vertical field of view, shared with the Canvas camera in chamber-canvas.tsx. */
export const CAMERA_FOV = 35;

/**
 * Camera distance for a canvas aspect ratio. Narrow (phone) canvases back off just enough
 * to keep the washer about 3 units wide in frame. Shared by the camera and the clothesline
 * layout so the photos are always laid out for what the camera can actually see.
 */
function cameraDistance(aspect: number): number {
  return aspect < 1.2 ? Math.max(CAMERA_Z - 0.6, 4.9 / Math.max(0.5, aspect)) : CAMERA_Z;
}

/** Width of the line the photos may use: the whole line, or what fits on screen at its depth. */
function usableLineSpan(aspect: number): number {
  const full = LINE_HALF * 2 - 0.3;
  const depth = cameraDistance(aspect) - LINE_Z;
  const visible = 2 * depth * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * aspect;
  // A little margin so pegs and edges don't touch the screen edge.
  return Math.min(full, visible * 0.9);
}

const EMBER = new THREE.Color(PALETTE.accent);
const CLEAN = new THREE.Color(PALETTE.mint);
const FAULT = new THREE.Color(PALETTE.fault);
const WATER_LIGHT = new THREE.Color("#8fdcff");
const MURK_LIGHT = new THREE.Color("#c9c46a");

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const easeOutBack = (t: number) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2;
const lerp = THREE.MathUtils.lerp;
const damp = THREE.MathUtils.damp;

/* ============================================================== pose === */

type Face = "idle" | "excited" | "ready" | "talk" | "working" | "rinse" | "happy" | "error";
type Garment = "hidden" | "hang" | "in" | "drum" | "out";

/** Everything the scene needs for one frame; derived from mode + timeline. */
interface Pose {
  /** Scene seconds; monotonic (r3f resets its own clock when the frameloop changes). */
  time: number;
  face: Face;
  door: number;
  spin: number;
  level: number;
  water: number;
  murk: number;
  emerge: number;
  flush: number;
  fog: number;
  fault: number;
  sparkle: number;
  garment: Garment;
  /** 0..1 progress of an in/out flight. */
  flight: number;
  /** Extra sway while hanging (a tug before loading). */
  tug: number;
  /** 0..1 cycle progress shown on the LED ring around the dial. */
  progress: number;
  /** LED ring runs a chase while waiting on the server. */
  chase: boolean;
  /** Foam on the water surface, 0..1. */
  suds: number;
  /** Celebration hop when the wash finishes, 0..1..0. */
  hop: number;
  /** The wash is handing photos back (failed ones stay in the drum). */
  returning: boolean;
}

const EMPTY = -0.85;
const FULL = -0.3;

function derivePose(mode: StageMode, sample: TimelineSample | null, hasPhoto: boolean, t: number): Pose {
  const pose: Pose = {
    time: t,
    face: "idle",
    door: 0,
    spin: 0.15,
    level: EMPTY,
    water: 0,
    murk: 0,
    emerge: 0,
    flush: 0,
    fog: 0,
    fault: 0,
    sparkle: 0,
    garment: hasPhoto ? "hang" : "hidden",
    flight: 0,
    tug: 0,
    progress: 0,
    chase: false,
    suds: 0,
    hop: 0,
    returning: false,
  };

  if (!sample || (mode !== "run" && mode !== "finished")) {
    if (mode === "drag") {
      pose.face = "excited";
      pose.door = 0.18;
    } else if (hasPhoto) {
      pose.face = "ready";
    }
    return pose;
  }

  const { phase, outcome } = sample;
  const failed = outcome === "error" && (phase === "fault" || phase === "complete");
  const done = phase === "clear" || (phase === "complete" && !failed);

  // Loading: door opens, photo is pulled in, door shuts, water fills.
  pose.face = "talk";
  pose.tug = sample.materialize * (1 - sample.activate);
  pose.progress = 0.12 * sample.activate + 0.28 * sample.scan + 0.35 * sample.purge + 0.25 * sample.clear;
  pose.suds = seg(sample.scan, 0.25, 0.8);
  pose.door = easeInOut(seg(sample.activate, 0, 0.5)) * (1 - easeInOut(seg(sample.scan, 0, 0.35)));
  if (sample.activate >= 1) pose.garment = "drum";
  else if (sample.activate > 0.4) {
    pose.garment = "in";
    pose.flight = easeInOut(seg(sample.activate, 0.4, 1));
  }
  if (sample.scan > 0.15) {
    pose.water = 1;
    pose.level = FULL;
    pose.fog = 0.6;
  }
  if (sample.scan > 0) {
    pose.face = "working";
    pose.spin = lerp(0, 9, seg(sample.scan, 0.3, 1));
    pose.murk = seg(sample.scan, 0.3, 1);
    pose.emerge = seg(sample.scan, 0.3, 1);
  }
  if (phase === "awaiting") {
    pose.chase = true;
    // A real tumble cycle: mostly forward with a short reverse every few seconds.
    pose.spin = Math.sin(t * 0.7) > -0.85 ? 8 : -4;
  }

  if (phase === "purge" || phase === "dissipate") {
    const p = sample.purge;
    pose.face = "rinse";
    pose.suds = 1 - seg(sample.purge, 0.1, 0.7);
    pose.spin = lerp(9, 2, seg(p, 0.6, 1));
    if (outcome === "clean") {
      pose.flush = easeInOut(seg(p, 0.15, 0.9));
      pose.murk = 1 - seg(p, 0.3, 0.95);
    } else {
      pose.emerge = 1 - seg(p, 0, 0.5);
      pose.murk = 1 - seg(p, 0, 0.7);
      pose.flush = 0;
    }
  }

  if (done) {
    const c = phase === "complete" ? 1 : sample.clear;
    pose.face = "happy";
    pose.returning = true;
    pose.spin = 0;
    pose.murk = 0;
    pose.emerge = 0;
    pose.fog = 0.6 * (1 - seg(c, 0, 0.4));
    pose.level = c < 0.35 ? FULL : EMPTY;
    pose.water = c < 0.4 ? 1 : 0;
    pose.door = easeInOut(seg(c, 0.1, 0.5));
    const out = seg(c, 0.35, 1);
    pose.garment = out >= 1 ? "hang" : "out";
    pose.flight = easeOutCubic(out);
    pose.sparkle = outcome === "clean" ? seg(c, 0.6, 1) : seg(c, 0.6, 1) * 0.4;
    pose.suds = 0;
    pose.progress = phase === "complete" ? 1 : pose.progress;
    pose.hop = phase === "complete" ? 0 : Math.sin(Math.PI * seg(c, 0.62, 0.86));
  }

  if (failed) {
    pose.face = "error";
    pose.spin = 0;
    pose.door = 0;
    pose.garment = "drum";
    pose.fault = phase === "complete" ? 1 : seg(sample.fault, 0, 0.4);
    pose.chase = false;
    pose.suds = 0;
    pose.emerge = 0;
    pose.flush = 0;
  }
  return pose;
}

/* ============================================================ shared === */

/**
 * Normalised pointer for parallax; the canvas itself takes no pointer events.
 * Mouse/pen only: on touch screens pointermove fires while scrolling and tapping,
 * which would jerk the camera around, so phones keep a steady view.
 */
const pointer = new THREE.Vector2();
function usePointer() {
  useEffect(() => {
    if (!window.matchMedia?.("(pointer: fine)").matches) return;
    const onMove = (e: PointerEvent) => pointer.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
}

function useDispose<T extends { dispose(): void }>(value: T) {
  useEffect(() => () => value.dispose(), [value]);
  return value;
}

function seeds(count: number, seed: number) {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
  const out = new Float32Array(count * 4);
  for (let i = 0; i < out.length; i++) out[i] = rand();
  return { rand, out };
}

/* ============================================================= scene === */

export function WasherScene({ mode, run, garments, tier, rich = false, neighbours = false }: ChamberSceneProps) {
  const budget = TIER_BUDGETS[tier];
  // Shadow maps redraw every caster each frame: only on wide stages of fast devices.
  const shadows = tier === "full" && rich;
  const hasPhotos = garments.length > 0;
  usePointer();

  // One pose per frame, shared by every part through a ref.
  const pose = useRef<Pose>(derivePose(mode, null, false, 0));
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    elapsed.current += Math.min(dt, 0.1);
    const sample = run ? run.sample() : null;
    pose.current = derivePose(mode, sample, hasPhotos, elapsed.current);
  }, -1);

  return (
    <>
      <color attach="background" args={["#08090c"]} />
      <fog attach="fog" args={["#08090c", 8, 16]} />
      <CameraRig motion={budget.cameraMotion} />
      <Room budget={budget} pose={pose} rich={rich} />
      {rich && <Reflections />}
      <Lights shadows={shadows} pose={pose} />
      <Washer pose={pose} budget={budget} shadows={shadows} />
      {/* Neighbouring machines triple the model's vertex load: wide stages only (on a phone
          they'd sit mostly out of frame anyway), and dropped if the device proves slow. */}
      {neighbours && tier === "full" && <WasherShell x={-2.35} />}
      {neighbours && tier === "full" && <WasherShell x={2.35} />}
      <Clothesline />
      <Laundry garments={garments} pose={pose} budget={budget} />
      <AdaptiveQuality />
    </>
  );
}

/** The hero canvas is full-viewport: drop the pixel ratio once if the device can't hold ~40 fps. */
function AdaptiveQuality() {
  const setDpr = useThree((s) => s.setDpr);
  const stats = useRef({ frames: 0, time: 0, degraded: false });
  useFrame((_, dt) => {
    const st = stats.current;
    if (st.degraded || dt > 0.5) return; // ignore tab switches / demand-mode gaps
    st.frames += 1;
    st.time += dt;
    if (st.time >= 2) {
      if (st.frames / st.time < 40) {
        setDpr(1);
        st.degraded = true;
      }
      st.frames = 0;
      st.time = 0;
    }
  });
  return null;
}

/** Decodes a photo once per queue item (a changed `failed` flag doesn't re-decode it). */
function usePhoto(subject: ChamberSubject | null): PhotoTexture | null {
  const [loaded, setLoaded] = useState<{ key: string; photo: PhotoTexture } | null>(null);
  const key = subject?.key;
  const file = subject?.file;
  const label = subject?.label;
  useEffect(() => {
    if (!key || !file || !label) return;
    let alive = true;
    let owned: PhotoTexture | null = null;
    void loadPhotoTexture(file, label).then((p) => {
      if (!alive) return p.dispose();
      owned = p;
      setLoaded({ key, photo: p });
    });
    return () => {
      alive = false;
      owned?.dispose();
    };
  }, [key, file, label]);
  return loaded && key && loaded.key === key ? loaded.photo : null;
}

/** A soft studio room baked into an environment map: chrome, glass and enamel get real reflections. */
function Reflections() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    const { gl, scene } = get();
    const pmrem = new THREE.PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = pmrem.fromScene(room, 0.04);
    scene.environment = target.texture;
    scene.environmentIntensity = 0; // eased in below, under the preloader's fade, so they never snap on
    room.dispose();
    pmrem.dispose();
    return () => {
      scene.environment = null;
      target.dispose();
    };
  }, [get]);
  useFrame(({ scene, invalidate }, dt) => {
    if (scene.environmentIntensity >= 0.449) return;
    scene.environmentIntensity = Math.min(0.45, scene.environmentIntensity + dt * 0.45);
    invalidate();
  });
  return null;
}

/* ============================================================ camera === */

function CameraRig({ motion }: { motion: boolean }) {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const smooth = useRef(new THREE.Vector2());
  useFrame((_, dt) => {
    const distance = cameraDistance(size.width / Math.max(1, size.height));
    if (motion) smooth.current.lerp(pointer, 1 - Math.exp(-dt * 2));
    camera.position.set(smooth.current.x * 0.4, 1.6 + smooth.current.y * 0.15, distance);
    camera.lookAt(0, 1.25, 0);
  });
  return null;
}

/* ============================================================== room === */

type PoseRef = React.RefObject<Pose>;

function Room({ budget, pose, rich }: { budget: TierBudget; pose: PoseRef; rich: boolean }) {
  const floorUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLight: { value: new THREE.Color("#a493ff") },
      uGlow: { value: WATER_LIGHT.clone() },
      uGlowStrength: { value: 0 },
      uAccent: { value: EMBER.clone() },
      uEnergy: { value: 0 },
    }),
    [],
  );
  const wallUniforms = useMemo(() => ({ uTime: { value: 0 }, uAccent: { value: EMBER.clone() }, uEnergy: { value: 0 } }), []);
  const floor = useRef<THREE.ShaderMaterial>(null);
  const wall = useRef<THREE.ShaderMaterial>(null);
  // The room reacts to the wash: energy follows the drum and water, colour the outcome.
  const room = useRef({ energy: 0, accent: EMBER.clone() });

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const p = pose.current;
    const r = room.current;
    const target = Math.min(1, (Math.abs(p.spin) / 9) * 0.8 + p.water * 0.2 + p.sparkle * 0.6 + p.fault * 0.5);
    r.energy = damp(r.energy, target, 1.5, dt);
    r.accent.lerp(p.fault > 0.05 ? FAULT : p.progress > 0.99 ? CLEAN : EMBER, 1 - Math.exp(-dt * 3));
    const f = floor.current;
    if (f) {
      f.uniforms.uTime.value = p.time;
      f.uniforms.uGlowStrength.value = damp(f.uniforms.uGlowStrength.value, p.water, 2, dt);
      (f.uniforms.uGlow.value as THREE.Color).copy(p.fault > 0 ? FAULT : WATER_LIGHT);
      (f.uniforms.uAccent.value as THREE.Color).copy(r.accent);
      f.uniforms.uEnergy.value = r.energy;
    }
    const w = wall.current;
    if (w) {
      w.uniforms.uTime.value = p.time;
      (w.uniforms.uAccent.value as THREE.Color).copy(r.accent);
      w.uniforms.uEnergy.value = r.energy;
    }
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 2]}>
        <planeGeometry args={[24, 18]} />
        <shaderMaterial ref={floor} uniforms={floorUniforms} vertexShader={floorVertex} fragmentShader={floorFragment} />
      </mesh>
      <mesh position={[0, 4, -1.35]}>
        <planeGeometry args={[24, 8]} />
        {/* Keyed so the shader recompiles when the device tier settles (LITE on slow devices). */}
        <shaderMaterial
          key={rich ? "rich" : "lite"}
          ref={wall}
          uniforms={wallUniforms}
          vertexShader={wallVertex}
          fragmentShader={wallFragment}
          defines={rich ? {} : { LITE: 1 }}
        />
      </mesh>
      {budget.particles > 40 && <Motes count={Math.round(budget.particles * 0.6)} />}
    </group>
  );
}

function Motes({ count }: { count: number }) {
  const geometry = useDispose(
    useMemo(() => {
      const { rand, out } = seeds(count, 0x51ed);
      const positions = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        positions[i * 3] = rand() * 7 - 2.5;
        positions[i * 3 + 1] = rand() * 4;
        positions[i * 3 + 2] = rand() * 4 - 1;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(out, 4));
      return g;
    }, [count]),
  );
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSize: { value: 60 }, uColor: { value: new THREE.Color("#c4b8ff") } }), []);
  const material = useRef<THREE.ShaderMaterial>(null);
  const dpr = useThree((s) => s.viewport.dpr);
  useFrame((_, dt) => {
    const m = material.current;
    if (!m) return;
    m.uniforms.uTime.value += Math.min(dt, 0.1);
    m.uniforms.uSize.value = 60 * dpr;
  });
  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={moteVertex}
        fragmentShader={moteFragment}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function Lights({ shadows, pose }: { shadows: boolean; pose: PoseRef }) {
  const key = useRef<THREE.SpotLight>(null);
  const alarm = useRef<THREE.PointLight>(null);
  useEffect(() => {
    key.current?.target.position.set(0, 1, 0);
    key.current?.target.updateMatrixWorld();
  }, []);
  useFrame((_, dt) => {
    const a = alarm.current;
    if (a) a.intensity = damp(a.intensity, pose.current.fault * (4 + Math.sin(pose.current.time * 6) * 2), 4, dt);
  });
  return (
    <>
      <ambientLight color="#e8ecff" intensity={0.35} />
      <hemisphereLight args={["#ebe6ff", "#0b0c10", 0.55]} />
      <spotLight
        ref={key}
        position={[3.5, 6, 4.5]}
        angle={0.55}
        penumbra={0.8}
        intensity={115}
        color="#ddd4ff"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      {/* Cool rim light: keeps the dark metal's silhouette readable against the room. */}
      <directionalLight position={[-4, 3, -2]} intensity={1.3} color="#5ca8ff" />
      <directionalLight position={[-1, 2.5, 6]} intensity={0.7} color="#f6f4ff" />
      <pointLight ref={alarm} position={[0, 2.6, 1.4]} color={PALETTE.fault} distance={5} intensity={0} />
    </>
  );
}

/* ============================================================ washer === */

const blinkOn = (t: number) => Math.sin(t * 8) > 0;

/** Damped spring (semi-implicit Euler, sub-stepped so large demand-mode gaps stay stable). */
interface Spring {
  x: number;
  v: number;
}
function stepSpring(s: Spring, target: number, stiffness: number, damping: number, dt: number) {
  let left = Math.min(dt, 0.1);
  while (left > 0) {
    const h = Math.min(left, 1 / 120);
    s.v += (stiffness * (target - s.x) - damping * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
}

const LED_COUNT = DIAL_LEDS;
const LED_OFF = new THREE.Color("#211e2b");
const LED_DIM = CLEAN.clone().multiplyScalar(0.25);
/** Depth of the inside-the-drum effects layer (water, foam, grime) in porthole units. */
const EFFECTS_DEPTH = 0.66;

/**
 * The user's washing-machine model, measured and rigged once after loading:
 * scaled to BODY_H and stood on the floor, with the door re-parented onto a
 * hinge pivot (left edge) and the drum onto a spin pivot (porthole axis).
 * Everything is expressed in the washer body's local space (origin at the
 * cabinet's centre).
 */
interface WasherRig {
  model: THREE.Object3D;
  doorPivot: THREE.Group;
  drumPivot: THREE.Group;
  /** Porthole centre; z is the front of the door glass. */
  port: THREE.Vector3;
  glassRadius: number;
  doorRadius: number;
  /** Front face of the cabinet. */
  front: number;
  /** Door glass centre relative to the hinge (for decorations that swing with the door). */
  glassInDoor: THREE.Vector3;
  /** Front of the drum: inside-the-drum effects stay behind it. */
  drumFront: number;
  panel: THREE.Box3;
  /** The program knob on the panel (centre at its front face, radius, panel depth at its foot), for the dial. */
  knob: { centre: THREE.Vector3; radius: number; base: number } | null;
}

const PART = { door: "xyj_gaizi", glass: "xyj_boli", drum: "xyj_neidan", shell: "xyj_waike", panel: "xyj_jiemian" } as const;

function partOf(root: THREE.Object3D, name: string): THREE.Object3D {
  const part = root.getObjectByName(name);
  if (!part) throw new Error(`washer model is missing "${name}"`);
  return part;
}

/** One-time material fixes, shared by every clone. */
function prepareMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of materials as THREE.MeshStandardMaterial[]) {
      if (m.userData.cfPrepared) continue;
      m.userData.cfPrepared = true;
      // The model ships DirectX-convention normal maps; glTF/three expect OpenGL (green up).
      if (m.normalMap) m.normalScale.y *= -1;
      if (m.name === "glass") {
        // The authored glass is nearly opaque; thin it so the wash inside stays visible.
        m.transparent = true;
        m.opacity = 0.3;
        m.depthWrite = false;
      }
    }
  });
}

/**
 * The knob is part of the cabinet mesh, not its own node: find it as the cluster of
 * cabinet vertices standing proud of everything else in the control-panel band.
 * Returns null when nothing protrudes (the LED ring then falls back to the panel).
 */
function findKnob(shell: THREE.Object3D, panel: THREE.Box3): WasherRig["knob"] {
  const mesh = shell as THREE.Mesh;
  const position = mesh.geometry?.attributes?.position;
  if (!position) return null;
  const height = panel.max.y - panel.min.y;
  const bandMin = panel.min.y - height;
  const bandMax = panel.max.y + height;
  const v = new THREE.Vector3();
  const band: THREE.Vector3[] = [];
  let front = -Infinity;
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
    if (v.y < bandMin || v.y > bandMax || v.x < panel.min.x || v.x > panel.max.x + height) continue;
    band.push(v.clone());
    if (v.z > front) front = v.z;
  }
  // Anything within ~1 % of the cabinet height of the front-most point belongs to the knob.
  const proud = band.filter((p) => p.z > front - BODY_H * 0.014);
  if (proud.length < 8) return null;
  const box = new THREE.Box3().setFromPoints(proud);
  const centre = box.getCenter(new THREE.Vector3());
  centre.z = front;
  const radius = Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2;
  // The panel face the knob stands on: the front-most cabinet point just around its foot
  // (or, failing that, anywhere in the band that isn't the knob itself).
  let near = -Infinity;
  let rest = -Infinity;
  for (const p of band) {
    if (p.z > front - BODY_H * 0.014) continue;
    rest = Math.max(rest, p.z);
    const d = Math.hypot(p.x - centre.x, p.y - centre.y);
    if (d > radius * 1.2 && d < radius * 2.6) near = Math.max(near, p.z);
  }
  const base = Number.isFinite(near) ? near : Number.isFinite(rest) ? rest : front - radius * 0.4;
  return { centre, radius, base };
}

function buildRig(source: THREE.Object3D): WasherRig {
  const model = source.clone(true);
  prepareMaterials(model);
  const holder = new THREE.Group();
  holder.add(model);
  holder.updateMatrixWorld(true);

  // Scale to the cabinet height and stand it on the floor, centred.
  const shellBox = new THREE.Box3().setFromObject(partOf(model, PART.shell));
  const size = shellBox.getSize(new THREE.Vector3());
  const k = BODY_H / size.y;
  const centre = shellBox.getCenter(new THREE.Vector3());
  model.scale.multiplyScalar(k);
  model.position.set(-centre.x * k, -shellBox.min.y * k - BODY_H / 2, -centre.z * k);
  holder.updateMatrixWorld(true);

  const shell = new THREE.Box3().setFromObject(partOf(model, PART.shell));
  const door = partOf(model, PART.door);
  const doorBox = new THREE.Box3().setFromObject(door);
  const doorCentre = doorBox.getCenter(new THREE.Vector3());
  const glassPart = partOf(model, PART.glass);
  // Draw the glass after everything inside the drum (render orders 2-5), like a real window.
  glassPart.renderOrder = 7;
  const glassBox = new THREE.Box3().setFromObject(glassPart);
  const glassCentre = glassBox.getCenter(new THREE.Vector3());
  const drumBox = new THREE.Box3().setFromObject(partOf(model, PART.drum));
  const panel = new THREE.Box3().setFromObject(partOf(model, PART.panel));

  // Door on a vertical hinge at its left edge, mid-thickness.
  const hinge = new THREE.Vector3(doorBox.min.x + 0.02, doorCentre.y, doorCentre.z);
  const doorPivot = new THREE.Group();
  doorPivot.name = "door-hinge";
  doorPivot.position.copy(hinge);
  holder.add(doorPivot);
  holder.updateMatrixWorld(true);
  doorPivot.attach(door);

  // Drum spins about the porthole axis.
  const drumPivot = new THREE.Group();
  drumPivot.name = "drum-axis";
  drumPivot.position.set(glassCentre.x, glassCentre.y, drumBox.getCenter(new THREE.Vector3()).z);
  holder.add(drumPivot);
  holder.updateMatrixWorld(true);
  drumPivot.attach(partOf(model, PART.drum));

  // Pivots become siblings of the model so React can own them directly.
  holder.remove(doorPivot, drumPivot);

  return {
    model,
    doorPivot,
    drumPivot,
    port: new THREE.Vector3(glassCentre.x, glassCentre.y, glassBox.max.z),
    glassRadius: Math.max(glassBox.max.x - glassBox.min.x, glassBox.max.y - glassBox.min.y) / 2,
    doorRadius: Math.max(doorBox.max.x - doorBox.min.x, doorBox.max.y - doorBox.min.y) / 2,
    front: shell.max.z,
    glassInDoor: new THREE.Vector3(glassCentre.x - hinge.x, glassCentre.y - hinge.y, glassBox.max.z - hinge.z),
    drumFront: Math.min(drumBox.max.z, glassBox.min.z) - 0.01,
    panel,
    knob: findKnob(partOf(model, PART.shell), panel),
  };
}

/** Where the photo tumbles inside the drum (world space); set once the model is measured. */
const drumAnchor = new THREE.Vector3(0, BODY_Y, 0.25);

function useWasherModel() {
  const gltf = useLoader(GLTFLoader, MODEL_URL, withMeshopt);
  return gltf.scene;
}

function Washer({ pose, budget, shadows }: { pose: PoseRef; budget: TierBudget; shadows: boolean }) {
  const source = useWasherModel();
  const rig = useMemo(() => buildRig(source), [source]);
  // Inside-the-drum effects are authored for a 0.6-radius porthole; fit them to this glass.
  const fx = useMemo(() => {
    const scale = rig.glassRadius / 0.6;
    return { scale, z: rig.drumFront - EFFECTS_DEPTH * scale };
  }, [rig]);
  useEffect(() => {
    // Just behind the water surface: this model's inner drum wall sits close behind the opening.
    drumAnchor.set(rig.port.x, BODY_Y + rig.port.y, fx.z + 0.5 * fx.scale);
  }, [rig, fx]);

  const body = useRef<THREE.Group>(null);
  const model = useRef<THREE.Object3D>(null);
  const door = useRef<THREE.Group>(null);
  const drum = useRef<THREE.Group>(null);
  const interior = useRef<THREE.PointLight>(null);
  const bubbles = useRef<THREE.InstancedMesh>(null);
  const suds = useRef<THREE.InstancedMesh>(null);
  const water = useRef<THREE.ShaderMaterial>(null);
  const glass = useRef<THREE.ShaderMaterial>(null);
  const grime = useRef<THREE.ShaderMaterial>(null);
  // Glowing ember accents (porthole halo, edge strips) share one colour per frame.
  const accents = useRef(new Set<THREE.MeshBasicMaterial>());
  const addAccent = useCallback((material: THREE.MeshBasicMaterial | null) => {
    if (!material) return;
    const set = accents.current;
    set.add(material);
    return () => {
      set.delete(material);
    };
  }, []);
  const accentColor = useRef(new THREE.Color());
  // Dial LED colours: one array shared with the dial shader's uniform, rewritten each frame.
  const leds = useMemo(() => Array.from({ length: LED_COUNT }, () => LED_OFF.clone()), []);
  const knobPointer = useRef<THREE.Group>(null);
  const pointerMaterials = useRef(new Set<THREE.MeshBasicMaterial>());
  const addPointerMaterial = useCallback((material: THREE.MeshBasicMaterial | null) => {
    if (!material) return;
    const set = pointerMaterials.current;
    set.add(material);
    return () => {
      set.delete(material);
    };
  }, []);
  const ledColor = useRef(new THREE.Color());

  // Shadows follow the quality tier.
  useEffect(() => {
    for (const root of [model.current, door.current, drum.current]) {
      root?.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = shadows;
          o.receiveShadow = shadows;
        }
      });
    }
  }, [shadows, rig]);

  const waterUniforms = useMemo(
    () => ({
      uLevel: { value: EMPTY },
      uTilt: { value: 0 },
      uTime: { value: 0 },
      uAlpha: { value: 0 },
      uMurk: { value: 0 },
      uFault: { value: FAULT.clone() },
      uFaultMix: { value: 0 },
    }),
    [],
  );
  const glassUniforms = useMemo(
    () => ({ uTime: { value: 0 }, uTint: { value: new THREE.Color("#bfe3f5") }, uFog: { value: 0 }, uRadius: { value: 0.6 } }),
    [],
  );
  const grimeUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uEmerge: { value: 0 },
      uFlush: { value: 0 },
      uSpin: { value: 0 },
      uSize: { value: 38 },
      uColorA: { value: new THREE.Color("#4a3a16") },
      uColorB: { value: new THREE.Color("#8a8f2a") },
    }),
    [],
  );
  const grimeGeometry = useDispose(
    useMemo(() => {
      const count = budget.particles;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(seeds(count, 0x9e37).out, 4));
      return g;
    }, [budget.particles]),
  );
  const bubbleCount = budget.particles > 120 ? 56 : budget.particles > 40 ? 32 : 16;
  const bubbleSeeds = useMemo(
    () =>
      Array.from({ length: bubbleCount }, (_, i) => ({
        x: (((i * 37) % bubbleCount) / bubbleCount) * 1.1 - 0.55,
        z: 0.35 + ((i * 13) % 7) * 0.05,
        speed: 0.6 + ((i * 7) % 5) * 0.25,
        phase: i * 1.7,
        size: 0.022 + ((i * 11) % 6) * 0.007,
      })),
    [bubbleCount],
  );
  // Foam: soft clumps riding the water line, swirled by the drum.
  const sudsCount = budget.particles > 120 ? 30 : budget.particles > 40 ? 20 : 10;
  const sudsSeeds = useMemo(
    () =>
      Array.from({ length: sudsCount }, (_, i) => ({
        u: i / sudsCount,
        z: 0.42 + ((i * 5) % 4) * 0.05,
        size: 0.05 + ((i * 7) % 5) * 0.014,
        phase: i * 2.3,
      })),
    [sudsCount],
  );
  const dpr = useThree((s) => s.viewport.dpr);

  const motion = useRef({
    spin: 0,
    prevSpin: 0,
    lean: 0,
    angle: 0,
    level: EMPTY,
    water: 0,
    murk: 0,
    emerge: 0,
    flush: 0,
    fog: 0,
    fault: 0,
    suds: 0,
    shudder: 0,
    jolt: 0,
    progress: 0,
    knob: 0,
    door: { x: 0, v: 0 } as Spring,
    hop: { x: 0, v: 0 } as Spring,
    sway: { x: 0, v: 0 } as Spring,
  });
  const tmp = useRef(new THREE.Object3D());
  const lightColor = useRef(new THREE.Color());

  useFrame(({ invalidate }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const p = pose.current;
    const now = p.time;
    const m = motion.current;

    // A jam stops the drum hard; otherwise it spins up and down smoothly.
    m.prevSpin = m.spin;
    m.spin = damp(m.spin, p.spin, p.fault > 0 ? 9 : 1.6, dt);
    m.angle += m.spin * dt;
    m.level = damp(m.level, p.level, 1.5, dt);
    m.water = damp(m.water, p.water, 3, dt);
    m.murk = damp(m.murk, p.murk, 2.5, dt);
    m.emerge = damp(m.emerge, p.emerge, 3, dt);
    m.flush = p.flush;
    m.fog = damp(m.fog, p.fog, 1.2, dt);
    m.fault = damp(m.fault, p.fault, 5, dt);
    m.suds = damp(m.suds, p.suds * m.water, 1.4, dt);
    m.progress = damp(m.progress, p.progress, 4, dt);
    m.shudder = p.fault > 0 && p.fault < 1 ? 1 - p.fault : damp(m.shudder, 0, 4, dt);
    m.jolt = damp(m.jolt, 0, 6, dt);

    // Door: a sprung hinge that swings past its mark and bounces off the seal when it shuts.
    const d = m.door;
    stepSpring(d, p.door, 70, 9, dt);
    if (d.x < 0) {
      if (d.v < -0.6) m.jolt = Math.min(1, m.jolt + Math.abs(d.v) * 0.25);
      d.x = 0;
      d.v = -d.v * 0.35;
    }
    if (door.current) door.current.rotation.y = -1.85 * d.x;
    if (drum.current) drum.current.rotation.z = -m.angle;

    // Suspension: the drum's off-centre load drags the cabinet round with it; spin-up leans it back.
    const speed = Math.min(1, Math.abs(m.spin) / 9);
    const load = speed * speed * m.water;
    const accel = dt > 0 ? (m.spin - m.prevSpin) / dt : 0;
    m.lean = damp(m.lean, THREE.MathUtils.clamp(accel * 0.004, -0.02, 0.02), 3, dt);
    stepSpring(m.hop, p.hop, 120, 9, dt);
    stepSpring(m.sway, Math.sin(m.angle) * load * 0.02, 160, 14, dt);
    const buzz = speed * 0.4 + m.shudder * 1.5 + m.jolt;
    if (body.current) {
      const hop = Math.max(0, m.hop.x);
      body.current.position.x = m.sway.x + Math.sin(now * 43) * 0.006 * buzz;
      body.current.position.y = BODY_Y + Math.cos(m.angle) * load * 0.012 + Math.abs(Math.sin(now * 31)) * 0.005 * buzz + hop * 0.16;
      body.current.rotation.z = m.lean + m.sway.x * 0.25 + Math.sin(now * 37) * 0.004 * buzz + m.jolt * 0.006 * Math.sin(now * 60);
      body.current.rotation.x = -m.jolt * 0.01;
      // Squash on take-off and landing, stretch in the air.
      const stretch = m.hop.v * 0.012;
      body.current.scale.set(1 - stretch * 0.5, 1 + stretch, 1 - stretch * 0.5);
    }
    // On demand-rendered (idle/slow) frames, keep drawing until the springs have settled,
    // so a slow device never freezes the door half-open.
    const moving = (s: Spring, target: number) => Math.abs(s.v) > 1e-3 || Math.abs(s.x - target) > 1e-3;
    if (moving(d, p.door) || moving(m.hop, p.hop) || m.jolt > 0.01) invalidate();

    const light = lightColor.current.copy(WATER_LIGHT).lerp(MURK_LIGHT, m.murk * 0.7).lerp(FAULT, m.fault);
    if (interior.current) {
      interior.current.color.copy(light);
      interior.current.intensity = 0.3 + m.water * 2.2 + m.fault * 2;
    }

    // Accents breathe when idle, burn brighter with drum speed, flash on a door slam,
    // turn cyan once the wash is done and red on a jam.
    const tone = m.fault > 0.05 ? FAULT : m.progress > 0.99 ? CLEAN : EMBER;
    const level = Math.min(1, 0.32 + 0.12 * Math.sin(now * 1.4) + 0.6 * speed + 0.4 * m.jolt + (m.fault > 0.05 && blinkOn(now) ? 0.5 : 0));
    accentColor.current.copy(tone).multiplyScalar(level);
    accents.current.forEach((mat) => mat.color.copy(accentColor.current));

    // Dial LEDs: fill with progress, chase while waiting, blink red on a jam, breathe when idle.
    const c = ledColor.current;
    const head = (now * 0.9) % 1;
    for (let i = 0; i < LED_COUNT; i++) {
      const f = i / LED_COUNT;
      if (m.fault > 0.05) {
        c.copy(blinkOn(now) ? FAULT : LED_OFF);
      } else if (p.chase) {
        const tail = (head - f + 1) % 1;
        c.copy(LED_OFF).lerp(EMBER, Math.max(f < m.progress ? 0.45 : 0, 1 - tail * 5));
      } else if (m.progress > 0.002) {
        c.copy(LED_OFF).lerp(m.progress > 0.99 ? CLEAN : EMBER, clamp01((m.progress - f) * LED_COUNT));
      } else {
        c.copy(LED_OFF).lerp(LED_DIM, (0.5 + 0.5 * Math.sin(now * 1.6 - f * Math.PI * 2)) * 0.6);
      }
      leds[i]!.copy(c);
    }
    // The knob's pointer turns to the cycle's leading LED (the chase head while waiting), home at twelve.
    const knobTarget = m.fault > 0.05 ? m.knob : p.chase ? head : m.progress > 0.99 ? 0 : m.progress;
    m.knob = damp(m.knob, knobTarget, p.chase ? 10 : 3, dt);
    if (knobPointer.current) knobPointer.current.rotation.z = -m.knob * Math.PI * 2;
    pointerMaterials.current.forEach((mat) => mat.color.copy(tone).multiplyScalar(0.6 + 0.4 * level));

    const w = water.current;
    if (w) {
      w.uniforms.uLevel.value = m.level;
      w.uniforms.uTilt.value = THREE.MathUtils.clamp(m.spin * 0.035 + m.sway.x * 4, -0.35, 0.35);
      w.uniforms.uTime.value = now;
      w.uniforms.uAlpha.value = m.water;
      w.uniforms.uMurk.value = m.murk;
      w.uniforms.uFaultMix.value = m.fault * 0.5;
    }
    const g = glass.current;
    if (g) {
      g.uniforms.uTime.value = now;
      g.uniforms.uFog.value = m.fog;
      (g.uniforms.uTint.value as THREE.Color).set("#bfe3f5").lerp(FAULT, m.fault * 0.6);
    }
    const gr = grime.current;
    if (gr) {
      gr.uniforms.uTime.value = now;
      gr.uniforms.uEmerge.value = m.emerge * m.water;
      gr.uniforms.uFlush.value = m.flush;
      gr.uniforms.uSpin.value = -m.angle;
      gr.uniforms.uSize.value = 38 * dpr * fx.scale;
    }

    const o = tmp.current;
    const mesh = bubbles.current;
    if (mesh) {
      bubbleSeeds.forEach((b, i) => {
        const rise = (now * b.speed * 0.25 + b.phase) % 1;
        const x = b.x + Math.sin(now * 2 + b.phase) * 0.04 - m.spin * 0.01;
        const y = m.level - 0.05 + rise * 0.12 + Math.sin(now * 3 + b.phase) * 0.02;
        const inside = x * x + y * y < 0.6 * 0.6;
        o.position.set(x, y, b.z);
        o.rotation.set(0, 0, 0);
        o.scale.setScalar(inside ? b.size * m.water * (0.45 + 0.5 * speed) * (1 - m.fault) : 0);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    const foam = suds.current;
    if (foam) {
      // Foam rides the (tilted) water line and gets thrown up the drum wall as it speeds up.
      const tilt = THREE.MathUtils.clamp(m.spin * 0.035, -0.35, 0.35);
      sudsSeeds.forEach((b, i) => {
        const swirl = (b.u + m.angle * 0.02 + Math.sin(now * 0.7 + b.phase) * 0.03) % 1;
        const x = (swirl < 0 ? swirl + 1 : swirl) * 1.16 - 0.58;
        const climb = speed * 0.18 * (0.5 + 0.5 * Math.sin(m.angle + b.phase));
        const y = m.level + x * tilt + 0.02 + climb + Math.sin(now * 2.4 + b.phase) * 0.015;
        const r = Math.hypot(x, y);
        const fit = r < 0.56 ? 1 : 0;
        const s = b.size * m.suds * fit * (0.8 + 0.3 * Math.sin(now * 3 + b.phase));
        o.position.set(x, y, b.z);
        o.rotation.set(0, 0, b.phase);
        o.scale.set(s * 1.4, s, s);
        o.updateMatrix();
        foam.setMatrixAt(i, o.matrix);
      });
      foam.instanceMatrix.needsUpdate = true;
    }
  });

  const halfWidth = BODY_W / 2;
  const glassScale = rig.glassRadius / 0.6;
  return (
    <group ref={body} position={[0, BODY_Y, 0]}>
      <primitive ref={model} object={rig.model} />
      <primitive ref={drum} object={rig.drumPivot} />

      {/* Door: the model's door and glass on a sprung hinge, plus a steam/fault overlay on the glass. */}
      <primitive ref={door} object={rig.doorPivot}>
        <mesh position={[rig.glassInDoor.x, rig.glassInDoor.y, rig.glassInDoor.z + 0.004]} scale={glassScale} renderOrder={8}>
          <circleGeometry args={[0.6, 64]} />
          <shaderMaterial ref={glass} uniforms={glassUniforms} vertexShader={glassVertex} fragmentShader={glassFragment} transparent depthWrite={false} />
        </mesh>
      </primitive>

      {/* Ember halo around the porthole and light strips down the front edges. */}
      <mesh position={[rig.port.x, rig.port.y, rig.front + 0.004]}>
        <ringGeometry args={[rig.doorRadius + 0.05, rig.doorRadius + 0.068, 96]} />
        <meshBasicMaterial ref={addAccent} color={PALETTE.accent} toneMapped={false} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (halfWidth - 0.06), rig.port.y - 0.15, rig.front + 0.004]}>
          <planeGeometry args={[0.014, 1.3]} />
          <meshBasicMaterial ref={addAccent} color={PALETTE.accent} toneMapped={false} />
        </mesh>
      ))}

      <PanelLights panel={rig.panel} knob={rig.knob} front={rig.front} pose={pose} leds={leds} pointerRef={knobPointer} addPointerMaterial={addPointerMaterial} />

      {/* Inside the drum: light, grime, water, bubbles and foam, fitted to the glass. */}
      <group position={[rig.port.x, rig.port.y, fx.z]} scale={fx.scale}>
        <pointLight ref={interior} position={[0, 0.1, 0.1]} color={WATER_LIGHT} distance={2.2} intensity={0.3} />
        <points geometry={grimeGeometry} frustumCulled={false} renderOrder={2}>
          <shaderMaterial ref={grime} uniforms={grimeUniforms} vertexShader={grimeVertex} fragmentShader={grimeFragment} transparent depthWrite={false} />
        </points>
        <mesh position={[0, 0, 0.62]} renderOrder={3}>
          <circleGeometry args={[0.62, 48]} />
          <shaderMaterial ref={water} uniforms={waterUniforms} vertexShader={waterVertex} fragmentShader={waterFragment} transparent depthWrite={false} />
        </mesh>
        <instancedMesh ref={bubbles} args={[undefined, undefined, bubbleSeeds.length]} renderOrder={4} frustumCulled={false}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.1} transparent opacity={0.85} />
        </instancedMesh>
        <instancedMesh ref={suds} args={[undefined, undefined, sudsSeeds.length]} renderOrder={5} frustumCulled={false}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#f7fbff" roughness={0.9} transparent opacity={0.92} />
        </instancedMesh>
      </group>
    </group>
  );
}

/** Face screen and program dial, mounted on the model's control panel. */
function PanelLights({
  panel,
  knob,
  front,
  pose,
  leds,
  pointerRef,
  addPointerMaterial,
}: {
  panel: THREE.Box3;
  knob: WasherRig["knob"];
  front: number;
  pose: PoseRef;
  leds: THREE.Color[];
  pointerRef: React.RefObject<THREE.Group | null>;
  addPointerMaterial: (material: THREE.MeshBasicMaterial | null) => (() => void) | undefined;
}) {
  const width = panel.max.x - panel.min.x;
  const height = panel.max.y - panel.min.y;
  const panelY = panel.min.y + height * 0.62;
  const panelZ = Math.max(panel.max.z, front) + 0.006;
  const faceWidth = Math.min(0.5, width * 0.22);
  // Without a detected knob, the dial sits flat in the middle of the panel.
  const dial = knob ?? {
    centre: new THREE.Vector3((panel.min.x + panel.max.x) / 2, panelY, panelZ),
    radius: Math.min(width, height) * 0.22,
    base: panelZ,
  };
  return (
    <>
      <ProgramDial knob={dial} leds={leds} pointerRef={pointerRef} addPointerMaterial={addPointerMaterial} />
      <mesh position={[panel.min.x + faceWidth * 0.7, panelY, panelZ]}>
        <planeGeometry args={[faceWidth, faceWidth / 3]} />
        <FaceScreen pose={pose} />
      </mesh>
    </>
  );
}

/**
 * The program dial: a raised graphite bezel around the knob carrying the LED ring and a
 * tick scale, plus a glowing pointer on the knob itself. The bezel's face stands proud of
 * the panel, close to the knob's own face, so the camera's downward view can't slide the
 * ring off-centre or tuck its lower LEDs behind the knob.
 */
function ProgramDial({
  knob,
  leds,
  pointerRef,
  addPointerMaterial,
}: {
  knob: NonNullable<WasherRig["knob"]>;
  leds: THREE.Color[];
  pointerRef: React.RefObject<THREE.Group | null>;
  addPointerMaterial: (material: THREE.MeshBasicMaterial | null) => (() => void) | undefined;
}) {
  const { centre, radius, base } = knob;
  const inner = radius * 1.1;
  const outer = radius * 1.88;
  const depth = Math.max(0.004, centre.z - base);
  const faceZ = base + depth * 0.55;
  const uniforms = useMemo(
    () => ({ uLed: { value: leds }, uInner: { value: inner }, uOuter: { value: outer } }),
    [leds, inner, outer],
  );
  return (
    <group position={[centre.x, centre.y, 0]}>
      {/* Bezel wall from the panel up to the face. */}
      <mesh position={[0, 0, base + (faceZ - base) / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[outer, outer * 1.03, faceZ - base, 64, 1, true]} />
        <meshStandardMaterial color="#16181c" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0, faceZ]}>
        <ringGeometry args={[inner, outer, 96, 4]} />
        <shaderMaterial uniforms={uniforms} vertexShader={dialVertex} fragmentShader={dialFragment} />
      </mesh>
      {/* Pointer: a lit notch near the knob's rim, with a soft halo. */}
      <group ref={pointerRef} position={[0, 0, centre.z + 0.003]}>
        <mesh position={[0, radius * 0.68, 0.0005]}>
          <circleGeometry args={[radius * 0.075, 20]} />
          <meshBasicMaterial ref={addPointerMaterial} toneMapped={false} />
        </mesh>
        <mesh position={[0, radius * 0.68, 0]}>
          <circleGeometry args={[radius * 0.2, 24]} />
          <meshBasicMaterial ref={addPointerMaterial} toneMapped={false} transparent opacity={0.28} depthWrite={false} blending={THREE.AdditiveBlending} />
        </mesh>
      </group>
    </group>
  );
}

/** Dimmed neighbouring machine: a static copy of the model. */
function WasherShell({ x }: { x: number }) {
  const source = useWasherModel();
  const shell = useMemo(() => {
    const copy = source.clone(true);
    prepareMaterials(copy);
    const box = new THREE.Box3().setFromObject(copy);
    const k = BODY_H / (box.max.y - box.min.y);
    const centre = box.getCenter(new THREE.Vector3());
    copy.scale.multiplyScalar(k);
    copy.position.set(-centre.x * k, -box.min.y * k, -centre.z * k);
    // Own, darker materials so the neighbours sit back in the room.
    copy.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const dim = (m: THREE.Material) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        c.color.multiplyScalar(0.45);
        return c;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(dim) : dim(mesh.material);
    });
    return copy;
  }, [source]);
  useEffect(
    () => () =>
      shell.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
      }),
    [shell],
  );
  return (
    <group position={[x, 0, -0.15]}>
      <primitive object={shell} />
    </group>
  );
}

/* ======================================================= clothesline === */

const LINE_HALF = 1.75;
const lineY = (x: number) => LINE_Y - LINE_SAG * (1 - (x / LINE_HALF) ** 2);

function Clothesline() {
  const geometry = useDispose(
    useMemo(() => {
      const points = Array.from({ length: 24 }, (_, i) => {
        const x = -LINE_HALF + (i / 23) * LINE_HALF * 2;
        return new THREE.Vector3(x, lineY(x), LINE_Z);
      });
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 64, 0.008, 6, false);
    }, []),
  );
  return (
    <group>
      <mesh geometry={geometry}>
        <meshStandardMaterial color="#7d828c" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* Hooks the line is tied to. */}
      {[-LINE_HALF, LINE_HALF].map((x) => (
        <mesh key={x} position={[x, LINE_Y + 0.02, LINE_Z]}>
          <sphereGeometry args={[0.035, 12, 8]} />
          <meshStandardMaterial color="#9aa3a8" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
}

/* =========================================================== laundry === */

/** Plane resolution for the cloth: enough vertices for smooth folds (all displacement is on the GPU). */
const SEGMENTS = 40;
/** The photos on the line, in the drum and back out. Pixels are never altered. */
function Laundry({ garments, pose, budget }: { garments: readonly ChamberSubject[]; pose: PoseRef; budget: TierBudget }) {
  const shown = garments.slice(0, MAX_GARMENTS);
  // On phones the camera sees less of the line than its full length: lay photos out within view.
  const size = useThree((s) => s.size);
  const lineSpan = usableLineSpan(size.width / Math.max(1, size.height));
  const slots = useMemo(() => lineSlots(shown.length, lineSpan, HANG_MAX.width), [shown.length, lineSpan]);
  const sparkles = useRef<THREE.ShaderMaterial>(null);
  const sparkleGroup = useRef<THREE.Points>(null);
  const sparkleCount = budget.particles > 40 ? 28 : 12;
  const sparkleGeometry = useDispose(
    useMemo(() => {
      const { rand, out } = seeds(sparkleCount, 0xc1ea);
      const positions = new Float32Array(sparkleCount * 3);
      for (let i = 0; i < sparkleCount; i++) {
        // Around the photo's outline, slightly in front of it.
        const a = rand() * Math.PI * 2;
        positions[i * 3] = Math.cos(a) * (0.55 + rand() * 0.25);
        positions[i * 3 + 1] = Math.sin(a) * (0.6 + rand() * 0.25);
        positions[i * 3 + 2] = 0.05 + rand() * 0.15;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setAttribute("aSeed", new THREE.BufferAttribute(out, 4));
      return g;
    }, [sparkleCount]),
  );
  const sparkleUniforms = useMemo(() => ({ uTime: { value: 0 }, uShow: { value: 0 }, uSize: { value: 220 }, uColor: { value: CLEAN.clone() } }), []);
  const dpr = useThree((s) => s.viewport.dpr);
  // Sparkles stretch to cover the whole row of photos.
  const span = slots.length ? slots[slots.length - 1].x - slots[0].x + slots[0].width : HANG_MAX.width;

  useFrame(() => {
    const p = pose.current;
    const sp = sparkles.current;
    if (sp) {
      sp.uniforms.uTime.value = p.time;
      sp.uniforms.uShow.value = shown.length > 0 && p.garment !== "hidden" ? p.sparkle : 0;
      sp.uniforms.uSize.value = 220 * dpr;
    }
    sparkleGroup.current?.scale.set(Math.max(1, span / HANG_MAX.width), 1, 1);
  });

  return (
    <>
      {shown.map((g, i) => (
        <Garment key={g.key} subject={g} index={i} count={shown.length} slot={slots[i]} pose={pose} />
      ))}
      <points ref={sparkleGroup} geometry={sparkleGeometry} position={[0, lineY(0) - 0.6, LINE_Z]} frustumCulled={false} renderOrder={8}>
        <shaderMaterial
          ref={sparkles}
          uniforms={sparkleUniforms}
          vertexShader={sparkleVertex}
          fragmentShader={sparkleFragment}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </>
  );
}

/** One photo: hangs in its slot on the line, gets washed with the others, and is hung back up. */
function Garment({ subject, index, count, slot, pose }: { subject: ChamberSubject; index: number; count: number; slot: Slot; pose: PoseRef }) {
  const photo = usePhoto(subject);
  // A texture that finishes decoding changes nothing three.js can see, so ask for a frame:
  // on demand-rendered (idle/slow) stages the drop onto the line would otherwise never start.
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (photo) invalidate();
  }, [photo, invalidate]);
  const mesh = useRef<THREE.Mesh>(null);
  const pins = useRef<THREE.Group>(null);
  const geometry = useDispose(useMemo(() => new THREE.PlaneGeometry(1, 1, SEGMENTS, SEGMENTS), []));
  const clothUniforms = useMemo(
    () => ({
      uMap: { value: null as THREE.Texture | null },
      uMapTransform: { value: new THREE.Matrix3() },
      uTime: { value: 0 },
      uSway: { value: 0.03 },
      uCrumple: { value: 0 },
      uPin: { value: 1 },
      uScale: { value: new THREE.Vector2(1, 1) },
      uWet: { value: 0 },
    }),
    [],
  );
  const cloth = useRef({ pin: 1, wet: 0 });
  const clothMaterial = useRef<THREE.ShaderMaterial>(null);
  const track = useRef({ shown: false, since: 0 });
  const hang = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());
  // Each photo has its own place on the drum's circle, so a batch tumbles without stacking.
  const phase = (index / Math.max(1, count)) * Math.PI * 2;

  useFrame(({ invalidate }, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const m = mesh.current;
    if (!m) return;
    const p = pose.current;
    const now = p.time;
    const visible = !!photo && p.garment !== "hidden";
    m.visible = visible;
    if (!visible || !photo) {
      track.current.shown = false;
      return;
    }
    // A fresh photo drops onto the line from above, a beat after its neighbour.
    if (!track.current.shown) track.current = { shown: true, since: now + index * 0.08 };
    const sinceDrop = now - track.current.since;
    const drop = p.garment === "hang" ? easeOutBack(seg(sinceDrop, 0, 0.7)) : 1;
    // The drop must finish even when idle frames are rationed (slow devices).
    if (sinceDrop < 0.7) invalidate();

    const { width, height } = fitPhoto(photo.aspect, slot.width, HANG_MAX.height);
    hang.current.set(slot.x, lineY(slot.x) - height / 2 + 0.02 + (1 - drop) * 2.6, LINE_Z);
    const pos = target.current;

    // A photo whose own cleaning failed stays in the drum when the others come out.
    const garment = subject.failed && p.returning ? "drum" : p.garment;
    const flight = staggered(p.flight, index, count);
    // In the drum every photo shrinks to a similar size, so a batch fits behind the glass.
    const drumWidth = count === 1 ? 0.55 : 0.42;
    const drumScale = Math.min(1, drumWidth / width);
    const inside = drumAnchor;

    let scale = 1;
    let sway = 0.03 + p.tug * 0.08;
    let crumple = 0;
    let spinZ = 0;
    let tiltX = 0;
    let pinned = true;

    switch (garment) {
      case "in": {
        pos.copy(hang.current).lerp(inside, flight);
        scale = lerp(1, drumScale, flight);
        spinZ = flight * Math.PI * 1.5;
        tiltX = Math.sin(flight * Math.PI) * -0.6;
        crumple = flight * 0.08;
        pinned = flight < 0.05;
        break;
      }
      case "drum": {
        // Tumble around inside the drum, lagging the drum like real laundry.
        const spin = Math.abs(p.spin) > 0.5;
        const a = spin ? now * 3.2 + phase + Math.sin(now * 2.3 + phase) * 0.6 : -Math.PI / 2 + (index - (count - 1) / 2) * 0.35;
        const r = spin ? (count === 1 ? 0.16 : 0.2) + Math.sin(now * 1.7 + phase) * 0.05 : 0.12;
        pos.set(inside.x + Math.cos(a) * r, inside.y + Math.sin(a) * r - 0.05, inside.z + Math.sin(now * 3.1 + phase) * 0.06 + index * 0.004);
        scale = drumScale;
        crumple = spin ? 0.1 : 0.05;
        spinZ = spin ? a * 1.3 : 0.3 + index * 0.4;
        tiltX = spin ? Math.sin(now * 2.7 + phase) * 0.5 : 0.2;
        sway = 0;
        pinned = false;
        break;
      }
      case "out": {
        pos.copy(inside).lerp(hang.current, flight);
        scale = lerp(drumScale, 1, flight);
        spinZ = (1 - flight) * Math.PI * 2;
        crumple = 0.08 * (1 - flight);
        pinned = flight > 0.95;
        break;
      }
      default:
        pos.copy(hang.current);
    }

    m.position.copy(pos);
    m.rotation.set(tiltX, Math.sin(now * 1.3 + phase) * sway * 2, spinZ);
    m.scale.set(width * scale, height * scale, 1);
    if (pins.current) pins.current.visible = pinned;

    // Cloth: soaked in the drum, then drying from the top down once it is back on the line.
    const c = cloth.current;
    c.pin = damp(c.pin, pinned ? 1 : 0, 6, dt);
    if (garment === "drum" && p.water > 0.5) c.wet = 1;
    else if (garment === "hang") c.wet = Math.max(0, c.wet - dt / 6);
    const u = clothMaterial.current?.uniforms;
    if (u) {
      u.uMap.value = photo.texture;
      photo.texture.updateMatrix();
      (u.uMapTransform.value as THREE.Matrix3).copy(photo.texture.matrix);
      // Neighbours sway slightly out of step.
      u.uTime.value = now + index * 1.7;
      u.uSway.value = sway;
      u.uCrumple.value = crumple;
      u.uPin.value = c.pin;
      (u.uScale.value as THREE.Vector2).set(width * scale, height * scale);
      u.uWet.value = c.wet;
    }
  });

  return (
    <mesh ref={mesh} geometry={geometry} visible={false}>
      <shaderMaterial ref={clothMaterial} uniforms={clothUniforms} vertexShader={clothVertex} fragmentShader={clothFragment} side={THREE.DoubleSide} />
      <group ref={pins} position={[0, 0.5, 0.02]}>
        {[-0.32, 0.32].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[0.045, 0.14, 0.035]} />
            <meshStandardMaterial color={PALETTE.accent} roughness={0.5} />
          </mesh>
        ))}
      </group>
    </mesh>
  );
}

/* ============================================================== face === */

const FACE_W = 192;
const FACE_H = 64;

/** Pixel face on the control-panel screen, redrawn at ~15 fps (or on each demand frame). */
function FaceScreen({ pose }: { pose: PoseRef }) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const texture = useDispose(
    useMemo(() => {
      const canvas = document.createElement("canvas");
      canvas.width = FACE_W;
      canvas.height = FACE_H;
      const t = new THREE.CanvasTexture(canvas);
      t.magFilter = THREE.NearestFilter;
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    }, []),
  );
  const last = useRef(-1);
  useFrame(() => {
    const map = material.current?.map;
    const now = pose.current.time;
    if (!map || now - last.current < 1 / 15) return;
    last.current = now;
    drawFace((map.image as HTMLCanvasElement).getContext("2d")!, pose.current.face, now);
    map.needsUpdate = true;
  });
  return <meshBasicMaterial ref={material} map={texture} toneMapped={false} />;
}

function drawFace(g: CanvasRenderingContext2D, face: Face, t: number) {
  const error = face === "error";
  const glow = error ? PALETTE.fault : PALETTE.accent;
  g.fillStyle = error ? "#1a0707" : "#0b0816";
  g.fillRect(0, 0, FACE_W, FACE_H);
  g.fillStyle = error ? "rgba(255,92,108,0.06)" : "rgba(157,140,255,0.06)";
  for (let y = 0; y < FACE_H; y += 3) g.fillRect(0, y, FACE_W, 1);

  g.fillStyle = glow;
  g.strokeStyle = glow;
  g.lineWidth = 4;
  g.lineCap = "round";
  const cx = FACE_W / 2;
  const eyeY = 26;
  const eyeDX = 30;
  const bob = face === "working" ? Math.round(Math.sin(t * 18) * 1.5) : 0;
  const blink = (face === "idle" || face === "ready") && t % 3.6 < 0.14;
  // "ready" looks down at the photo on the line.
  const look = face === "ready" ? 5 : 0;

  const eye = (x: number) => {
    g.beginPath();
    switch (face) {
      case "working": {
        const s = x < cx ? 1 : -1;
        g.moveTo(x - 7 * s, eyeY - 7 + bob);
        g.lineTo(x + 6 * s, eyeY + bob);
        g.lineTo(x - 7 * s, eyeY + 7 + bob);
        g.stroke();
        break;
      }
      case "rinse":
        g.moveTo(x - 9, eyeY);
        g.quadraticCurveTo(x - 4, eyeY - 6, x, eyeY);
        g.quadraticCurveTo(x + 4, eyeY + 6, x + 9, eyeY);
        g.stroke();
        break;
      case "happy":
        g.arc(x, eyeY + 5, 8, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
        break;
      case "error":
        g.moveTo(x - 7, eyeY - 7);
        g.lineTo(x + 7, eyeY + 7);
        g.moveTo(x + 7, eyeY - 7);
        g.lineTo(x - 7, eyeY + 7);
        g.stroke();
        break;
      case "excited":
        g.arc(x, eyeY, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#0b0816";
        g.fillRect(x + 1, eyeY - 6, 4, 4);
        g.fillStyle = glow;
        break;
      default:
        g.fillRect(x - 5, blink ? eyeY - 1 + look : eyeY - 9 + look, 10, blink ? 3 : 18);
    }
  };
  eye(cx - eyeDX);
  eye(cx + eyeDX);

  const mouthY = 48 + bob;
  g.beginPath();
  switch (face) {
    case "talk": {
      const open = 2 + Math.abs(Math.sin(t * 14)) * 7;
      g.ellipse(cx, mouthY, 7, open, 0, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "working":
    case "rinse":
      g.moveTo(cx - 14, mouthY);
      for (let i = 0; i <= 28; i += 4) g.lineTo(cx - 14 + i, mouthY + (i % 8 === 0 ? -2 : 2) * (face === "rinse" ? Math.sin(t * 6) : 1));
      g.stroke();
      break;
    case "error":
      g.arc(cx, mouthY + 6, 9, Math.PI * 1.2, Math.PI * 1.8);
      g.stroke();
      break;
    case "happy":
    case "excited":
      g.arc(cx, mouthY - 6, 10, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
      break;
    default:
      g.arc(cx, mouthY - 8, 8, Math.PI * 0.25, Math.PI * 0.75);
      g.stroke();
  }

  if (face === "happy" || face === "excited") {
    g.fillStyle = "rgba(255,140,170,0.55)";
    g.fillRect(cx - eyeDX - 18, eyeY + 12, 10, 5);
    g.fillRect(cx + eyeDX + 8, eyeY + 12, 10, 5);
  }
  if (face === "working" || face === "rinse") {
    g.strokeStyle = glow;
    g.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const y = FACE_H - ((t * 30 + i * 22) % FACE_H);
      g.beginPath();
      g.arc(18 + i * 6, y, 3 + i, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(FACE_W - 18 - i * 6, (y + 30) % FACE_H, 2 + i, 0, Math.PI * 2);
      g.stroke();
    }
  }
}
