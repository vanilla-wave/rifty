/**
 * Lockfile parsing + subgraph helpers used by `installer.ts` for the
 * ADR-0023 fast path. Kept separate so `installer.ts` stays within the
 * ADR-0024 line budget.
 */

import { type Vfs, joinPath } from '@rifty/vfs';
import type { Lockfile } from './linker.ts';
import { matchesRange } from './semver.ts';

export async function readExistingLockfile(vfs: Vfs, cwd: string): Promise<Lockfile | null> {
  const path = joinPath(cwd, 'package-lock.json');
  if (!(await vfs.exists(path))) return null;
  const text = await vfs.readFileText(path);
  let parsed: Lockfile;
  try {
    parsed = JSON.parse(text) as Lockfile;
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : String(parseError);
    throw new Error(`lockfile corrupt at ${path}: ${message}`, { cause: parseError });
  }
  if (parsed.lockfileVersion !== 3 || !parsed.packages) return null;
  return parsed;
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
