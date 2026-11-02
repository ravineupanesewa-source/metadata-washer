"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { PALETTE, TIER_BUDGETS, type QualityTier, type TierBudget } from "./chamber-config";
import { fitPhoto, loadPhotoTexture, type PhotoTexture } from "./image-texture";
import type { DecontaminationRun } from "./run";
import type { TimelineSample } from "./timeline";
import {
  beamFragment,
  beamVertex,
  clothFragment,
  clothVertex,
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
}

export interface ChamberSceneProps {
  mode: StageMode;
  run: DecontaminationRun | null;
  subject: ChamberSubject | null;
  tier: QualityTier;
  /** Fast device (frame-rate probe passed): add environment reflections. */
  rich?: boolean;
}

/* ============================================================ layout === */

const BODY_W = 2;
const BODY_H = 2.4;
const BODY_D = 1.6;
const BODY_Y = BODY_H / 2;
/** Porthole centre in washer-local coordinates (body origin at its centre). */
const PORT_Y = -0.15;
const PORT_R = 0.66;
const FRONT_Z = BODY_D / 2 + 0.04;
/** Clothesline in front of the washer (world). */
const LINE_Z = 2.6;
const LINE_Y = 1.86;
const LINE_SAG = 0.07;
const DRUM = new THREE.Vector3(0, BODY_Y + PORT_Y, 0.25);
const HANG_MAX = { width: 1.15, height: 1.2 };
const CAMERA_Z = 6.6;

/** Cabinet finish: dark brushed gunmetal. */
const GUNMETAL = "#3a3f48";
const EMBER = new THREE.Color(PALETTE.accent);
const CLEAN = new THREE.Color(PALETTE.mint);
const LED_IDLE = CLEAN.clone().multiplyScalar(0.35);
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
  /** Program dial: 0 = off, 1 = turned to the wash program. */
  dial: number;
  /** Detergent drawer: 0 shut .. 1 pulled out. */
  drawer: number;
  /** Foam on the water surface, 0..1. */
  suds: number;
  /** Celebration hop when the wash finishes, 0..1..0. */
  hop: number;
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
    dial: 0,
    drawer: 0,
    suds: 0,
    hop: 0,
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
  pose.dial = sample.materialize > 0 ? 1 : 0;
  // Detergent drawer slides out as the cycle is set, and shuts as the photo goes in.
  pose.drawer = easeInOut(sample.materialize) * (1 - easeInOut(seg(sample.activate, 0.1, 0.6)));
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

