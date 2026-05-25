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

import type { Vfs } from '@rifty/vfs';
import {
  lockfileCovers,
  lockfileSubgraph,
  readExistingLockfile,
  writeLockfileIfChanged,
} from './installer-lockfile-reader.ts';
import { type Lockfile, type ResolvedPackage, buildLockfile, link } from './linker.ts';
import { type OverrideMap, resolveOverride } from './overrides.ts';
import type { Packument, RegistryClient } from './registry.ts';
import { matchesRange, pickBestVersion } from './semver.ts';
import { type TarballCache, VfsTarballCache, computeIntegrity } from './tarball-cache.ts';
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

/** ResolvedPackage extended with provenance for the lockfile and peer-dep
 * metadata for the post-resolve warn pass. Peer/optional sets are not stored
 * in the v3 lockfile shape, so they live only on the in-memory record. */
type PinnedPackage = ResolvedPackage & {
  resolved?: string;
  integrity?: string;
  peerDependencies?: Record<string, string>;
};

export interface InstallResult {
  packages: ResolvedPackage[];
  lockfile: Lockfile;
  // Retained for shape compatibility; always empty since A-031 made conflicts
  // throw EVERSIONCONFLICT instead of being collected (nested install lands in M11; see ADR 0023).
  conflicts: { name: string; firstVersion: string; secondVersion: string }[];
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
    // Apply overrides (user + baked-in) to the top-level request before
    // checking lockfile coverage. Without this, the fast path would happily
    // replay a `bcrypt` pin from the lockfile even when an override redirects
    // it to `bcryptjs` — a silent semantic divergence between the cached and
    // live-resolve paths. Resolution: compute the effective request, and if
    // anything in the closed subgraph would also be redirected to a name
    // that's not pinned in the lockfile, bail out and let live-resolve take
    // over (treated as a cache miss).
    const effectiveRequest = applyOverridesToRequest(dependencies, rootName, opts.overrides);
    const topLevelPins = lockfileCovers(existingLockfile, effectiveRequest);
    if (
      topLevelPins &&
      subgraphFreeOfOverrideDivergence(existingLockfile, topLevelPins, opts.overrides)
    ) {
      // Build the closed subgraph from the requested roots and replay every
      // pin through the cache. Any cache miss falls through to a fetch but
      // still avoids the packument round-trip.
      const subgraph = lockfileSubgraph(existingLockfile, [...topLevelPins.keys()]);
      for (const name of subgraph) {
        const entry = existingLockfile.packages[`node_modules/${name}`];
        if (!entry || !entry.resolved || !entry.integrity) {
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
      // Diff-before-write preserves user-visible mtime when the install was a
      // functional no-op (ADR-0023). `writeLockfileIfChanged` skips the write
      // entirely if the serialized bytes match.
      await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
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
    if (manifest.peerDependencies && Object.keys(manifest.peerDependencies).length > 0) {
      pkg.peerDependencies = manifest.peerDependencies;
    }
    resolved.set(effectiveName, pkg);

    for (const [depName, depRange] of Object.entries(manifest.dependencies ?? {})) {
      await resolveDep(depName, depRange, effectiveName);
    }

    // Optional deps: try to resolve, warn on failure, never abort the install.
    // npm's contract is that a missing optional dep is non-fatal — typical use
    // case is platform-specific native helpers (fsevents on macOS only, etc).
    for (const [depName, depRange] of Object.entries(manifest.optionalDependencies ?? {})) {
      try {
        await resolveDep(depName, depRange, effectiveName);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `optional dependency ${depName}@${depRange} of ${effectiveName} could not be installed: ${reason}`,
        );
      }
    }
  }

  for (const [depName, depRange] of Object.entries(dependencies)) {
    await resolveDep(depName, depRange, rootName);
  }

  const packages = [...resolved.values()];
  warnUnsatisfiedPeers(packages);
  await link(opts.vfs, opts.cwd, packages);
  const lockfile = buildLockfile(rootName, rootVersion, packages);
  // Diff-before-write preserves mtime when live-resolve happens to produce
  // the same lockfile as what's already on disk (ADR-0023).
  await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
  return { packages, lockfile, conflicts: [] };
}

/**
 * Apply overrides (user + baked-in) to the top-level request. The returned
 * map keys are the *effective* package names that will actually be installed;
 * values are the effective ranges. When no override matches a name, the
 * original (name, range) is kept verbatim.
 *
 * The fast path uses this so the lockfile is queried for the names that
 * would actually end up installed — not the raw names from `package.json`.
 * Without this, adding `"overrides": { "bcrypt": "bcryptjs" }` after the
 * lockfile was written would silently no-op until something forced a full
 * resolve, because the fast path would replay the original `bcrypt` pin.
 */
function applyOverridesToRequest(
  request: Record<string, string>,
  parent: string,
  overrides: OverrideMap | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(request)) {
    const override = resolveOverride(name, parent, overrides);
    if (override) {
      // null range means "latest" — there is no single range we can pin
      // against the lockfile, so encode it as `*` (which `matchesRange`
      // treats as satisfied by anything). The lockfile fast path will then
      // accept any pinned version of the override target; if the operator
      // wants a specific range, they should write it explicitly in the
      // override target (`"bcrypt": "bcryptjs@2.x"`).
      out[override.name] = override.range ?? range;
    } else {
      out[name] = range;
    }
  }
  return out;
}

