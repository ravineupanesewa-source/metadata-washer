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
    idleTouch: "Add a photo to the washer",
    drag: "Release to load the washer",
    addMore: "Add more",
    hintIdle: "Nothing is uploaded until you press “Remove metadata”.",
    ready: (n: number, mode: string) => `${n} ${n === 1 ? "image" : "images"} ready · ${mode}`,
    showResults: "Show results",
    loading: "Warming up the washer…",
    /** Decorative cycle readout under the preloader (four steps, two seconds each). */
    loadingSteps: ["Filling the drum…", "Adding detergent…", "Loosening EXIF…", "Spinning up…"],
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

/**
 * Server-rendered explainer below the washer: the page's crawlable content
 * (headings, steps, FAQ) and the source for its FAQPage structured data.
 */
export const guide = {
  title: "Remove metadata from photos, privately",
  lead:
    "Every photo you take can quietly record where you were, which device you used and when. Before you share an image online, CleanFrame removes that hidden information and proves it is gone, without touching a single pixel.",
  stepsTitle: "How it works",
  removedTitle: "What CleanFrame removes",
  removedNote:
    "In Privacy mode the ICC colour profile and the orientation flag are kept so the picture looks exactly the same. Strict mode removes those too.",
  formatsTitle: "Supported formats",
  privacyTitle: "Privacy by design",
  faqTitle: "Frequently asked questions",
  faq: [
    {
      q: "What is image metadata?",
      a: "Metadata is information stored inside an image file alongside the picture: EXIF, IPTC and XMP fields such as GPS coordinates, camera make, model and serial number, the date and time the photo was taken, the author's name, editing software and embedded thumbnails.",
    },
    {
      q: "Does removing metadata reduce image quality?",
      a: "No. CleanFrame rewrites only the metadata sections of the file. The image data is never decoded or recompressed, and after cleaning the image data hash is checked against the original to prove it is unchanged.",
    },
    {
      q: "How do I remove GPS location from a photo?",
      a: "Drop the photo on the washer and press “Remove metadata”. GPS coordinates are removed in both Privacy and Strict mode, and the cleaned file is re-read to confirm no location data remains before you download it.",
    },
    {
      q: "Are my images uploaded or stored?",
      a: "Images are sent over HTTPS only when you press “Remove metadata”, processed in a private temporary folder and deleted as soon as the response is sent. They are never stored in a database, logged or shared, and there are no accounts, analytics or ads.",
    },
    {
      q: "Can I clean several images at once?",
      a: "Yes. Add a batch of images, clean them in one go and download each file individually or all of them together as a ZIP.",
    },
    {
      q: "Can CleanFrame remove information visible in the picture?",
      a: "No. CleanFrame removes metadata stored in the file. It cannot detect information inside the pixels themselves, such as visible text, faces, watermarks or steganography.",
    },
  ],
};

/** The before/after showcase under the washer, shown once a run has cleaned files. */
export const beforeAfter = {
  eyebrow: "Before & after",
  title: "Same picture. None of the baggage.",
  subtitle:
    "Both sides show your real files: the original on the left, the cleaned download on the right. The pixels stay put; the hidden data doesn't.",
  jump: "See before & after",
  before: "Original",
  after: "Cleaned",
  slider: "Compare the original and the cleaned file",
  sliderValue: (pct: number) => `${pct}% of the original shown`,
  picker: "Choose which image to compare",
  noPreview: (format: string) => `${format} can't be previewed in this browser. The comparison below is still exact.`,
  hiddenFields: (n: number) => `${n} hidden ${n === 1 ? "field" : "fields"}`,
  cleanShort: "Clean",
  cleanBadge: (kept: number) => (kept > 0 ? `No private metadata · ${kept} kept on purpose` : "No metadata left"),
  noneFound: "This file had no metadata to begin with. Nothing needed removing.",
  stats: {
    fields: "Metadata fields",
    size: "File size",
    pixels: "Image data",
    verification: "Verification",
  },
  pixels: {
    identical: "Identical, hash-checked",
    "not-verifiable": "Unchanged (dimensions checked)",
    transformed: "Rotated as you chose",
    mismatch: "Changed unexpectedly",
  },
  verification: {
    verified: "Verified clean",
    partial: "Partly verified",
    failed: "Not verified",
  },
  ledgerTitle: "Field by field",
  fate: {
    removed: "Removed",
    kept: "Kept on purpose",
    remained: "Still present",
  },
  reasons: {
    "color-rendering": "keeps colours accurate",
    "visible-orientation": "keeps the photo upright",
  },
} as const;

/** Optional support modal shown after a download (see src/features/support/support-config.ts). */
export const support = {
  eyebrow: "Keep the washer running",
  title: "Liked how clean that came out?",
  body: "CleanFrame is free, with no ads, no accounts and no trackers, and it runs on a real server. If it just protected your privacy, a small tip helps keep it that way for everyone.",
  impact: (fields: number, images: number) =>
    `You just scrubbed ${fields} hidden ${fields === 1 ? "field" : "fields"} from ${images} ${images === 1 ? "image" : "images"}`,
  impactLocation: "including your GPS location",
  amountsLabel: "Pick a tip",
  amountHint: (amount: number) => `Enter Rs ${amount} in eSewa after scanning.`,
  qrAlt: (name: string) => (name ? `eSewa QR code for ${name}` : "eSewa QR code"),
  scanHint: "Scan with the eSewa app",
  idLabel: "Or pay to eSewa ID",
  /** Phones show the ID first (you can't scan your own screen), so no "or". */
  idLabelFirst: "Pay to eSewa ID",
  copy: "Copy",
  copied: "Copied",
  steps: ["Open eSewa", "Scan the QR or use the ID", "Enter your tip"],
  saveQr: "Save QR image",
  saveQrHint: "On this phone? Save the QR, then scan it from your gallery in eSewa.",
  paid: "I've sent it",
  later: "Maybe later",
  close: "Close",
  thanksTitle: "Dhanyabad!",
  thanksBody: "You're keeping CleanFrame free, private and ad-free for everyone. Thank you for chipping in.",
  thanksClose: "Back to my photos",
} as const;

/** Sound toggle in the dock (mutes everything) and the music switch in Settings. */
export const sound = {
  label: "Sound",
  on: "Sound on",
  off: "Sound off",
  music: {
    title: "Background music",
    description: "A calm, generated soundtrack that follows the wash. Plays only while sound is on.",
  },
} as const;
