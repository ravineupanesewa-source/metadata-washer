/**
 * GLSL for the decontamination chamber. Plain strings compiled by
 * THREE.ShaderMaterial, so no build-time shader loader is needed.
 */

/* ---------------------------------------------------------------- glass -- */

/** Fresnel glass: transparent face-on, luminous at grazing angles and panel edges. */
export const glassVertex = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewDirV;
  varying vec2 vUv;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);   // view space
    vViewDirV = normalize(-mv.xyz);                // view space, surface -> camera
    vUv = uv;
    gl_Position = projectionMatrix * mv;
  }
`;

export const glassFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uEdgeColor;
  uniform float uOpacity;
  uniform float uFresnelPower;
  uniform float uGlow;
  uniform float uPulse;
  varying vec3 vNormalV;
  varying vec3 vViewDirV;
  varying vec2 vUv;
  void main() {
    vec3 n = normalize(vNormalV);
    if (!gl_FrontFacing) n = -n;                    // back faces of the open shell
    float facing = max(dot(n, normalize(vViewDirV)), 0.0);
    float fresnel = pow(1.0 - facing, uFresnelPower);

    // Bright rim along each panel's edges (reads as bevelled glass).
    vec2 e = min(vUv, 1.0 - vUv);
    float rim = 1.0 - smoothstep(0.0, 0.025, min(e.x, e.y));

    // Slow diagonal sheen; optional, scaled by uPulse.
    float sheen = smoothstep(0.08, 0.0, abs(fract((vUv.x + vUv.y) * 0.5 - uTime * 0.05) - 0.5)) * uPulse;

    float alpha = uOpacity + fresnel * uGlow + rim * 0.22 * uGlow + sheen * 0.06;
    gl_FragColor = vec4(uEdgeColor, clamp(alpha, 0.0, 0.6));
  }
`;

/* ----------------------------------------------------------------- beam -- */

/** Scan beam over the photo: bright core stripe, soft glow, faded ends, faint scanlines. */
export const beamVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const beamFragment = /* glsl */ `
  uniform float uTime;
  uniform float uScanProgress;   // 0 = top edge, 1 = bottom edge
  uniform float uBeamWidth;      // in UV units
  uniform float uBeamIntensity;
  uniform float uActive;         // 0..1 visibility
  uniform vec3 uColor;
  varying vec2 vUv;
  void main() {
    float lineY = 1.0 - uScanProgress;
    float d = abs(vUv.y - lineY);
    float core = exp(-pow(d / uBeamWidth, 2.0) * 2.0);
    float glow = exp(-d / (uBeamWidth * 7.0)) * 0.35;
    // Trailing field above the line (already scanned), very faint, with scanlines.
    float trail = smoothstep(0.0, 0.35, vUv.y - lineY) * (1.0 - smoothstep(0.35, 0.6, vUv.y - lineY));
    float lines = 0.5 + 0.5 * sin(vUv.y * 340.0 - uTime * 6.0);
    float field = trail * lines * 0.05;
    float ends = smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
    float a = (core + glow + field) * ends * uBeamIntensity * uActive;
    vec3 color = mix(uColor, vec3(1.0), core * 0.6);
    gl_FragColor = vec4(color, a);
  }
`;

/* ------------------------------------------------------------ particles -- */

/**
 * Metadata particles, animated entirely on the GPU. Each particle's position
 * is a pure function of uniforms + its attributes, so replay is deterministic.
 */