/**
 * Walk the closed lockfile subgraph reachable from the top-level pins and
 * check that none of the locked package names would be redirected by an
 * override to a name that is *not* pinned in the lockfile.
 *
 * Returning `false` here means "the lockfile no longer reflects what live
 * resolve would produce" — the caller must fall through to live-resolve as
 * if the lockfile didn't cover at all.
 *
 * We deliberately use the global (no-parent) form of `resolveOverride` for
 * transitive entries because the v3 flat lockfile loses parent context.
 * That's slightly more aggressive than strictly necessary (a `parent>child`
 * override that doesn't apply to the actual parent will still trigger
 * fallthrough), but the cost is one extra live-resolve and the win is
 * never silently ignoring an override.
 */
function subgraphFreeOfOverrideDivergence(
  lockfile: Lockfile,
  topLevelPins: Map<string, string>,
  overrides: OverrideMap | undefined,
): boolean {
  const subgraph = lockfileSubgraph(lockfile, [...topLevelPins.keys()]);
  for (const name of subgraph) {
    const override = resolveOverride(name, undefined, overrides);
    if (!override) continue;
    // If the override redirects to a different name, the lockfile would need
    // to have that name pinned instead. Anything else is a divergence.
    if (override.name !== name) return false;
    // Same name but different effective range — if the locked version no
    // longer satisfies the override's range, the fast path's replayed pin
    // would silently differ from what live-resolve would have produced.
    if (override.range) {
      const entry = lockfile.packages[`node_modules/${name}`];
      if (!entry || !matchesRange(entry.version, override.range)) return false;
    }
  }
  return true;
}

/**
 * Walk every resolved package's `peerDependencies` and emit a one-line
 * `console.warn` for each missing peer. Already-satisfied peers are silent.
 *
 * We intentionally do not check whether the installed peer version satisfies
 * the requested range: per the spec scope, we warn only on a missing entry.
 * Range-level peer-resolution lands with full peer-dep resolution (its own
 * milestone).
 */
function warnUnsatisfiedPeers(packages: readonly PinnedPackage[]): void {
  const installed = new Set(packages.map((p) => p.name));
  for (const pkg of packages) {
    if (!pkg.peerDependencies) continue;
    for (const [peerName, peerRange] of Object.entries(pkg.peerDependencies)) {
      if (installed.has(peerName)) continue;
      console.warn(
        `peer dependency ${peerName}@${peerRange} required by ${pkg.name} but not installed`,
      );
    }
  }
}
