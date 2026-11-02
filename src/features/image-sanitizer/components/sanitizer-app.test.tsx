// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ProcessingReport } from "@/lib/image/types";
import type { SanitizerEngine } from "../engine/types";
import { SanitizerApp } from "./sanitizer-app";

const limits = { maxFileSizeBytes: 1024 * 1024, maxFilesPerBatch: 2, clientConcurrency: 1 };
const fixtures = path.resolve(import.meta.dirname, "../../../../tests/fixtures");

const report = {
  version: 1,
  status: "success",
  mode: "privacy",
  input: { format: "jpeg", mimeType: "image/jpeg", size: 10, width: 4, height: 4, frameCount: 1 },
  output: { format: "jpeg", mimeType: "image/jpeg", size: 8, width: 4, height: 4, frameCount: 1 },
  metadata: { before: [{ category: "location", count: 3 }], removed: ["location"], retained: [], stillPresent: [], noMetadataDetected: false },
  icc: { present: false, retained: false },
  orientation: { original: null, action: "none" },
  pixelData: { reencoded: false, integrity: "identical" },
  verification: { status: "verified", checks: [] },
  notices: [],
} satisfies ProcessingReport;

beforeAll(() => {
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:mock-${n++}`);
  URL.revokeObjectURL = vi.fn();
});

async function jpegFile(name: string) {
  return new File([await readFile(path.join(fixtures, "jpeg-icc.jpg"))], name, { type: "image/jpeg" });
}

const stage = () => screen.getByTestId("chamber-stage");

describe("SanitizerApp", () => {
  it("validates by content, loads the chamber, processes only on request, and shows real results", async () => {
    const engine: SanitizerEngine = {
      sanitize: vi.fn(async () => ({ ok: true as const, report, blob: new Blob(["cleaned-bytes"]) })),
      inspect: vi.fn(),
    };
    const user = userEvent.setup();
    render(<SanitizerApp limits={limits} engine={engine} />);
    expect(stage()).toHaveAttribute("data-mode", "idle");
    // jsdom has no WebGL: the CSS chamber is used.
    expect(stage()).toHaveAttribute("data-renderer", "fallback");

    const fake = new File(["hello"], "fake.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByTestId("file-input"), [await jpegFile("<b>bold</b>.jpg"), fake]);

    const rows = await screen.findAllByTestId("queue-item");
    expect(rows).toHaveLength(2);
    await waitFor(() => expect(rows[0]).toHaveAttribute("data-status", "ready"));
    expect(rows[1]).toHaveAttribute("data-status", "invalid");
    expect(within(rows[0]).getByText("<b>bold</b>.jpg")).toBeInTheDocument();
    // The selected image is loaded into the chamber; nothing is uploaded yet.
    expect(stage()).toHaveAttribute("data-mode", "ready");
    expect(within(stage()).getByText("<b>bold</b>.jpg")).toBeInTheDocument();
    expect(engine.sanitize).not.toHaveBeenCalled();

    await user.click(within(stage()).getByRole("button", { name: "Remove metadata" }));
    expect(stage()).toHaveAttribute("data-mode", "run");

    // Results can be revealed as soon as the real result exists.
    await user.click(await within(stage()).findByRole("button", { name: "Show results" }));
    const panel = await screen.findByTestId("batch-summary");
    expect(panel).toHaveTextContent("Metadata removed");
    expect(within(panel).getByText("Location (GPS)")).toBeInTheDocument();
    const download = within(panel).getByRole("link", { name: /Download cleaned image/ });
    expect(download).toHaveAttribute("download", "b_-clean.jpg");
    // The link points at the cleaned output blob, not the original preview.
    const row = screen.getAllByTestId("queue-item")[0];
    expect(download.getAttribute("href")).toBe(within(row).getByRole("link", { name: /Download cleaned/ }).getAttribute("href"));
    expect(document.activeElement).toBe(within(panel).getByRole("heading", { name: "Metadata removed" }));
    expect(engine.sanitize).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("live-region")).toHaveTextContent("1 cleaned and verified");
  });

  it("never shows success when cleaning fails, and retry starts a fresh run", async () => {
    let fail = true;
    const engine: SanitizerEngine = {
      sanitize: vi.fn(async () =>
        fail
          ? { ok: false as const, error: { code: "BUSY", message: "The server is busy.", retryable: true }, report: null }
          : { ok: true as const, report, blob: new Blob(["x"]) },
      ),
      inspect: vi.fn(),
    };
    const user = userEvent.setup();
    render(<SanitizerApp limits={limits} engine={engine} />);
    await user.upload(screen.getByTestId("file-input"), await jpegFile("a.jpg"));
    await waitFor(() => expect(screen.getByTestId("queue-item")).toHaveAttribute("data-status", "ready"));
    await user.click(within(stage()).getByRole("button", { name: "Remove metadata" }));

    await waitFor(() => expect(stage()).toHaveAttribute("data-outcome", "error"));
    await waitFor(() => expect(within(stage()).getByTestId("decon-status")).toHaveTextContent("Cleaning failed"));
    expect(stage()).not.toHaveTextContent("Metadata removed");
    expect(stage()).toHaveTextContent("The server is busy.");

    await user.click(within(stage()).getByRole("button", { name: "Show results" }));
    const panel = await screen.findByTestId("batch-summary");
    expect(panel).toHaveTextContent("Cleaning failed");
    expect(within(panel).queryByRole("link", { name: /Download/ })).not.toBeInTheDocument();

    fail = false;
    await user.click(within(panel).getByRole("button", { name: "Retry failed" }));
    expect(stage()).toHaveAttribute("data-mode", "run");
    await waitFor(() => expect(stage()).toHaveAttribute("data-outcome", "clean"));
    expect(engine.sanitize).toHaveBeenCalledTimes(2);
  });

  it("reports 'no metadata found' honestly", async () => {
    const empty = { ...report, metadata: { ...report.metadata, before: [], removed: [], noMetadataDetected: true } } satisfies ProcessingReport;
    const engine: SanitizerEngine = {
      sanitize: vi.fn(async () => ({ ok: true as const, report: empty, blob: new Blob(["x"]) })),
      inspect: vi.fn(),
    };
    const user = userEvent.setup();
    render(<SanitizerApp limits={limits} engine={engine} />);
    await user.upload(screen.getByTestId("file-input"), await jpegFile("clean.jpg"));
    await waitFor(() => expect(screen.getByTestId("queue-item")).toHaveAttribute("data-status", "ready"));
    await user.click(within(stage()).getByRole("button", { name: "Remove metadata" }));
    await waitFor(() => expect(stage()).toHaveAttribute("data-outcome", "no-metadata"));
    await user.click(within(stage()).getByRole("button", { name: "Show results" }));
    const panel = await screen.findByTestId("batch-summary");
    expect(panel).toHaveTextContent("No metadata found");
    expect(panel).toHaveTextContent("nothing was removed");
    expect(screen.getByTestId("chamber-stage")).not.toHaveTextContent("Metadata removed");
  });

  it("enforces the batch limit", async () => {
    const engine: SanitizerEngine = { sanitize: vi.fn(), inspect: vi.fn() };
    render(<SanitizerApp limits={limits} engine={engine} />);
    await userEvent.upload(screen.getByTestId("file-input"), await Promise.all(["a", "b", "c"].map((n) => jpegFile(`${n}.jpg`))));
    const rows = await screen.findAllByTestId("queue-item");
    await waitFor(() => expect(rows.map((r) => r.getAttribute("data-status"))).toEqual(["ready", "ready", "invalid"]));
    expect(rows[2]).toHaveTextContent("batch limit");
  });
});