/** Normalised pointer for parallax; the canvas itself takes no pointer events. */
const pointer = new THREE.Vector2();
function usePointer() {
  useEffect(() => {
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

export function WasherScene({ mode, run, subject, tier, rich = false }: ChamberSceneProps) {
  const budget = TIER_BUDGETS[tier];
  // Shadow maps redraw every caster each frame: only on wide stages of fast devices.
  const shadows = tier === "full" && rich;
  const photo = usePhoto(subject);
  usePointer();

  // One pose per frame, shared by every part through a ref.
  const pose = useRef<Pose>(derivePose(mode, null, false, 0));
  const elapsed = useRef(0);
  useFrame((_, dt) => {
    elapsed.current += Math.min(dt, 0.1);
    const sample = run ? run.sample() : null;
    pose.current = derivePose(mode, sample, !!photo, elapsed.current);
  }, -1);

  return (
    <>
      <color attach="background" args={["#08090c"]} />
      <fog attach="fog" args={["#08090c", 8, 16]} />
      <CameraRig motion={budget.cameraMotion} />
      <Room budget={budget} pose={pose} />
      {rich && <Reflections />}
      <Lights shadows={shadows} pose={pose} />
      <Washer pose={pose} budget={budget} shadows={shadows} />
      <WasherShell x={-2.35} />
      <WasherShell x={2.35} />
      <Clothesline />
      <Laundry photo={photo} pose={pose} budget={budget} />
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

function usePhoto(subject: ChamberSubject | null): PhotoTexture | null {
  const [loaded, setLoaded] = useState<{ key: string; photo: PhotoTexture } | null>(null);
  useEffect(() => {
    if (!subject) return;
    let alive = true;
    let owned: PhotoTexture | null = null;
    void loadPhotoTexture(subject.file, subject.label).then((p) => {
      if (!alive) return p.dispose();
      owned = p;
      setLoaded({ key: subject.key, photo: p });
    });
    return () => {
      alive = false;
      owned?.dispose();
    };
  }, [subject]);
  return loaded && subject && loaded.key === subject.key ? loaded.photo : null;
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
    scene.environmentIntensity = 0; // faded in below: reflections arrive after the perf probe, so no pop
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
    const aspect = size.width / Math.max(1, size.height);
    // Narrow (phone) canvases: back off just enough to keep the washer about 3 units wide in frame.
    const distance = aspect < 1.2 ? Math.max(CAMERA_Z - 0.6, 4.9 / Math.max(0.5, aspect)) : CAMERA_Z;
    if (motion) smooth.current.lerp(pointer, 1 - Math.exp(-dt * 2));
    camera.position.set(smooth.current.x * 0.4, 1.6 + smooth.current.y * 0.15, distance);
    camera.lookAt(0, 1.25, 0);
  });
  return null;
}

/* ============================================================== room === */

type PoseRef = React.RefObject<Pose>;

function Room({ budget, pose }: { budget: TierBudget; pose: PoseRef }) {
  const floorUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uLight: { value: new THREE.Color("#ff9a4d") },
      uGlow: { value: WATER_LIGHT.clone() },
      uGlowStrength: { value: 0 },
    }),
    [],
  );
  const wallUniforms = useMemo(() => ({ uTime: { value: 0 }, uWindow: { value: new THREE.Color("#ff8a3d") } }), []);
  const floor = useRef<THREE.ShaderMaterial>(null);
  const wall = useRef<THREE.ShaderMaterial>(null);

  useFrame((_, dt) => {
    const f = floor.current;
    if (f) {
      f.uniforms.uTime.value = pose.current.time;
      f.uniforms.uGlowStrength.value = damp(f.uniforms.uGlowStrength.value, pose.current.water, 2, dt);
      (f.uniforms.uGlow.value as THREE.Color).copy(pose.current.fault > 0 ? FAULT : WATER_LIGHT);
    }
    if (wall.current) wall.current.uniforms.uTime.value = pose.current.time;
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0, 2]}>
        <planeGeometry args={[24, 18]} />
        <shaderMaterial ref={floor} uniforms={floorUniforms} vertexShader={floorVertex} fragmentShader={floorFragment} />
      </mesh>
      <mesh position={[0, 4, -1.35]}>
        <planeGeometry args={[24, 8]} />
        <shaderMaterial ref={wall} uniforms={wallUniforms} vertexShader={wallVertex} fragmentShader={wallFragment} />
      </mesh>
      <LightBeams />
      {budget.particles > 40 && <Motes count={Math.round(budget.particles * 0.6)} />}
    </group>
  );
}

