# CleanFrame — Implementation Plan

Source requirements: [`ProjectDocumentation.md`](./ProjectDocumentation.md).
This file is the working plan. Sprint checkboxes are updated as work lands.

## 0. Environment findings (Sprint 0 inspection, 2026-10-28)

| Item | Finding | Consequence |
| --- | --- | --- |
| Repository | Empty apart from `ProjectDocumentation.md`; not a git repo | Greenfield scaffold |
| Node.js | v20.19.5 found (EOL since 2026-04-30); Vitest 5 needs >= 22.12 | Installed Node 24.22.1 LTS via nvm; `.nvmrc` = 24, `engines.node >= 22.12` |
| Next.js | 16.4.3 latest stable | Use App Router, Node runtime for API routes |
| ExifTool | Not installed system-wide; Perl 5.38 available | Use `exiftool-vendored` (bundles ExifTool, runs via system Perl on Linux) |
| jpegtran | Not installed; no sudo | Lossless JPEG rotation is optional/runtime-detected (see §4); included in Dockerfile |
| Playwright libs | libnspr4/libnss3/libasound missing; no sudo | Extracted .debs locally + `LD_LIBRARY_PATH` (README → Troubleshooting) |
| Memory | ~7.6 GB total, frequently < 1.5 GB free | Low default concurrency (2), strict size limits, avoid duplicate buffers |

## 1. Key architectural decisions

1. **ExifTool is the only default sanitizer.** It rewrites metadata containers without
   decoding pixel data, so image payloads are byte-identical. Sharp is *not* a dependency of the
   default path.
2. **Single upload per file.** `POST /api/sanitize` accepts one file and returns the sanitized
   bytes as the raw response body (no base64 bloat, no server-side storage for a later
   download). The small, non-sensitive report travels in the `X-CleanFrame-Report` response
   header as base64url-encoded JSON. Before-processing categories come from the same request,
   so the file is uploaded once. `POST /api/inspect` exists only for the optional
   "view metadata values" panel and returns category summaries (values only when `reveal=true`).
3. **Server-side processing is disclosed.** The UI states images are uploaded to this server,
   processed in a private temp dir, and deleted in `finally`. The UI talks to a
   `SanitizerEngine` interface so a future client-side (WASM) engine can be swapped in.
4. **Format-capability registry** (`src/lib/image/capabilities.ts`) is the single source of
   truth used by API validation, UI copy and tests.
5. **Signature-based detection** (own magic-byte sniffer, unit-tested) — never trust the
   extension or the MIME type.
6. **Verification is independent**: the output file is re-read by ExifTool and categorized
   again; any targeted category still present ⇒ verification `failed` ⇒ no "sanitized" status,
   no download offered as clean.

## 2. Metadata modes

| Mode | Removes | Keeps | Notes |
| --- | --- | --- | --- |
| `privacy` (default) | EXIF (all incl. GPS, MakerNotes, thumbnails), IPTC, XMP, comments, PNG text, Photoshop IRB, etc. | ICC profile; EXIF `Orientation` only when the image needs it to display upright | Kept items are reported as *intentionally retained* |
| `strict` | Everything ExifTool can remove, including ICC | Nothing optional | UI warns colour may change. Orientation needs a pixel transform (see §4) |

## 3. Format-capability matrix (verified in Sprint 2 with ExifTool 13.59)

