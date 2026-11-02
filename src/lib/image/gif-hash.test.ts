import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gifRenderHash } from "./gif-hash";

const fixture = path.resolve(import.meta.dirname, "../../../tests/fixtures/gif-animated.gif");

describe("gifRenderHash", () => {
  it("counts frames and ignores comment extensions", async () => {
    const gif = await readFile(fixture);
    const result = gifRenderHash(gif);
    expect(result?.frames).toBe(3);
    // Insert an extra comment extension right before the trailer: render hash must not change.
    const comment = Buffer.from([0x21, 0xfe, 0x03, 0x61, 0x62, 0x63, 0x00]);
    const withComment = Buffer.concat([gif.subarray(0, -1), comment, gif.subarray(-1)]);
    expect(gifRenderHash(withComment)?.hash).toBe(result?.hash);
  });

  it("rejects truncated or non-GIF data", async () => {
    const gif = await readFile(fixture);
    expect(gifRenderHash(gif.subarray(0, gif.length - 40))).toBeNull();
    expect(gifRenderHash(Buffer.from("not a gif"))).toBeNull();
  });
});
