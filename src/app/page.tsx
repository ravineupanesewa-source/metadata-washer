import { Guide } from "@/features/image-sanitizer/components/guide";
import { SanitizerApp } from "@/features/image-sanitizer/components/sanitizer-app";
import { guide } from "@/features/image-sanitizer/strings";
import { getServerConfig, toPublicLimits } from "@/lib/config/server-config";
import { SITE, absoluteUrl } from "@/lib/config/site";
import { SUPPORTED_FORMATS } from "@/lib/image/capabilities";

/** Structured data: the tool itself, plus the FAQ shown in the guide. */
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebApplication",
      name: SITE.name,
      url: absoluteUrl("/"),
      description: SITE.description,
      applicationCategory: "UtilitiesApplication",
      operatingSystem: "Any (web browser)",
      browserRequirements: "Requires JavaScript",
      isAccessibleForFree: true,
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      featureList: [
        "Remove EXIF, IPTC and XMP metadata",
        "Remove GPS location from photos",
        "No recompression: image data is verified unchanged",
        "Batch cleaning with ZIP download",
        `Formats: ${SUPPORTED_FORMATS.map((f) => f.label).join(", ")}`,
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: guide.faq.map(({ q, a }) => ({
        "@type": "Question",
        name: q,
        acceptedAnswer: { "@type": "Answer", text: a },
      })),
    },
  ],
};

/** The laundromat hero is the app; the guide below it is the crawlable explainer. */
export default function Home() {
  const limits = toPublicLimits(getServerConfig());
  return (
    <main id="main" className="flex-1">
      <SanitizerApp limits={limits} />
      <Guide />
      <script
        type="application/ld+json"
        // JSON.stringify can't break out of the script element once "<" is escaped.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}
      />
    </main>
  );
}