| Format | Detect | Lossless strip | ICC keep | Pixel proof | Finding | Status |
| --- | --- | --- | --- | --- | --- | --- |
| JPEG | `FF D8 FF` | ✅ | ✅ | ImageDataHash identical | — | supported |
| PNG | 8-byte sig | ✅ | ✅ | ImageDataHash identical | `-all=` also drops gAMA/sRGB/cHRM → restored in privacy mode | supported |
| WebP | `RIFF....WEBP` | ✅ | ✅ | ImageDataHash identical | FileType may change "Extended WEBP" → "WEBP" when ICC removed; both accepted. Animated WebP hash identical | supported |
| TIFF | `II*\0` / `MM\0*` | ✅ | ✅ | ImageDataHash identical | `-all=` cannot delete IFD0 → Make/Model/Artist survive; explicit IFD0 deletions + residual pass fix it | supported |
| AVIF | ftyp avif/avis | ✅ | ✅ | ImageDataHash identical | orientation in `irot`, untouched | supported |
| HEIC/HEIF | ftyp heic/heix/mif1… | ✅ (same path as AVIF) | ✅ | ImageDataHash | no HEVC encoder locally → no fixture; runtime verification gates success; `untested-format` notice | supported (flagged) |
| GIF | `GIF87a/89a` | ✅ | n/a | custom render-block SHA-256 (ExifTool can't hash GIF) | frames/delays/loop/transparency preserved | supported |
| Truncated files | — | — | — | — | ExifTool warns "JPEG format error" → `MALFORMED_IMAGE` | rejected |
| SVG, BMP, PDF, JXL, BigTIFF, video | — | — | — | — | — | rejected |

## 4. Orientation strategy

- `privacy` mode: keep the EXIF `Orientation` tag (non-identifying) ⇒ visible orientation is
  preserved with zero pixel changes. Reported as retained.
- `strict` mode with Orientation ≠ 1, user setting `orientationPolicy`:
  - `lossless-only` (default): use `jpegtran -perfect` when available; otherwise **fail** that
    file with an actionable message (switch to privacy mode or allow re-encode).
  - `allow-reencode`: explicit opt-in; Sharp rotates and re-encodes at max quality, report marks
    `pixelDataReencoded: true`.
  - `keep-tag`: keep the Orientation tag even in strict mode (reported as retained).
- HEIF/AVIF use container `irot`/`imir` properties, not EXIF, so orientation is untouched.

## 5. Sprints

### Sprint 0 — Inspect & plan ✅
- [x] Inspect repo, runtime, tool availability
- [x] Write this plan and initial capability matrix

### Sprint 1 — Scaffold & foundations ✅
- [x] Next.js 16 + TS strict + Tailwind v4 + ESLint scaffold (npm)
- [x] Install core deps: zod, exiftool-vendored, lucide-react, react-dropzone, jszip, shadcn/ui primitives
- [x] `lib/config` — Zod-validated server config (limits, concurrency, timeouts, temp dir)
- [x] `lib/files` — signature detection, filename sanitizer, temp workspace with `finally` cleanup
- [x] `lib/security` — content-disposition builder, error mapping, safe error type
- [x] Vitest setup + unit tests for the above

### Sprint 2 — Processing engine ✅
- [x] Fixture generator script (real images with GPS/EXIF/IPTC/XMP/ICC/text chunks, truncated, spoofed)
- [x] ExifTool service wrapper (singleton, timeouts, graceful shutdown)
- [x] `inspect.ts` — tag → category classifier (EXIF, GPS, MakerNotes, IPTC, XMP, ICC, comments, PNG text, thumbnails, other)
- [x] `capabilities.ts` registry (verify matrix above with fixtures)
- [x] `orientation.ts` — decision logic (pure, unit-tested) + optional jpegtran / opt-in Sharp
- [x] `sanitize.ts` — mode-specific ExifTool args, atomic output (write to temp, verify, then return)
- [x] `verify.ts` — second pass + dimension / frame-count / format checks
- [x] `report.ts` — typed report, no sensitive values
- [x] Integration tests with real fixtures (payload byte-equality for lossless cases)

### Sprint 3 — API ✅
- [x] `POST /api/inspect`, `POST /api/sanitize`, `GET /api/health` (raw-bytes body instead of multipart; Node runtime is the default under Cache Components, so no `runtime` export)
- [x] Concurrency limiter (server semaphore) + request abort cleanup
- [x] Structured error responses; API tests

### Sprint 4 — UI ✅
- [x] Design tokens, light/dark theme, header, About/How-it-works dialog, privacy notice
- [x] Dropzone + queue (thumbnail, format, size, dimensions, status, remove)
- [x] Settings (mode, ICC explanation, orientation policy)
- [x] Client processing queue with bounded concurrency, cancel, retry, clear
- [x] Results: before/after categories, sizes, dimensions, verification, downloads, ZIP
- [x] Accessibility: live regions, keyboard, focus, reduced motion; strings in one module

### Sprint 5 — Hardening & tests ✅
- [x] Security tests (path traversal, header injection, MIME spoofing, oversized, cleanup on failure, XSS via metadata)
- [x] Playwright E2E (upload, reject, process, download, batch, mixed, ZIP, theme, mobile, keyboard, retry/clear, server error)

### Sprint 6 — Delivery ✅
- [x] README, `.env.example`, deployment notes (Docker with Perl), troubleshooting, guarantees
- [x] `lint`, `typecheck`, `test`, `test:integration`, `test:e2e`, `build` all green

### Sprint 7 — Visual redesign & 3D ✅
- [x] three.js 0.186.1 (lazy-loaded) with a shared scene runtime (DPR cap, pause off-screen, full disposal)
- [x] Dropzone 3D constellation: reacts to drag-over, swirls on drop, pointer parallax
- [x] Cleaning overlay: the user's previews as 3D cards, scanner beam, metadata chips peeling off, success ring and check, error shake
- [x] Minimum 3.5 s animation; results revealed afterwards; real progress counts only
- [x] Reduced-motion and no-WebGL fallbacks; overlay portalled above the sticky header
- [x] Aurora/grid/glass design system built on tokens; new hero, feature chips, steps, polished rows and settings tiles
- [x] Tests: overlay timing hook (fake timers), E2E animation spec (canvas mounts, ≥3.4 s, success, cancel)

### Sprint 8 — Digital Decontamination Chamber (CleaningAnimationGuide.md) ✅
- [x] Pure, unit-tested timeline (5 phases, ~4.5 s) gated on the real server result; single clock per run
- [x] Procedural chamber: fresnel glass, pillars, sequential strips, holographic base, gantry with 4 coordinated arms, scan beam and carriages, shader particles, extraction core with compress and shockwave, completion shield
- [x] Honest outcomes: clean (purge), no-metadata (dissipate, neutral), error (immediate fault, retry)
- [x] Accessible dialog: inert background, focus management, live status, icon plus text
- [x] Quality tiers (full/compact/reduced), CSS fallback for missing WebGL or context loss
- [x] Old cleaning overlay removed; reuses existing three.js runtime (no R3F/Drei dependency)
- [x] Tests: timeline, outcome derivation, fitPhoto, component flows (fallback, failure/retry, no-metadata), 9 chamber E2E specs

### Sprint 9 — CleanFrame 3D Experience (pasted master brief) ✅
- [x] White-and-mint redesign: tokens, compact hero, ~1,216 px workbench (67/33), stage → settings → results order on mobile, restyled header and steps
- [x] Chamber moved into the workbench as the upload surface: idle / drag (pane opens) / ready (real photo) / run / finished
- [x] React Three Fiber 9.8.1 (compatibility checked); imperative runtime removed
- [x] GLSL: Fresnel glass, scan beam, GPU particle trajectories, procedural floor markings
- [x] Result panel: real cleaned preview, download of the exact output blob, categories from the report, ZIP, retry, reset
- [x] Rendering policy (24 fps idle, static when finished or reduced, off-screen pause), adaptive pixel ratio, error boundary and context-loss fallback
- [x] Fixed: react-dropzone `disabled` set aria-disabled on the whole stage, so the stage now uses `noDrag`
- [x] Tests: particle seeds, 4 rewritten component flows, 12 chamber E2E specs (shader compile check, drag, timing, slow server, no-metadata, failure, cancel, fresh session, fallback, reduced motion, mobile)

### Sprint 10 — Night & lime landing page ✅
- [x] Dark-by-default "night & lime" theme (light mode keeps mint); always-dark showcase surfaces; dark-glass header with centred nav and lime CTA
- [x] Hero: procedural jelly-bean mascot (custom jelly GLSL, raycast face, cursor-follow, blink), light-ray shader, absorbed motes; glass drop pill wired to the real queue and file picker
- [x] Feature carousel: five shader-art cards from one shared WebGL2 context; accessible carousel semantics
- [x] Footer: SVG outline wordmark with gradient stroke over a violet sweep; About/guarantees dialog moved here
- [x] Chamber recoloured to lime; LaserFlow removed (replaced by the hero rays)
- [x] Shared performance tier (one probe → animate or static frames) for all decorative WebGL
- [x] Fixed during review: card-art effect never re-ran after hydration; exponential glow tail washed out portrait screens (now Gaussian, aspect-aware)
- [x] Tests: 7 landing E2E specs; chamber specs wait for the perf probe

## 6. Results (2026-10-28)

| Check | Result |
| --- | --- |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run test:all` | 164 tests passed (unit + component + integration with real ExifTool) |
| `npm run build` | success (standalone output) |
| `npm run test:e2e` | 34 passed, twice in a row (desktop + mobile Chromium, production build, incl. 12 chamber + 7 landing specs) |

## 7. Follow-ups / known gaps
- HEIC: add a real iPhone HEIC fixture to `tests/fixtures` when one is available.
- Optional client-side (WASM) engine implementing `SanitizerEngine`.
- Docker image built and smoke-tested (read-only rootfs, tmpfs /tmp): health OK; strict + lossless-or-fail rotated a JPEG via jpegtran with no leftover temp files.
