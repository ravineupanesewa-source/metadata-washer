# Build a Production-Grade Image Metadata Removal Application

## 1. Role and objective

Act as a senior full-stack engineer, security engineer, and product designer. Build a complete, production-ready image metadata removal web application using the latest stable Next.js ecosystem.

The application should let users select one or more images, inspect their metadata, remove privacy-sensitive information, verify that the resulting files are clean, and download the sanitized images.

The product's core promise is:

**Remove image metadata while preserving the original image quality and visual appearance as much as technically possible. Never silently recompress or resize an image.**

This is a privacy utility, not a general-purpose image editor. Prioritize correctness, privacy, security, processing reliability, accessibility, and a polished user experience over unnecessary features.

Do not merely create a landing page or a demonstration. Implement the actual processing pipeline, API routes, verification, error handling, tests, and complete documentation.

## 2. Required technology stack

Use current stable versions at implementation time. Verify package compatibility before installing anything. Do not use experimental or canary releases for production dependencies.

- **Framework:** Next.js 16.4.3 or the newer stable release available when implementation begins.
- **Routing:** Next.js App Router.
- **Language:** TypeScript with strict type checking.
- **UI:** React, Tailwind CSS v4, and shadcn/ui where appropriate.
- **Icons:** lucide-react.
- **Drag and drop:** react-dropzone or a well-implemented native drag-and-drop interface.
- **Validation:** Zod for API parameters, configuration, and structured reports.
- **Image metadata processing:** ExifTool through a maintained Node.js wrapper or a properly managed ExifTool installation.
- **Optional image utilities:** Sharp only when required for a carefully controlled image transformation. Do not use it as the default metadata-removal mechanism if doing so would unnecessarily re-encode images.
- **Batch download:** JSZip, or another maintained library, if client-side ZIP creation is appropriate.
- **Testing:** Vitest, React Testing Library, and Playwright.
- **Package manager:** npm.
- **Runtime:** A currently supported Node.js LTS version compatible with Next.js and the chosen native dependencies.

Use the App Router and Node.js runtime for processing routes. Do not run native image-processing tools in the Edge runtime.

Inspect the current official documentation for each dependency. Pin compatible versions in the lockfile and document native runtime requirements.

## 3. Product requirements

### A. Main application interface

Build a clean, modern, responsive utility named "CleanFrame" (keep the name easy to change).

The interface should communicate trust, privacy, and simplicity. Avoid an overly decorative dashboard, excessive gradients, distracting animations, and unnecessary marketing sections.

Create the following areas:

**Header**
- Application logo and name.
- A concise "Your images stay private" privacy link or explanation.
- Theme toggle for light and dark modes.
- A small About or How It Works dialog.

**Main workspace**
- Clear heading: "Remove image metadata."
- Supporting text explaining that metadata can contain GPS coordinates, device details, timestamps, and other information.
- Large drag-and-drop area.
- File picker button.
- Supported-format and maximum-file-size information.
- Multi-file upload support.
- A privacy notice explaining where image processing takes place.

**Selected-file queue**
- Thumbnail preview.
- Original filename.
- Detected file format.
- File size and image dimensions.
- Processing status.
- Remove-file action.
- Individual progress or status feedback where supported.
- Clear errors for unsupported files.

**Processing controls**
- A primary "Remove metadata" action.
- A metadata-removal mode selector.
- A clear explanation of whether ICC color profiles are retained.
- A setting for handling images whose EXIF orientation requires a transformation.
- A cancel or clear action when technically feasible.

**Results**
- Success or partial-success status.
- Before-and-after metadata summary.
- Image dimensions and format comparison.
- Original and processed file sizes.
- Download button for individual files.
- Download-all button for successful batch results.
- A verification result showing which metadata categories were removed, retained intentionally, or could not be verified.
- A way to process another batch.

Use real data returned by the processing pipeline. Never use hardcoded demo values for actual processing results.

### B. Visual design requirements

Create a polished, production-quality interface with:

- Neutral backgrounds and restrained accent colors.
- Strong typography and clear visual hierarchy.
- Generous but efficient spacing.
- Rounded cards and subtle borders.
- Consistent button, input, dialog, tooltip, badge, and alert styling.
- A clear distinction between idle, processing, successful, warning, and error states.
- Responsive layouts for desktop, tablet, and mobile.
- Keyboard-accessible controls.
- Visible focus indicators and appropriate contrast.
- Reduced-motion support.
- Skeletons or progress indicators only where useful.
- Useful empty states and actionable error messages.

