import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

/**
 * A private, per-request temporary directory (mode 0700 via mkdtemp). Files
 * inside use fixed, server-chosen names; user filenames never touch the disk.
 */
export interface Workspace {
  dir: string;
  file(name: WorkspaceFile): string;
}

export type WorkspaceFile =
  | `input.${string}`
  | `oriented.${string}`
  | `output.${string}`;

const PREFIX = "cleanframe-";

export async function createWorkspace(root: string): Promise<Workspace> {
  const dir = await mkdtemp(path.join(root, PREFIX));
  return {
    dir,
    file: (name) => path.join(dir, name),
  };
}

/**
 * Removes the workspace. Never throws: cleanup failures must not mask the
 * original result. Application-level deletion only; it does not securely
 * erase bytes from the underlying storage.
 */
export async function destroyWorkspace(workspace: Workspace | null): Promise<void> {
  if (!workspace) return;
  try {
    await rm(workspace.dir, { recursive: true, force: true, maxRetries: 2 });
  } catch {
    // Intentionally ignored; see README "Temporary files".
  }
}

/** Runs `fn` inside a fresh workspace and always removes it afterwards. */
export async function withWorkspace<T>(root: string, fn: (ws: Workspace) => Promise<T>): Promise<T> {
  let workspace: Workspace | null = null;
  try {
    workspace = await createWorkspace(root);
    return await fn(workspace);
  } finally {
    await destroyWorkspace(workspace);
  }
}
