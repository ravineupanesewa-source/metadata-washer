"use client";

import { Aperture } from "lucide-react";
import Link from "next/link";
import { requestFilePicker, scrollToWorkbench } from "@/features/image-sanitizer/intake";
import { APP_NAME, copy } from "@/features/image-sanitizer/strings";
import { AboutDialog, PrivacyDialog } from "./info-dialogs";

/** Dark glass header in both themes: it floats over the always-dark hero. */
export function SiteHeader() {
  return (
    <header className="dark fixed inset-x-0 top-0 z-40 border-b border-white/[0.06] bg-night/60 text-white backdrop-blur-xl">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 sm:px-6 lg:px-8">
        <Link
          href="#top"
          className="flex items-center gap-2 justify-self-start rounded-lg text-lg font-semibold tracking-tight focus-visible:ring-3 focus-visible:ring-ember/50 focus-visible:outline-none"
        >
          <span className="grid size-8 place-items-center rounded-xl bg-ember text-ember-foreground shadow-[0_0_24px_-4px] shadow-ember/60">
            <Aperture className="size-4" aria-hidden />
          </span>
          {APP_NAME}
        </Link>

        {/* One-section site: "How it works" is a dialog rather than an anchor. */}
        <nav aria-label="Site" className="hidden items-center gap-1 text-sm md:flex [&_button]:text-white/75 [&_button]:hover:bg-white/10 [&_button]:hover:text-white">
          <AboutDialog />
        </nav>

        <div className="flex items-center gap-1 justify-self-end [&_button]:text-white/75 [&_button]:hover:bg-white/10 [&_button]:hover:text-white">
          <PrivacyDialog compact />
          <button
            type="button"
            onClick={() => {
              scrollToWorkbench();
              requestFilePicker();
            }}
            className="ml-1 hidden h-9 rounded-full bg-ember px-4 whitespace-nowrap text-sm font-medium !text-ember-foreground shadow-[0_0_30px_-8px] shadow-ember transition hover:!bg-ember/90 focus-visible:ring-3 focus-visible:ring-ember/50 focus-visible:outline-none sm:inline-flex sm:items-center"
          >
            {copy.nav.cta}
          </button>
        </div>
      </div>
    </header>
  );
}
