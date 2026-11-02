// Copies static assets next to the standalone server (as `next build` does not) and starts it.
import { cp } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const standalone = path.join(root, ".next/standalone");
if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No standalone build found. Run `npm run build` first.");
  process.exit(1);
}
await cp(path.join(root, ".next/static"), path.join(standalone, ".next/static"), { recursive: true });
if (existsSync(path.join(root, "public"))) {
  await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
}
process.chdir(standalone);
await import(path.join(standalone, "server.js"));