/** Two soft shafts of window light slanting down to the floor in front of the washer. */
function LightBeams() {
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uColor: { value: new THREE.Color("#ff9a50") }, uIntensity: { value: 0.18 } }),
    [],
  );
  const material = useRef<THREE.ShaderMaterial>(null);
  const beams = useMemo(() => {
    const toward = new THREE.Vector3(0, 0, 1);
    return [
      { from: new THREE.Vector3(3.0, 3.6, -1.3), to: new THREE.Vector3(0.9, 0, 2.6), width: 1.5 },
      { from: new THREE.Vector3(3.8, 3.4, -1.3), to: new THREE.Vector3(2.1, 0, 2.4), width: 1.1 },
    ].map(({ from, to, width }) => {
      const up = from.clone().sub(to);
      const length = up.length();
      up.normalize();
      const normal = toward.clone().sub(up.clone().multiplyScalar(toward.dot(up))).normalize();
      const side = new THREE.Vector3().crossVectors(up, normal);
      const matrix = new THREE.Matrix4().makeBasis(side, up, normal);
      const quaternion = new THREE.Quaternion().setFromRotationMatrix(matrix);
      return { position: from.clone().add(to).multiplyScalar(0.5), quaternion, length, width };
    });
  }, []);
  useFrame((_, dt) => {
    if (material.current) material.current.uniforms.uTime.value += Math.min(dt, 0.1);
  });
  return (
    <>
      {beams.map((b, i) => (
        <mesh key={i} position={b.position} quaternion={b.quaternion} renderOrder={5}>
          <planeGeometry args={[b.width, b.length]} />
          <shaderMaterial
            ref={i === 0 ? material : undefined}
            uniforms={uniforms}
            vertexShader={beamVertex}
            fragmentShader={beamFragment}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </>
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
  const uniforms = useMemo(() => ({ uTime: { value: 0 }, uSize: { value: 60 }, uColor: { value: new THREE.Color("#ffb27a") } }), []);
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
      <hemisphereLight args={["#ffe3cc", "#0b0c10", 0.55]} />
      <spotLight
        ref={key}
        position={[3.5, 6, 4.5]}
        angle={0.55}
        penumbra={0.8}
        intensity={115}
        color="#ffc29a"
        castShadow={shadows}
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      {/* Cool rim light: keeps the dark metal's silhouette readable against the room. */}
      <directionalLight position={[-4, 3, -2]} intensity={1.3} color="#5ca8ff" />
      <directionalLight position={[-1, 2.5, 6]} intensity={0.7} color="#fff6ee" />
      <pointLight ref={alarm} position={[0, 2.6, 1.4]} color={PALETTE.fault} distance={5} intensity={0} />
    </>
  );
}

/* ========================================================== geometry === */

function roundedRect(w: number, h: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

let bodyGeometry: THREE.ExtrudeGeometry | null = null;
/** Cabinet with a round tunnel for the porthole; shared by every washer and never disposed. */
function getBodyGeometry() {
  if (!bodyGeometry) {
    const shape = roundedRect(BODY_W, BODY_H, 0.14);
    const hole = new THREE.Path();
    hole.absarc(0, PORT_Y, PORT_R, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    bodyGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: BODY_D,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 4,
      curveSegments: 48,
    });
    bodyGeometry.translate(0, 0, -BODY_D / 2);
  }
  return bodyGeometry;
}

function perforatedTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#b9bec4";
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = "#3d4248";
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      g.beginPath();
      g.arc(x * 16 + 8 + (y % 2) * 8, y * 16 + 8, 3, 0, Math.PI * 2);
      g.fill();
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
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

const CHROME = { color: "#c9ced6", metalness: 1, roughness: 0.18 } as const;
const RUBBER = { color: "#1b1f22", roughness: 0.85, metalness: 0 } as const;
const PANEL_Y = 0.88;
const DIAL_X = 0.56;
const LED_COUNT = 18;
const LED_RING = 0.2;
const LED_OFF = new THREE.Color("#2a2320");
const LED_DIM = CLEAN.clone().multiplyScalar(0.25);
const DOME_R = 1.6;
const DOME_THETA = Math.asin(0.6 / DOME_R);

function Washer({ pose, budget, shadows }: { pose: PoseRef; budget: TierBudget; shadows: boolean }) {
  const body = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const drum = useRef<THREE.Group>(null);
  const dial = useRef<THREE.Group>(null);
  const drawer = useRef<THREE.Group>(null);
  const interior = useRef<THREE.PointLight>(null);
  const bubbles = useRef<THREE.InstancedMesh>(null);
  const suds = useRef<THREE.InstancedMesh>(null);
  const water = useRef<THREE.ShaderMaterial>(null);
  const glass = useRef<THREE.ShaderMaterial>(null);
  const grime = useRef<THREE.ShaderMaterial>(null);
  const led = useRef<THREE.MeshBasicMaterial>(null);
  // Glowing ember accents (porthole halo, edge strips, lid seam, panel trim) share one colour per frame.
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
  const ring = useRef<THREE.InstancedMesh | null>(null);
  const ledColor = useRef(new THREE.Color());

  const drumMap = useDispose(useMemo(() => perforatedTexture(), []));
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
    door: { x: 0, v: 0 } as Spring,
    dial: { x: 0, v: 0 } as Spring,
    drawer: { x: 0, v: 0 } as Spring,
    hop: { x: 0, v: 0 } as Spring,
    sway: { x: 0, v: 0 } as Spring,
  });
  const tmp = useRef(new THREE.Object3D());
  const lightColor = useRef(new THREE.Color());

  useFrame((_, rawDt) => {
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

    // Program dial clicks round to the wash setting with a little overshoot.
    stepSpring(m.dial, p.dial, 90, 10, dt);
    if (dial.current) dial.current.rotation.z = -m.dial.x * Math.PI * 0.72;
    stepSpring(m.drawer, p.drawer, 55, 11, dt);
    if (drawer.current) drawer.current.position.z = FRONT_Z + 0.02 + m.drawer.x * 0.34;

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

    const light = lightColor.current.copy(WATER_LIGHT).lerp(MURK_LIGHT, m.murk * 0.7).lerp(FAULT, m.fault);
    if (interior.current) {
      interior.current.color.copy(light);
      interior.current.intensity = 0.3 + m.water * 2.2 + m.fault * 2;
    }
    if (led.current) led.current.color.copy(m.fault > 0.05 ? FAULT : Math.abs(m.spin) > 0.5 ? EMBER : LED_IDLE);

    // Accents breathe when idle, burn brighter with drum speed, flash on a door slam,
    // turn cyan once the wash is done and red on a jam.
    const tone = m.fault > 0.05 ? FAULT : m.progress > 0.99 ? CLEAN : EMBER;
    const level = Math.min(1, 0.32 + 0.12 * Math.sin(now * 1.4) + 0.6 * speed + 0.4 * m.jolt + (m.fault > 0.05 && blinkOn(now) ? 0.5 : 0));
    accentColor.current.copy(tone).multiplyScalar(level);
    accents.current.forEach((mat) => mat.color.copy(accentColor.current));

    // LED ring: fills with progress, chases while waiting, blinks red on a jam, breathes when idle.
    const blink = Math.sin(now * 8) > 0;
    const dots = ring.current;
    if (dots) {
      const c = ledColor.current;
      for (let i = 0; i < LED_COUNT; i++) {
        const f = i / LED_COUNT;
        if (m.fault > 0.05) {
          c.copy(blink ? FAULT : LED_OFF);
        } else if (p.chase) {
          const head = (now * 0.9) % 1;
          const tail = (head - f + 1) % 1;
          c.copy(LED_OFF).lerp(EMBER, Math.max(f < m.progress ? 0.5 : 0, 1 - tail * 5));
        } else if (m.progress > 0.002) {
          c.copy(LED_OFF).lerp(m.progress > 0.99 ? CLEAN : EMBER, clamp01((m.progress - f) * LED_COUNT));
        } else {
          c.copy(LED_OFF).lerp(LED_DIM, (0.5 + 0.5 * Math.sin(now * 1.6 - f * Math.PI * 2)) * 0.6);
        }
        dots.setColorAt(i, c);
      }
      if (dots.instanceColor) dots.instanceColor.needsUpdate = true;
    }

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
      gr.uniforms.uSize.value = 38 * dpr;
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

  return (
    <group ref={body} position={[0, BODY_Y, 0]}>
      {/* Enamelled cabinet. */}
      <mesh geometry={getBodyGeometry()} castShadow={shadows} receiveShadow={shadows}>
        <meshStandardMaterial color={GUNMETAL} roughness={0.32} metalness={0.45} />
      </mesh>
      {/* Worktop lid with a shadow gap under it. */}
      <mesh position={[0, BODY_H / 2 + 0.05, 0]} castShadow={shadows}>
        <boxGeometry args={[BODY_W + 0.06, 0.05, BODY_D + 0.06]} />
        <meshStandardMaterial color="#23262c" roughness={0.35} metalness={0.5} />
      </mesh>
      <mesh position={[0, BODY_H / 2 + 0.022, FRONT_Z - 0.02]}>
        <boxGeometry args={[BODY_W - 0.1, 0.012, 0.02]} />
        <meshBasicMaterial ref={addAccent} color={PALETTE.accent} toneMapped={false} />
      </mesh>

      <ControlPanel shadows={shadows} pose={pose} dial={dial} drawer={drawer} led={led} ringRef={ring} addAccent={addAccent} />

      {/* Ember light strips down the front edges. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (BODY_W / 2 - 0.07), -0.3, FRONT_Z + 0.004]}>
          <planeGeometry args={[0.016, 1.45]} />
          <meshBasicMaterial ref={addAccent} color={PALETTE.accent} toneMapped={false} />
        </mesh>
      ))}

      {/* Kick panel with vents. */}
      <mesh position={[0, -1.02, FRONT_Z + 0.004]}>
        <planeGeometry args={[1.6, 0.22]} />
        <meshStandardMaterial color="#16181d" roughness={0.5} metalness={0.3} />
      </mesh>
      {[-0.06, 0, 0.06].map((y) => (
        <mesh key={y} position={[0.55, -1.02 + y, FRONT_Z + 0.008]}>
          <planeGeometry args={[0.36, 0.018]} />
          <meshBasicMaterial color="#5a2a0c" toneMapped={false} />
        </mesh>
      ))}

      <group position={[0, PORT_Y, 0]}>
        {/* Glowing halo around the porthole. */}
        <mesh position={[0, 0, FRONT_Z + 0.006]}>
          <ringGeometry args={[PORT_R + 0.1, PORT_R + 0.118, 96]} />
          <meshBasicMaterial ref={addAccent} color={PALETTE.accent} toneMapped={false} />
        </mesh>
        {/* Porthole bezel and rubber bellows seal. */}
        <mesh position={[0, 0, FRONT_Z + 0.003]}>
          <ringGeometry args={[PORT_R - 0.005, PORT_R + 0.1, 64]} />
          <meshStandardMaterial color="#1c1f25" roughness={0.3} metalness={0.6} />
        </mesh>
        <mesh position={[0, 0, FRONT_Z - 0.12]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[PORT_R - 0.01, PORT_R - 0.05, 0.24, 48, 1, true]} />
          <meshStandardMaterial {...RUBBER} side={THREE.BackSide} />
        </mesh>
        <mesh position={[0, 0, FRONT_Z - 0.02]}>
          <torusGeometry args={[PORT_R - 0.03, 0.035, 12, 64]} />
          <meshStandardMaterial {...RUBBER} roughness={0.6} />
        </mesh>

        {/* Drum: perforated stainless cylinder, lifter paddles and a spider hub at the back. */}
        <group ref={drum}>
          <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.05]}>
            <cylinderGeometry args={[0.62, 0.62, 1.5, 48, 1, true]} />
            <meshStandardMaterial map={drumMap} side={THREE.BackSide} metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, 0, -0.68]}>
            <circleGeometry args={[0.62, 48]} />
            <meshStandardMaterial map={drumMap} metalness={0.8} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, -0.66]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.09, 0.11, 0.04, 24]} />
            <meshStandardMaterial {...CHROME} roughness={0.25} />
          </mesh>
          {[0, 1, 2].map((i) => (
            <group key={i} rotation-z={(i * Math.PI * 2) / 3}>
              <mesh position={[0, 0.3, -0.665]}>
                <boxGeometry args={[0.05, 0.5, 0.02]} />
                <meshStandardMaterial color="#b9c0c6" metalness={0.85} roughness={0.3} />
              </mesh>
              {/* Lifter: a ridged paddle along the drum wall. */}
              {/* Triangular prism lying along the drum axis (cylinders are built along Y). */}
              <mesh position={[0, 0.56, 0.05]} rotation-x={Math.PI / 2}>
                <cylinderGeometry args={[0.065, 0.065, 1.4, 3, 1]} />
                <meshStandardMaterial color="#d4d9de" metalness={0.8} roughness={0.25} flatShading />
              </mesh>
            </group>
          ))}
        </group>
        <pointLight ref={interior} position={[0, 0.1, 0.1]} color={WATER_LIGHT} distance={2.2} intensity={0.3} />

        <points geometry={grimeGeometry} frustumCulled={false} renderOrder={2}>
          <shaderMaterial
            ref={grime}
            uniforms={grimeUniforms}
            vertexShader={grimeVertex}
            fragmentShader={grimeFragment}
            transparent
            depthWrite={false}
          />
        </points>
        <mesh position={[0, 0, 0.62]} renderOrder={3}>
          <circleGeometry args={[0.62, 48]} />
          <shaderMaterial
            ref={water}
            uniforms={waterUniforms}
            vertexShader={waterVertex}
            fragmentShader={waterFragment}
            transparent
            depthWrite={false}
          />
        </mesh>
        <instancedMesh ref={bubbles} args={[undefined, undefined, bubbleSeeds.length]} renderOrder={4} frustumCulled={false}>
          <sphereGeometry args={[1, 10, 8]} />
          <meshStandardMaterial color="#ffffff" roughness={0.1} transparent opacity={0.85} />
        </instancedMesh>
        <instancedMesh ref={suds} args={[undefined, undefined, sudsSeeds.length]} renderOrder={5} frustumCulled={false}>
          <icosahedronGeometry args={[1, 1]} />
          <meshStandardMaterial color="#f7fbff" roughness={0.9} transparent opacity={0.92} />
        </instancedMesh>

        {/* Hinge blocks (fixed to the cabinet). */}
        {[0.26, -0.26].map((y) => (
          <mesh key={y} position={[-PORT_R - 0.06, y, FRONT_Z + 0.05]} castShadow={shadows}>
            <cylinderGeometry args={[0.032, 0.032, 0.13, 16]} />
            <meshStandardMaterial {...CHROME} />
          </mesh>
        ))}

        {/* Door, hinged on the left edge of the porthole. */}
        <group ref={door} position={[-PORT_R - 0.02, 0, FRONT_Z + 0.06]}>
          <group position={[PORT_R + 0.02, 0, 0]}>
            <mesh castShadow={shadows}>
              <torusGeometry args={[0.65, 0.07, 16, 64]} />
              <meshStandardMaterial {...CHROME} />
            </mesh>
            <mesh position={[0, 0, -0.025]}>
              <torusGeometry args={[0.585, 0.045, 16, 80]} />
              <meshStandardMaterial color="#14161a" roughness={0.25} metalness={0.4} />
            </mesh>
            <mesh position={[0, 0, -0.01]} renderOrder={6}>
              <circleGeometry args={[0.6, 64]} />
              <shaderMaterial
                ref={glass}
                uniforms={glassUniforms}
                vertexShader={glassVertex}
                fragmentShader={glassFragment}
                transparent
                depthWrite={false}
              />
            </mesh>
            {/* Domed glass: mostly clear, it only shows the room's reflections. */}
            <mesh
              position={[0, 0, -DOME_R * Math.cos(DOME_THETA)]}
              rotation-x={Math.PI / 2}
              renderOrder={7}
            >
              <sphereGeometry args={[DOME_R, 64, 12, 0, Math.PI * 2, 0, DOME_THETA]} />
              <meshStandardMaterial
                color="#ffffff"
                transparent
                opacity={0.18}
                roughness={0.04}
                metalness={0}
               
                envMapIntensity={2.2}
                depthWrite={false}
              />
            </mesh>
            {/* Pull handle. */}
            <mesh position={[0.735, 0, 0.03]} castShadow={shadows}>
              <capsuleGeometry args={[0.035, 0.24, 6, 16]} />
              <meshStandardMaterial {...CHROME} />
            </mesh>
            <mesh position={[0.7, 0, 0.0]}>
              <boxGeometry args={[0.08, 0.34, 0.03]} />
              <meshStandardMaterial color="#14161a" roughness={0.4} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

