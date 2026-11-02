"use client";

/**
 * Procedural card artwork from ONE shared offscreen WebGL2 context. Each card
 * owns a plain 2D canvas; we render a style into the shared GL canvas and copy
 * the pixels across, so five cards cost one GPU context.
 */

export const CARD_STYLES = ["aurora", "flame", "leaf", "wave", "orb"] as const;
export type CardStyle = (typeof CARD_STYLES)[number];

const VERTEX = `#version 300 es
in vec2 aPosition;
out vec2 vUv;
void main() { vUv = aPosition * 0.5 + 0.5; gl_Position = vec4(aPosition, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRes;
uniform float uTime;
uniform int uStyle;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + 3.7; a *= 0.5; } return v; }
vec2 hash2(vec2 p) { return vec2(hash(p), hash(p + 17.3)); }

// 0: violet aurora arc with stars
vec3 aurora(vec2 p, float t) {
  vec3 col = mix(vec3(0.03, 0.02, 0.10), vec3(0.10, 0.04, 0.25), vUv.y);
  float arc = p.y - (-0.55 + 0.42 * p.x * p.x - 0.15 * p.x + 0.04 * sin(p.x * 3.0 + t));
  col += vec3(0.55, 0.35, 1.0) * exp(-abs(arc) * 34.0) * 1.4;
  col += vec3(0.35, 0.2, 0.95) * exp(-abs(arc) * 6.0) * 0.45;
  col += vec3(0.9, 0.85, 1.0) * step(0.992, hash(floor(vUv * uRes / 3.0))) * (0.5 + 0.5 * sin(t * 3.0 + hash(floor(vUv * 40.0)) * 6.28));
  return col;
}

// 1: amber flame ribbons
vec3 flame(vec2 p, float t) {
  vec2 q = vec2(p.x * 1.6, p.y * 1.1 - t * 0.12);
  float n = fbm(q + fbm(q * 1.4 + t * 0.08) * 1.3);
  float band = smoothstep(0.38, 0.5, n) * (1.0 - smoothstep(0.5, 0.7, n));
  vec3 col = mix(vec3(0.08, 0.02, 0.01), vec3(0.2, 0.05, 0.01), vUv.y);
  col += mix(vec3(1.0, 0.35, 0.05), vec3(1.0, 0.75, 0.35), band) * band * 1.5;
  col += vec3(0.9, 0.25, 0.05) * smoothstep(0.45, 0.8, n) * 0.5;
  return col;
}

// 2: lime leaf with veins and water droplets
vec3 leaf(vec2 p, float t) {
  vec3 col = mix(vec3(0.16, 0.42, 0.04), vec3(0.62, 0.86, 0.18), smoothstep(-0.9, 0.9, p.x + p.y * 0.4));
  // Midrib and side veins.
  float mid = abs(p.y - p.x * 0.55);
  col += vec3(0.85, 1.0, 0.5) * exp(-mid * 60.0) * 0.6;
  float along = p.x * 0.88 + p.y * 0.48;
  float side = abs(fract(along * 3.2) - 0.5) + abs(p.y - p.x * 0.55) * 0.35;
  col += vec3(0.75, 0.95, 0.4) * exp(-side * 30.0) * 0.25;
  col *= 0.85 + 0.25 * fbm(p * 6.0);
  // Droplets: voronoi points shaded as small glossy spheres.
  vec2 g = vUv * vec2(uRes.x / uRes.y, 1.0) * 6.0;
  vec2 cell = floor(g);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 c = cell + vec2(x, y);
    vec2 h = hash2(c);
    if (h.x < 0.45) continue;
    vec2 center = c + 0.2 + 0.6 * h;
    float r = 0.08 + 0.18 * hash(c + 9.1);
    vec2 d = (g - center) / r;
    float l = dot(d, d);
    if (l < 1.0) {
      float z = sqrt(1.0 - l);
      float light = pow(max(dot(normalize(vec3(d, z)), normalize(vec3(-0.4, 0.6, 0.7))), 0.0), 40.0);
      col = mix(col, col * 0.75 + vec3(0.06, 0.12, 0.0), 0.6) + light * 1.4 + (1.0 - z) * 0.12;
    }
  }
  return col + vec3(0.9, 1.0, 0.4) * 0.08 * sin(t * 0.8 + p.x * 3.0);
}

// 3: azure light wave
vec3 wave(vec2 p, float t) {
  vec3 col = mix(vec3(0.01, 0.03, 0.12), vec3(0.02, 0.07, 0.25), vUv.y);
  float y = -0.35 + 0.22 * sin(p.x * 2.4 + t * 0.9) + 0.08 * sin(p.x * 5.1 - t * 1.3);
  float d = abs(p.y - y);
  col += vec3(0.2, 0.55, 1.0) * exp(-d * 22.0) * 1.3;
  col += vec3(0.4, 0.85, 1.0) * exp(-d * 90.0);
  col += vec3(0.1, 0.3, 0.9) * exp(-d * 4.0) * 0.4 * smoothstep(0.0, -0.8, p.y - y);
  return col;
}

// 4: magenta rim-lit orb
vec3 orb(vec2 p, float t) {
  vec3 col = mix(vec3(0.06, 0.01, 0.07), vec3(0.14, 0.02, 0.16), vUv.y);
  vec2 c = vec2(0.45, -0.55);
  float r = length(p - c);
  float rim = exp(-abs(r - 0.75) * 18.0);
  col += vec3(1.0, 0.3, 0.85) * rim * 1.2;
  col += vec3(0.6, 0.15, 0.9) * exp(-abs(r - 0.95 - 0.03 * sin(t)) * 30.0) * 0.6;
  col += vec3(0.4, 0.05, 0.4) * smoothstep(0.75, 0.0, r) * 0.35;
  return col;
}

void main() {
  vec2 p = (vUv - 0.5) * 2.0;
  p.x *= uRes.x / uRes.y;
  vec3 col;
  if (uStyle == 0) col = aurora(p, uTime);
  else if (uStyle == 1) col = flame(p, uTime);
  else if (uStyle == 2) col = leaf(p, uTime);
  else if (uStyle == 3) col = wave(p, uTime);
  else col = orb(p, uTime);
  // Gentle top shade so overlaid text stays readable.
  col *= 0.55 + 0.45 * smoothstep(1.0, 0.35, vUv.y);
  outColor = vec4(1.0 - exp(-col * 1.25), 1.0);
}`;

interface Renderer {
  render(style: CardStyle, target: HTMLCanvasElement, time: number): boolean;
}

let shared: Renderer | null | undefined;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
  console.error("CardArt shader error", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createRenderer(): Renderer | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, preserveDrawingBuffer: false });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;

  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, "uRes");
  const uTime = gl.getUniformLocation(program, "uTime");
  const uStyle = gl.getUniformLocation(program, "uStyle");

  return {
    render(style, target, time) {
      const ctx = target.getContext("2d");
      if (!ctx || target.width === 0 || target.height === 0) return false;
      if (canvas.width !== target.width || canvas.height !== target.height) {
        canvas.width = target.width;
        canvas.height = target.height;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.uniform2f(uRes, canvas.width, canvas.height);
      gl.uniform1f(uTime, time);
      gl.uniform1i(uStyle, CARD_STYLES.indexOf(style));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // Copy in the same task, before the drawing buffer is cleared.
      ctx.drawImage(canvas, 0, 0);
      return true;
    },
  };
}

/** Lazily creates the shared renderer; null when WebGL2 is unavailable. */
export function getCardRenderer(): Renderer | null {
  if (shared === undefined) shared = typeof document === "undefined" ? null : createRenderer();
  return shared;
}
