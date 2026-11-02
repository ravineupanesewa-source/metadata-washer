import { connection } from "next/server";
import { getExifTool } from "@/lib/image/exiftool";
import { jsonResponse } from "@/lib/server/http";

/** GET /api/health: confirms the ExifTool toolchain can start (for container health checks). */
export async function GET(): Promise<Response> {
  await connection();
  try {
    const version = await getExifTool().version();
    return jsonResponse({ ok: true, exiftool: version });
  } catch {
    return jsonResponse({ ok: false }, 503);
  }
}
