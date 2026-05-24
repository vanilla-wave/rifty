/**
 * Top-level installer: resolve a name+range, walk transitive deps, fetch
 * tarballs, unpack into the VFS.
 *
 * For M9 we stay flat: every package lives directly under
 * `node_modules/<name>/`. Conflicting versions throw `EVERSIONCONFLICT`
 * (A-031) — nested install lands in M11 per ADR 0023.
 *
 * ADR-0023: on subsequent invocations the installer reads the existing
 * `package-lock.json` and skips network calls for any dep whose lockfile pin
 * still satisfies the requested range. Tarballs are cached at
 * `/.rifty/tarball-cache/` so even an absent lockfile won't re-download
 * already-seen tarballs once the cache is warm.
 */

import { type Vfs, joinPath } from '@rifty/vfs';
import { type Lockfile, type ResolvedPackage, buildLockfile, link } from './linker.ts';
import { type OverrideMap, resolveOverride } from './overrides.ts';
import type { Packument, RegistryClient } from './registry.ts';
import { matchesRange, pickBestVersion } from './semver.ts';
import {
  type TarballCache,
  VfsTarballCache,
  computeIntegrity,
} from './tarball-cache.ts';
import { extractTarGz } from './unpacker.ts';

export interface InstallOptions {
  vfs: Vfs;
  cwd: string;
  registry: RegistryClient;
  overrides?: OverrideMap;
  /** Cache of already-loaded packuments (lets multiple installs share). */
  packumentCache?: Map<string, Packument>;
  /**
   * Tarball cache (ADR-0023). Defaults to a {@link VfsTarballCache} at
   * `/.rifty/tarball-cache/` inside `opts.vfs`. Pass an explicit instance to
   * disable caching (e.g. `{ get: async () => null, put: async () => '' }`).
   */
  tarballCache?: TarballCache;
}

/** ResolvedPackage extended with provenance for the lockfile. */
type PinnedPackage = ResolvedPackage & { resolved?: string; integrity?: string };

export interface InstallResult {
  packages: ResolvedPackage[];
  lockfile: Lockfile;
  // Retained for shape compatibility; always empty since A-031 made conflicts
  // throw EVERSIONCONFLICT instead of being collected (nested install lands in M11; see ADR 0023).
  conflicts: { name: string; firstVersion: string; secondVersion: string }[];
}

async function readExistingLockfile(vfs: Vfs, cwd: string): Promise<Lockfile | null> {
  const path = joinPath(cwd, 'package-lock.json');
  if (!(await vfs.exists(path))) return null;
  try {
    const text = await vfs.readFileText(path);
    const parsed = JSON.parse(text) as Lockfile;
    if (parsed.lockfileVersion !== 3 || !parsed.packages) return null;
    return parsed;
  } catch {
    return null;
  }
}

function pinnedVersionFor(lockfile: Lockfile, name: string): string | undefined {
  return lockfile.packages[`node_modules/${name}`]?.version;
}

/**
 * Walk the lockfile graph starting from `roots`, returning the set of
 * package names that participate in this subgraph. Used to decide which deps
 * can be served from the lockfile vs. need a live re-resolve.
 */
