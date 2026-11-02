import type { Metadata, Viewport } from "next";
import { Exo_2, Orbitron, Share_Tech_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { APP_NAME, copy } from "@/features/image-sanitizer/strings";
import "./globals.css";

/* Futuristic type: Orbitron for headings, Exo 2 for reading text, Share Tech Mono for readouts. */
const display = Orbitron({ variable: "--font-display", subsets: ["latin"] });
const body = Exo_2({ variable: "--font-body", subsets: ["latin"] });
const mono = Share_Tech_Mono({ variable: "--font-readout", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: `${APP_NAME}: remove image metadata`,
  description: copy.intro,
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // Always dark: the browser chrome matches the stage.
  themeColor: "#08090c",
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