Use CSS variables and semantic design tokens so the visual system can be changed centrally.

Follow Tailwind CSS v4 conventions. Avoid unnecessary custom CSS and avoid scattering arbitrary values across components.

Keep components focused and reusable. Separate UI components, business logic, file processing, validation, and API communication. Prefer small, single-responsibility modules rather than monolithic components.

## 4. Metadata removal: the most important requirement

Do not assume that converting an image to JPEG, PNG, or WebP automatically provides a quality-preserving metadata removal solution.

Implement a metadata-first strategy.

### A. Prefer lossless metadata removal

Use ExifTool or another verified format-specific solution to remove metadata from the original file without decoding and recompressing its image data unnecessarily.

The processing flow must be:

1. Validate the input file.
2. Identify the actual file format from its contents.
3. Inspect the metadata.
4. Determine whether the format and requested operation are supported.
5. Remove applicable metadata.
6. Handle orientation and color-profile considerations.
7. Inspect the output again.
8. Confirm that the output is valid and meets the requested privacy mode.
9. Return the resulting file and an accurate report.

Do not silently fall back to lossy image re-encoding.

If a particular format cannot be sanitized safely using the available toolchain, fail clearly or offer an explicitly confirmed alternative. Never label an unsupported or partially processed image as fully sanitized.

### B. Metadata categories to inspect and remove

Handle the following metadata wherever the format and processing library support it:

**EXIF**
- GPS coordinates and related location fields.
- Camera manufacturer and model.
- Lens manufacturer and model.
- Capture date and time.
- Device serial numbers.
- Camera settings.
- MakerNotes and manufacturer-specific fields.
- Embedded EXIF thumbnails.
- Orientation and other EXIF tags.

**IPTC**
- Author and creator.
- Copyright and licensing fields when removal is requested.
- Captions.
- Keywords and descriptive tags.
- Contact information.
- Location descriptions.

**XMP**
- Creator information.
- Editing history.
- Ratings and labels.
- Custom properties.
- Application information and other supported XMP properties.

**Additional metadata**
- JPEG comments and supported application-specific segments.
- PNG text chunks and other supported textual metadata.
- WebP EXIF and XMP chunks.
- TIFF metadata fields.
- Embedded thumbnails and supported metadata previews.
- Other metadata that the selected processing library can reliably identify and remove.

The application must distinguish between "no metadata detected," "metadata removed," and "metadata could not be verified." These statuses must never be treated as equivalent.

### C. Color profiles and visual fidelity

ICC color profiles are technically metadata, but they may affect displayed color.

Provide two understandable modes:

**1. Privacy sanitization — default**
- Remove privacy-sensitive and descriptive metadata.
- Preserve embedded ICC profiles when needed to maintain color rendering.
- Preserve the original pixel dimensions.
- Preserve the original image encoding where the selected operation permits it.
- Report any metadata retained specifically for visual compatibility.

**2. Strict metadata removal**
- Remove ICC profiles and other remaining removable metadata in addition to privacy metadata.
- Explain that color appearance may change in some viewers or color-managed workflows.
- Do not claim that this mode preserves identical color rendering.

Users must understand that retaining an ICC profile means not every metadata field has been removed.

### D. EXIF orientation handling

Some images rely on an EXIF orientation flag to appear upright.

Removing the flag without correcting the underlying pixel orientation can make a portrait image appear sideways.

Therefore:

- Inspect orientation before processing.
- Preserve the original visible orientation.
- Prefer a lossless pixel transformation where available.
- For JPEG files, investigate whether the required operation can be completed with a suitable lossless JPEG transformation tool and strict handling of unsupported dimensions.
- If lossless correction is impossible, do not silently recompress the image.
- Ask for explicit permission before applying a potentially lossy correction.
- Report any transformation and its limitations.

If a safe orientation-preserving operation is unavailable, fail safely rather than corrupt the image's appearance.

### E. Supported formats

Evaluate and document format-specific support before exposing any format as fully supported.

The initial target set should include:

