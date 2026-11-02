import * as THREE from "three";
import type { TimelineConfig } from "./timeline";

/**
 * Deterministic per-particle attributes for the GPU particle shader. The same
 * seed produces the same layout every run, so replays look equally composed.
 */
export interface ParticleAttributes {
  home: Float32Array; // vec2
  dir: Float32Array; // vec2
  motion: Float32Array; // vec4: lift, wobble, freq, phase
  timing: Float32Array; // vec4: emergeAt, delay, swirl, size
}

export function createParticleAttributes(count: number, config: TimelineConfig, seed = 0x9e3779b9): ParticleAttributes {
  let state = seed >>> 0 || 1;
  const rand = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
  const home = new Float32Array(count * 2);
  const dir = new Float32Array(count * 2);
  const motion = new Float32Array(count * 4);
  const timing = new Float32Array(count * 4);

  for (let i = 0; i < count; i++) {
    let u: number;
    let v: number;
    if (rand() < 0.55) {
      // Perimeter: data "around the edges" of the file.
      const edge = Math.floor(rand() * 4);
      const along = rand() - 0.5;
      u = edge < 2 ? along : edge === 2 ? -0.5 : 0.5;
      v = edge === 0 ? -0.5 : edge === 1 ? 0.5 : along;
    } else {
      u = rand() - 0.5;
      v = rand() - 0.5;
    }
    const len = Math.hypot(u, v) || 1;
    home.set([u, v], i * 2);
    dir.set([u / len, -v / len], i * 2);
    motion.set([0.2 + rand() * 0.5, 0.02 + rand() * 0.05, 0.6 + rand() * 1.4, rand() * Math.PI * 2], i * 4);

    const big = rand() < 0.1;
    const size = big ? 0.13 + rand() * 0.05 : 0.045 + rand() * 0.04;
    // ~10% shimmer into view during activation; the rest emerge as the beam passes them (top → bottom).
    const emergeAt =
      rand() < 0.1
        ? config.materializeEnd + (config.activateEnd - config.materializeEnd) * (0.3 + rand() * 0.6)
        : config.activateEnd + (config.scanEnd - config.activateEnd) * Math.min(1, Math.max(0, v + 0.5));
    timing.set([emergeAt, rand() * 0.32, (rand() - 0.5) * 1.6, size], i * 4);
  }
  return { home, dir, motion, timing };
}

export function particleGeometry(attributes: ParticleAttributes): THREE.BufferGeometry {
  const count = attributes.home.length / 2;
  const geometry = new THREE.BufferGeometry();
  // Positions are computed in the vertex shader; this attribute only sets the draw count.
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  geometry.setAttribute("aHome", new THREE.BufferAttribute(attributes.home, 2));
  geometry.setAttribute("aDir", new THREE.BufferAttribute(attributes.dir, 2));
  geometry.setAttribute("aMotion", new THREE.BufferAttribute(attributes.motion, 4));
  geometry.setAttribute("aTiming", new THREE.BufferAttribute(attributes.timing, 4));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
  return geometry;
}
