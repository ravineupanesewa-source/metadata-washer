import type { Metadata, Viewport } from "next";
import { Exo_2, Orbitron, Share_Tech_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SITE, SITE_URL } from "@/lib/config/site";
import "./globals.css";

/* Futuristic type: Orbitron for headings, Exo 2 for reading text, Share Tech Mono for readouts. */
const display = Orbitron({ variable: "--font-display", subsets: ["latin"], display: "swap" });
const body = Exo_2({ variable: "--font-body", subsets: ["latin"], display: "swap" });
// Readouts only appear once the stage has booted: don't let this font compete with the critical ones.
const mono = Share_Tech_Mono({ variable: "--font-readout", subsets: ["latin"], weight: "400", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: { default: SITE.title, template: `%s | ${SITE.name}` },
  description: SITE.description,
  applicationName: SITE.name,
  keywords: [...SITE.keywords],
  category: "utilities",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE.title,
    description: SITE.description,
    url: "/",
    locale: "en_US",
  },
  twitter: { card: "summary_large_image", title: SITE.title, description: SITE.description },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  // Always dark: the browser chrome matches the stage.
  themeColor: SITE.themeColor,
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${body.variable} ${mono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:ring-3 focus:ring-ring/50"
        >
          Skip to content
        </a>
        <ThemeProvider>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
