/**
 * GLSL for the laundromat scene. Everything is procedural: no texture files.
 * Uniform names are prefixed with `u`; per-vertex attributes with `a`.
 */

/* ---------------------------------------------------------------- floor --- */

/** World-space graphite tiles with glowing ember grout, a light pool from the wall panel and a soft vignette. */
export const floorVertex = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const floorFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uLight;
  uniform vec3 uGlow;
  uniform float uGlowStrength;
  varying vec3 vWorld;

  float tile(vec2 p) {
    vec2 c = floor(p);
    return mod(c.x + c.y, 2.0);
  }

  void main() {
    vec2 p = vWorld.xz * 1.6;
    // Grout lines and slightly worn tiles.
    vec2 f = abs(fract(p) - 0.5);
    float grout = smoothstep(0.485, 0.5, max(f.x, f.y));
    float checker = tile(p);
    vec3 dark = vec3(0.10, 0.105, 0.12);
    vec3 light = vec3(0.24, 0.25, 0.28);
    vec3 col = mix(dark, light, checker);
    col = mix(col, vec3(0.02), grout * 0.6);

    // Warm light pool falling from the window (back right) toward the washer.
    vec2 pool = vWorld.xz - vec2(0.9, 1.6);
    pool.x *= 0.55;
    float lightPool = exp(-dot(pool, pool) * 0.35);
    col *= 0.45 + lightPool * 0.9 * uLight;
    // Grout seams glow faintly near the machines.
    col += uLight * grout * 0.22 * exp(-dot(vWorld.xz - vec2(0.0, 1.2), vWorld.xz - vec2(0.0, 1.2)) * 0.12);

    // Glow under the washer while it works (water light leaking out).
    float under = exp(-dot(vWorld.xz - vec2(0.0, 1.1), vWorld.xz - vec2(0.0, 1.1)) * 1.4);
    col += uGlow * under * uGlowStrength * 0.35;

    // Contact shadow under the machines.
    float shadow = smoothstep(1.25, 0.6, abs(vWorld.x - clamp(vWorld.x, -3.3, 3.3)) + max(0.0, vWorld.z - 0.95) * 1.6);
    col *= mix(1.0, 0.55, shadow * step(vWorld.z, 1.4));

    // Fade into the room.
    float dist = length(vWorld.xz - vec2(0.0, 1.5));
    col *= smoothstep(9.0, 2.0, dist);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ----------------------------------------------------------------- wall --- */

/** Back wall: graphite panels, an ember neon band and a glowing light panel. */
export const wallVertex = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

export const wallFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uWindow;
  varying vec2 vUv;
  varying vec3 vWorld;

  float box(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  }

  void main() {
    // Upper wall: large graphite panels with dark seams (linear values: these read as near-black).
    vec3 panel = mix(vec3(0.012, 0.013, 0.017), vec3(0.03, 0.031, 0.038), smoothstep(0.0, 4.5, vWorld.y));
    vec2 pf = abs(fract(vec2(vWorld.x / 1.6, (vWorld.y - 1.1) / 1.2)) - 0.5);
    panel *= 1.0 - smoothstep(0.485, 0.5, max(pf.x, pf.y)) * 0.6;
    // Lower wall: small dark tiles below 1.1m.
    float lower = step(vWorld.y, 1.1);
    vec2 t = vec2(vWorld.x * 3.0, vWorld.y * 3.0);
    vec2 tf = abs(fract(t) - 0.5);
    float tileLine = smoothstep(0.46, 0.5, max(tf.x, tf.y));
    vec3 tiles = mix(vec3(0.02, 0.021, 0.026), vec3(0.008, 0.008, 0.01), tileLine);
    vec3 col = mix(panel, tiles, lower);
    // Ember neon band just above the machines, with a soft spill, gently pulsing.
    float band = abs(vWorld.y - 2.75);
    float pulse = 0.85 + 0.15 * sin(uTime * 1.3);
    col += uWindow * (smoothstep(0.018, 0.0, band) * 1.4 + exp(-band * 5.0) * 0.12) * pulse;

    // Light panel (four glowing cells) with a soft bloom around it.
    vec2 w = vWorld.xy - vec2(3.4, 3.0);
    float frame = box(w, vec2(1.35, 0.9));
    vec2 pane = abs(fract((w + vec2(1.35, 0.9)) / vec2(0.675, 0.9)) - 0.5);
    float mullion = smoothstep(0.47, 0.5, max(pane.x, pane.y));
    float inside = step(frame, 0.0);
    vec3 sky = mix(uWindow, uWindow * vec3(1.0, 0.82, 0.62), clamp(w.y * 0.5 + 0.5, 0.0, 1.0));
    col = mix(col, sky * 1.1, inside * (1.0 - mullion * 0.85));
    col += uWindow * exp(-max(frame, 0.0) * 2.2) * 0.35 * (1.0 - inside);

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ---------------------------------------------------------------- beams --- */

/** Additive light shafts from the window, with drifting noise for dusty air. */
export const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying vec2 vUv;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  void main() {
    float across = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.65, vUv.x);
    float along = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.45, vUv.y);
    float dust = 0.65 + 0.35 * noise(vec2(vUv.x * 6.0 + uTime * 0.05, vUv.y * 3.0 - uTime * 0.08));
    float a = across * along * dust * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/* ---------------------------------------------------------------- motes --- */

/** Dust motes drifting in the window light. Positions wrap inside a box. */
export const moteVertex = /* glsl */ `
  uniform float uTime;
  uniform float uSize;
  attribute vec4 aSeed;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.x += sin(uTime * 0.2 * aSeed.y + aSeed.x * 6.28) * 0.25;
    p.y = mod(p.y + uTime * 0.04 * aSeed.z + 4.0, 4.0);
    p.z += cos(uTime * 0.17 * aSeed.w + aSeed.y * 6.28) * 0.2;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.4 + aSeed.w) / -mv.z;
    // Brighter inside the beam band (back right, high).
    float beam = smoothstep(2.5, 0.0, abs((p.x - 1.2) - (p.y - 2.0) * 0.9));
    vAlpha = (0.15 + 0.85 * beam) * (0.5 + 0.5 * sin(uTime * aSeed.z + aSeed.x * 10.0));
  }
`;

export const moteFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d) * vAlpha;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/* ---------------------------------------------------------------- glass --- */

