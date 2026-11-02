import { SanitizerApp } from "@/features/image-sanitizer/components/sanitizer-app";
import { getServerConfig, toPublicLimits } from "@/lib/config/server-config";

/** One section: the laundromat hero is the whole app. */
export default function Home() {
  const limits = toPublicLimits(getServerConfig());
  return (
    <main id="main" className="flex-1">
      <SanitizerApp limits={limits} />
    </main>
  );
}