export const particleVertex = /* glsl */ `
  attribute vec2 aHome;      // -0.5..0.5 position on the photo (u, v; v down)
  attribute vec2 aDir;       // outward drift direction
  attribute vec4 aMotion;    // lift, wobble amplitude, frequency, phase
  attribute vec4 aTiming;    // emergeAt (s), purge delay (0..0.32), swirl, size
  uniform float uTime;
  uniform vec3 uPhoto;       // width, height, centre y
  uniform vec3 uCore;
  uniform float uRelease;    // release time (s), or -1 before the result arrives
  uniform float uPurge;      // 0..1 purge / dissipate progress
  uniform float uDissipate;  // 1 when nothing was found: fade instead of extract
  uniform float uFade;       // global fade (fault, clear)
  uniform float uRunMix;     // 0 idle motes .. 1 run choreography
  uniform float uDrag;       // 0..1 drag-over excitement (idle)
  uniform float uSizeScale;
  varying float vAlpha;
  varying float vHeat;

  vec3 drift(float t) {
    float age = max(0.0, t - aTiming.x);
    float e = 1.0 - pow(1.0 - clamp(age / 0.9, 0.0, 1.0), 3.0);
    float w = aMotion.y;
    float f = aMotion.z;
    float ph = aMotion.w;
    return vec3(
      aHome.x * uPhoto.x + aDir.x * 0.32 * e + sin(t * f + ph) * w,
      uPhoto.z - aHome.y * uPhoto.y + aDir.y * 0.22 * e + cos(t * f * 0.8 + ph) * w + min(age, 4.0) * 0.02,
      0.04 + aMotion.x * e + sin(t * f * 0.6 + ph) * w * 0.6
    );
  }

  void main() {
    float t = uTime;
    float age = t - aTiming.x;
    float size = aTiming.w;
    float alpha = clamp(age / 0.25, 0.0, 1.0) * step(0.0, age);
    float heat = size > 0.12 ? 0.8 : 0.3;
    vec3 p = drift(t);

    if (uRelease >= 0.0 && uDissipate < 0.5) {
      float s = clamp((uPurge - aTiming.y) / 0.5, 0.0, 1.0);
      if (s > 0.0) {
        vec3 p0 = drift(uRelease);
        vec3 ctrl = vec3(p0.x * 0.35 + aTiming.z, (p0.y + uCore.y) * 0.5 + 0.25, max(p0.z, uCore.z) + 0.55);
        float e = s * s * s;                       // accelerate into the core
        float a = 1.0 - e;
        p = a * a * p0 + 2.0 * a * e * ctrl + e * e * uCore;
        size *= 1.0 - 0.75 * e;
        heat = max(heat, e);
        alpha *= s > 0.9 ? (1.0 - s) / 0.1 : 1.0;
        if (age <= 0.0) alpha = sin(s * 3.14159) * 0.8;
      }
    } else if (uRelease >= 0.0) {
      float fade = 1.0 - pow(1.0 - uPurge, 3.0);   // nothing found: calm fade in place
      alpha *= 1.0 - fade;
      p.z += fade * 0.3;
      size *= 1.0 + fade * 0.4;
    }
    alpha *= uFade;

    // Idle motes: a slow halo around the chamber, excited by drag-over.
    float ph = aMotion.w;
    float r = 1.4 + aMotion.x * 1.4 - uDrag * 0.5;
    float ang = ph + t * (0.05 + aMotion.z * 0.04) * (1.0 + uDrag * 3.0);
    vec3 idle = vec3(cos(ang) * r, -0.6 + fract(aMotion.y * 37.0 + t * 0.03) * 2.6, sin(ang) * r * 0.45);
    float idleAlpha = (0.18 + uDrag * 0.5) * step(0.75, fract(aMotion.y * 91.0)); // ~25% of motes
    p = mix(idle, p, uRunMix);
    alpha = mix(idleAlpha, alpha, uRunMix);
    size = mix(0.05 + uDrag * 0.03, size, uRunMix);

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = size * uSizeScale / max(0.1, -mv.z);
    vAlpha = alpha * 0.9;
    vHeat = heat;
  }
`;

export const particleFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vHeat;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5 || vAlpha <= 0.001) discard;
    float glow = smoothstep(0.5, 0.0, d);
    float center = smoothstep(0.18, 0.0, d);
    vec3 color = mix(uColor, vec3(1.0), center * (0.45 + vHeat * 0.55));
    gl_FragColor = vec4(color, vAlpha * glow);
  }
`;

/* ---------------------------------------------------------------- floor -- */

/** Holographic platform markings: rings, radial ticks, faint grid, travelling highlight. */
export const floorVertex = beamVertex;

export const floorFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;   // overall brightness 0..1
  uniform float uSweep;       // 0..1 strength of the rotating highlight
  uniform float uRings;       // number of concentric rings
  varying vec2 vUv;
  const float PI = 3.14159265;

  float band(float x, float w) { return 1.0 - smoothstep(0.0, w, abs(x)); }

  void main() {
    vec2 p = vUv * 2.0 - 1.0;              // -1..1 across the disc
    float r = length(p);
    if (r > 1.0) discard;
    float angle = atan(p.y, p.x);

    // Concentric rings, thinner towards the centre.
    float ringPos = r * uRings;
    float rings = band(fract(ringPos) - 0.5, 0.02 + 0.01 * r) * step(0.25, r);
    float outer = band(r - 0.94, 0.006) * 1.6;

    // Radial ticks on the outer band; every sixth tick is longer.
    float tickIdx = angle / (2.0 * PI) * 72.0;
    float tick = band(fract(tickIdx) - 0.5, 0.06);
    float longTick = step(0.5, 1.0 - abs(mod(floor(tickIdx + 0.5), 6.0)));
    float ticks = tick * step(0.86 - longTick * 0.05, r) * step(r, 0.92);

    // Faint grid inside the chamber footprint.
    vec2 g = abs(fract(p * 7.0) - 0.5);
    float grid = (band(g.x, 0.02) + band(g.y, 0.02)) * 0.12 * (1.0 - smoothstep(0.55, 0.8, r));

    // Highlight travelling around the rings while the chamber works.
    float sweepAngle = mod(uTime * 0.9, 2.0 * PI) - PI;
    float da = abs(mod(angle - sweepAngle + PI, 2.0 * PI) - PI);
    float sweep = exp(-da * 3.0) * uSweep * (rings + outer + ticks + 0.12 * step(0.3, r));

    float glow = (1.0 - smoothstep(0.0, 1.0, r)) * 0.08;
    float a = (rings * 0.55 + outer + ticks * 0.7 + grid + glow + sweep * 1.4) * uIntensity;
    gl_FragColor = vec4(uColor, a);
  }
`;
