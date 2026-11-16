import { describe, expect, it } from "vitest";
import { cuesBetween, moodFor, type SoundSnapshot } from "./sound-cues";

const idle: SoundSnapshot = { mode: "idle", phase: null, outcome: null, items: 0 };
const at = (over: Partial<SoundSnapshot>): SoundSnapshot => ({ ...idle, ...over });

describe("cuesBetween", () => {
  it("adding files pins them to the line", () => {
    expect(cuesBetween(idle, at({ mode: "ready", items: 2 }))).toEqual(["drop"]);
  });

  it("follows a clean wash from button press to sparkle", () => {
    const ready = at({ mode: "ready", items: 1 });
    const run = (phase: SoundSnapshot["phase"], outcome: SoundSnapshot["outcome"] = null) => at({ mode: "run", phase, outcome, items: 1 });
    const steps: [SoundSnapshot, SoundSnapshot][] = [
      [ready, run("materialize")],
      [run("materialize"), run("activate")],
      [run("activate"), run("scan")],
      [run("scan"), run("awaiting")],
      [run("awaiting"), run("purge", "clean")],
      [run("purge", "clean"), run("clear", "clean")],
      [run("clear", "clean"), run("complete", "clean")],
      [run("complete", "clean"), at({ mode: "finished", phase: "complete", outcome: "clean", items: 1 })],
    ];
    expect(steps.map(([a, b]) => cuesBetween(a, b))).toEqual([
      ["start"],
      ["doorOpen"],
      ["doorClose", "washStart"],
      [],
      ["drain"],
      ["washStop", "doorOpen", "sparkle"],
      [],
      [],
    ]);
  });

  it("an image with no metadata rinses instead of draining", () => {
    expect(cuesBetween(at({ mode: "run", phase: "awaiting", items: 1 }), at({ mode: "run", phase: "dissipate", outcome: "no-metadata", items: 1 }))).toEqual(["rinse"]);
  });

  it("a jam stops the motor and sounds the fault", () => {
    expect(cuesBetween(at({ mode: "run", phase: "awaiting", items: 1 }), at({ mode: "run", phase: "fault", outcome: "error", items: 1 }))).toEqual([
      "washStop",
      "fault",
    ]);
  });

  it("cancelling mid-wash winds the motor down", () => {
    expect(cuesBetween(at({ mode: "run", phase: "awaiting", items: 1 }), at({ mode: "ready", items: 1 }))).toEqual(["washStop", "cancel"]);
  });

  it("showing results early stops the loop without a cancel sound", () => {
    expect(cuesBetween(at({ mode: "run", phase: "purge", items: 1 }), at({ mode: "finished", phase: "purge", items: 1 }))).toEqual(["washStop"]);
  });

  it("adding files during a run doesn't play the drop sound over the wash", () => {
    expect(cuesBetween(at({ mode: "run", phase: "scan", items: 1 }), at({ mode: "run", phase: "scan", items: 2 }))).toEqual([]);
  });
});

describe("moodFor", () => {
  it("rests while idle or loading the line", () => {
    expect(moodFor(idle)).toBe("idle");
    expect(moodFor(at({ mode: "ready", items: 2 }))).toBe("idle");
  });

  it("ducks under the wash, then blooms when the photo comes out clean", () => {
    expect(moodFor(at({ mode: "run", phase: "scan", items: 1 }))).toBe("wash");
    expect(moodFor(at({ mode: "run", phase: "purge", outcome: "clean", items: 1 }))).toBe("wash");
    expect(moodFor(at({ mode: "run", phase: "clear", outcome: "clean", items: 1 }))).toBe("clean");
    expect(moodFor(at({ mode: "finished", phase: "complete", outcome: "no-metadata", items: 1 }))).toBe("clean");
  });

  it("goes dark on a jam and stays there while the error is shown", () => {
    expect(moodFor(at({ mode: "run", phase: "fault", outcome: "error", items: 1 }))).toBe("fault");
    expect(moodFor(at({ mode: "finished", phase: "complete", outcome: "error", items: 1 }))).toBe("fault");
  });
});
