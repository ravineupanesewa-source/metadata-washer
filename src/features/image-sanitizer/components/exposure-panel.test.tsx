// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MetadataFindings, ProcessingReport } from "@/lib/image/types";
import { ExposurePanel, buildEntries, leftoverSummary } from "./exposure-panel";

const findings: MetadataFindings = {
  version: 1,
  gps: { latitude: -33.8688, longitude: 151.2093, altitude: 58, fate: "removed" },
  items: [
    { kind: "software", category: "exif-other", value: "Photo Editor 2", fate: "removed" },
    { kind: "serial", category: "device", value: "<img src=x onerror=alert(1)>", fate: "removed" },
    { kind: "thumbnail", category: "thumbnails", value: "2048", fate: "removed" },
    { kind: "captured", category: "timestamps", value: "2024-05-06 07:08:09", fate: "still-present" },
  ],
};

const report = {
  metadata: {
    before: [
      { category: "location", count: 6 },
      { category: "device", count: 3 },
      { category: "camera-settings", count: 14 },
      { category: "maker-notes", count: 40 },
      { category: "icc-profile", count: 9 },
    ],
    removed: ["location", "device", "camera-settings", "maker-notes", "exif-other", "thumbnails"],
    retained: [{ category: "icc-profile", reason: "color-rendering" }],
    stillPresent: ["timestamps"],
    noMetadataDetected: false,
  },
} as unknown as ProcessingReport;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("buildEntries / leftoverSummary", () => {
  it("puts GPS first and orders the rest by risk", () => {
    expect(buildEntries(findings).map((e) => e.key)).toEqual(["gps", "serial", "thumbnail", "captured", "software"]);
  });

  it("formats raw values into readable text", () => {
    const thumb = buildEntries(findings).find((e) => e.key === "thumbnail");
    expect(thumb && thumb.type === "item" && thumb.value).toBe("Embedded copy of the photo (2.0 KB)");
  });

  it("summarises removed categories that have no headline finding", () => {
    expect(leftoverSummary(findings, report)).toEqual({ count: 54, labels: ["Camera settings", "Manufacturer notes"] });
  });
});

describe("ExposurePanel", () => {
  it("renders values as text and reflects each fate (reduced motion: final state at once)", () => {
    render(<ExposurePanel findings={findings} report={report} />);
    const cards = screen.getAllByTestId("finding");
    expect(cards.map((c) => [c.dataset.kind, c.dataset.state])).toEqual([
      ["gps", "washed"],
      ["serial", "washed"],
      ["thumbnail", "washed"],
      ["captured", "still-present"],
      ["software", "washed"],
    ]);
    // Untrusted values are text, never markup.
    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("33.86880° S, 151.20930° E")).toBeInTheDocument();
    expect(screen.getByText("58 m altitude")).toBeInTheDocument();
    // One detail could not be removed, so the meter never claims "all washed".
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "1");
    expect(screen.getByTestId("exposure-panel")).toHaveTextContent("+ 54 more technical fields removed");
  });

  it("can blur values for screen sharing", async () => {
    render(<ExposurePanel findings={findings} report={report} />);
    const toggle = screen.getByTestId("exposure-hide");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    for (const value of screen.getAllByTestId("finding-value")) expect(value).toHaveAttribute("aria-hidden", "true");
  });

  it("washes removable findings one by one once visible", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query: string) =>
        ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }) as unknown as MediaQueryList,
    );
    class VisibleObserver {
      constructor(private cb: IntersectionObserverCallback) {}
      observe() {
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
      }
      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal("IntersectionObserver", VisibleObserver);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));

    render(<ExposurePanel findings={findings} report={report} />);
    const panel = screen.getByTestId("exposure-panel");
    const states = () => within(panel).getAllByTestId("finding").map((c) => c.dataset.state);
    expect(states()).toEqual(["exposed", "exposed", "exposed", "still-present", "exposed"]);
    expect(screen.getByRole("meter")).toHaveAttribute("aria-valuenow", "5");

    act(() => vi.advanceTimersByTime(1300));
    expect(states()).toEqual(["washed", "exposed", "exposed", "still-present", "exposed"]);
    act(() => vi.advanceTimersByTime(5000));
    expect(states()).toEqual(["washed", "washed", "washed", "still-present", "washed"]);
    expect(panel.dataset.washed).toBe("4");
    // The scramble settles back on the real coordinates.
    expect(within(panel).getByText("33.86880° S, 151.20930° E")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