/** Porthole glass: fresnel rim, a moving highlight streak and a tint that follows the wash. */
export const glassVertex = /* glsl */ `
  varying vec2 vP;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    vP = position.xy;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

export const glassFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uTint;
  uniform float uFog;
  uniform float uRadius;
  varying vec2 vP;
  varying vec3 vNormalV;
  varying vec3 vViewDir;
  void main() {
    float r = length(vP) / uRadius;
    float fresnel = pow(1.0 - abs(dot(vNormalV, vViewDir)), 2.0);
    float rim = smoothstep(0.75, 1.0, r);
    // Diagonal highlight streak that slides slowly.
    float streak = smoothstep(0.06, 0.0, abs(vP.x * 0.8 + vP.y - 0.25 + sin(uTime * 0.3) * 0.05)) * smoothstep(1.0, 0.4, r);
    float streak2 = smoothstep(0.025, 0.0, abs(vP.x * 0.8 + vP.y - 0.42)) * smoothstep(1.0, 0.5, r);
    // Steam fogging from the edge inward while washing.
    float fog = uFog * smoothstep(0.35, 1.0, r) * (0.75 + 0.25 * sin(vP.x * 12.0 + uTime));
    vec3 col = uTint * (0.25 + rim * 0.5) + vec3(1.0) * (streak * 0.55 + streak2 * 0.35 + fresnel * 0.3) + vec3(0.9) * fog * 0.5;
    float a = 0.12 + rim * 0.25 + streak * 0.45 + streak2 * 0.3 + fresnel * 0.2 + fog * 0.35;
    gl_FragColor = vec4(col, clamp(a, 0.0, 0.85));
  }
`;

/* ---------------------------------------------------------------- water --- */

/**
 * Water seen through the porthole. Sloshes with drum speed, turns murky while
 * metadata is "in the wash", and clears during the rinse.
 */
