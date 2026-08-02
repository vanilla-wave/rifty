/**
 * Lockfile parsing + subgraph helpers for `installer.ts`'s ADR-0023 fast
 * path. Split out to keep `installer.ts` within the ADR-0024 line budget.
 */

import { NotImplementedError } from '@riftydev/io';
import { type Vfs, joinPath } from '@riftydev/vfs';
import {
  type RegistryShadowEmbeddedSource,
  planShadowSubstitutionsFromLockfile,
  registryAcquisitionInstallPath,
  registryShadowEmbeddedSourcesFromLockfile,
} from './internal/shadow/planner.ts';
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
  // v1 (npm 5/6) and v2 (npm 7) have a different shape than v3. Returning
  // null would trigger a fresh resolve that overwrites the user's lockfile
  // with v3 — data loss disguised as caching. Throw so the gap is visible.
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
 * (install path) it was found under. Caller needs the path because fast-path
 * replay places packages exactly where the lockfile recorded them;
 * re-deriving placement from the walk could diverge if visit-order shifts
 * between installs (e.g. `dependencies` reordered in `package.json`).
 */
export interface PinnedEntryLookup {
  readonly installPath: string;
  readonly entry: LockfileEntry;
}

/**
 * Parent-aware lookup for the lockfile fast path (ADR-0042 follow-on).
 *
 * Node's resolver applied to v3 lockfile keys: for a request for `name` from
 * a package at `parentInstallPath`, walk up checking
 * `<scope>/node_modules/<name>` at each ancestor scope; return the first hit.
 * `parentInstallPath === ''` is the root (top-level requests), whose only
 * candidate is `node_modules/<name>`.
 *
 * Walk-up rather than bare-name because post-M11 a lockfile can carry both a
 * hoisted `node_modules/<name>` entry and nested
 * `node_modules/<parent>/node_modules/<name>` entries for diamond conflicts
 * (`express → debug → ms@^2.1` vs `express → finalhandler → ms@2.0`). A
 * nested package's transitive request must see its own nested copy first,
 * else the fast path replays the wrong version.
 *
 * Returns `undefined` when no ancestor scope contains the name; the caller
 * (`createLockfileSource`) turns that into a loud `EBROKENLOCK`, per the
 * post-2026-05-27 "lockfile is authoritative or it's an error" contract.
 *
 * O(depth) per lookup (`/node_modules/` segments in `parentInstallPath`),
 * bounded by real nesting depth (≤ 5). A precomputed parent→entry index
 * could optimise further, but map lookups are already constant-time per
 * ancestor.
 */
export function pinnedEntryForParent(
  lockfile: Lockfile,
  name: string,
  parentInstallPath: string,
): PinnedEntryLookup | undefined {
  let scope = parentInstallPath;
  // Terminates on a hit, or once the `scope === ''` check fires after the
  // root candidate `node_modules/<name>` has been searched.
  while (true) {
    const candidate = scope === '' ? `node_modules/${name}` : `${scope}/node_modules/${name}`;
    const entry = lockfile.packages[candidate];
    if (entry) return { installPath: candidate, entry };
    if (scope === '') return undefined;
    // Pop the trailing `/node_modules/<x>` segment. Absence means a
    // malformed install path — a programmer error, not a runtime concern.
    const cut = scope.lastIndexOf('/node_modules/');
    scope = cut < 0 ? '' : scope.slice(0, cut);
  }
}

/** Bare package name of a v3 lockfile install path (last `node_modules/` segment). */
export function lockfilePathBareName(key: string): string {
  const idx = key.lastIndexOf('/node_modules/');
  return idx < 0 ? key.slice('node_modules/'.length) : key.slice(idx + '/node_modules/'.length);
}

export function lockfileSubgraph(lockfile: Lockfile, roots: string[]): Set<string> {
  // name → install-path index over every entry so the BFS visits nested
  // copies too. Pre-ADR-0042-follow-on only flat entries existed on the fast
  // path; after it, transitive visibility includes nested keys, so without
  // this we'd miss override divergence evidenced only on a nested copy.
  const namesToPaths = new Map<string, string[]>();
  for (const key of Object.keys(lockfile.packages)) {
    if (key === '') continue;
    const bare = lockfilePathBareName(key);
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
    // ''`), so the walk-up reduces to a bare-name check. Routing through
    // `pinnedEntryForParent` keeps the call shape symmetric with the
    // source-level lookup the walk uses for transitives.
    const hit = pinnedEntryForParent(lockfile, name, '');
    if (!hit) return null;
    if (!matchesRange(hit.entry.version, range)) return null;
    pinned.set(name, hit.entry.version);
  }
  return pinned;
}

interface BundleShadowContext {
  readonly acquisitionByMaterializationPath: ReadonlyMap<string, string>;
  readonly embeddedSources: readonly RegistryShadowEmbeddedSource[];
}

