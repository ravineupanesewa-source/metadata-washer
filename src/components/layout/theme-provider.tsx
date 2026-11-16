"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  // The lavender theme is dark-only.
  return <NextThemesProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange {...props} />;
}