export const waterVertex = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const waterFragment = /* glsl */ `
  uniform float uLevel;
  uniform float uTilt;
  uniform float uTime;
  uniform float uAlpha;
  uniform float uMurk;
  uniform vec3 uFault;
  uniform float uFaultMix;
  varying vec2 vP;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 17853.5453); }

  void main() {
    float surface = uLevel + uTilt * vP.x
      + 0.035 * sin(vP.x * 9.0 + uTime * 5.0)
      + 0.018 * sin(vP.x * 23.0 - uTime * 7.0);
    float d = surface - vP.y;
    if (d < 0.0) discard;

    vec3 shallow = vec3(0.50, 0.84, 0.95);
    vec3 deep = vec3(0.08, 0.38, 0.60);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 0.6, d));

    // Murky wash water: olive-brown with swirling grime.
    float swirl = sin(vP.x * 14.0 + uTime * 3.0 + sin(vP.y * 11.0 - uTime * 2.0) * 2.0) * 0.5 + 0.5;
    vec3 murky = mix(vec3(0.30, 0.30, 0.12), vec3(0.45, 0.42, 0.18), swirl);
    col = mix(col, murky, uMurk * 0.85);
    col = mix(col, uFault, uFaultMix);

    // Foam line and tiny bubbles near the surface.
    float foam = 1.0 - smoothstep(0.0, 0.055, d);
    float fizz = step(0.985, hash(floor(vec2(vP.x * 60.0, (vP.y + uTime * 0.2) * 60.0)))) * smoothstep(0.25, 0.0, d);
    col = mix(col, vec3(0.97), max(foam, fizz));
    float a = (0.3 + 0.25 * uMurk + 0.5 * foam) * uAlpha;
    gl_FragColor = vec4(col, a);
  }
`;

/* ---------------------------------------------------------------- grime --- */

/**
 * "Metadata grime": specks that seep out of the photo into the water, swirl
 * with the drum, then get flushed toward the drain during the rinse.
 *  aSeed: x = angle, y = radius, z = speed, w = size/phase
 */
export const grimeVertex = /* glsl */ `
  uniform float uTime;
  uniform float uEmerge;
  uniform float uFlush;
  uniform float uSpin;
  uniform float uSize;
  attribute vec4 aSeed;
  varying float vAlpha;
  varying float vHue;
  void main() {
    float ang = aSeed.x * 6.2832 + uSpin * (0.6 + aSeed.z * 0.6) + sin(uTime * 2.0 + aSeed.w * 9.0) * 0.3;
    float rad = mix(0.05, aSeed.y * 0.52, uEmerge);
    vec3 p = vec3(cos(ang) * rad, sin(ang) * rad, 0.25 + aSeed.w * 0.35);
    // Flush: spiral inward and back toward the drain at the rear of the drum.
    float f = clamp(uFlush * 1.3 - aSeed.z * 0.3, 0.0, 1.0);
    p.xy *= 1.0 - f;
    p.z -= f * 0.9;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + aSeed.w) * (1.0 - f * 0.6) / -mv.z;
    vAlpha = uEmerge * (1.0 - f);
    vHue = aSeed.z;
  }
`;

export const grimeFragment = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  varying float vAlpha;
  varying float vHue;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    // Blobby specks rather than perfect discs.
    float r = length(c) * (1.0 + 0.25 * sin(atan(c.y, c.x) * 3.0 + vHue * 12.0));
    float a = smoothstep(0.5, 0.2, r) * vAlpha;
    if (a < 0.01) discard;
    vec3 col = mix(uColorA, uColorB, vHue);
    gl_FragColor = vec4(col, a);
  }
`;

/* ------------------------------------------------------------- sparkles --- */

/** Four-point "squeaky clean" sparkles around the finished photo. */
export const sparkleVertex = /* glsl */ `
  uniform float uTime;
  uniform float uShow;
  uniform float uSize;
  attribute vec4 aSeed;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y += sin(uTime * 1.5 + aSeed.x * 6.28) * 0.04;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = pow(max(0.0, sin(uTime * (2.0 + aSeed.y * 3.0) + aSeed.z * 6.28)), 3.0);
    gl_PointSize = uSize * (0.5 + aSeed.w) * (0.4 + twinkle) * uShow / -mv.z;
    vAlpha = uShow * (0.3 + 0.7 * twinkle);
  }
