import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

if (typeof window !== "undefined" && !window.matchMedia) {
  // jsdom has no matchMedia. Report "reduced motion" so 3D scenes stay off in component tests.
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (typeof window !== "undefined" && !("ResizeObserver" in window)) {
  // jsdom has no layout; observers simply never fire.
  class NoopObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.assign(window, { ResizeObserver: NoopObserver, IntersectionObserver: NoopObserver });
}

// Vitest globals are off, so React Testing Library cannot register auto-cleanup itself.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
