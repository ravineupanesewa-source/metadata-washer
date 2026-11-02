import { getCapability } from "../image/capabilities";
import type { ImageFormat } from "../image/types";

/**
 * Filename helpers. Pure so the browser (download names, ZIP entries) and the
 * server (Content-Disposition) produce identical results.
 */

const MAX_STEM_LENGTH = 80;
export const SANITIZED_SUFFIX = "-clean";

/** Reduces an untrusted filename to a safe stem: no paths, controls, or reserved characters. */
export function safeStem(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const withoutExt = base.includes(".") ? base.slice(0, base.lastIndexOf(".")) : base;
  const cleaned = withoutExt
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .replace(/[<>:"/\\|?*;=%`$'{}[\]]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^[.\s_-]+|[.\s]+$/g, "")
    .slice(0, MAX_STEM_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : "image";
}

/** Output filename using the extension of the *detected* format, never the uploaded one. */
export function sanitizedFilename(originalName: string, format: ImageFormat): string {
  const preferred = preferredExtension(originalName, format);
  return `${safeStem(originalName)}${SANITIZED_SUFFIX}.${preferred}`;
}

function preferredExtension(originalName: string, format: ImageFormat): string {
  const { extensions } = getCapability(format);
  const original = originalName.split(".").pop()?.toLowerCase() ?? "";
  return extensions.includes(original) ? original : extensions[0];
}

/** Makes names unique within a batch/ZIP: "a-clean.jpg", "a-clean (2).jpg", … */
export function dedupeFilenames(names: readonly string[]): string[] {
  const seen = new Map<string, number>();
  const used = new Set<string>();
  return names.map((name) => {
    const key = name.toLowerCase();
    let candidate = name;
    let n = seen.get(key) ?? 1;
    while (used.has(candidate.toLowerCase())) {
      n += 1;
      const dot = name.lastIndexOf(".");
      candidate = dot > 0 ? `${name.slice(0, dot)} (${n})${name.slice(dot)}` : `${name} (${n})`;
    }
    seen.set(key, n);
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/**
 * RFC 6266 / 5987 Content-Disposition. The ASCII fallback strips anything
 * outside printable ASCII and quotes; the UTF-8 form is percent-encoded, so
 * CR/LF or quote injection is impossible.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