`;

export const sparkleFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    vec2 c = abs(gl_PointCoord - 0.5) * 2.0;
    float star = max(smoothstep(0.18, 0.0, c.x) * (1.0 - c.y), smoothstep(0.18, 0.0, c.y) * (1.0 - c.x));
    float core = smoothstep(0.35, 0.0, length(c));
    float a = clamp(star + core, 0.0, 1.0) * vAlpha;
    if (a < 0.01) discard;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

/* ---------------------------------------------------------------- cloth --- */

/**
 * The photo as a hung-up piece of fabric. A unit plane (uv y=1 is the top hem)
 * is displaced on the GPU: drape folds that fan out from the two pegs, a slack
 * top edge between them, corners that curl, and a gusting breeze that grows
 * towards the free bottom hem. Normals come from finite differences of the same
 * displacement, so folds catch the light. Shading only: the photo's own colours
 * are lit, never recoloured.
 */
const clothDisplace = /* glsl */ `
  uniform float uTime;
  uniform float uSway;
  uniform float uCrumple;
  uniform float uPin;
  uniform vec2 uScale;

  const float PEG_L = 0.18;
  const float PEG_R = 0.82;

  // Displacement in object units (x/y are scaled by uScale afterwards, z is not).
  vec3 clothOffset(vec2 uv) {
    float hang = 1.0 - uv.y;                      // 0 at the top hem, 1 at the bottom
    float free = mix(1.0, pow(hang, 1.2), uPin);  // unpinned cloth moves everywhere
    float t = uTime;

    // Distance to the nearest peg along the top edge.
    float peg = min(abs(uv.x - PEG_L), abs(uv.x - PEG_R));
    float between = step(PEG_L, uv.x) * step(uv.x, PEG_R);

    // Slack: the top hem dips between the pegs and the outer corners droop.
    float slack = uPin * (between * sin((uv.x - PEG_L) / (PEG_R - PEG_L) * 3.14159) * 0.035
                + (1.0 - between) * smoothstep(0.0, 0.18, peg) * 0.05);
    float topBand = smoothstep(0.35, 0.0, hang);
    float dy = -slack * topBand;

    // Drape folds: vertical pleats hanging from the pegs, widening further down.
    float pleat = sin((uv.x - 0.5) * (22.0 - hang * 8.0) + sin(uv.y * 3.0) * 0.6);
    float drape = pleat * (0.016 + 0.028 * hang) * mix(0.35, 1.0, uPin);

    // Breeze: travelling waves with a slow gust envelope.
    float gust = 0.65 + 0.35 * sin(t * 0.45) * sin(t * 0.23 + 1.3);
    float wind = sin(uv.x * 5.0 - t * 2.6 + uv.y * 2.0) * 0.6
               + sin(uv.x * 9.0 + t * 3.7 - uv.y * 4.0) * 0.25
               + sin(uv.y * 6.0 - t * 2.1) * 0.35;
    float breeze = wind * uSway * gust * free * 1.6;

    // Corner curl: the free bottom corners roll slightly forward.
    float corner = pow(abs(uv.x - 0.5) * 2.0, 4.0) * pow(hang, 2.0);
    float curl = corner * (0.05 + 0.03 * sin(t * 1.7 + uv.x * 3.0)) * uPin;

    // Crumple: tight wrinkles while it tumbles in the drum.
    float crumple = uCrumple * (sin(uv.x * 23.0 + t * 6.0) * cos(uv.y * 19.0 - t * 4.0)
                  + 0.5 * sin((uv.x + uv.y) * 31.0 + t * 5.0));

    // A little horizontal sway, more at the bottom.
    float dx = uSway * free * sin(t * 1.3 + uv.y * 2.0) * 0.04;
    return vec3(dx, dy, drape + breeze + curl + crumple);
  }