type RingRef = React.RefObject<THREE.InstancedMesh | null>;

/** Control strip: detergent drawer, face screen, program dial with its LED ring, status LEDs. */
function ControlPanel({
  shadows,
  pose,
  dial,
  drawer,
  led,
  ringRef,
  addAccent,
}: {
  shadows: boolean;
  pose: PoseRef;
  dial: React.RefObject<THREE.Group | null>;
  drawer: React.RefObject<THREE.Group | null>;
  led: React.RefObject<THREE.MeshBasicMaterial | null>;
  ringRef: RingRef;
  addAccent: (material: THREE.MeshBasicMaterial | null) => (() => void) | undefined;
}) {
  const dots = useMemo(() => Array.from({ length: LED_COUNT }, (_, i) => Math.PI / 2 - (i / LED_COUNT) * Math.PI * 2), []);
  // One draw call for the whole LED ring; colours are set per instance each frame.
  const placeDots = useCallback(
    (mesh: THREE.InstancedMesh | null) => {
      ringRef.current = mesh;
      if (!mesh) return;
      const o = new THREE.Object3D();
      dots.forEach((a, i) => {
        o.position.set(Math.cos(a) * LED_RING, Math.sin(a) * LED_RING, 0.004);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
        mesh.setColorAt(i, LED_OFF);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    },
    [dots, ringRef],
  );
  return (
    <group position={[0, PANEL_Y, 0]}>
      {/* Gloss black fascia with a glowing ember trim underneath. */}
      <mesh position={[0, 0, FRONT_Z + 0.008]}>
        <boxGeometry args={[1.84, 0.48, 0.012]} />
        <meshStandardMaterial color="#0c0d10" roughness={0.3} />
      </mesh>
      <mesh position={[0, -0.255, FRONT_Z + 0.012]}>
        <boxGeometry args={[1.84, 0.012, 0.02]} />
        <meshBasicMaterial ref={addAccent} color={PALETTE.accent} toneMapped={false} />
      </mesh>

      {/* Detergent drawer: slides out as the cycle is set. The tray hides inside the cabinet. */}
      <group ref={drawer} position={[-0.66, 0, FRONT_Z + 0.02]}>
        <mesh castShadow={shadows}>
          <boxGeometry args={[0.44, 0.36, 0.04]} />
          <meshStandardMaterial color={GUNMETAL} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.11, 0.021]}>
          <planeGeometry args={[0.24, 0.05]} />
          <meshStandardMaterial color="#0c0d10" roughness={0.6} />
        </mesh>
        <mesh position={[0, 0, -0.2]}>
          <boxGeometry args={[0.4, 0.3, 0.36]} />
          <meshStandardMaterial color="#2a2e36" roughness={0.5} metalness={0.3} />
        </mesh>
        <mesh position={[0, 0.151, -0.2]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.34, 0.3]} />
          <meshStandardMaterial color="#ff8a2a" roughness={0.35} emissive="#a63c00" emissiveIntensity={0.8} />
        </mesh>
      </group>

      {/* Face screen behind a smoked glass bezel. */}
      <mesh position={[-0.06, 0, FRONT_Z + 0.016]}>
        <boxGeometry args={[0.8, 0.32, 0.01]} />
        <meshStandardMaterial color="#0b0f10" roughness={0.1} />
      </mesh>
      <mesh position={[-0.06, 0, FRONT_Z + 0.022]}>
        <planeGeometry args={[0.72, 0.24]} />
        <FaceScreen pose={pose} />
      </mesh>

      {/* Program dial: chrome skirt, knurled grip, ember pointer. */}
      <group position={[DIAL_X, 0, FRONT_Z + 0.014]}>
        <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.01]}>
          <cylinderGeometry args={[0.16, 0.16, 0.012, 48]} />
          <meshStandardMaterial {...CHROME} roughness={0.2} />
        </mesh>
        <group ref={dial}>
          <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.05]} castShadow={shadows}>
            <cylinderGeometry args={[0.125, 0.135, 0.08, 48]} />
            <meshStandardMaterial {...CHROME} />
          </mesh>
          {/* Knurled grip: a faceted sleeve catches the light like ridges. */}
          <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.05]}>
            <cylinderGeometry args={[0.14, 0.14, 0.06, 28, 1]} />
            <meshStandardMaterial {...CHROME} roughness={0.3} flatShading />
          </mesh>
          <mesh position={[0, 0, 0.091]}>
            <circleGeometry args={[0.105, 48]} />
            <meshStandardMaterial color="#14161a" roughness={0.2} />
          </mesh>
          <mesh position={[0, 0.06, 0.093]}>
            <planeGeometry args={[0.018, 0.075]} />
            <meshBasicMaterial color={PALETTE.accent} toneMapped={false} />
          </mesh>
        </group>
        {/* Progress LEDs around the dial. */}
        <instancedMesh ref={placeDots} args={[undefined, undefined, LED_COUNT]} frustumCulled={false}>
          <circleGeometry args={[0.014, 12]} />
          <meshBasicMaterial toneMapped={false} />
        </instancedMesh>
      </group>

      {/* Status LEDs. */}
      <mesh position={[0.84, 0, FRONT_Z + 0.016]}>
        <circleGeometry args={[0.03, 16]} />
        <meshBasicMaterial ref={led} color={PALETTE.mint} toneMapped={false} />
      </mesh>
      {[-0.1, 0.1].map((y) => (
        <mesh key={y} position={[0.84, y, FRONT_Z + 0.016]}>
          <circleGeometry args={[0.022, 16]} />
          <meshBasicMaterial color="#3a3330" />
        </mesh>
      ))}
    </group>
  );
}

