#!/usr/bin/env node
/**
 * Bundles a portable Perl into `vendor/perl` for serverless hosts (Vercel) whose runtime
 * has no /usr/bin/perl, which ExifTool needs. Run by `npm run vercel-build`; Docker and
 * local setups use the system Perl and never run this.
 *
 * The archive is pinned by version and SHA-256 and checked before extraction. Parts
 * ExifTool never loads (docs, C headers, static libperl, extra scripts) are removed to
 * keep the serverless function small.
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const VERSION = "5.42.2.0";
const ARCHIVE_URL = `https://github.com/skaji/relocatable-perl/releases/download/${VERSION}/perl-linux-amd64.tar.gz`;
const SHA256 = "18d9dc642abbf94bfb9871ae4dbddd8477984557c627a9ffcf83c834935f681f";

const root = path.resolve(import.meta.dirname, "..");
const dest = path.join(root, "vendor", "perl");
const marker = path.join(dest, ".version");

if (existsSync(path.join(dest, "bin", "perl")) && existsSync(marker)) {
  console.log(`[vendor-perl] already present in ${path.relative(root, dest)}`);
  process.exit(0);
}

console.log(`[vendor-perl] downloading relocatable-perl ${VERSION}`);
const res = await fetch(ARCHIVE_URL);
if (!res.ok) throw new Error(`[vendor-perl] download failed: HTTP ${res.status}`);
const archive = Buffer.from(await res.arrayBuffer());

const digest = createHash("sha256").update(archive).digest("hex");
if (digest !== SHA256) throw new Error(`[vendor-perl] checksum mismatch: got ${digest}`);

const tmp = path.join(os.tmpdir(), `vendor-perl-${process.pid}.tar.gz`);
writeFileSync(tmp, archive);
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
execFileSync("tar", ["-xzf", tmp, "-C", dest, "--strip-components=1"], { stdio: "inherit" });
rmSync(tmp, { force: true });

// Trim what ExifTool never needs at runtime.
const lib = path.join(dest, "lib", VERSION.split(".").slice(0, 3).join("."));
for (const p of [path.join(lib, "pod"), path.join(lib, "x86_64-linux", "CORE"), path.join(dest, "man")]) {
  rmSync(p, { recursive: true, force: true });
}
for (const name of readdirSync(path.join(dest, "bin"))) {
  if (name !== "perl") rmSync(path.join(dest, "bin", name), { force: true });
}
execFileSync("find", [dest, "-name", "*.pod", "-delete"]);

writeFileSync(marker, VERSION);
console.log(`[vendor-perl] installed to ${path.relative(root, dest)}`);
