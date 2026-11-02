import { access, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { withWorkspace } from "./workspace";

describe("withWorkspace", () => {
  it("removes the directory after success", async () => {
    let dir = "";
    await withWorkspace(os.tmpdir(), async (ws) => {
      dir = ws.dir;
      await writeFile(ws.file("input.jpg"), "x");
    });
    await expect(access(dir)).rejects.toThrow();
  });

  it("removes the directory after failure and rethrows", async () => {
    let dir = "";
    await expect(
      withWorkspace(os.tmpdir(), async (ws) => {
        dir = ws.dir;
        await writeFile(ws.file("output.jpg"), "x");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(access(dir)).rejects.toThrow();
  });

  it("creates private, uniquely named directories", async () => {
    await withWorkspace(os.tmpdir(), async (a) =>
      withWorkspace(os.tmpdir(), async (b) => {
        expect(a.dir).not.toBe(b.dir);
        expect((await readdir(a.dir)).length).toBe(0);
      }),
    );
  });
});
