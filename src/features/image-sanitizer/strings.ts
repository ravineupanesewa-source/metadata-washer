import type { ErrorCode } from "@/lib/security/errors";
import type {
  MetadataCategory,
  MetadataMode,
  NoticeCode,
  OrientationPolicy,
  VerificationCheck,
} from "@/lib/image/types";

/**
 * All user-facing copy for the sanitizer, kept in one module so it can be
 * swapped for an i18n catalogue later without touching components.
 */

export const APP_NAME = "CleanFrame";

export const copy = {
  tagline: "Your images stay private",
  heading: "Remove image metadata.",
  intro:
    "Photos can carry GPS coordinates, camera and lens serial numbers, capture times, author names and editing history. CleanFrame removes it without recompressing your image.",
  privacyNotice:
    "Images are sent over HTTPS to this CleanFrame server, processed in a private temporary folder, and deleted as soon as the response is sent. Nothing is stored, logged or shared.",
  dropzone: {
    idle: "Drag and drop images here",
    active: "Drop to add images",
    or: "or",
    browse: "Choose files",
    limits: (formats: string, maxSize: string, maxFiles: number) =>
      `${formats} · up to ${maxSize} each · ${maxFiles} files per batch`,
    label: "Add images to clean",
  },
  queue: {
    title: "Selected images",
    empty: "No images yet. Add some to get started. Nothing uploads until you press “Remove metadata”.",
    remove: (name: string) => `Remove ${name}`,
    retry: (name: string) => `Retry ${name}`,
    download: (name: string) => `Download cleaned ${name}`,
    details: (name: string) => `Show report for ${name}`,
    inspect: (name: string) => `Inspect metadata in ${name}`,
    clear: "Clear all",
    noPreview: "No preview",
  },
  status: {
    ready: "Ready",
    invalid: "Not supported",
    queued: "Queued",
    processing: "Cleaning…",
    success: "Cleaned and verified",
    partial: "Cleaned, partly verified",
    failed: "Failed",
    cancelled: "Cancelled",
  },
  settings: {
    title: "Removal settings",
    modeLabel: "Mode",
    modes: {
      privacy: {
        title: "Privacy (recommended)",
        description:
          "Removes location, device, time, author and editing metadata. Keeps the ICC colour profile and the orientation flag so the image looks exactly the same.",
      },
      strict: {
        title: "Strict",
        description:
          "Also removes the ICC colour profile and every other removable field. Colours may look different in colour-managed apps.",
      },
    } satisfies Record<MetadataMode, { title: string; description: string }>,
    iccNote:
      "An ICC profile tells apps how to display colours. It describes the colour space, not you. Keeping it means not literally every field is removed.",
    orientationLabel: "Rotated photos (strict mode)",
    orientation: {
      "preserve-tag": {
        title: "Keep the orientation flag",
        description: "Lossless. Keeps one non-identifying tag (e.g. “rotate 90°”) so the photo stays upright.",
      },
      "lossless-or-fail": {
        title: "Rotate losslessly or skip",
        description: "Rotate the pixels without quality loss when possible (JPEG with jpegtran); otherwise the file fails safely.",
      },
      "allow-reencode": {
        title: "Allow re-encoding",
        description: "If lossless rotation is impossible, rotate and re-save at high quality. This changes pixel data.",
      },
    } satisfies Record<OrientationPolicy, { title: string; description: string }>,
    orientationDisabled: "Privacy mode always keeps the orientation flag.",
  },
  actions: {
    start: "Remove metadata",
    processing: "Cleaning…",
    cancel: "Cancel",
    downloadAll: "Download all (ZIP)",
    preparingZip: "Preparing ZIP…",
    another: "Clean another batch",
    retryFailed: "Retry failed",
  },
  summary: {
    title: "Results",
    counts: (ok: number, partial: number, failed: number) =>
      [
        ok ? `${ok} cleaned and verified` : null,
        partial ? `${partial} partly verified` : null,
        failed ? `${failed} failed` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    zipNote: "The ZIP contains only successfully cleaned images and a report.json without any metadata values.",
  },
  report: {
    title: (name: string) => `Report for ${name}`,
    description: "What CleanFrame found, removed and verified in this image.",
    before: "Found before cleaning",
    removed: "Removed",
    retained: "Kept on purpose",
    stillPresent: "Could not be removed",
    noMetadata: "No metadata was detected in this image. Nothing needed removing.",
    nothingRemoved: "Nothing",
    format: "Format",
    dimensions: "Dimensions",
    frames: "Frames",
    size: "File size",
    original: "Original",
    cleaned: "Cleaned",
    pixelData: "Image data",
    verification: "Verification",
    checksTitle: "Checks on the output file",
  },
  inspect: {
    title: (name: string) => `Metadata in ${name}`,
    description: "Read directly from the file. Values are hidden until you choose to show them.",
    reveal: "Show values",
    revealHint: "Values can include exact GPS coordinates and serial numbers.",
    loading: "Reading metadata…",
    empty: "No metadata found.",
    error: "Could not read metadata.",
  },
  header: {
    privacy: "Privacy",
    about: "How it works",
    theme: "Toggle colour theme",
  },
  about: {
    title: "How CleanFrame works",
    steps: [
      "Checks the file's real format from its bytes, not its name.",
      "Reads all metadata with ExifTool.",
      "Rewrites only the metadata sections. The image data itself is not decoded or recompressed.",
      "Reads the result again and checks that targeted metadata is gone, the dimensions and frames match, and the image data hash is unchanged.",
      "Only then offers the cleaned file for download.",
    ],
    guarantee:
      "CleanFrame removes every metadata field ExifTool can identify and remove for the format. It cannot detect information hidden inside the pixels themselves (for example watermarks, steganography or visible content).",
  },
  privacyDialog: {
    title: "Your images stay private",
    points: [
      "No accounts, analytics, tracking or advertising.",
      "Images are uploaded only when you press “Remove metadata”, and only to this server.",
      "Each image is processed in its own private temporary folder that is deleted right after processing, whether it succeeds or fails.",
      "Images and metadata are never stored in a database or written to logs.",
      "Responses are marked no-store so browsers and proxies do not cache them.",
      "Deletion is done by the application. It does not guarantee immediate physical erasure from the server's disk.",
    ],
  },
  stage: {
    title: "The metadata washer",
    idle: "Drop a photo on the washer",
    drag: "Release to load the washer",
    addMore: "Add more",
    hintIdle: "Nothing is uploaded until you press “Remove metadata”.",
    ready: (n: number, mode: string) => `${n} ${n === 1 ? "image" : "images"} ready · ${mode}`,
    showResults: "Show results",
    loading: "Warming up the washer…",
  },
  result: {
    download: "Download cleaned image",
    downloadAll: "Download all (ZIP)",
    another: "Clean another batch",
    retryFailed: "Retry failed",
    removed: "Removed",
    kept: "Kept on purpose",
    noneRemoved: "No metadata was present, so nothing was removed.",
    previewAlt: (name: string) => `Cleaned preview of ${name}`,
    noPreview: "Preview not available for this format in your browser. The download is the cleaned file.",
    sizes: (before: string, after: string) => `${before} → ${after}`,
  },
  decon: {
    eyebrow: "Metadata laundromat",
    eyebrowShort: "Laundromat",
    title: (total: number) => (total === 1 ? "Decontaminating image" : `Decontaminating ${total} images`),
    subtitle: "Hidden metadata is located, removed and verified on the server. The picture itself is left as it is.",
    progress: (done: number, total: number) => `${done} of ${total} ${total === 1 ? "image" : "images"} processed`,
    more: (n: number) => `+${n} more`,
    phases: {
      materialize: "Taking your photo off the line…",
      activate: "Loading the washer…",
      scan: "Washing out embedded metadata…",
      awaiting: "Scrubbing metadata and verifying the output…",
      purge: "Rinsing the metadata away…",
      dissipate: "No embedded metadata detected",
      clear: "Hanging up the clean photo…",
      fault: "Cleaning failed",
      complete: "Done",
    },
    result: {
      clean: { title: "Metadata removed", body: "Verified on the server. Your cleaned files are ready." },
      partial: "Some checks couldn't be completed for this format. See each file's report.",
      "no-metadata": { title: "No metadata found", body: "Nothing needed removing. The file is already clean and ready to download." },
      error: { title: "Cleaning failed", body: "No cleaned file was produced. You can retry or go back to your images." },
    },
    viewResults: "View results",
    backToImages: "Back to images",
    retry: "Retry",
  },
  hero: {
    titleStart: "Launder your photos.",
    titleAccent: "The metadata comes out in the wash.",
    subtitle: "Location, device serials, timestamps and edit history are scrubbed out and verified. Every pixel stays exactly as it was.",
    pill: "Drop a photo to strip its metadata…",
    pillDrop: "Release to send it to the chamber",
    reassurance: "Nothing uploads until you press “Remove metadata”.",
  },
  nav: {
    home: "Home",
    how: "How it works",
    clean: "Clean a photo",
    cta: "Clean a photo",
  },
  /** What the washer says (decorative; the status line carries the real state). */
  washer: {
    idle: "Toss a photo in. I'll wash the metadata out.",
    drag: "Let go, let go!",
    ready: "Looks grubby. Start the wash?",
    loading: "In you go…",
    washing: "Scrub, scrub…",
    rinse: "Down the drain!",
    clean: "Squeaky clean. Same pixels.",
    noMetadata: "Already clean!",
    error: "Uh-oh, I jammed.",
  },
  carousel: {
    eyebrow: "How it works",
    title: "From hidden data to a clean file, verified.",
    previous: "Previous step",
    next: "Next step",
    slideLabel: (n: number, total: number, title: string) => `${title}, step ${n} of ${total}`,
    slides: [
      { style: "aurora", kicker: "Drop", title: "Add any photo", text: "JPEG, PNG, WebP, TIFF, AVIF, HEIC or GIF. Checked by content, not by name." },
      { style: "flame", kicker: "Inspect", title: "Find what it leaks", text: "GPS, camera serials, capture time, author and edit history, read straight from the file." },
      { style: "leaf", kicker: "Scrub", title: "Strip it cleanly", text: "Only metadata is rewritten. The image data is never decoded or recompressed." },
      { style: "wave", kicker: "Verify", title: "Prove it's gone", text: "The output is re-read and its image-data hash compared before you can download it." },
      { style: "orb", kicker: "Download", title: "Keep every pixel", text: "Download the verified file, or a ZIP of the batch. Nothing is stored on the server." },
    ] as const,
  },
  footer: {
    tagline: "Private photos start with CleanFrame.",
    fineprint: "No tracking · No storage · Powered by ExifTool",
  },
  workbench: {
    eyebrow: "The decontamination chamber",
    title: "Clean a photo",
  },
  live: {
    added: (n: number) => `${n} image${n === 1 ? "" : "s"} added.`,
    rejected: (n: number) => `${n} file${n === 1 ? "" : "s"} could not be added.`,
    started: (n: number) => `Cleaning ${n} image${n === 1 ? "" : "s"}.`,
    finished: (summary: string) => `Finished. ${summary}.`,
    cancelled: "Processing cancelled.",
    cleared: "Queue cleared.",
  },
} as const;

export const CATEGORY_LABELS: Record<MetadataCategory, string> = {
  location: "Location (GPS)",
  device: "Camera, lens & serial numbers",
  timestamps: "Dates & times",
  "camera-settings": "Camera settings",
  "maker-notes": "Manufacturer notes",
  thumbnails: "Embedded thumbnails",
  "exif-other": "Other EXIF",
  iptc: "IPTC (author, captions, keywords)",
  xmp: "XMP (creator, edits, ratings)",
  comments: "Comments",
  "text-chunks": "PNG text",
  photoshop: "Photoshop data",
  "icc-profile": "ICC colour profile",
  orientation: "Orientation flag",
  other: "Other metadata",
};

export const NOTICE_TEXT: Record<NoticeCode, string> = {
  "icc-retained": "The ICC colour profile was kept so colours display the same.",
  "icc-removed-color-may-change": "The ICC colour profile was removed. Colours may look different in some apps.",
  "orientation-tag-kept": "The orientation flag was kept so the photo stays upright. It does not identify you.",
  "orientation-lossless-transform": "The photo was rotated losslessly so the orientation flag could be removed.",
  "orientation-reencoded": "The photo was rotated and re-saved at high quality. Pixel data changed.",
  "pixel-integrity-not-verifiable": "This format's image data could not be hashed, so unchanged pixels could not be proven.",
  "format-container-orientation": "Rotation for this format is stored in the image container and is not affected.",
  "untested-format": "This format is processed by the same engine but was not covered by local test images. The result was still verified.",
};

export const CHECK_LABELS: Record<VerificationCheck["id"], string> = {
  "output-readable": "Output file is valid",
  format: "Same format",
  dimensions: "Same dimensions",
  frames: "All frames kept",
  "pixel-data": "Image data unchanged",
  "metadata-removed": "Targeted metadata gone",
};

export const ERROR_TEXT: Partial<Record<ErrorCode | "CLIENT_TOO_LARGE" | "CLIENT_UNSUPPORTED" | "CLIENT_TOO_MANY" | "NETWORK", string>> = {
  CLIENT_TOO_LARGE: "This file is larger than the maximum size.",
  CLIENT_UNSUPPORTED: "This doesn't look like a supported image. The file's contents were checked, not just its name.",
  CLIENT_TOO_MANY: "The batch limit was reached. This file was not added.",
  NETWORK: "Could not reach the server. Check your connection and retry.",
};
