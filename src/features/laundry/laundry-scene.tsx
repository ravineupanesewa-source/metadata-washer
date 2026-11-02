"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { easeInOut, easeOutBack, easeOutCubic, lerp, seg, type WashPhase } from "./timeline";

/**
 * Procedural laundromat: one front-loading washer (plus two dimmed neighbours)
 * that swallows the dropped picture, spins it, and hands back the result.
 * No downloaded models or textures; everything is built from primitives and
 * small canvas textures.
 */

export interface LaundrySceneProps {
  phase: WashPhase;
  /** Object URL of the dropped picture (shown while loading / washing). */
  sourceUrl: string | null;
  /** Object URL of the processed picture (shown while unloading). */
  resultUrl: string | null;
  /** Something is being dragged over the page. */
  dragOver: boolean;
  onFailure: () => void;
}

export default function LaundryCanvas({ onFailure, ...props }: LaundrySceneProps) {
  return (
    <ErrorBoundary onError={onFailure}>
      <Canvas
        className="!absolute inset-0"
        shadows
        dpr={[1, 1.75]}
        camera={{ fov: 35, position: [0, 1.55, CAMERA_Z], near: 0.1, far: 40 }}
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
      >
        <color attach="background" args={["#140e0c"]} />
        <fog attach="fog" args={["#140e0c", 7, 15]} />
        <Rig />
        <Room />
        <Lights phase={props.phase} />
        <Washer {...props} />
        <WasherShell position={[-2.35, 0, -0.15]} />
        <WasherShell position={[2.35, 0, -0.15]} />
      </Canvas>
    </ErrorBoundary>
  );
}

/* ============================================================ layout === */

const BODY_W = 2;
const BODY_H = 2.4;
const BODY_D = 1.6;
/** Porthole centre, in washer-local coordinates (body origin at its centre). */
const PORT_Y = -0.15;
const PORT_R = 0.66;
const FRONT_Z = BODY_D / 2 + 0.04;
/** Washer body sits on the floor. */
const BODY_Y = BODY_H / 2;
/** Where the hanging picture waits in front of the machine (world). */
const HANG = new THREE.Vector3(0, 1.35, 2.75);
/** Inside the drum (world). */
const DRUM = new THREE.Vector3(0, BODY_Y + PORT_Y, 0.25);

