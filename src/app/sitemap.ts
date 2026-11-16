import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/config/site";

/** Only indexable pages: the app itself. (/laundry is a noindex prototype.) */
export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: absoluteUrl("/"), changeFrequency: "monthly", priority: 1 }];
}
