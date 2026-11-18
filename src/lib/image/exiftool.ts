import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { DefaultExiftoolArgs, ExifTool, ExifToolTask, exiftoolPath } from "exiftool-vendored";
import { getServerConfig } from "../config/server-config";
import { parseExifToolJson, type ClassifiedTag } from "./classify";

/**
 * Serverless runtimes (Vercel) have no /usr/bin/perl. `npm run vercel-build` bundles a
 * portable Perl into vendor/perl (scripts/vendor-perl.mjs); use it when the system has none.
 */
function bundledPerl(): string | null {
  if (existsSync("/usr/bin/perl")) return null;
  const candidate = path.join(process.cwd(), "vendor", "perl", "bin", "perl");
  return existsSync(candidate) ? candidate : null;
}

function perlOptions() {
  const perl = bundledPerl();
  if (!perl) return {};
  return {
    checkPerl: false,
    ignoreShebang: true,
    // A custom factory replaces the library's, so it must pass `-stay_open True -@ -` itself;
    // without them ExifTool exits/hangs instead of serving the batch protocol.
    processFactory: async () =>
      spawn(/*turbopackIgnore: true*/ perl, [await exiftoolPath(), ...DefaultExiftoolArgs], {
        stdio: "pipe" as const,
        shell: false,
        windowsHide: true,
        detached: false,
        env: { NODE_ENV: process.env.NODE_ENV, LANG: "C" },
      }),
  };
}

/**
 * Thin wrapper around a long-lived ExifTool process pool (`-stay_open`).
 * Arguments are sent line by line over stdin, never through a shell, and every
 * path we pass is a server-generated workspace path.
 */

const globalKey = Symbol.for("cleanframe.exiftool");
type GlobalWithExifTool = typeof globalThis & { [globalKey]?: ExifTool };

export function getExifTool(): ExifTool {
  const g = globalThis as GlobalWithExifTool;
  if (!g[globalKey]) {
    const config = getServerConfig();
    g[globalKey] = new ExifTool({
      maxProcs: config.concurrency,
      taskTimeoutMillis: config.timeoutMs,
      taskRetries: 0,
      // Our own args decide what is read; no geolocation lookups or timezone inference.
      geolocation: false,
      ...perlOptions(),
    });
  }
  return g[globalKey];
}

export async function shutdownExifTool(): Promise<void> {
  const g = globalThis as GlobalWithExifTool;
  const instance = g[globalKey];
  g[globalKey] = undefined;
  await instance?.end();
}

export interface CommandResult {
  stdout: string;
  warnings: string[];
  errors: string[];
}

/** Runs raw ExifTool arguments and reports warnings/errors without throwing on them. */
class CommandTask extends ExifToolTask<CommandResult> {
  protected parse(input: string, error?: Error): CommandResult {
    const errors = [...this.errors];
    if (error && errors.length === 0) errors.push(error.message);
    return { stdout: input, warnings: [...this.warnings], errors };
  }
}

export function runExifTool(args: string[]): Promise<CommandResult> {
  return getExifTool().enqueueTask(() => new CommandTask(args), false);
}

export interface MetadataSnapshot {
  fileType: string | null;
  width: number | null;
  height: number | null;
  frameCount: number;
  orientation: number | null;
  imageDataHash: string | null;
  tags: ClassifiedTag[];
  /** ExifTool reported the file as damaged or unreadable. */
  malformed: boolean;
}

const READ_ARGS = [
  "-j",
  "-G0:1",
  "-a",
  "-n",
  "-api",
  "imagehashtype=SHA256",
  "-api",
  "LargeFileSupport=1",
  "-all",
  "-ImageDataHash",
];

const MALFORMED_PATTERN = /format error|truncat|corrupt|bad .* (segment|chunk|header)|not a valid|unexpected end|file format error/i;

export async function readMetadata(filePath: string): Promise<MetadataSnapshot> {
  const result = await runExifTool([...READ_ARGS, filePath]);
  let record: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (Array.isArray(parsed) && parsed[0] && typeof parsed[0] === "object") {
      record = parsed[0] as Record<string, unknown>;
    }
  } catch {
    return emptySnapshot(true);
  }
  return snapshotFromRecord(record, result.errors.length > 0);
}

export function snapshotFromRecord(record: Record<string, unknown>, hadErrors = false): MetadataSnapshot {
  const warning = String(record["ExifTool:Warning"] ?? "");
  const error = String(record["ExifTool:Error"] ?? "");
  const [width, height] = parseSize(record["Composite:ImageSize"]);
  return {
    fileType: typeof record["File:FileType"] === "string" ? record["File:FileType"] : null,
    width,
    height,
    frameCount: firstNumber(record, ["GIF:FrameCount", "RIFF:FrameCount", "PNG:AnimationFrames"]) ?? 1,
    orientation: firstNumber(record, ["EXIF:IFD0:Orientation"]),
    imageDataHash: typeof record["File:ImageDataHash"] === "string" ? record["File:ImageDataHash"] : null,
    tags: parseExifToolJson(record),
    malformed: hadErrors || error.length > 0 || MALFORMED_PATTERN.test(warning),
  };
}

function emptySnapshot(malformed: boolean): MetadataSnapshot {
  return {
    fileType: null,
    width: null,
    height: null,
    frameCount: 1,
    orientation: null,
    imageDataHash: null,
    tags: [],
    malformed,
  };
}

function parseSize(value: unknown): [number | null, number | null] {
  if (typeof value !== "string") return [null, null];
  const [w, h] = value.split(/[\sx]+/).map(Number);
  return Number.isFinite(w) && Number.isFinite(h) ? [w, h] : [null, null];
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = Number(record[key]);
    if (record[key] !== undefined && Number.isFinite(value)) return value;
  }
  return null;
}
