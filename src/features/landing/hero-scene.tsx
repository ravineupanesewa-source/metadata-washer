"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Component, useEffect, useMemo, useRef, type ReactNode, type RefObject } from "react";
import * as THREE from "three";
import { jellyFragment, jellyVertex, motesFragment, motesVertex, raysFragment, raysVertex } from "./shaders";

/**
 * Landing hero: a glossy lime jelly bean (procedural, no downloaded assets)
 * floating in diagonal light. Decorative only: aria-hidden, no pointer events.
 */

const LIME = new THREE.Color("#c6f432");
const DEEP_GREEN = new THREE.Color("#2f6b06");
const RIM = new THREE.Color("#f3ffc4");
const BACKDROP = new THREE.Color("#050805");

export interface HeroSceneProps {
  /** Animate continuously; otherwise a single settled frame is rendered. */
  animate: boolean;
  /** Normalised pointer (-1..1) shared from the page. */
  pointer: RefObject<{ x: number; y: number }>;
  onFailure: () => void;
}

export default function HeroCanvas({ animate, pointer, onFailure }: HeroSceneProps) {
  return (
    <ErrorBoundary onError={onFailure}>
      <Canvas
        className="!absolute inset-0"
        frameloop={animate ? "always" : "demand"}
        dpr={[1, 1.5]}
        flat
        camera={{ fov: 30, position: [0, 0.35, 7.5], near: 0.1, far: 50 }}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (event) => {
            event.preventDefault();
            onFailure();
          });
        }}
        tabIndex={-1}
        style={{ pointerEvents: "none" }}
      >
        <Scene animate={animate} pointer={pointer} />
      </Canvas>
    </ErrorBoundary>
  );
}

function Scene({ animate, pointer }: Pick<HeroSceneProps, "animate" | "pointer">) {
  const bean = useRef<THREE.Group>(null);
  const viewport = useThree((s) => s.viewport);
  // Fit the bean to narrow (phone) viewports; full size on desktop.
  const fit = Math.min(1, viewport.width / 3.6);
  // Upper third of the hero, clear of the header and the headline.
  const position = useMemo(() => new THREE.Vector3(0, viewport.height * 0.2, 0), [viewport.height]);

  return (
    <>
      <Rays animate={animate} beanPosition={position} />
      <group ref={bean} position={position} scale={fit * 0.52}>
        <Bean animate={animate} pointer={pointer} />
        <Motes animate={animate} />
      </group>
    </>
  );
}

/* ================================================================ rays === */

