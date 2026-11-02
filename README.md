# CleanFrame

CleanFrame is a web app for removing privacy-sensitive metadata from images. It handles GPS location, camera and lens serial numbers, capture times, authors, captions, editing history and embedded thumbnails. It **does not recompress or resize** the image.

Every output file is re-read and verified before it is offered for download. If verification fails, the user gets no file and a clear explanation.

- **Stack:** Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui, three.js + React Three Fiber, Zod, ExifTool (via `exiftool-vendored`), Vitest, React Testing Library, Playwright.
- **Runtime:** Node.js 24 LTS (`>= 22.12`), Perl 5 (ExifTool is a Perl program), optional `jpegtran`.
- Implementation plan and sprint log: [`IMPLEMENTATION_PLAN.md`](./IMPLEMENTATION_PLAN.md). Original brief: [`ProjectDocumentation.md`](./ProjectDocumentation.md).

---

## What it guarantees, and what it does not

**It guarantees that:**
- the format is detected from file bytes, never from the filename or MIME type;
- metadata is removed by rewriting metadata containers only. Image data is not decoded or re-encoded unless you explicitly allow re-encoding for orientation;
- after processing, the output is read again independently. A file is marked **"Cleaned and verified"** only if all of these hold:
  - every targeted metadata category is gone;
  - format, dimensions and frame count are unchanged;
  - the image-data hash is identical (ExifTool `ImageDataHash`, or a GIF render-block hash).
- if a check cannot be performed, the status is **"partly verified"**, never "verified". If a check fails, no file is returned;
- "no metadata detected", "metadata removed" and "could not be verified" are always reported as distinct states.

**It does not guarantee:**
- removal of information that is part of the picture itself (visible content, watermarks, steganography);
- removal of fields that ExifTool cannot identify. Unknown proprietary blobs inside a format may survive. They would show up as "other", fail verification, and produce no file;
- secure erasure. Temporary files are deleted by the application right after processing, but this does not physically wipe disk blocks.

## Supported formats

All results below are verified with ExifTool 13.59 against the generated fixtures in `tests/fixtures`. The single source of truth is [`src/lib/image/capabilities.ts`](src/lib/image/capabilities.ts).

| Format | Lossless strip | ICC kept (privacy mode) | Pixel proof | Notes |
| --- | --- | --- | --- | --- |
| JPEG | ✅ | ✅ | `ImageDataHash` identical | EXIF, GPS, MakerNotes, IFD1 thumbnail, IPTC, XMP, COM comments, Photoshop IRB |
| PNG | ✅ | ✅ (plus gAMA/sRGB/cHRM) | `ImageDataHash` | tEXt/iTXt/zTXt, eXIf, XMP |
| WebP (still and animated) | ✅ | ✅ | `ImageDataHash` | EXIF/XMP chunks |
| TIFF | ✅ | ✅ | `ImageDataHash` | IFD0 can't be deleted as a whole, so descriptive IFD0 tags (Make, Model, Artist…) are removed one by one and re-verified |
| AVIF | ✅ | ✅ | `ImageDataHash` | Rotation lives in the container (`irot`) and is untouched |
| HEIC / HEIF | ✅ (same ExifTool path as AVIF) | ✅ | `ImageDataHash` | ⚠ No HEVC encoder was available to build a local fixture. Every file is still verified at runtime, and the report says so |
| GIF (incl. animated) | ✅ | n/a | GIF render-block hash | Every frame, delay, loop count and transparency setting is preserved and verified |
| SVG, BMP, PDF, JPEG XL, BigTIFF, video | ❌ rejected | | | SVG can contain active content and is deliberately excluded |

## Metadata modes

| | **Privacy** (default) | **Strict** |
| --- | --- | --- |
| EXIF, GPS, MakerNotes, thumbnails, IPTC, XMP, comments, text chunks | removed | removed |
| ICC colour profile | **kept**, so colours render identically (reported as "kept on purpose") | removed. Colours may shift in colour-managed apps |
| EXIF `Orientation` (only when ≠ 1) | kept, so the photo stays upright | see below |

An ICC profile describes a colour space, not a person, but it *is* metadata. Privacy mode therefore never claims that "all metadata" was removed.

