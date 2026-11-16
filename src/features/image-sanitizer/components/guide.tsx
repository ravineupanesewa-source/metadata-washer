import { SUPPORTED_FORMATS } from "@/lib/image/capabilities";
import { CATEGORY_LABELS, copy, guide } from "../strings";

/** Categories Privacy mode removes (the ICC profile and orientation flag are kept on purpose). */
const REMOVED = Object.entries(CATEGORY_LABELS)
  .filter(([key]) => key !== "icc-profile" && key !== "orientation")
  .map(([, label]) => label);

/**
 * Below-the-fold explainer. A server component with no client JS: it gives the page
 * real, crawlable text (the washer above is a canvas) and mirrors the FAQ structured data.
 * An <article>, not a <section>: the washer stays the page's only section.
 */
export function Guide() {
  return (
    <article aria-labelledby="guide-title" className="dark bg-stage px-4 py-16 text-white sm:py-24" data-testid="guide">
      <div className="mx-auto max-w-3xl space-y-14">
        <div className="space-y-4">
          <h2 id="guide-title" className="font-heading text-2xl font-semibold tracking-wide text-balance sm:text-3xl">
            {guide.title}
          </h2>
          <p className="text-base leading-relaxed text-white/70 text-pretty">{guide.lead}</p>
          <p className="text-sm leading-relaxed text-white/55 text-pretty">{copy.intro}</p>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-ember">{guide.stepsTitle}</h3>
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-white/70 marker:text-ember/80">
            {copy.about.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p className="text-xs leading-relaxed text-white/50">{copy.about.guarantee}</p>
        </div>

        <div className="grid gap-10 sm:grid-cols-2">
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-ember">{guide.removedTitle}</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-white/70 marker:text-ember/80">
              {REMOVED.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <p className="text-xs leading-relaxed text-white/50">{guide.removedNote}</p>
          </div>
          <div className="space-y-4">
            <h3 className="text-lg font-semibold text-ember">{guide.formatsTitle}</h3>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-white/70 marker:text-ember/80">
              {SUPPORTED_FORMATS.map((format) => (
                <li key={format.label}>{format.label}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-ember">{guide.privacyTitle}</h3>
          <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-white/70 marker:text-ember/80">
            {copy.privacyDialog.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-ember">{guide.faqTitle}</h3>
          <div className="divide-y divide-white/10 rounded-2xl bg-stage-raised/60 ring-1 ring-ember/15">
            {guide.faq.map(({ q, a }) => (
              <details key={q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  {q}
                  <span aria-hidden className="text-ember transition-transform group-open:rotate-45 motion-reduce:transition-none">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-white/65">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}