function Rays({ animate, beanPosition }: { animate: boolean; beanPosition: THREE.Vector3 }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 3.0 },
      uAspect: { value: 1.6 },
      uFocus: { value: new THREE.Vector2(0.5, 0.65) },
      uColor: { value: LIME.clone() },
      uDeep: { value: BACKDROP.clone() },
      uIntensity: { value: 0.7 },
    }),
    [],
  );
  const projected = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    const m = material.current;
    if (!m) return;
    if (animate) m.uniforms.uTime.value += dt;
    m.uniforms.uAspect.value = size.width / Math.max(1, size.height);
    projected.copy(beanPosition).project(camera);
    m.uniforms.uFocus.value.set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5);
  });

  return (
    <mesh frustumCulled={false} renderOrder={-1}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={material}
        vertexShader={raysVertex}
        fragmentShader={raysFragment}
        uniforms={uniforms}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

/* ================================================================ bean === */

/** Unit sphere sculpted into a plump, slightly kidney-shaped bean. */
function createBeanGeometry(): THREE.BufferGeometry {
  const geometry = new THREE.SphereGeometry(1, 128, 96);
  const pos = geometry.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    v.x *= 0.82;
    v.y *= 1.1;
    v.z *= 0.8;
    // Bend: ends curve to the right, the middle of the left side dips in (kidney).
    v.x += 0.2 * v.y * v.y - 0.1;
    if (v.x < 0) v.x += 0.1 * Math.exp(-v.y * v.y * 3.2) * Math.min(1, -v.x * 2.2);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

interface FacePart {
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

/** Projects face anchor points onto the sculpted surface (front side). */
function placeOnSurface(geometry: THREE.BufferGeometry, points: readonly [number, number][]): FacePart[] {
  const mesh = new THREE.Mesh(geometry);
  const ray = new THREE.Raycaster();
  return points.map(([x, y]) => {
    ray.set(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(mesh, false)[0];
    const normal = hit?.face?.normal.clone() ?? new THREE.Vector3(0, 0, 1);
    return { position: hit?.point.clone() ?? new THREE.Vector3(x, y, 0.7), normal };
  });
}

function Bean({ animate, pointer }: Pick<HeroSceneProps, "animate" | "pointer">) {
  const body = useRef<THREE.Group>(null);
  const eyes = useRef<(THREE.Group | null)[]>([]);
  const material = useRef<THREE.ShaderMaterial>(null);
  const geometry = useMemo(() => createBeanGeometry(), []);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const [leftEye, rightEye, smile] = useMemo(
    () =>
      placeOnSurface(geometry, [
        [-0.13, 0.26],
        [0.19, 0.27],
        [0.04, 0.05],
      ]),
    [geometry],
  );

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: LIME.clone() },
      uDeep: { value: DEEP_GREEN.clone() },
      uRim: { value: RIM.clone() },
      uKey: { value: new THREE.Vector3(-0.45, 0.75, 0.5).normalize() },
      uFill: { value: new THREE.Vector3(0.7, -0.2, 0.6).normalize() },
    }),
    [],
  );

  const lookRef = useRef({ x: 0, y: 0 });
  const clock = useRef(0);

  useFrame((_, dt) => {
    const g = body.current;
    if (!g || !material.current) return;
    if (animate) clock.current += dt;
    const t = clock.current;
    material.current.uniforms.uTime.value = t;

    // Gentle float, breathing squash-and-stretch, and a lazy turn toward the cursor.
    const p = pointer.current ?? { x: 0, y: 0 };
    const look = lookRef.current;
    look.x = THREE.MathUtils.damp(look.x, animate ? p.x : 0, 3, dt);
    look.y = THREE.MathUtils.damp(look.y, animate ? p.y : 0, 3, dt);
    const breathe = Math.sin(t * 1.6) * 0.025;
    g.position.y = Math.sin(t * 1.1) * 0.08;
    g.rotation.set(-look.y * 0.22 + Math.sin(t * 0.7) * 0.04, look.x * 0.45 + Math.sin(t * 0.5) * 0.06, -0.38 + Math.sin(t * 0.8) * 0.03);
    g.scale.set(1 - breathe * 0.5, 1 + breathe, 1 - breathe * 0.5);

    // Eyes follow the cursor and blink every few seconds.
    const blinkPhase = t % 3.8;
    const blink = blinkPhase > 3.65 ? Math.abs(Math.sin(((blinkPhase - 3.65) / 0.15) * Math.PI)) : 1;
    eyes.current.forEach((eye) => {
      if (!eye) return;
      eye.scale.y = Math.max(0.12, blink);
      eye.children[1]?.position.set(-0.022 + look.x * 0.014, 0.025 + look.y * 0.012, 0.035);
    });
  });

  return (
    <group ref={body}>
      <mesh geometry={geometry}>
        <shaderMaterial ref={material} vertexShader={jellyVertex} fragmentShader={jellyFragment} uniforms={uniforms} />
      </mesh>
      {[leftEye, rightEye].map((eye, i) => (
        <FaceAnchor key={i} part={eye}>
          <group
            ref={(g) => {
              eyes.current[i] = g;
            }}
          >
            <mesh scale={[0.07, 0.09, 0.035]}>
              <sphereGeometry args={[1, 24, 16]} />
              <meshBasicMaterial color="#0b1206" />
            </mesh>
            <mesh position={[-0.022, 0.025, 0.035]} scale={0.02}>
              <sphereGeometry args={[1, 12, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
          </group>
        </FaceAnchor>
      ))}
      <FaceAnchor part={smile}>
        <mesh rotation-z={Math.PI} position-y={0.03}>
          <torusGeometry args={[0.11, 0.019, 12, 40, Math.PI]} />
          <meshBasicMaterial color="#0b1206" />
        </mesh>
      </FaceAnchor>
    </group>
  );
}

/** Places children on the bean surface, facing along the surface normal. */
function FaceAnchor({ part, children }: { part: FacePart; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useEffect(() => {
    const g = group.current;
    if (!g) return;
    g.position.copy(part.position).addScaledVector(part.normal, 0.004);
    g.lookAt(part.position.clone().add(part.normal));
  }, [part]);
  return <group ref={group}>{children}</group>;
}

/* =============================================================== motes === */

function Motes({ animate }: { animate: boolean }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const size = useThree((s) => s.size);
  const dpr = useThree((s) => s.viewport.dpr);
  const geometry = useMemo(() => {
    const count = 22;
    const seeds = new Float32Array(count * 4);
    let state = 7;
    const rand = () => ((state = (state * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < count; i++) seeds.set([1.3 + rand() * 0.9, rand() * Math.PI * 2, 0.6 + rand() * 0.8, rand() - 0.5], i * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    g.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
    return g;
  }, []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  const uniforms = useMemo(() => ({ uTime: { value: 2 }, uSize: { value: 60 }, uColor: { value: LIME.clone() } }), []);

  useFrame((_, dt) => {
    if (!material.current) return;
    if (animate) material.current.uniforms.uTime.value += dt;
    material.current.uniforms.uSize.value = 0.11 * size.height * dpr;
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        vertexShader={motesVertex}
        fragmentShader={motesFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

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
