/**
 * Lockfile parsing + subgraph helpers used by `installer.ts` for the
 * ADR-0023 fast path. Kept separate so `installer.ts` stays within the
 * ADR-0024 line budget.
 */

import { NotImplementedError } from '@rifty/io';
import { type Vfs, joinPath } from '@rifty/vfs';
import type { Lockfile, LockfileEntry } from './linker.ts';
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

/**
 * Result of a walk-up lookup: the matched entry plus the lockfile key
 * (install path) it was found under. The caller needs the path because the
 * fast-path replay places packages exactly where the lockfile recorded
 * them — re-deriving placement from the walk would risk diverging from the
 * lockfile if visit-order shifts between installs (e.g. operator
 * reorders `dependencies` in `package.json`).
 */
export interface PinnedEntryLookup {
  readonly installPath: string;
  readonly entry: LockfileEntry;
}

/**
 * Parent-aware lookup for the lockfile fast path (ADR-0042 follow-on).
 *
 * Implements Node's resolver, applied to v3 lockfile keys: given a request
 * for `name` from a package installed at `parentInstallPath`, walk up the
 * parent's path checking `<scope>/node_modules/<name>` at each ancestor
 * scope; return the first hit. `parentInstallPath === ''` represents the
 * root (top-level requests), in which case the only candidate is
 * `node_modules/<name>`.
 *
 * Why walk-up rather than bare-name: post-M11 a lockfile can carry both a
 * hoisted `node_modules/<name>` entry and one or more nested
 * `node_modules/<parent>/node_modules/<name>` entries for diamond conflicts
 * (the classic `express → debug → ms@^2.1` vs `express → finalhandler →
 * ms@2.0` case). A nested package's transitive dep request must see its own
 * nested copy first, otherwise the fast path replays the wrong version.
 *
 * Returns `undefined` when no ancestor scope contains the name — the
 * caller (`createLockfileSource`) turns that into a loud `EBROKENLOCK`,
 * matching the post-2026-05-27 "lockfile is authoritative or it's an
 * error" contract.
 *
 * Performance: O(depth) per lookup, where depth is the number of
 * `/node_modules/` segments in `parentInstallPath`. Bounded by real-world
 * nesting depth (≤ 5 for npm projects). A precomputed parent→entry index
 * is a possible future optimisation, but the current map lookups are
 * already constant-time per ancestor.
 */
export function pinnedEntryForParent(
  lockfile: Lockfile,
  name: string,
  parentInstallPath: string,
): PinnedEntryLookup | undefined {
  let scope = parentInstallPath;
  // Loop terminates once we either find a hit or pop past the root scope.
  // The "pop past root" condition is captured by the `scope === ''` check
  // after we've already searched the root candidate `node_modules/<name>`.
  while (true) {
    const candidate = scope === '' ? `node_modules/${name}` : `${scope}/node_modules/${name}`;
    const entry = lockfile.packages[candidate];
    if (entry) return { installPath: candidate, entry };
    if (scope === '') return undefined;
    // Pop the trailing `/node_modules/<x>` segment. Anything else means
    // someone fed us a malformed install path; that's a programmer error,
    // not a runtime concern.
    const cut = scope.lastIndexOf('/node_modules/');
    scope = cut < 0 ? '' : scope.slice(0, cut);
  }
}

export function lockfileSubgraph(lockfile: Lockfile, roots: string[]): Set<string> {
  // Build a name → install-path index from every entry in the lockfile so
  // that the BFS can visit nested copies too. Pre-ADR-0042-follow-on this
  // walker only knew about flat entries, which was safe because nested
  // entries did not exist on the fast path. After the follow-on, transitive
  // visibility includes nested keys; without this we'd miss any override
  // divergence whose only evidence lives on a nested copy.
  const namesToPaths = new Map<string, string[]>();
  for (const key of Object.keys(lockfile.packages)) {
    if (key === '') continue;
    const idx = key.lastIndexOf('/node_modules/');
    const bare =
      idx < 0 ? key.slice('node_modules/'.length) : key.slice(idx + '/node_modules/'.length);
    const existing = namesToPaths.get(bare);
    if (existing) existing.push(key);
    else namesToPaths.set(bare, [key]);
  }

  const visited = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift();
    if (!name || visited.has(name)) continue;
    const paths = namesToPaths.get(name);
    if (!paths) continue;
    visited.add(name);
    for (const path of paths) {
      const entry = lockfile.packages[path];
      if (!entry) continue;
      for (const dep of Object.keys(entry.dependencies ?? {})) {
        queue.push(dep);
      }
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
    // Top-level requests resolve from the root scope (`parentInstallPath ===
    // ''`), so the walk-up reduces to a single bare-name check. Going
    // through `pinnedEntryForParent` keeps the call shape symmetric with
    // the source-level lookup that the walk uses for transitives.
    const hit = pinnedEntryForParent(lockfile, name, '');
    if (!hit) return null;
    if (!matchesRange(hit.entry.version, range)) return null;
    pinned.set(name, hit.entry.version);
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
