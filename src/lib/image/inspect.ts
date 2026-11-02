import "server-only";
import { writeFile } from "node:fs/promises";
import { getServerConfig } from "../config/server-config";
import { withWorkspace } from "../files/workspace";
import { AppError } from "../security/errors";
import { EXIFTOOL_FILE_TYPES, getCapability } from "./capabilities";
import { countCategories } from "./classify";
import { readMetadata } from "./exiftool";
import { assertProcessable } from "./sanitize";
import type { InspectedTag, InspectionResult } from "./types";

const MAX_VALUE_LENGTH = 200;
const MAX_TAGS = 400;

/**
 * Reads metadata without modifying anything. Values are returned only when
 * the user explicitly asks (`reveal`), are truncated, and are always plain
 * strings rendered as text by React (never HTML).
 */
export async function inspectImage(bytes: Uint8Array, reveal: boolean): Promise<InspectionResult> {
  const config = getServerConfig();
  const format = assertProcessable(bytes, config.maxFileSizeBytes);

  return withWorkspace(config.tempRoot, async (ws) => {
    const inputPath = ws.file(`input.${getCapability(format).extensions[0]}`);
    await writeFile(inputPath, bytes, { mode: 0o600, flag: "wx" });
    const snapshot = await readMetadata(inputPath);
    if (snapshot.malformed || !snapshot.fileType || !EXIFTOOL_FILE_TYPES[format].includes(snapshot.fileType)) {
      throw new AppError("MALFORMED_IMAGE");
    }

    const tags: InspectedTag[] = snapshot.tags
      .filter((t) => t.category !== "structural")
      .slice(0, MAX_TAGS)
      .map((t) => ({
        group: t.group0 === t.group1 ? t.group0 : `${t.group0}:${t.group1}`,
        name: t.name,
        category: t.category as InspectedTag["category"],
        ...(reveal ? { value: formatValue(t.value) } : {}),
      }));

    return {
      format,
      width: snapshot.width,
      height: snapshot.height,
      frameCount: snapshot.frameCount,
      orientation: snapshot.orientation,
      categories: countCategories(snapshot.tags),
      tags,
    };
  });
}

export function formatValue(value: unknown): string {
  let text: string;
  if (typeof value === "string") text = value.startsWith("base64:") ? "(binary data)" : value;
  else if (Array.isArray(value)) text = value.map((v) => formatValue(v)).join(", ");
  else if (value !== null && typeof value === "object") text = "(structured data)";
  else text = String(value);
  text = text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  return text.length > MAX_VALUE_LENGTH ? `${text.slice(0, MAX_VALUE_LENGTH)}…` : text;
}