`;

export const clothVertex = /* glsl */ `
  ${clothDisplace}
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vFold;

  vec3 clothPoint(vec2 uv) {
    vec3 o = clothOffset(uv);
    // Plane spans -0.5..0.5; x/y offsets are in uv units so they scale with the photo.
    return vec3(uv.x - 0.5 + o.x, uv.y - 0.5 + o.y, o.z);
  }

  void main() {
    vUv = uv;
    vec3 o = clothOffset(uv);
    vec3 p = vec3(uv.x - 0.5 + o.x, uv.y - 0.5 + o.y, o.z);
    // Finite-difference normal in the scaled (world-proportioned) space.
    float e = 0.01;
    vec3 sx = vec3(uScale, 1.0);
    vec3 dx = (clothPoint(uv + vec2(e, 0.0)) - clothPoint(uv - vec2(e, 0.0))) * sx;
    vec3 dy = (clothPoint(uv + vec2(0.0, e)) - clothPoint(uv - vec2(0.0, e))) * sx;
    vec3 n = normalize(cross(dx, dy));
    // Undo the mesh's non-uniform x/y scale so the normal is correct after normalMatrix.
    n = normalize(n * vec3(uScale.x, uScale.y, 1.0));
    vNormalV = normalize(normalMatrix * n);
    vFold = o.z;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vViewPos = mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

export const clothFragment = /* glsl */ `
  uniform sampler2D uMap;
  // The texture's own UV transform: uploaded photos are ImageBitmaps, which can't be
  // flipped on upload, so image-texture.ts flips them via repeat/offset instead.
  uniform mat3 uMapTransform;
  uniform vec2 uScale;
  uniform float uWet;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vNormalV;
  varying vec3 vViewPos;
  varying float vFold;

  void main() {
    vec3 n = normalize(vNormalV);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(-vViewPos);
    vec2 mapUv = (uMapTransform * vec3(vUv, 1.0)).xy;
    vec3 base = texture2D(uMap, mapUv).rgb;

    // Warm key from the upper right, cool fill from the left (matches the room lights).
    vec3 keyDir = normalize(vec3(0.45, 0.6, 0.65));
    vec3 fillDir = normalize(vec3(-0.7, 0.2, 0.5));
    float key = max(dot(n, keyDir), 0.0);
    float fill = max(dot(n, fillDir), 0.0);
    // Soft, wrapped fabric lighting: folds read clearly without crushing the photo.
    // Balanced so a flat, front-facing patch shows the photo at about its true brightness.
    vec3 light = vec3(0.6) + vec3(1.0, 0.95, 0.88) * key * 0.6 + vec3(0.75, 0.85, 1.0) * fill * 0.1;
    // Fold shadows: valleys a touch darker.
    light *= 1.0 - clamp(-vFold * 5.0, 0.0, 0.2);
    if (!gl_FrontFacing) light *= 0.7;                         // back of the fabric

    // Woven threads: a faint over-under texture at roughly real-cloth density.
    vec2 w = vUv * uScale * 260.0;
    float weave = sin(w.x) * sin(w.y + step(0.0, sin(w.x * 0.5)) * 1.5708);
    light *= 1.0 + weave * 0.035;

    // Sewn hem with a dashed stitch line.
    vec2 edge = min(vUv, 1.0 - vUv) * uScale;
    float hemDist = min(edge.x, edge.y);
    float hem = smoothstep(0.022, 0.012, hemDist);
    light *= 1.0 - hem * 0.12;
    float stitchLine = smoothstep(0.004, 0.0, abs(hemDist - 0.03));
    float dash = step(0.5, fract((vUv.x * uScale.x + vUv.y * uScale.y) * 40.0));
    vec3 col = base * light;
    col = mix(col, vec3(0.96, 0.95, 0.9), stitchLine * dash * 0.35);

    // Fabric sheen at grazing angles.
    float rim = pow(1.0 - abs(dot(n, v)), 3.0);
    col += vec3(1.0, 0.97, 0.92) * rim * 0.12;

    // Fresh out of the wash: darker, with a damp highlight, drying from the top down.
    float front = 1.0 - uWet;
    float damp = smoothstep(front - 0.1, front + 0.2, 1.0 - vUv.y) * min(1.0, uWet * 3.0);
    col *= 1.0 - damp * 0.22;
    vec3 h = normalize(keyDir + v);
    col += vec3(1.0) * pow(max(dot(n, h), 0.0), 48.0) * damp * 0.5;
    // Drip bead along the bottom hem while damp.
    float drip = smoothstep(0.03, 0.0, vUv.y) * damp * (0.5 + 0.5 * sin(vUv.x * 60.0 + uTime * 2.0));
    col += vec3(0.7, 0.85, 1.0) * drip * 0.15;

    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;
