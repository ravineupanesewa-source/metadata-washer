import { AboutDialog } from "@/components/layout/info-dialogs";
import { APP_NAME, copy } from "../image-sanitizer/strings";

/** Closing section: violet light sweep and a giant outline wordmark (SVG, scales to any width). */
export function SiteFooter() {
  return (
    <footer className="relative isolate overflow-hidden bg-night text-white" aria-labelledby="footer-title">
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_85%_100%,rgb(124_77_255/0.55),transparent_70%),radial-gradient(60%_50%_at_10%_110%,rgb(91_33_182/0.45),transparent_70%),linear-gradient(160deg,transparent_35%,rgb(124_77_255/0.18)_60%,transparent_80%)]"
        aria-hidden
      />
      <h2 id="footer-title" className="sr-only">
        {APP_NAME}
      </h2>
      <svg
        className="mx-auto block w-full max-w-7xl px-2 pt-16 sm:pt-24"
        viewBox="0 0 1200 270"
        role="img"
        aria-label={APP_NAME}
      >
        <defs>
          <linearGradient id="wordmark-stroke" x1="0" y1="0" x2="1" y2="0.4">
            <stop offset="0%" stopColor="#c6f432" />
            <stop offset="45%" stopColor="#8b7bff" />
            <stop offset="100%" stopColor="#7c4dff" />
          </linearGradient>
        </defs>
        <text
          x="600"
          y="225"
          textAnchor="middle"
          fontSize="250"
          fontWeight="600"
          textLength="1150"
          lengthAdjust="spacingAndGlyphs"
          fill="none"
          stroke="url(#wordmark-stroke)"
          strokeWidth="1.6"
          fontFamily="var(--font-sans), system-ui, sans-serif"
        >
          {APP_NAME}
        </text>
      </svg>
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 pt-6 pb-10 text-sm sm:flex-row sm:items-end sm:justify-between sm:px-8">
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-white/70">
          <a className="hover:text-ember" href="#top">
            {copy.nav.home}
          </a>
          <a className="hover:text-ember" href="#how">
            {copy.nav.how}
          </a>
          <a className="hover:text-ember" href="#workbench">
            {copy.nav.clean}
          </a>
          <span className="-my-1 [&_button]:h-auto [&_button]:p-0 [&_button]:text-white/70 [&_button]:hover:bg-transparent [&_button]:hover:text-ember">
            <AboutDialog />
          </span>
        </nav>
        <p className="max-w-56 text-white/80 sm:text-right">{copy.footer.tagline}</p>
      </div>
      <p className="border-t border-white/10 py-5 text-center text-xs text-white/45">{copy.footer.fineprint}</p>
    </footer>
  );
}