### Orientation and quality

Many phone photos are stored sideways and rely on the EXIF `Orientation` flag. Removing that flag without rotating the pixels would show the photo sideways. In strict mode you choose:

- **Keep the orientation flag** (default): lossless. One non-identifying tag remains and is reported.
- **Rotate losslessly or skip:** uses `jpegtran -perfect` for JPEG. If `jpegtran` is not installed, or the image dimensions are not aligned to JPEG blocks, the file **fails safely** (`ORIENTATION_UNSAFE`).
- **Allow re-encoding:** explicit opt-in. Sharp rotates the pixels and re-saves the image (JPEG q95 4:4:4, PNG lossless, WebP q95, TIFF LZW). The report marks `pixelData.reencoded: true`.

Without your explicit opt-in, CleanFrame never re-encodes.

## Visual design and 3D

**Night & lime.** Dark is the default theme: near-black surfaces with an electric lime accent (`--lime: #c6f432`), modelled on a dark neon reference design. Light mode remains available and keeps the mint palette. The hero, carousel, footer and chamber interior are always dark showcase surfaces.

### Landing page (`src/features/landing/`)
| Section | What it is |
| --- | --- |
| Hero (`hero.tsx`, `hero-scene.tsx`) | A **procedural 3D mascot**, a glossy lime jelly bean with a face, in React Three Fiber. Its custom jelly shader combines depth gradient, Fresnel rim, fake subsurface glow, two specular highlights, an environment band and slow internal density. The face is raycast onto the sculpted surface. It follows the cursor, blinks and breathes. Behind it, a full-screen **light-ray shader** draws crossing lime beams with flowing streaks, a Gaussian core glow, point glitter and a vignette; beams are slimmer and dimmer on portrait screens. Orbiting "metadata" motes spiral in and are absorbed |
| Hero pill | A glass "drop a photo" pill. Clicking it opens the **real** file picker; dropping files adds them to the **real** queue (via `image-sanitizer/intake.ts`, a same-document event channel). The header's lime **Clean a photo** button does the same |
| Carousel (`feature-carousel.tsx`, `card-art.ts`) | Five glass cards (Drop, Inspect, Scrub, Verify, Download) with **shader-generated art**: violet aurora arc, flame ribbons, leaf with veins and water droplets, light wave, rim-lit orb. **One shared offscreen WebGL2 context** paints all cards and copies the pixels into each card's 2D canvas. Only the active, visible card animates (~30 fps). Accessible as a carousel: named slides, Previous/Next buttons, arrow keys and a live status |
| Footer (`site-footer.tsx`) | A giant outline **CleanFrame** wordmark (SVG, lime→violet gradient stroke, always fits its width) over a violet light sweep, plus footer links and the "How it works & guarantees" dialog |

**No downloaded 3D models.** Sketchfab downloads need an account and API token, licences vary (CC-BY attribution, non-commercial clauses), and the CSP blocks third-party loading, so a model would have to be bundled. The mascot is built from code instead: no licence obligations and zero asset weight.

**Performance budget** (`src/lib/perf/perf-tier.ts`):
- One app-wide probe measures the frame rate once: a 1 s warm-up, then 2 s of frames. Its result is mirrored to `<html data-perf>`.
- `high` (≥ 40 fps): effects animate.
- `low` (slow GPU, software rendering, or reduced motion): the hero, card art and chamber idle each render one settled frame.
- Off-screen sections never render.
- The essential cleaning animation never depends on the probe.
- three.js and React Three Fiber stay code-split, not in the initial page load (verified).

> Replaced: the React Bits **LaserFlow** beam from the previous iteration was removed. This design's hero light rays take its place, and having two full-screen WebGL effects measurably starved slower devices.

### The chamber is the upload surface
The stage (`decontamination/chamber-stage.tsx`) is the drop target. It holds the 3D chamber, the status line read by screen readers, and the primary action:

| Mode | What happens |
| --- | --- |
| idle | A procedural sample photo floats in the chamber with gentle motion at 24 fps. Instructions and **Choose files** are overlaid |
| drag | The front glass pane lifts, the enclosure opens slightly, the edge strips and floor brighten, and particles swirl. The border highlights |
| ready | Your actual photo appears in the chamber, upright (EXIF-rotated), with its aspect ratio kept |
| run | The full 4.5 s decontamination sequence, driven by the real request (see the timeline below) |
| finished | The chamber holds its final pose; the result panel shows the real cleaned preview and download |