/** Dimmed neighbouring machine (static). */
function WasherShell({ x }: { x: number }) {
  return (
    <group position={[x, BODY_Y, -0.15]}>
      <mesh geometry={getBodyGeometry()}>
        <meshStandardMaterial color="#25282e" roughness={0.35} metalness={0.45} />
      </mesh>
      <mesh position={[0, BODY_H / 2 + 0.05, 0]}>
        <boxGeometry args={[BODY_W + 0.06, 0.05, BODY_D + 0.06]} />
        <meshStandardMaterial color="#1d2025" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, PANEL_Y, FRONT_Z + 0.008]}>
        <boxGeometry args={[1.84, 0.48, 0.012]} />
        <meshStandardMaterial color="#0c0d10" roughness={0.35} />
      </mesh>
      <group position={[0, PORT_Y, FRONT_Z + 0.06]}>
        <mesh>
          <torusGeometry args={[0.65, 0.07, 16, 48]} />
          <meshStandardMaterial {...CHROME} roughness={0.25} />
        </mesh>
        <mesh position={[0, 0, -0.4]}>
          <circleGeometry args={[0.62, 48]} />
          <meshStandardMaterial color="#1a1e22" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
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

/** The photo itself: hangs on the line, gets washed, and is hung back up. Pixels are never altered. */
function Laundry({ photo, pose, budget }: { photo: PhotoTexture | null; pose: PoseRef; budget: TierBudget }) {
  const mesh = useRef<THREE.Mesh>(null);
  const pins = useRef<THREE.Group>(null);
  const sparkles = useRef<THREE.ShaderMaterial>(null);
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

  const track = useRef({ shown: false, since: 0 });
  const hang = useRef(new THREE.Vector3());
  const target = useRef(new THREE.Vector3());

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const m = mesh.current;
    if (!m) return;
    const p = pose.current;
    const now = p.time;
    const visible = !!photo && p.garment !== "hidden";
    m.visible = visible;
    const sp = sparkles.current;
    if (sp) {
      sp.uniforms.uTime.value = now;
      sp.uniforms.uShow.value = visible ? p.sparkle : 0;
      sp.uniforms.uSize.value = 220 * dpr;
    }
    if (!visible || !photo) {
      track.current.shown = false;
      return;
    }
    // A fresh photo drops onto the line from above.
    if (!track.current.shown) track.current = { shown: true, since: now };
    const drop = p.garment === "hang" ? easeOutBack(seg(now - track.current.since, 0, 0.7)) : 1;

    const { width, height } = fitPhoto(photo.aspect, HANG_MAX.width, HANG_MAX.height);
    hang.current.set(0, lineY(0) - height / 2 + 0.02 + (1 - drop) * 2.6, LINE_Z);
    const pos = target.current;

    let scale = 1;
    let sway = 0.03 + p.tug * 0.08;
    let crumple = 0;
    let spinZ = 0;
    let tiltX = 0;
    let pinned = true;
    const inside = DRUM;

    switch (p.garment) {
      case "in": {
        pos.copy(hang.current).lerp(inside, p.flight);
        scale = lerp(1, 0.5, p.flight);
        spinZ = p.flight * Math.PI * 1.5;
        tiltX = Math.sin(p.flight * Math.PI) * -0.6;
        crumple = p.flight * 0.08;
        pinned = p.flight < 0.05;
        break;
      }
      case "drum": {
        // Tumble around inside the drum, lagging the drum like real laundry.
        const spin = Math.abs(p.spin) > 0.5;
        const a = spin ? now * 3.2 + Math.sin(now * 2.3) * 0.6 : -Math.PI / 2;
        const r = spin ? 0.16 + Math.sin(now * 1.7) * 0.05 : 0.12;
        pos.set(inside.x + Math.cos(a) * r, inside.y + Math.sin(a) * r - 0.05, inside.z + Math.sin(now * 3.1) * 0.06);
        scale = 0.5;
        crumple = spin ? 0.1 : 0.05;
        spinZ = spin ? a * 1.3 : 0.3;
        tiltX = spin ? Math.sin(now * 2.7) * 0.5 : 0.2;
        sway = 0;
        pinned = false;
        break;
      }
      case "out": {
        pos.copy(inside).lerp(hang.current, p.flight);
        scale = lerp(0.5, 1, p.flight);
        spinZ = (1 - p.flight) * Math.PI * 2;
        crumple = 0.08 * (1 - p.flight);
        pinned = p.flight > 0.95;
        break;
      }
      default:
        pos.copy(hang.current);
    }

    m.position.copy(pos);
    m.rotation.set(tiltX, Math.sin(now * 1.3) * sway * 2, spinZ);
    m.scale.set(width * scale, height * scale, 1);
    if (pins.current) pins.current.visible = pinned;

    // Cloth: soaked in the drum, then drying from the top down once it is back on the line.
    const c = cloth.current;
    c.pin = damp(c.pin, pinned ? 1 : 0, 6, dt);
    if (p.garment === "drum" && p.water > 0.5) c.wet = 1;
    else if (p.garment === "hang") c.wet = Math.max(0, c.wet - dt / 6);
    const u = clothMaterial.current?.uniforms;
    if (u) {
      u.uMap.value = photo.texture;
      photo.texture.updateMatrix();
      (u.uMapTransform.value as THREE.Matrix3).copy(photo.texture.matrix);
      u.uTime.value = now;
      u.uSway.value = sway;
      u.uCrumple.value = crumple;
      u.uPin.value = c.pin;
      (u.uScale.value as THREE.Vector2).set(width * scale, height * scale);
      u.uWet.value = c.wet;
    }
  });

  return (
    <>
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
      <points geometry={sparkleGeometry} position={[0, lineY(0) - 0.6, LINE_Z]} frustumCulled={false} renderOrder={8}>
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
  g.fillStyle = error ? "#1a0707" : "#140802";
  g.fillRect(0, 0, FACE_W, FACE_H);
  g.fillStyle = error ? "rgba(255,92,108,0.06)" : "rgba(255,122,26,0.06)";
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
        g.fillStyle = "#140802";
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
