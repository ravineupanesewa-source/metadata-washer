import { buildComparison } from "@/features/image-sanitizer/components/before-after-model";
import type { QueueItem } from "@/features/image-sanitizer/types/queue";
import type { SupportImpact } from "./support-store";

/** What the user's downloaded files had removed, from the server's reports (same numbers as before/after). */
export function impactOf(items: readonly QueueItem[]): SupportImpact {
  let images = 0;
  let fieldsRemoved = 0;
  let location = false;
  for (const item of items) {
    if (!item.report || !item.output) continue;
    const c = buildComparison(item.report, item.output.blob.size);
    images += 1;
    fieldsRemoved += c.fieldsRemoved;
    location ||= c.hasLocation;
  }
  return { images, fieldsRemoved, location };
}