### Timeline (unchanged, tested)
| Time | Phase |
| --- | --- |
| 0–0.6 s | materialize: photo rises into position, strips light in sequence, floor glows, camera settles |
| 0.6–1.4 s | activate: four gantry arms start moving together, traces run up the pillars, core lights |
| 1.4–2.5 s | scan: the shader beam sweeps the photo; particles emerge where it passes |
| (waiting) | awaiting: restrained scan loop **only while the server is still working**. The purge never starts before the real result |
| +1.3 s | purge: particles accelerate into the core, which compresses and vanishes with a small shockwave |
| +0.7 s | clear: arms return to rest, mint lighting, shield outline around the photo |

**Outcomes come from real results:**
- **No metadata found:** a calm "dissipate" instead of a purge.
- **Failure:** an immediate red fault, with Retry.
- **Cancel** stops the run at once.
- **"Show results"** reveals results as soon as they exist, without waiting for the animation to finish.

### React Three Fiber + custom GLSL
- **React Three Fiber 9.8.1.** It supports React `>=19 <19.4` (the app has 19.3.0) and three `>=0.156` (the app has 0.186.1). I pinned 9.8.1 rather than 9.8.2, which was exactly two weeks old at the time.
- **Structure:**
  - React declares the scene (`chamber-scene.tsx`). All motion runs in `useFrame` through refs and shader uniforms.
  - A single driver samples the run's timeline once per frame, so nothing calls `setState` per frame.
  - The canvas (`chamber-canvas.tsx`) is loaded with `next/dynamic({ ssr: false })` and is code-split. Its ~945 KB chunk isn't part of the initial page load (verified).
- **Shaders** (`shaders.ts`, compiled by `THREE.ShaderMaterial`, so no build-time loader is needed):
  - **Fresnel glass:** `pow(1 - max(dot(N, V), 0), uFresnelPower)` computed in view space, with back faces flipped. It adds panel-edge rims and an optional slow sheen. Uniforms: `uTime`, `uEdgeColor`, `uOpacity`, `uFresnelPower`, `uGlow`, `uPulse`. The panes are almost invisible face-on, so the photo stays clear.
  - **Scan beam:** `uTime`, `uScanProgress`, `uBeamWidth`, `uBeamIntensity`, `uActive`. It draws a Gaussian core stripe, an exponential glow, faded ends and faint trailing scanlines.
  - **Particles:** the whole trajectory runs on the GPU. Each particle carries per-particle attributes (home position on the photo, drift direction, motion, emergence time, purge delay, size). The shader computes drift, a quadratic Bézier into the core, accelerating ease-in, shrinking and fading. It's deterministic (seeded), so replays are identical. Idle motes and the drag swirl use the same buffer.
  - **Floor markings:** a procedural shader for concentric rings, 72 radial ticks (every sixth long), a faint grid and a highlight that travels around while the chamber works.
- **No Drei.** The only helper worth using was an adaptive performance monitor, so I wrote a 20-line one instead: if the frame rate stays under 40 fps while animating, it drops the pixel ratio to 1.
- **The optional extraction distortion wasn't built.** A real distortion needs a screen-space render pass, which costs too much for a restrained effect. The core's compress-and-shockwave covers the payoff instead.

### Performance, fallbacks, accessibility
- **Rendering policy:**
  - run or drag: every frame;
  - idle or ready: 24 fps;
  - reduced motion: a single static frame;
  - finished: renders briefly to settle, then stops;
  - off-screen: nothing.