function lockfileSubgraph(lockfile: Lockfile, roots: string[]): Set<string> {
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

/**
 * Decide whether the lockfile alone can satisfy the requested top-level
 * dependencies. Returns the names that can be served from the lockfile (with
 * their pinned versions still matching the requested range), or null when
 * any range no longer matches — falling back to a full re-resolve in that
 * case is simpler than per-subgraph partial reuse.
 */
function lockfileCovers(
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

export async function install(
  rootName: string,
  rootVersion: string,
  dependencies: Record<string, string>,
  opts: InstallOptions,
): Promise<InstallResult> {
  const packumentCache = opts.packumentCache ?? new Map<string, Packument>();
  const tarballCache: TarballCache = opts.tarballCache ?? new VfsTarballCache(opts.vfs);
  const resolved = new Map<string, PinnedPackage>();

  // --- Lockfile fast path (ADR-0023) ---
  const existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);
  if (existingLockfile) {
    const topLevelPins = lockfileCovers(existingLockfile, dependencies);
    if (topLevelPins) {
      // Build the closed subgraph from the requested roots and replay every
      // pin through the cache. Any cache miss falls through to a fetch but
      // still avoids the packument round-trip.
      const subgraph = lockfileSubgraph(existingLockfile, [...topLevelPins.keys()]);
      let allCached = true;
      for (const name of subgraph) {
        const entry = existingLockfile.packages[`node_modules/${name}`];
        if (!entry || !entry.resolved || !entry.integrity) {
          allCached = false;
          break;
        }
        let bytes = await tarballCache.get(name, entry.version, entry.integrity);
        if (!bytes) {
          bytes = await opts.registry.getTarball(entry.resolved);
          const actual = await computeIntegrity(bytes);
          if (actual !== entry.integrity) {
            throw Object.assign(
              new Error(
                `Integrity mismatch for ${name}@${entry.version}: expected ${entry.integrity}, got ${actual}`,
              ),
              { code: 'EINTEGRITY', packageName: name, version: entry.version },
            );
          }
          await tarballCache.put(name, entry.version, entry.integrity, bytes);
          allCached = false;
        }
        const files = await extractTarGz(bytes);
        resolved.set(name, {
          name,
          version: entry.version,
          files,
          dependencies: entry.dependencies ?? {},
          resolved: entry.resolved,
          integrity: entry.integrity,
        });
      }

      const packages = [...resolved.values()];
      await link(opts.vfs, opts.cwd, packages);
      const lockfile = buildLockfile(rootName, rootVersion, packages);
      // Only rewrite the lockfile if a new entry was pulled (cache-miss path).
      // Cache-only restores leave the on-disk lockfile byte-identical so the
      // user-visible mtime stays stable.
      if (!allCached) {
        await opts.vfs.writeFile(
          joinPath(opts.cwd, 'package-lock.json'),
          JSON.stringify(lockfile, null, 2),
        );
      }
      return { packages, lockfile, conflicts: [] };
    }
  }

  // --- Live resolve (no lockfile, or lockfile didn't cover) ---
  async function resolveDep(
    name: string,
    range: string | null,
    parent: string | undefined,
  ): Promise<void> {
    const override = resolveOverride(name, parent, opts.overrides);
    const effectiveName = override?.name ?? name;
    const effectiveRange = override?.range ?? range;

    let packument = packumentCache.get(effectiveName);
    if (!packument) {
      packument = await opts.registry.getPackument(effectiveName);
      packumentCache.set(effectiveName, packument);
    }
    const versions = Object.keys(packument.versions);
    let pick = pickBestVersion(versions, effectiveRange);
    if (!pick) {
      const tag = packument['dist-tags']?.latest;
      if (tag) pick = tag;
    }
    if (!pick) throw new Error(`No matching version for ${effectiveName}@${effectiveRange ?? '*'}`);

    if (resolved.has(effectiveName)) {
      const existing = resolved.get(effectiveName)!;
      if (existing.version !== pick) {
        throw Object.assign(
          new Error(
            `Conflicting versions of ${effectiveName}: ${existing.version} vs ${pick} — nested install not implemented yet (deferred to M11; see ADR 0023)`,
          ),
          {
            code: 'EVERSIONCONFLICT',
            packageName: effectiveName,
            firstVersion: existing.version,
            secondVersion: pick,
          },
        );
      }
      return;
    }

    const manifest = packument.versions[pick];
    if (!manifest) throw new Error(`Packument missing version manifest ${effectiveName}@${pick}`);

    // Try cache first. Prefer the manifest's integrity; fall back to the
    // lockfile pin's integrity for the same (name, version) so that a
    // partial re-resolve (e.g. one range bumped) still serves unchanged
    // transitive deps from the cache.
    let cacheIntegrity = manifest.dist.integrity;
    if (!cacheIntegrity && existingLockfile) {
      const pinned = existingLockfile.packages[`node_modules/${effectiveName}`];
      if (pinned && pinned.version === pick && pinned.integrity) {
        cacheIntegrity = pinned.integrity;
      }
    }
    let tarball: Uint8Array | null = null;
    if (cacheIntegrity) {
      tarball = await tarballCache.get(effectiveName, pick, cacheIntegrity);
    }
    let integrity = cacheIntegrity;
    if (!tarball) {
      tarball = await opts.registry.getTarball(manifest.dist.tarball);
      integrity = integrity ?? (await computeIntegrity(tarball));
      await tarballCache.put(effectiveName, pick, integrity, tarball);
    }
    const files = await extractTarGz(tarball);
    const pkg: PinnedPackage = {
      name: effectiveName,
      version: pick,
      files,
      dependencies: manifest.dependencies ?? {},
      resolved: manifest.dist.tarball,
      integrity,
    };
    resolved.set(effectiveName, pkg);

    for (const [depName, depRange] of Object.entries(manifest.dependencies ?? {})) {
      await resolveDep(depName, depRange, effectiveName);
    }
  }

  for (const [depName, depRange] of Object.entries(dependencies)) {
    await resolveDep(depName, depRange, rootName);
  }

  const packages = [...resolved.values()];
  await link(opts.vfs, opts.cwd, packages);
  const lockfile = buildLockfile(rootName, rootVersion, packages);
  await opts.vfs.writeFile(
    joinPath(opts.cwd, 'package-lock.json'),
    JSON.stringify(lockfile, null, 2),
  );
  return { packages, lockfile, conflicts: [] };
}