- JPEG / JPG.
- PNG.
- WebP.
- TIFF.
- AVIF.
- HEIC / HEIF, where the installed tooling supports the required operations.
- GIF, including animated GIFs, only if animation preservation is verified.

Do not accept a format merely because its filename has an image extension.

Detect the actual file signature, validate the detected format, and check that the selected metadata processor supports the requested operation.

For animated images, preserve all frames, animation timing, looping behavior, and transparency. If this cannot be guaranteed, reject the format with an explicit explanation.

Do not silently convert unsupported images to another format.

Treat SVG separately. It is an XML-based vector format that can contain active or external content. Exclude SVG from the initial supported set unless a secure SVG sanitizer is implemented and thoroughly tested.

Maintain a format-capability registry so that the UI, API, and tests share the same support definitions.

## 5. Architecture

Use a clear separation between presentation and processing.

Suggested project organization:

```text
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── globals.css
│   ├── api/
│   │   ├── inspect/
│   │   │   └── route.ts
│   │   └── sanitize/
│   │       └── route.ts
│   └── error.tsx
├── components/
│   ├── layout/
│   ├── upload/
│   ├── metadata/
│   ├── results/
│   ├── settings/
│   └── ui/
├── features/
│   └── image-sanitizer/
│       ├── components/
│       ├── hooks/
│       ├── schemas/
│       ├── types/
│       └── utils/
├── lib/
│   ├── config/
│   ├── security/
│   ├── image/
│   │   ├── capabilities.ts
│   │   ├── inspect.ts
│   │   ├── sanitize.ts
│   │   ├── verify.ts
│   │   ├── orientation.ts
│   │   └── report.ts
│   ├── files/
│   ├── validation/
│   └── utils/
└── types/
```

Adjust this structure when appropriate, but preserve the separation of responsibilities.

### Processing layer

Create well-defined services for:

- File validation.
- Format detection.
- Metadata inspection.
- Capability checking.
- Metadata removal.
- Orientation handling.
- Post-processing verification.
- Processing reports.
- Temporary-file cleanup.

Use typed result objects instead of passing loosely structured values across the application.

All file processing must run in a controlled Node.js environment using supported libraries. Avoid invoking arbitrary shell commands with user-provided input.

### API design

Implement a consistent API for inspecting images and processing them.

For example:

- `POST /api/inspect` — inspect a file and return a safe metadata summary.
- `POST /api/sanitize` — sanitize a file and return the resulting file plus an accurate processing report.

If an alternative API design avoids duplicate uploads or handles large files more efficiently, use it and explain the decision.

Validate all incoming data on the server. Client-side validation is only a usability feature, never the security boundary.

Return appropriate status codes and structured errors for invalid files, unsupported formats, payload limits, processing failures, and verification failures.

Do not expose filesystem paths, stack traces, internal command output, or sensitive metadata in error responses.

Use safe download headers and a sanitized output filename. Prevent header injection through filenames.

## 6. Privacy and security requirements

Treat every uploaded file as untrusted input.

Implement the following:

- No accounts, tracking, or analytics by default.
- No advertising SDKs or third-party image uploads.
- No permanent image storage.
- No saving images or metadata to a database.
- No application logs containing file contents or private metadata values.
- No logging of GPS coordinates, serial numbers, or captured timestamps.
- Temporary files, if needed, must use uniquely generated names and a controlled temporary directory.
- Delete temporary files in a `finally` block on both success and failure.
- Set strict upload-size limits, file-count limits, and request timeouts.
- Apply concurrency limits for batch processing.
- Reject empty, malformed, truncated, or oversized files.
- Validate file signatures instead of trusting MIME types or filenames.
- Prevent path traversal and unsafe filenames.
- Avoid command injection by using the library's structured API or safely constructed process arguments.
- Never pass user-supplied filenames directly into shell commands.
- Configure request limits at both the application and deployment layers.
- Do not use a globally accessible directory for temporary or output files.
- Avoid caching API responses containing image data.
- Configure suitable cache-control headers, such as `Cache-Control: no-store`, for sensitive processing responses.
- Ensure temporary resources are cleaned up when processing fails or a request is interrupted, as far as the runtime permits.
- Do not claim that all bytes are immediately erased from physical storage when only application-level cleanup has been implemented.

