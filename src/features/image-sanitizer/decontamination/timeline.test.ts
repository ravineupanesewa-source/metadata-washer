import { describe, expect, it } from "vitest";
import type { ProcessingReport } from "@/lib/image/types";
import { DecontaminationRun } from "./run";
import { REDUCED_TIMELINE, TIMELINE, deriveOutcome, nominalDuration, sampleTimeline } from "./timeline";

const phaseAt = (t: number, at: number | null, outcome: "clean" | "no-metadata" | "error" = "clean") =>
  sampleTimeline(t, at === null ? null : { at, outcome }, TIMELINE).phase;

describe("sampleTimeline", () => {
  it("runs the five phases in about 4.5 s when the server answers early", () => {
    expect(nominalDuration(TIMELINE)).toBeCloseTo(4.5);
    expect(phaseAt(0.3, 0.2)).toBe("materialize");
    expect(phaseAt(1.0, 0.2)).toBe("activate");
    expect(phaseAt(2.0, 0.2)).toBe("scan");
    expect(phaseAt(3.0, 0.2)).toBe("purge");
    expect(phaseAt(4.1, 0.2)).toBe("clear");
    expect(phaseAt(4.6, 0.2)).toBe("complete");
    expect(sampleTimeline(4.6, { at: 0.2, outcome: "clean" }, TIMELINE).done).toBe(true);
  });

  it("never purges before the real result arrives", () => {
    expect(phaseAt(3.0, null)).toBe("awaiting");
    expect(phaseAt(30, null)).toBe("awaiting");
    expect(sampleTimeline(30, null, TIMELINE).done).toBe(false);
    // Result at 6 s → purge starts at 6 s, completes at 8 s.
    expect(phaseAt(5.9, 6)).toBe("awaiting");
    expect(phaseAt(6.1, 6)).toBe("purge");
    expect(phaseAt(8.1, 6)).toBe("complete");
  });

  it("loops the scan beam while waiting", () => {
    const a = sampleTimeline(2.5 + TIMELINE.scanLoop * 0.25, null, TIMELINE);
    const b = sampleTimeline(2.5 + TIMELINE.scanLoop * 1.25, null, TIMELINE);
    expect(a.scanLine).toBeCloseTo(0.25);
    expect(b.scanLine).toBeCloseTo(0.25);
    expect(a.beam).toBe(1);
  });

  it("faults immediately on error and never purges", () => {
    expect(phaseAt(0.8, 0.7, "error")).toBe("fault");
    expect(phaseAt(1.7, 0.7, "error")).toBe("complete");
    for (let t = 0.7; t < 6; t += 0.1) expect(phaseAt(t, 0.7, "error")).not.toBe("purge");
  });

  it("dissipates instead of purging when no metadata was found", () => {
    expect(phaseAt(3.0, 1, "no-metadata")).toBe("dissipate");
    expect(phaseAt(4.0, 1, "no-metadata")).toBe("clear");
  });

  it("halves durations for reduced motion", () => {
    expect(nominalDuration(REDUCED_TIMELINE)).toBeCloseTo(2.25);
  });

  it("reports monotonic progress values", () => {
    const s = sampleTimeline(3.15, { at: 1, outcome: "clean" }, TIMELINE);
    expect(s.materialize).toBe(1);
    expect(s.scan).toBe(1);
    expect(s.purge).toBeCloseTo(0.5);
    expect(s.releaseAt).toBe(2.5);
    expect(s.beam).toBe(0);
  });
});

describe("DecontaminationRun", () => {
  it("uses a single clock and resolves only once", () => {
    let now = 1000;
    const run = new DecontaminationRun(false, () => now);
    now += 1200;
    expect(run.sample().phase).toBe("activate");
    expect(run.resolve("clean")).toBe(true);
    expect(run.resolve("error")).toBe(false);
    expect(run.outcome).toBe("clean");
    now += 1500; // t = 2.7
    expect(run.sample().phase).toBe("purge");
  });

  it("gives every run a unique id", () => {
    expect(new DecontaminationRun(false).id).not.toBe(new DecontaminationRun(false).id);
  });
});

describe("deriveOutcome", () => {
  const report = (noMetadataDetected: boolean) => ({ metadata: { noMetadataDetected } }) as ProcessingReport;
  it("maps real results to outcomes", () => {
    expect(deriveOutcome([{ status: "success", report: report(false) }])).toBe("clean");
    expect(deriveOutcome([{ status: "partial", report: report(false) }, { status: "failed", report: null }])).toBe("clean");
    expect(deriveOutcome([{ status: "success", report: report(true) }])).toBe("no-metadata");
    expect(deriveOutcome([{ status: "success", report: report(true) }, { status: "success", report: report(false) }])).toBe("clean");
    expect(deriveOutcome([{ status: "failed", report: null }])).toBe("error");
    expect(deriveOutcome([])).toBe("error");
  });
});
