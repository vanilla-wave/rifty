/**
 * Lockfile parsing + subgraph helpers used by `installer.ts` for the
 * ADR-0023 fast path. Kept separate so `installer.ts` stays within the
 * ADR-0024 line budget.
 */

import { NotImplementedError } from '@rifty/io';
import { type Vfs, joinPath } from '@rifty/vfs';
import type { Lockfile } from './linker.ts';
import { matchesRange } from './semver.ts';

export async function readExistingLockfile(vfs: Vfs, cwd: string): Promise<Lockfile | null> {
  const path = joinPath(cwd, 'package-lock.json');
  if (!(await vfs.exists(path))) return null;
  const text = await vfs.readFileText(path);
  let parsed: { lockfileVersion?: unknown; packages?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`lockfile corrupt at ${path}: ${message}`, { cause: parseError });
  }
  // npm 5/6 (v1) and npm 7 (v2) use a different shape than v3. Silently
  // returning null here would cause `install` to do a fresh resolve and
  // overwrite the user's lockfile with v3 — data loss disguised as caching.
  // Throw loud so the gap is visible; the caller decides how to surface it.
  if (parsed.lockfileVersion === 1 || parsed.lockfileVersion === 2) {
    throw new NotImplementedError(`npm-client.lockfile.v${parsed.lockfileVersion}`);
  }
  if (parsed.lockfileVersion !== 3 || !parsed.packages) return null;
  return parsed as Lockfile;
}

export function pinnedVersionFor(lockfile: Lockfile, name: string): string | undefined {
  return lockfile.packages[`node_modules/${name}`]?.version;
}

export function lockfileSubgraph(lockfile: Lockfile, roots: string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || visited.has(name)) continue;
    const entry = lockfile.packages[`node_modules/${name}`];
    if (!entry) continue;
    visited.add(name);
    for (const dep of Object.keys(entry.dependencies ?? {})) {
      queue.push(dep);
    }
  }
  return visited;
}

export function lockfileCovers(
  lockfile: Lockfile,
  request: Record<string, string>,
): Map<string, string> | null {
  const pinned = new Map<string, string>();
  for (const [name, range] of Object.entries(request)) {
    const version = pinnedVersionFor(lockfile, name);
    if (!version) return null;
    if (!matchesRange(version, range)) return null;
    pinned.set(name, version);
  }
  return pinned;
}

/**
 * Write a lockfile to disk only if its serialized form differs from what's
 * already there. Preserves the user-visible mtime when the install was a
 * functional no-op (ADR-0023 promise), and avoids needless OPFS churn.
 *
 * Returns `true` if a write happened, `false` if the existing file was
 * byte-identical.
 */
export async function writeLockfileIfChanged(
  vfs: Vfs,
  cwd: string,
  lockfile: Lockfile,
): Promise<boolean> {
  const path = joinPath(cwd, 'package-lock.json');
  const next = JSON.stringify(lockfile, null, 2);
  if (await vfs.exists(path)) {
    const current = await vfs.readFileText(path);
    if (current === next) return false;
  }
  await vfs.writeFile(path, next);
  return true;
}