If deployment requires server-side processing, clearly disclose that images are transmitted to the application server for processing. State that files are processed temporarily and are not intentionally retained.

Design the application so a future fully client-side processing mode can be introduced without coupling the UI to a specific processing engine.

## 7. Metadata inspection and verification

Implement a typed metadata report that summarizes findings without unnecessarily exposing sensitive values.

The report should include:

- Input format and output format.
- Original and resulting file sizes.
- Original and resulting dimensions.
- Frame count when relevant.
- Whether an ICC profile was present and whether it was retained.
- Metadata categories detected before processing.
- Metadata categories removed.
- Metadata categories intentionally retained.
- Metadata categories that could not be verified.
- Orientation operations, if any.
- Whether pixel data was re-encoded.
- The verification outcome.

Use a simple status model, for example:

```ts
type ProcessingStatus =
  | "success"
  | "partial"
  | "failed";

type VerificationStatus =
  | "verified"
  | "partial"
  | "failed";
```

Expand the types as necessary.

Verify the resulting file by inspecting the actual output rather than trusting the processor's success message.

Use a second inspection pass to confirm that the targeted metadata categories have been removed. Ensure verification failures prevent an image from receiving a fully sanitized status.

Do not display exact GPS values by default. Let users inspect sensitive metadata values only when they explicitly request that view.

## 8. Batch processing and user experience

Support multiple images in a single session.

Implement:

- Drag-and-drop selection.
- File picker selection.
- Configurable file-count and file-size limits.
- Per-file validation.
- Per-file processing states.
- Bounded concurrency.
- Progress feedback where reliable progress information is available.
- Retry for failed items.
- Remove individual items.
- Clear the entire queue.
- Download individual results.
- Download all successful results as a ZIP.
- Preserve the individual filenames with a clear sanitized suffix.
- Handle duplicate filenames safely.
- Ensure failed files are not included in a ZIP presented as fully successful.
- Revoke temporary browser object URLs when they are no longer needed.

Do not fabricate percentages for operations where actual progress cannot be measured. Use an indeterminate progress state when appropriate.

For ZIP downloads, ensure that sanitized filenames cannot overwrite one another. Include a processing report in the ZIP only if it contains no unintended sensitive metadata values.

If the user has not explicitly started processing, do not upload selected images automatically.

## 9. Performance and reliability

Build for large photographs and real-world network conditions.

- Make upload limits configurable through validated server-side configuration.
- Reject files exceeding configured limits before expensive processing.
- Avoid unnecessary base64 conversions.
- Avoid loading several full-resolution images into memory without limits.
- Use bounded concurrency for batch work.
- Use streaming where practical and supported by the selected processor.
- Avoid retaining duplicate full-size buffers longer than necessary.
- Set explicit processing timeouts.
- Handle cancellation, worker failure, malformed data, and interrupted requests.
- Avoid retrying a failed destructive operation indefinitely.
- Ensure the UI remains responsive while files are processing.
- Do not depend on filesystem persistence for ordinary user workflows.
- Document memory requirements and deployment considerations for high-resolution images.

The processing engine must support atomic output handling: a failed operation should not leave a partially written file available as a successful result.

## 10. Accessibility and internationalization readiness

Implement accessible labels, keyboard navigation, semantic markup, live announcements for upload and processing status, and meaningful error messages.

Ensure that the application works without a mouse.

Use an accessible dialog implementation, retain focus appropriately, and respect reduced-motion preferences.

Keep user-facing strings separate enough that internationalization can be added later.

## 11. Automated testing requirements

Write genuine tests using representative image fixtures. Do not rely solely on mocked processor responses.

### Unit tests

Test:

- Format detection.
- File signature validation.
- File-size and file-count limits.
- Filename sanitization.
- Metadata report creation.
- Format capability checks.
- Unsupported formats.
- Configuration validation.
- Orientation decisions.
- Error mapping.
- Temporary-file cleanup.

### Integration tests

Test actual image files containing a variety of metadata:

- JPEG with GPS, capture timestamp, camera details, and orientation.
- JPEG with an embedded ICC profile.
- PNG containing text chunks.
- WebP containing supported EXIF or XMP metadata.
- TIFF with representative metadata.
- Animated formats if they are declared supported.
- Images without metadata.
- Corrupted or truncated image files.
- Files whose extensions do not match their content.
- Oversized input files.
- Images for which metadata removal is incomplete or verification fails.