function bundleShadowContext(lockfile: Lockfile): BundleShadowContext | string {
  try {
    const plan = planShadowSubstitutionsFromLockfile(lockfile);
    const embeddedSources = registryShadowEmbeddedSourcesFromLockfile(lockfile, plan);
    const acquisitionByMaterializationPath = new Map<string, string>();
    for (const substitution of plan.substitutions) {
      if (substitution.acquisition.kind !== 'registry') continue;
      acquisitionByMaterializationPath.set(
        substitution.materialization.installPath,
        registryAcquisitionInstallPath(substitution),
      );
    }
    return { acquisitionByMaterializationPath, embeddedSources };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `bundle lockfile shadow trace/topology is invalid (${message})`;
  }
}

function exactBundleReachablePaths(
  lockfile: Lockfile,
  request: Record<string, string>,
  acquisitionByMaterializationPath: ReadonlyMap<string, string>,
): ReadonlySet<string> {
  const reachablePaths = new Set<string>();
  const queue = Object.keys(request).map((name) => ({ name, parentInstallPath: '' }));
  for (let index = 0; index < queue.length; index += 1) {
    const edge = queue[index];
    if (!edge) continue;
    const hit = pinnedEntryForParent(lockfile, edge.name, edge.parentInstallPath);
    if (!hit) continue;
    const installPath = acquisitionByMaterializationPath.get(hit.installPath) ?? hit.installPath;
    if (reachablePaths.has(installPath)) continue;
    const entry = installPath === hit.installPath ? hit.entry : lockfile.packages[installPath];
    if (!entry) continue;
    reachablePaths.add(installPath);
    for (const name of Object.keys(entry.dependencies ?? {})) {
      queue.push({ name, parentInstallPath: installPath });
    }
  }
  return reachablePaths;
}

function bundleCompletenessGapForValidatedPaths(
  lockfile: Lockfile,
  reachablePaths: ReadonlySet<string>,
  tarballs: ReadonlyArray<{ name: string; version: string; integrity: string }>,
  embeddedSources: readonly RegistryShadowEmbeddedSource[],
): string | null {
  const embeddedDependencyPaths = new Set(
    embeddedSources.flatMap((source) =>
      source.dependencies.map((dependency) => dependency.installPath),
    ),
  );
  const integrityByNameVersion = new Map<string, string>();
  for (const t of tarballs) integrityByNameVersion.set(`${t.name}@${t.version}`, t.integrity);
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') continue; // the root project is not a tarball
    if (!reachablePaths.has(path) || embeddedDependencyPaths.has(path)) continue;
    const name = lockfilePathBareName(path);
    if (!entry.version || !entry.resolved || !entry.integrity) {
      return `bundle lockfile entry ${path} lacks replay fields (resolved/integrity)`;
    }
    const integrity = integrityByNameVersion.get(`${name}@${entry.version}`);
    if (integrity === undefined) {
      return `bundle omits the tarball for ${name}@${entry.version}`;
    }
    if (integrity !== entry.integrity) {
      return `bundle tarball integrity for ${name}@${entry.version} does not match its lockfile`;
    }
  }
  return null;
}

/**
 * Eddy-bundle completeness gate (round 6): every lockfile package REACHABLE
 * from the request must be replayable FROM THE BUNDLE — a `resolved` +
 * `integrity` on the entry, and a manifest tarball matching its
 * name@version+integrity. Without this, a divergent/buggy resolver could send
 * a covering lockfile while omitting tarballs; the client would adopt the
 * lockfile, then the replay would quietly fetch the omissions from the
 * ORDINARY registry on cache miss while still reporting (and learning)
 * `source: 'eddy'` — a provenance lie. An honest bundle can never trip this:
 * the server harvests one tarball per resolved package from the SAME install
 * that produced the lockfile (`services/eddy/resolver.ts`).
 *
 * @returns a decline reason, or `null` when the bundle is complete.
 */
export function bundleCompletenessGap(
  lockfile: Lockfile,
  request: Record<string, string>,
  tarballs: ReadonlyArray<{ name: string; version: string; integrity: string }>,
): string | null {
  const shadow = bundleShadowContext(lockfile);
  if (typeof shadow === 'string') return shadow;
  const reachablePaths = exactBundleReachablePaths(
    lockfile,
    request,
    shadow.acquisitionByMaterializationPath,
  );
  return bundleCompletenessGapForValidatedPaths(
    lockfile,
    reachablePaths,
    tarballs,
    shadow.embeddedSources,
  );
}

/** Exact-path variant for callers that already own override/companion traversal. */
export function bundleCompletenessGapForPaths(
  lockfile: Lockfile,
  reachablePaths: ReadonlySet<string>,
  tarballs: ReadonlyArray<{ name: string; version: string; integrity: string }>,
): string | null {
  const shadow = bundleShadowContext(lockfile);
  if (typeof shadow === 'string') return shadow;
  return bundleCompletenessGapForValidatedPaths(
    lockfile,
    reachablePaths,
    tarballs,
    shadow.embeddedSources,
  );
}

/**
 * Write a lockfile only if its serialized form differs from what's on disk.
 * Preserves mtime on a functional no-op (ADR-0023 promise) and avoids OPFS
 * churn.
 *
 * @returns `true` if a write happened, `false` if the file was byte-identical.
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
