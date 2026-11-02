/**
 * GLSL for the landing hero. Plain strings for THREE.ShaderMaterial.
 * Colours arrive as linear THREE.Color uniforms; the colorspace include
 * converts the result for display, matching built-in materials.
 */

const noise = /* glsl */ `
  float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return v; }
`;

/* ------------------------------------------------------------ light rays -- */

/** Full-screen quad: positions are already in clip space. */
export const raysVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.9999, 1.0);
  }
`;

export const raysFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uFocus;        // mascot position in UV space
  uniform vec3 uColor;        // lime
  uniform vec3 uDeep;         // background tint
  uniform float uIntensity;
  varying vec2 vUv;
  ${noise}

  // Soft beam through 'origin' at 'angle'; returns intensity, writes 'along' for streaks.
  float beam(vec2 p, vec2 origin, float angle, float width, out float along) {
    vec2 d = vec2(cos(angle), sin(angle));
    vec2 n = vec2(-d.y, d.x);
    vec2 q = p - origin;
    along = dot(q, d);
    float dist = dot(q, n);
    float core = exp(-pow(dist / width, 2.0));
    float halo = exp(-abs(dist) / (width * 2.5)) * 0.07;
    // Brightest near the mascot, fading towards the edges of the frame.
    return (core + halo) * (0.15 + 0.85 * exp(-abs(along) * 1.1));
  }

  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    vec2 f = (uFocus - 0.5) * vec2(uAspect, 1.0);
    float t = uTime;

    // Narrow (portrait) screens: the beams cover far more of the frame, so slim and dim them.
    float wide = smoothstep(0.45, 1.2, uAspect);
    float w = mix(0.55, 1.0, wide);
    float a1; float a2; float a3;
    float b1 = beam(p, f + vec2(0.0, 0.02), 0.34 + 0.015 * sin(t * 0.3), 0.022 * w, a1);
    float b2 = beam(p, f + vec2(0.0, -0.03), -0.27 + 0.015 * cos(t * 0.25), 0.018 * w, a2);
    float b3 = beam(p, vec2(0.0, f.y - 0.5), 0.05, 0.05, a3);

    // Light flowing along each beam.
    float s1 = 0.6 + 0.6 * fbm(vec2(a1 * 3.0 - t * 0.35, 1.7));
    float s2 = 0.6 + 0.6 * fbm(vec2(a2 * 3.0 + t * 0.3, 5.1));
    float s3 = 0.5 + 0.5 * fbm(vec2(a3 * 2.0 - t * 0.2, 9.3));

    float light = (b1 * s1 + b2 * s2 * 0.85 + b3 * s3 * 0.18) * mix(0.55, 1.0, wide);
    // Gaussian, not exponential: bright around the mascot, ~0 a short way off at any aspect ratio.
    float gl = length((p - f) * vec2(1.0, 1.2));
    float glow = exp(-pow(gl / 0.13, 2.0)) * 0.38 + exp(-pow(gl / 0.3, 2.0)) * 0.05;
    float haze = fbm(p * 2.5 + vec2(t * 0.02, -t * 0.015)) * 0.03 * exp(-length(p - f) * 3.0);

    vec3 col = uDeep;
    col += uColor * (light + glow + haze) * uIntensity;
    col += vec3(1.0, 1.0, 0.85) * pow(max(b1 * s1, b2 * s2) * 0.6, 4.0) * uIntensity; // hot cores

    // Sparse glitter riding the beams: round points, not cells.
    vec2 g = p * 70.0 + vec2(0.0, t * 1.5);
    vec2 cell = floor(g);
    vec2 star = cell + 0.2 + 0.6 * vec2(hash(cell + 1.3), hash(cell + 7.7));
    float on = step(0.93, hash(cell)) * (0.5 + 0.5 * sin(t * 4.0 + hash(cell + 3.1) * 6.28));
    col += uColor * on * exp(-dot(g - star, g - star) * 18.0) * (b1 + b2) * 1.5;

    // Vignette.
    col *= 1.0 - smoothstep(0.45, 1.1, length(p * vec2(0.75, 1.1)));
    col = 1.0 - exp(-col * 1.2);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ----------------------------------------------------------------- jelly -- */

export const jellyVertex = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying vec3 vLocal;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormalV = normalize(normalMatrix * normal);
    vViewV = normalize(-mv.xyz);
    vLocal = position;
    gl_Position = projectionMatrix * mv;
  }
`;

export const jellyFragment = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;     // bright lime
  uniform vec3 uDeep;      // deep green core
  uniform vec3 uRim;       // pale lime rim
  uniform vec3 uKey;       // key light direction (view space)
  uniform vec3 uFill;      // fill light direction (view space)
  varying vec3 vNormalV;
  varying vec3 vViewV;
  varying vec3 vLocal;
  ${noise}

  void main() {
    vec3 n = normalize(vNormalV);
    vec3 v = normalize(vViewV);
    float ndv = max(dot(n, v), 0.0);
    float fresnel = pow(1.0 - ndv, 2.3);

    // Body: denser and deeper in the middle, lighter where light scatters out near the edges.
    float up = n.y * 0.5 + 0.5;
    vec3 body = mix(uDeep, uColor, 0.32 + 0.48 * up);
    body = mix(body, uColor * 1.25, fresnel * 0.55);
    // Fake subsurface: light from behind glows through the thin edges.
    body += uColor * pow(1.0 - ndv, 1.4) * 0.35;
    // Slow internal density variation.
    float density = fbm(vLocal.xy * 2.4 + vec2(vLocal.z, uTime * 0.08));
    body *= 0.9 + 0.18 * density;

    // Specular: a sharp key highlight plus a soft sheen and a fill glint.
    vec3 h1 = normalize(uKey + v);
    vec3 h2 = normalize(uFill + v);
    float spec = pow(max(dot(n, h1), 0.0), 160.0) * 1.8 + pow(max(dot(n, h1), 0.0), 18.0) * 0.12;
    spec += pow(max(dot(n, h2), 0.0), 70.0) * 0.55;

    // Environment band reflected along the top of the bean.
    vec3 r = reflect(-v, n);
    float env = smoothstep(0.35, 0.85, r.y) * 0.22 * (0.4 + fresnel);

    vec3 col = body + uRim * fresnel * 0.85 + vec3(spec) + vec3(env);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

/* ----------------------------------------------------------------- motes -- */

export const motesVertex = /* glsl */ `
  attribute vec4 aSeed;   // radius, phase, speed, tilt
  uniform float uTime;
  uniform float uSize;
  varying float vAlpha;
  void main() {
    // Each mote spirals inwards over its life and is "absorbed", then respawns.
    float life = fract(uTime * aSeed.z * 0.08 + aSeed.y * 0.159);
    float r = aSeed.x * (1.0 - 0.85 * life * life);
    float ang = aSeed.y + uTime * aSeed.z * 0.6 + life * 4.0;
    vec3 p = vec3(cos(ang) * r, sin(ang) * r * 0.38 + aSeed.w * (1.0 - life) * 0.6, sin(ang) * r * 0.6);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.6 + aSeed.z * 0.4) * (1.0 - life * 0.7) / max(0.1, -mv.z);
    vAlpha = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.85, 1.0, life));
  }
`;

export const motesFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, d);
    vec3 col = mix(uColor, vec3(1.0), smoothstep(0.2, 0.0, d));
    gl_FragColor = vec4(col, glow * vAlpha);
    #include <colorspace_fragment>
  }
`;