- **Pixel ratio:** capped at 2× (1.5× on compact and reduced tiers).
- **Quality tiers:** full (240 particles), compact for stages under 560 px wide (120 particles, no traces), and reduced (40 particles, half-length timeline, no arm travel or camera motion, a softer pulse).
- **Resource handling:** every geometry, material and texture is disposed on change or unmount. Each photo is decoded once (`createImageBitmap`, capped at 1024 px) and its ImageBitmap is closed.
- **Fallback:** if WebGL is missing, fails to initialise (caught by an error boundary) or loses its context, the CSS chamber takes over with the same states.
- **Accessibility:**
  - The status line is a polite live region with a few announcements per run, never one per frame.
  - Icons are always paired with text.
  - Focus moves to Cancel, then "Show results", then the result heading.
  - Canvases are `aria-hidden`, can't be focused and ignore pointer events.
  - While a run is in progress the stage uses `noDrag` rather than react-dropzone's `disabled`. `disabled` sets `aria-disabled` on the whole stage, which would announce Cancel as disabled.

## Architecture

```
src/
├── app/
│   ├── page.tsx, layout.tsx, error.tsx   UI shell (server components)
│   └── api/
│       ├── sanitize/route.ts             POST raw bytes → cleaned bytes + report header
│       ├── inspect/route.ts              POST raw bytes → categories (values only if reveal=1)
│       └── health/route.ts               GET → ExifTool availability
├── components/{layout,ui}/               header, dialogs, shadcn/ui primitives
├── features/image-sanitizer/
│   ├── components/                       dropzone, queue rows, settings, report/inspect dialogs, summary
│   ├── engine/                           SanitizerEngine interface + HTTP implementation
│   ├── hooks/                            queue reducer + bounded-concurrency queue hook
│   ├── schemas/api.ts                    Zod schemas for query params, reports, errors
│   ├── strings.ts                        all user-facing copy (i18n-ready)
│   └── utils/                            formatting, ZIP builder
└── lib/
    ├── config/                           Zod-validated server config, public limits
    ├── files/                            filename sanitising, Content-Disposition, temp workspaces
    ├── image/                            the processing engine (below)
    ├── security/errors.ts                error codes → fixed safe messages
    └── server/                           semaphore, limited body reader, HTTP helpers
```

**Processing pipeline** (`src/lib/image/sanitize.ts`):

1. `assertProcessable`: checks the size, rejects empty files, and detects the format from the file signature (`signature.ts`).
2. Writes the upload to a private `mkdtemp` workspace (mode 0700) under a fixed name. User filenames never touch the disk.
3. `readMetadata` (ExifTool `-j -G0:1 -n` plus `ImageDataHash`) and `classify.ts` map every tag to a category or to "structural".
4. Malformed or truncated files are rejected (`MALFORMED_IMAGE`).
5. `decideOrientation` (pure function) returns keep the tag, lossless transform, re-encode (opt-in), or reject.
6. `buildStripArgs` runs `exiftool -all= [-tagsFromFile @ -ICC_Profile -EXIF:Orientation] -o output input`. The input is never modified in place. For TIFF, residual IFD0 tags get a second deletion pass.
7. The output is re-read and passed to `verifyOutput` (pure function), which checks format, dimensions, frames, the pixel hash, and that only allowed categories remain.
8. `buildReport` produces a value-free report. The workspace is deleted in `finally`, on both success and failure.

**API design decision:** the client sends the **raw file bytes** (`application/octet-stream`), with options in a Zod-validated query string, instead of multipart form data. This means:
- there is one upload per file and no base64;
- the size limit is enforced while streaming (`readLimitedBody`), and before reading at all when `Content-Length` is present;
- there is no multipart parser to attack.

The cleaned file comes back as the response body. The report (categories only, no values) comes back in the `X-CleanFrame-Report` header as base64url-encoded JSON. The client validates that header with Zod before trusting it.

**Swappable engine:** the UI only talks to the `SanitizerEngine` interface (`features/image-sanitizer/engine/types.ts`). A future in-browser (WASM) engine can replace `createHttpEngine()` without any UI changes. The component tests already inject a fake engine.

## Getting started

```bash
nvm use            # Node 24 (see .nvmrc)
npm ci
npm run fixtures   # (re)generates tests/fixtures with real metadata
npm run dev        # http://localhost:3000
```