const WATER_VERTEX = /* glsl */ `
  varying vec2 vP;
  void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const WATER_FRAGMENT = /* glsl */ `
  uniform float uLevel, uTilt, uTime, uAlpha;
  varying vec2 vP;
  void main() {
    float surface = uLevel + uTilt * vP.x + 0.03 * sin(vP.x * 9.0 + uTime * 5.0) + 0.015 * sin(vP.x * 23.0 - uTime * 7.0);
    float d = surface - vP.y;
    if (d < 0.0) discard;
    vec3 deep = vec3(0.10, 0.42, 0.62);
    vec3 shallow = vec3(0.45, 0.80, 0.92);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 0.6, d));
    float foam = 1.0 - smoothstep(0.0, 0.05, d);
    col = mix(col, vec3(0.97), foam);
    gl_FragColor = vec4(col, (0.28 + 0.5 * foam) * uAlpha);
  }`;

const CAMERA_Z = 6.6;
const CREAM = "#f1ebdf";
const ACCENT = "#1f8f7a";

/* ============================================================== rig === */

/** Keeps the washer framed on narrow screens and adds a little pointer parallax. */
function Rig() {
  const camera = useThree((s) => s.camera);
  const pointer = useThree((s) => s.pointer);
  const size = useThree((s) => s.size);
  const smooth = useRef(new THREE.Vector2());
  useFrame((_, dt) => {
    const aspect = size.width / Math.max(1, size.height);
    const distance = aspect < 1 ? (CAMERA_Z / Math.max(0.55, aspect)) * 0.7 : CAMERA_Z;
    smooth.current.lerp(pointer, 1 - Math.exp(-dt * 2));
    camera.position.set(smooth.current.x * 0.4, 1.55 + smooth.current.y * 0.15, distance);
    camera.lookAt(0, 1.2, 0);
  });
  return null;
}

/* ============================================================= room === */

function Room() {
  const floor = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = "#d6cdbb";
    g.fillRect(0, 0, 128, 128);
    g.fillStyle = "#2a2729";
    g.fillRect(0, 0, 64, 64);
    g.fillRect(64, 64, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(14, 14);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => floor.dispose(), [floor]);

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow>
        <planeGeometry args={[28, 28]} />
        <meshStandardMaterial map={floor} roughness={0.35} metalness={0.05} />
      </mesh>
      <mesh position={[0, 4, -1.35]} receiveShadow>
        <planeGeometry args={[28, 8]} />
        <meshStandardMaterial color="#3b2a24" roughness={0.9} />
      </mesh>
      {/* Warm window glow on the back wall. */}
      <group position={[3.6, 3.1, -1.33]}>
        <mesh>
          <planeGeometry args={[2.6, 1.7]} />
          <meshBasicMaterial color="#ffc58f" toneMapped={false} />
        </mesh>
        {[-0.65, 0, 0.65].map((x) => (
          <mesh key={x} position={[x, 0, 0.01]}>
            <planeGeometry args={[0.06, 1.7]} />
            <meshBasicMaterial color="#3b2a24" />
          </mesh>
        ))}
      </group>
      {/* Skirting board. */}
      <mesh position={[0, 0.08, -1.3]}>
        <boxGeometry args={[28, 0.16, 0.06]} />
        <meshStandardMaterial color="#22191a" />
      </mesh>
    </group>
  );
}

function Lights({ phase }: { phase: WashPhase }) {
  const key = useRef<THREE.SpotLight>(null);
  useEffect(() => {
    key.current?.target.position.set(0, 1, 0);
    key.current?.target.updateMatrixWorld();
  }, []);
  return (
    <>
      <ambientLight color="#fff1e4" intensity={0.45} />
      <hemisphereLight args={["#fff0de", "#1c1416", 0.6]} />
      <spotLight
        ref={key}
        position={[3.5, 6, 4.5]}
        angle={0.55}
        penumbra={0.8}
        intensity={phase === "idle" ? 110 : 125}
        color="#ffd3ad"
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-4, 3, -2]} intensity={0.9} color="#8fb8ff" />
      <directionalLight position={[-1, 2.5, 6]} intensity={0.6} color="#fff6ee" />
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
/** Cabinet with a round tunnel for the porthole; shared by every washer. */
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

type Face = "idle" | "talk" | "working" | "happy" | "excited";

function faceFor(phase: WashPhase, dragOver: boolean): Face {
  if (dragOver && phase === "idle") return "excited";
  switch (phase) {
    case "loading":
      return "talk";
    case "washing":
      return "working";
    case "unloading":
    case "done":
      return "happy";
    default:
      return "idle";
  }
}

function Washer({ phase, sourceUrl, resultUrl, dragOver }: Omit<LaundrySceneProps, "onFailure">) {
  const body = useRef<THREE.Group>(null);
  const door = useRef<THREE.Group>(null);
  const drum = useRef<THREE.Group>(null);
  const interior = useRef<THREE.PointLight>(null);
  const bubbles = useRef<THREE.InstancedMesh>(null);

  const drumMap = useMemo(() => perforatedTexture(), []);
  const waterMat = useRef<THREE.ShaderMaterial>(null);
  const waterUniforms = useMemo(
    () => ({ uLevel: { value: -1 }, uTilt: { value: 0 }, uTime: { value: 0 }, uAlpha: { value: 0 } }),
    [],
  );
  useEffect(() => () => drumMap.dispose(), [drumMap]);


  const bubbleSeeds = useMemo(
    () =>
      Array.from({ length: 56 }, (_, i) => ({
        x: (((i * 37) % 56) / 56) * 1.1 - 0.55,
        z: 0.35 + ((i * 13) % 7) * 0.05,
        speed: 0.6 + ((i * 7) % 5) * 0.25,
        phase: i * 1.7,
        size: 0.025 + ((i * 11) % 6) * 0.008,
      })),
    [],
  );


  const phaseRef = useRef({ phase, start: -1 });
  const motion = useRef({ spin: 0, angle: 0, level: -1, alpha: 0 });
  const tmp = useRef(new THREE.Object3D());

  useFrame((state, dt) => {
    const now = state.clock.elapsedTime;
    if (phaseRef.current.phase !== phase || phaseRef.current.start < 0) phaseRef.current = { phase, start: now };
    const t = now - phaseRef.current.start;
    const m = motion.current;

    let doorOpen = 0;
    let spinTarget = 0.25;
    let levelTarget = -0.8;
    let alphaTarget = 0;
    switch (phase) {
      case "loading":
        doorOpen = easeInOut(seg(t, 0.5, 1.3)) * (1 - easeInOut(seg(t, 2.45, 3.1)));
        spinTarget = 0;
        if (t > 2.6) {
          levelTarget = -0.4;
          alphaTarget = 1;
        }
        break;
      case "washing":
        // Accelerate, with a short reversal every few seconds like a real tumble cycle.
        spinTarget = lerp(2, 10, seg(t, 0, 3)) * (Math.sin(t * 0.7) > -0.85 ? 1 : -0.6);
        levelTarget = -0.3;
        alphaTarget = 1;
        break;
      case "unloading":
        spinTarget = 0;
        levelTarget = t < 0.7 ? -0.3 : -0.8;
        alphaTarget = t < 0.8 ? 1 : 0;
        doorOpen = easeInOut(seg(t, 0.5, 1.1));
        break;
      case "done":
        spinTarget = 0;
        doorOpen = 1;
        break;
      case "closing":
        doorOpen = 1 - easeInOut(seg(t, 0, 0.7));
        break;
    }

    m.spin = THREE.MathUtils.damp(m.spin, spinTarget, 1.6, dt);
    m.angle += m.spin * dt;
    m.level = THREE.MathUtils.damp(m.level, levelTarget, 1.5, dt);
    m.alpha = THREE.MathUtils.damp(m.alpha, alphaTarget, 3, dt);

    if (drum.current) drum.current.rotation.z = -m.angle;
    if (door.current) door.current.rotation.y = -1.85 * doorOpen;

    const shake = Math.min(1, Math.abs(m.spin) / 10);
    if (body.current) {
      body.current.position.x = Math.sin(now * 43) * 0.012 * shake;
      body.current.position.y = BODY_Y + Math.abs(Math.sin(now * 31)) * 0.008 * shake;
      body.current.rotation.z = Math.sin(now * 37) * 0.004 * shake;
    }
    if (interior.current) interior.current.intensity = 0.3 + m.alpha * 2.2;

    const w = waterMat.current;
    if (w) {
      w.uniforms.uLevel.value = m.level;
      w.uniforms.uTilt.value = THREE.MathUtils.clamp(m.spin * 0.035, -0.35, 0.35);
      w.uniforms.uTime.value = now;
      w.uniforms.uAlpha.value = m.alpha;
    }

    const mesh = bubbles.current;
    if (mesh) {
      bubbleSeeds.forEach((b, i) => {
        const rise = (now * b.speed * 0.25 + b.phase) % 1;
        const x = b.x + Math.sin(now * 2 + b.phase) * 0.04 - m.spin * 0.01;
        const y = m.level - 0.05 + rise * 0.12 + Math.sin(now * 3 + b.phase) * 0.02;
        const inside = x * x + y * y < 0.6 * 0.6;
        const o = tmp.current;
        o.position.set(x, y, b.z);
        o.scale.setScalar(inside ? b.size * m.alpha * (0.45 + 0.5 * shake) : 0);
        o.updateMatrix();
        mesh.setMatrixAt(i, o.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <group ref={body} position={[0, BODY_Y, 0]}>
        <mesh geometry={getBodyGeometry()} castShadow receiveShadow>
          <meshStandardMaterial color={CREAM} roughness={0.38} metalness={0.05} />
        </mesh>

        {/* Control strip, screen and dial. */}
        <mesh position={[0, 0.88, FRONT_Z + 0.005]}>
          <planeGeometry args={[1.82, 0.46]} />
          <meshStandardMaterial color="#2d3437" roughness={0.5} />
        </mesh>
        <mesh position={[-0.32, 0.88, FRONT_Z + 0.012]}>
          <planeGeometry args={[0.96, 0.32]} />
          <FaceScreen face={faceFor(phase, dragOver)} />
        </mesh>
        <mesh position={[0.58, 0.88, FRONT_Z + 0.04]} rotation-x={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.14, 0.15, 0.07, 32]} />
          <meshStandardMaterial color="#d9dde0" metalness={0.8} roughness={0.25} />
        </mesh>
        <mesh position={[0.58, 0.97, FRONT_Z + 0.078]}>
          <boxGeometry args={[0.025, 0.07, 0.01]} />
          <meshBasicMaterial color={ACCENT} />
        </mesh>
        {[0.32, 0.38, 0.44].map((y, i) => (
          <mesh key={y} position={[0.82, 0.88 + (i - 1) * 0.1, FRONT_Z + 0.012]}>
            <circleGeometry args={[0.025, 16]} />
            <meshBasicMaterial color={i === 1 && phase === "washing" ? "#7dffcf" : "#55605f"} toneMapped={false} />
          </mesh>
        ))}
        {/* Kick panel. */}
        <mesh position={[0, -1.02, FRONT_Z + 0.004]}>
          <planeGeometry args={[1.6, 0.22]} />
          <meshStandardMaterial color="#d8d0bf" roughness={0.6} />
        </mesh>

        {/* Drum: rotating perforated cylinder with lifter ribs. */}
        <group position={[0, PORT_Y, 0]}>
          <group ref={drum}>
            <mesh rotation-x={Math.PI / 2} position={[0, 0, 0.05]}>
              <cylinderGeometry args={[0.62, 0.62, 1.5, 48, 1, true]} />
              <meshStandardMaterial map={drumMap} side={THREE.BackSide} metalness={0.7} roughness={0.35} />
            </mesh>
            <mesh position={[0, 0, -0.68]}>
              <circleGeometry args={[0.62, 48]} />
              <meshStandardMaterial map={drumMap} metalness={0.7} roughness={0.4} />
            </mesh>
            {[0, 1, 2].map((i) => (
              <group key={i} rotation-z={(i * Math.PI * 2) / 3}>
                <mesh position={[0, 0.57, 0.05]}>
                  <boxGeometry args={[0.1, 0.08, 1.4]} />
                  <meshStandardMaterial color="#c8cdd2" metalness={0.75} roughness={0.3} />
                </mesh>
              </group>
            ))}
          </group>
          <pointLight ref={interior} position={[0, 0.1, 0.1]} color="#8fdcff" distance={2} intensity={0.3} />
          <mesh position={[0, 0, 0.62]}>
            <circleGeometry args={[0.62, 48]} />
            <shaderMaterial
              ref={waterMat}
              uniforms={waterUniforms}
              vertexShader={WATER_VERTEX}
              fragmentShader={WATER_FRAGMENT}
              transparent
              depthWrite={false}
            />
          </mesh>
          <instancedMesh ref={bubbles} args={[undefined, undefined, bubbleSeeds.length]}>
            <sphereGeometry args={[1, 10, 8]} />
            <meshStandardMaterial color="#ffffff" roughness={0.1} transparent opacity={0.85} />
          </instancedMesh>

          {/* Door, hinged on the left edge of the porthole. */}
          <group ref={door} position={[-PORT_R - 0.02, 0, FRONT_Z + 0.06]}>
            <group position={[PORT_R + 0.02, 0, 0]}>
              <mesh castShadow>
                <torusGeometry args={[0.64, 0.075, 20, 64]} />
                <meshStandardMaterial color="#e3e7ea" metalness={0.85} roughness={0.2} />
              </mesh>
              <mesh position={[0, 0, -0.01]}>
                <circleGeometry args={[0.6, 64]} />
                <meshPhysicalMaterial
                  color="#bfe3f5"
                  transparent
                  opacity={0.22}
                  roughness={0.05}
                  clearcoat={1}
                  depthWrite={false}
                />
              </mesh>
              <mesh position={[0.74, 0, 0.02]} castShadow>
                <boxGeometry args={[0.08, 0.32, 0.06]} />
                <meshStandardMaterial color="#9aa3a8" metalness={0.8} roughness={0.25} />
              </mesh>
            </group>
          </group>
        </group>
      </group>

      <Garment phase={phase} sourceUrl={sourceUrl} resultUrl={resultUrl} motion={motion} />
    </>
  );
}

/** Dimmed copy of the cabinet for the neighbouring machines. */
function WasherShell({ position }: { position: [number, number, number] }) {
  return (
    <group position={[position[0], position[1] + BODY_Y, position[2]]}>
      <mesh geometry={getBodyGeometry()} castShadow receiveShadow>
        <meshStandardMaterial color="#cfc7b6" roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.88, FRONT_Z + 0.005]}>
        <planeGeometry args={[1.82, 0.46]} />
        <meshStandardMaterial color="#262c2e" roughness={0.5} />
      </mesh>
      <group position={[0, PORT_Y, FRONT_Z + 0.06]}>
        <mesh>
          <torusGeometry args={[0.64, 0.075, 16, 48]} />
          <meshStandardMaterial color="#c9cdd0" metalness={0.8} roughness={0.3} />
        </mesh>
        <mesh position={[0, 0, -0.4]}>
          <circleGeometry args={[0.62, 48]} />
          <meshStandardMaterial color="#1a1e22" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

/* =========================================================== garment === */

const SEGMENTS = 14;

/** The dropped picture: hangs on pins, gets pulled in, tumbles, and pops back out. */
function Garment({
  phase,
  sourceUrl,
  resultUrl,
  motion,
}: {
  phase: WashPhase;
  sourceUrl: string | null;
  resultUrl: string | null;
  motion: React.RefObject<{ spin: number; angle: number }>;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const pins = useRef<THREE.Group>(null);
  const source = useTexture(sourceUrl);
  const result = useTexture(resultUrl);
  const geometry = useMemo(() => new THREE.PlaneGeometry(1, 1, SEGMENTS, SEGMENTS), []);
  const rest = useMemo(() => Float32Array.from(geometry.attributes.position.array), [geometry]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const phaseRef = useRef({ phase, start: -1 });
  const target = useRef(new THREE.Vector3());

  const showResult = phase === "unloading" || phase === "done";
  const texture = showResult ? (result ?? source) : source;

  useFrame((state) => {
    const m = mesh.current;
    if (!m) return;
    const now = state.clock.elapsedTime;
    if (phaseRef.current.phase !== phase || phaseRef.current.start < 0) phaseRef.current = { phase, start: now };
    const t = now - phaseRef.current.start;
    const pos = target.current;

    let visible = !!texture;
    let size = 1.1;
    let sway = 0;
    let crumple = 0;
    let spinZ = 0;
    let tiltX = 0;
    let pinsVisible = false;

    switch (phase) {
      case "loading": {
        const drop = easeOutBack(seg(t, 0, 0.75));
        const fly = easeInOut(seg(t, 1.5, 2.45));
        pos.set(HANG.x, lerp(3.9, HANG.y, drop), HANG.z).lerp(DRUM, fly);
        size = lerp(1.15, 0.58, fly);
        sway = 0.1 * (1 - seg(t, 0.4, 1.6)) + 0.04 + fly * 0.06;
        crumple = fly * 0.08;
        spinZ = fly * Math.PI * 1.5;
        tiltX = Math.sin(fly * Math.PI) * -0.6;
        pinsVisible = fly < 0.05;
        break;
      }
      case "washing": {
        // Tumble around inside the drum, lagging the drum like real laundry.
        const a = -(motion.current?.angle ?? 0) * 0.85 + Math.sin(now * 2.3) * 0.6;
        const r = 0.16 + Math.sin(now * 1.7) * 0.05;
        pos.set(DRUM.x + Math.cos(a) * r, DRUM.y + Math.sin(a) * r - 0.05, DRUM.z + Math.sin(now * 3.1) * 0.08);
        size = 0.58;
        crumple = 0.1;
        spinZ = a * 1.3;
        tiltX = Math.sin(now * 2.7) * 0.5;
        break;
      }
      case "unloading": {
        const out = easeOutCubic(seg(t, 0.9, 1.8));
        visible = visible && t > 0.85;
        pos.copy(DRUM).lerp(new THREE.Vector3(0, 1.3, 2.5), out);
        size = lerp(0.4, 1.25, out);
        spinZ = (1 - out) * Math.PI * 2;
        crumple = 0.1 * (1 - out);
        sway = 0.03;
        break;
      }
      default:
        visible = false;
    }

    m.visible = visible;
    if (pins.current) pins.current.visible = visible && pinsVisible;
    if (!visible || !texture) return;

    const img = texture.image as { width: number; height: number };
    const aspect = img.width / Math.max(1, img.height);
    m.position.copy(pos);
    m.rotation.set(tiltX, Math.sin(now * 1.3) * sway * 2, spinZ);
    m.scale.set(aspect >= 1 ? size : size * aspect, aspect >= 1 ? size / aspect : size, 1);

    // Cloth-like ripple: pinned along the top edge while hanging, crumpled while washing.
    const p = m.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = rest[i * 3];
      const y = rest[i * 3 + 1];
      const hang = 0.5 - y;
      const z =
        sway * hang * Math.sin(now * 3.2 + x * 4 + y * 2) +
        crumple * Math.sin(x * 9 + now * 6) * Math.cos(y * 7 - now * 4);
      p.setZ(i, z);
    }
    p.needsUpdate = true;
  });

  return (
    <mesh ref={mesh} geometry={geometry} visible={false} castShadow>
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} transparent alphaTest={0.02} toneMapped={false} />
      <group ref={pins} position={[0, 0.5, 0.02]}>
        {[-0.3, 0.3].map((x) => (
          <mesh key={x} position={[x, 0, 0]}>
            <boxGeometry args={[0.05, 0.16, 0.04]} />
            <meshStandardMaterial color={ACCENT} roughness={0.5} />
          </mesh>
        ))}
      </group>
    </mesh>
  );
}

function useTexture(url: string | null) {
  const [loaded, setLoaded] = useState<{ url: string; texture: THREE.Texture } | null>(null);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let texture: THREE.Texture | null = null;
    new THREE.TextureLoader().load(url, (t) => {
      if (cancelled) return t.dispose();
      t.colorSpace = THREE.SRGBColorSpace;
      texture = t;
      setLoaded({ url, texture: t });
    });
    return () => {
      cancelled = true;
      texture?.dispose();
    };
  }, [url]);
  return loaded && loaded.url === url ? loaded.texture : null;
}

/* ============================================================== face === */

const FACE_W = 192;
const FACE_H = 64;
const GLOW = "#7dffcf";

/** Pixel face on the control-panel screen, redrawn at ~15 fps. */
function FaceScreen({ face }: { face: Face }) {
  const material = useRef<THREE.MeshBasicMaterial>(null);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = FACE_W;
    canvas.height = FACE_H;
    const t = new THREE.CanvasTexture(canvas);
    t.magFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);

  const last = useRef(0);
  useFrame((state) => {
    const map = material.current?.map;
    const now = state.clock.elapsedTime;
    if (!map || now - last.current < 1 / 15) return;
    last.current = now;
    drawFace((map.image as HTMLCanvasElement).getContext("2d")!, face, now);
    map.needsUpdate = true;
  });
  return <meshBasicMaterial ref={material} map={texture} toneMapped={false} />;
}

function drawFace(g: CanvasRenderingContext2D, face: Face, t: number) {
  g.fillStyle = "#06140f";
  g.fillRect(0, 0, FACE_W, FACE_H);
  // Scanlines.
  g.fillStyle = "rgba(125,255,207,0.05)";
  for (let y = 0; y < FACE_H; y += 3) g.fillRect(0, y, FACE_W, 1);

  g.fillStyle = GLOW;
  g.strokeStyle = GLOW;
  g.lineWidth = 4;
  g.lineCap = "round";
  const cx = FACE_W / 2;
  const eyeY = 26;
  const eyeDX = 30;
  const bob = face === "working" ? Math.round(Math.sin(t * 18) * 1.5) : 0;

  const blink = face === "idle" && t % 3.6 < 0.14;
  const eye = (x: number) => {
    switch (face) {
      case "working": {
        // > <
        const s = x < cx ? 1 : -1;
        g.beginPath();
        g.moveTo(x - 7 * s, eyeY - 7 + bob);
        g.lineTo(x + 6 * s, eyeY + bob);
        g.lineTo(x - 7 * s, eyeY + 7 + bob);
        g.stroke();
        break;
      }
      case "happy":
        g.beginPath();
        g.arc(x, eyeY + 5, 8, Math.PI * 1.1, Math.PI * 1.9);
        g.stroke();
        break;
      case "excited":
        g.beginPath();
        g.arc(x, eyeY, 9, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#06140f";
        g.fillRect(x + 1, eyeY - 6, 4, 4);
        g.fillStyle = GLOW;
        break;
      default:
        g.fillRect(x - 5, blink ? eyeY - 1 : eyeY - 9, 10, blink ? 3 : 18);
    }
  };
  eye(cx - eyeDX);
  eye(cx + eyeDX);

  // Mouth.
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
      g.moveTo(cx - 14, mouthY);
      for (let i = 0; i <= 28; i += 4) g.lineTo(cx - 14 + i, mouthY + (i % 8 === 0 ? -2 : 2));
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

  // Cheeks and side bubbles while working.
  g.fillStyle = "rgba(255,140,170,0.55)";
  if (face === "happy" || face === "excited") {
    g.fillRect(cx - eyeDX - 18, eyeY + 12, 10, 5);
    g.fillRect(cx + eyeDX + 8, eyeY + 12, 10, 5);
  }
  if (face === "working") {
    g.strokeStyle = GLOW;
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

/* ============================================================ errors === */

class ErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
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
