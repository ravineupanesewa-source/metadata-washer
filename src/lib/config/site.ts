/**
 * Public site identity used for canonical URLs, Open Graph, the sitemap and robots.txt.
 *
 * NEXT_PUBLIC_SITE_URL must be set at BUILD time: the home page and metadata files are
 * prerendered, so the value is baked into the HTML. Falls back to localhost for development.
 */

import { APP_NAME } from "@/features/image-sanitizer/strings";

function resolveSiteUrl(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw.endsWith("/") ? raw : `${raw}/`);
    } catch {
      throw new Error(`NEXT_PUBLIC_SITE_URL is not a valid absolute URL: "${raw}"`);
    }
  }
  return new URL(`http://localhost:${process.env.PORT ?? 3000}/`);
}

export const SITE_URL = resolveSiteUrl();

/** Absolute URL for a site path ("/" → https://example.com/). */
export const absoluteUrl = (path: string) => new URL(path.replace(/^\//, ""), SITE_URL).toString();

export const SITE = {
  name: APP_NAME,
  title: `${APP_NAME}: remove EXIF and image metadata without recompressing`,
  description:
    "Free, private image metadata remover. Strip GPS location, camera serial numbers, dates, author and editing history from JPEG, PNG, WebP, HEIC, AVIF, TIFF and GIF. No recompression, verified results, nothing stored.",
  keywords: [
    "remove image metadata",
    "remove EXIF data",
    "EXIF remover",
    "strip metadata from photos",
    "remove GPS from photo",
    "photo privacy",
    "metadata cleaner",
    "remove location from image",
  ],
  themeColor: "#08090c",
} as const;