Perl 5 must be on `PATH`. It is preinstalled on most Linux and macOS systems. On Windows, `exiftool-vendored` ships its own `exiftool.exe`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (`output: "standalone"`) |
| `npm start` | `next start` (or `node .next/standalone/server.js`, see below) |
| `npm run lint` | ESLint (Next.js core-web-vitals + TypeScript rules) |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm test` | Unit and component tests (Vitest, jsdom for components) |
| `npm run test:integration` | Real ExifTool runs against the fixtures, plus API route and security tests |
| `npm run test:all` | Both Vitest projects |
| `npm run test:e2e` | Playwright against the production standalone build (run `npm run build` first) |
| `npm run fixtures` | Regenerate the test fixtures |

Playwright needs a browser: `npx playwright install --with-deps chromium`. Without root access, see [Troubleshooting](#troubleshooting).

## Configuration

Every variable is optional and validated with Zod at startup. An invalid value stops the server with a clear message. See [`.env.example`](./.env.example).

| Variable | Default | Meaning |
| --- | --- | --- |
| `CLEANFRAME_MAX_FILE_SIZE_MB` | `25` | Per-file size limit, enforced on the server while streaming |
| `CLEANFRAME_MAX_FILES_PER_BATCH` | `20` | Files the UI accepts per batch |
| `CLEANFRAME_PROCESSING_CONCURRENCY` | `2` | Images processed in parallel, which is also the ExifTool process pool size. The UI uses `min(this, 3)` parallel uploads |
| `CLEANFRAME_MAX_QUEUED_REQUESTS` | `20` | Requests waiting for a slot. Beyond this the server returns `503 BUSY` |
| `CLEANFRAME_PROCESSING_TIMEOUT_MS` | `60000` | Timeout per ExifTool and jpegtran step |
| `CLEANFRAME_TEMP_DIR` | OS temp dir | Absolute path for per-request private workspaces |
| `CLEANFRAME_JPEGTRAN_PATH` | auto-detect | Absolute path to `jpegtran` |

The home page is prerendered at build time, so the limits shown in the UI are the ones present during `next build`. The server always enforces its **runtime** values. If you change limits, rebuild so the UI copy matches.

**Memory:** each in-flight request holds the upload (up to `MAX_FILE_SIZE`) plus the output in memory, so peak usage is roughly `concurrency × 2 × max size`, plus about 30 MB per ExifTool process. Opt-in re-encoding decodes the full image (about `width × height × 4` bytes). Size your container for that.

## Deployment

**Supported:** any long-running Node.js 24 host or container with Perl. A production-ready [`Dockerfile`](./Dockerfile) is included. It installs Perl and `jpegtran`, runs as a non-root user, uses a private temp dir, and has a health check.

```bash
docker build -t cleanframe .
docker run -p 3000:3000 --read-only --tmpfs /tmp:rw,mode=1777 -e CLEANFRAME_TEMP_DIR=/tmp cleanframe
```

Without Docker:

```bash
npm ci && npm run build
cp -r public .next/standalone/ && cp -r .next/static .next/standalone/.next/
PORT=3000 node .next/standalone/server.js
```

**Before using a serverless or edge platform, check:**
- the Perl binary is available. ExifTool cannot run in the Edge runtime, and many serverless images lack Perl;
- the request body limit is large enough (several platforms cap bodies at about 4.5 MB);
- the function timeout and memory fit your file sizes;
- a writable temp directory exists.

Do not assume CleanFrame works on every serverless platform. Use the container if in doubt.

**Reverse proxy:** set a body size limit matching `CLEANFRAME_MAX_FILE_SIZE_MB` (for example nginx `client_max_body_size 26m;`), keep request buffering limits sane, and terminate TLS there. The application enforces its own limits as well.

## Privacy and security

- No accounts, analytics, tracking, ads or third-party requests. The CSP is `connect-src 'self'` and `img-src 'self' blob: data:`.
- Nothing uploads until the user presses "Remove metadata". The E2E tests check this.
- No database and no image persistence. Each request gets a `mkdtemp` folder (0700), removed in `finally` on both success and failure. Tests cover leaks on both paths.
- Logs never contain file contents, metadata values, filenames or paths. The only log line is the error code and the error class name on `PROCESSING_FAILED`.
- Error responses contain a fixed message per error code: no stack traces, tool output or paths.
- ExifTool runs in `-stay_open` mode over stdin, one argument per line, so no shell is involved. Its arguments are server-chosen paths and constant flags. Residual TIFF tag names are validated against a strict pattern. `jpegtran` runs via `execFile` (no shell) with a timeout.
- Download headers: `Content-Disposition` uses RFC 6266/5987 encoding. The filename is built from the *detected* format, so CR/LF and quote injection are impossible (unit-tested).
- Untrusted strings (filenames, metadata values) are rendered as React text, never HTML. An E2E test uploads `<img onerror>` as a filename.
- Security headers on every response: CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, Permissions-Policy and COOP. API responses also send `Cache-Control: no-store`.
- Bounded resources: a server-wide semaphore with a bounded queue (`503 BUSY` when full), streaming size limits, per-step timeouts, and bounded client concurrency.
- Exact GPS values and serial numbers are only displayed when the user turns on **Show values** in the inspect dialog.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `/api/health` returns `{ ok: false }` | Perl is missing or can't start ExifTool. Run `perl -v`. On Linux, check that `node_modules/exiftool-vendored.pl/bin/exiftool` exists |
| Strict mode + "Rotate losslessly" always fails | `jpegtran` is not installed. Install `libjpeg-turbo-progs` (Debian/Ubuntu) or `jpeg-turbo` (Homebrew), or set `CLEANFRAME_JPEGTRAN_PATH` |
| `413` for a file under the limit | A reverse proxy limit is lower than `CLEANFRAME_MAX_FILE_SIZE_MB` |
| `503 BUSY` | Raise `CLEANFRAME_MAX_QUEUED_REQUESTS` or the concurrency (watch memory) |
| HEIC files show "partly verified" | The installed ExifTool cannot hash that HEIC variant. Metadata removal was still verified |
| Playwright: `libnspr4.so: cannot open shared object file` and no root access | `apt-get download libnspr4 libnss3 libasound2t64`, extract each with `dpkg-deb -x <deb> ~/pw-libs`, then run with `LD_LIBRARY_PATH=~/pw-libs/usr/lib/x86_64-linux-gnu npm run test:e2e` |
| `npm install` fails with `Cannot read properties of null (reading 'edgesOut')` | You're on Node 20. Vitest 5 needs Node ≥ 22.12. Run `nvm use` |

## Tests

- **Unit:** signature detection, filename sanitising and header-injection safety, config validation, error mapping, tag classification, orientation decisions, strip-argument building, verification logic, GIF hashing, temp-workspace cleanup, semaphore, queue reducer, ZIP building, and the React components (with a fake engine).
- **Integration (real ExifTool and real fixtures):**
  - per-format privacy and strict mode, with independent re-reads of the output and a byte-level search for secret strings;
  - ICC handling, orientation policies, animated GIF frames, images without metadata;
  - truncated, spoofed, empty, SVG, BMP and oversized files;
  - temp-file leak checks;
  - API routes: status codes, headers, Zod validation, MIME spoofing, oversized streamed and declared bodies, multipart rejection, no internal details in errors.
- **E2E (Playwright, production build):** `landing.spec.ts` covers:
  - the hero scene rendering with no shader errors;
  - the hero pill and header CTA opening the real file picker, and a drop on the pill reaching the real queue;
  - the carousel's buttons, arrow keys (with wrap-around) and live status;
  - shader card art being present;
  - the footer wordmark and guarantees dialog;
  - full CSS fallbacks without WebGL, with the cleaning workflow still working.

  Functional specs run with reduced motion. `animation.spec.ts` runs the chamber with motion on and checks:
  - that the idle chamber renders with WebGL and every shader compiles (no WebGL or shader console errors);
  - the drag-over response;
  - the phase order, and a 4–7 s duration on a fast server;
  - that it holds in `awaiting` while the server is slow and never purges early;
  - the no-metadata, error-with-retry and cancel paths;
  - that a second run starts fresh;
  - the CSS fallback when WebGL is denied;
  - reduced motion, and the mobile layout without overflow.

  Other specs cover: upload, clean and download; no upload before start; unsupported files; report dialog; inspect with reveal; mixed batch with ZIP contents; server-error retry; remove/clear; strict mode; XSS via filename; keyboard-only flow; theme toggle; mobile layout.