Verify the output independently with the metadata processor. Confirm that retained visual-critical metadata matches the selected mode.

For lossless operations, verify that image payloads remain unchanged when the chosen format and operation make that guarantee possible. Where orientation transforms or format-specific limitations prevent this, test the documented exception instead of asserting a false guarantee.

### End-to-end tests

Use Playwright to test:

- Uploading a supported image.
- Rejecting an unsupported file.
- Processing and downloading a sanitized image.
- Viewing the verification report.
- Batch processing.
- Handling a mixture of successful and failed images.
- ZIP download.
- Dark and light themes.
- Mobile layout.
- Keyboard navigation.
- Recovery from server errors.
- Retry and clearing the queue.

### Security tests

Test path traversal, malicious filenames, MIME spoofing, oversized multipart requests, invalid payloads, unexpected file signatures, command injection attempts, and cleanup after processor failure.

Ensure that untrusted image metadata cannot inject HTML or script into the interface.

## 12. Documentation and operational readiness

Create a complete README containing:

- Project overview.
- Supported formats and known limitations.
- Architecture explanation.
- Installation instructions.
- Development commands.
- Environment variable documentation.
- Testing commands.
- Production build and start commands.
- Deployment requirements.
- Native image-processing dependencies.
- Maximum upload size and concurrency configuration.
- Temporary-file handling and privacy behavior.
- Explanation of metadata modes and ICC profiles.
- Orientation-related quality considerations.
- Troubleshooting guide.
- Security considerations.
- A clearly stated explanation of what the application can and cannot guarantee.

Add an `.env.example` file containing only documented, non-secret configuration variables.

Include linting, type-checking, unit-test, integration-test, and production-build scripts in `package.json`.

If the production deployment environment does not support the required image-processing dependency, document the limitation and provide a supported deployment approach, such as a compatible self-hosted Node.js runtime or container.

Do not imply that the application can be deployed to every serverless platform without checking binary availability, request size limits, execution limits, and temporary storage behavior.

## 13. Definition of done

The application is complete only when all of the following are true:

1. A user can upload real images and download real sanitized files.
2. The metadata-removal implementation uses a verified processing strategy rather than simply exporting every image through a lossy encoder.
3. The application accurately reports which metadata categories were removed and which were retained.
4. Orientation and color-profile trade-offs are handled explicitly.
5. Unsupported formats and failed verifications cannot be reported as successful sanitation.
6. Input validation, request limits, safe file handling, and temporary-file cleanup are implemented.
7. Batch processing works without unbounded resource usage.
8. Automated tests cover real image fixtures, processing failures, and security-sensitive cases.
9. Linting, strict TypeScript checks, tests, and the production build complete successfully.
10. The README accurately documents architecture, deployment, and limitations.
11. There are no placeholder processing functions, fake success messages, or unfinished core features.

## 14. Required implementation workflow

Work in this order:

**Phase 1 — Inspect and plan**

Inspect the existing repository before modifying files. Identify existing conventions, installed dependencies, and deployment assumptions. If the repository is empty, initialize the application using the latest stable compatible stack.

Verify the metadata processor's actual capabilities for each proposed image format. Create an implementation plan and a format-capability matrix.

**Phase 2 — Implement the processing engine**

Build and test file validation, metadata inspection, safe metadata stripping, orientation handling, verification, reporting, and cleanup before building the complete UI.

**Phase 3 — Build the UI**

Implement the responsive upload workspace, metadata summaries, settings, per-file states, results, and download workflow using real processing responses.

**Phase 4 — Harden and test**

Add integration, unit, end-to-end, and security tests. Test with real metadata-bearing files. Fix failures rather than weakening the tests to make them pass.

**Phase 5 — Validate delivery**

Run linting, type checking, all available tests, and the production build. Review temporary-file handling and the accuracy of metadata-removal claims. Provide the exact setup and run commands.

At completion, summarize the architecture, important implementation decisions, supported formats, verified limitations, tests executed, and commands needed to run the application.

**Important engineering rule:** Never sacrifice correctness for a misleading "100% metadata removed with zero quality loss" claim. Deliver the strongest verified lossless workflow the chosen tools support, and make unavoidable exceptions visible to the user.