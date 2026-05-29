/**
 * Top-level installer: resolve a name+range, walk transitive deps, fetch
 * tarballs, unpack into the VFS.
 *
 * Placement (ADR-0042, M11, 2026-05-27): first-wins-flat + nest-on-conflict.
 * Each package lives at `node_modules/<name>` when it wins the hoisted slot,
 * or at `<parentInstallPath>/node_modules/<name>` when a conflicting version
 * was already hoisted. `EVERSIONCONFLICT` is dead code; the walk handles
 * conflicts by nesting instead of aborting.
 *
 * ADR-0023: on subsequent invocations the installer reads the existing
 * `package-lock.json` and skips network calls for any dep whose lockfile pin
 * still satisfies the requested range. Tarballs are cached at
 * `/.rifty/tarball-cache/` so even an absent lockfile won't re-download
 * already-seen tarballs once the cache is warm. Post-ADR-0042-follow-on
 * (2026-05-27) this fast path also handles nested entries — see
 * `createLockfileSource` / `pinnedEntryForParent`.
 *
 * Pipeline shape (D-F unification, 2026-05-26):
 * `install()` orchestrates four collaborators and stays under the
 * ADR-0024 line budget. The two previously-parallel pipelines (lockfile
 * fast path + live-resolve) now share a single traversal driver
 * (`walkAndPin`) that pulls each node's pin from a `ResolutionSource`. Two
 * sources exist:
 *
 *   - {@link createLockfileSource} — replays pins from a v3 lockfile entry,
 *     using parent-aware walk-up to resolve nested copies.
 *   - {@link createRegistrySource} — packument fetch + `pickBestVersion`,
 *     applies overrides per node. Diamond version conflicts are not a
 *     source-level error — the walk handles them.
 *
 * The fast-path/live-path choice is a pre-flight decision before the walk
 * starts: lockfile-source iff a v3 lockfile exists, covers the top-level
 * request, and no override would redirect the locked subgraph to a name
 * the lockfile doesn't pin. Anything else → registry-source.
 *
 * The previously copy-pasted `Pinned = (lockfileEntry | manifest) →
 * PinnedPackage` adapter is now {@link pinToPackage}, called from a single
 * place in `walkAndPin`. Peer-deps hydration, override divergence and
 * tarball download all live in the unified flow.
 */

import type { Vfs } from '@rifty/vfs';
import { type FetchAndUnpackCtx, fetchAndUnpackToCache } from './fetch-and-unpack.ts';
import {
  lockfileCovers,
  lockfileSubgraph,
  pinnedEntryForParent,
  readExistingLockfile,
  writeLockfileIfChanged,
} from './installer-lockfile-reader.ts';
import { type Lockfile, type ResolvedPackage, buildLockfile, link } from './linker.ts';
import { type OverrideMap, resolveOverride } from './overrides.ts';
import type { Packument, RegistryClient, VersionManifest } from './registry.ts';
import { matchesRange, pickBestVersion } from './semver.ts';
import { type TarballCache, VfsTarballCache } from './tarball-cache.ts';
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
 * metadata for the post-resolve warn pass. Since the D-F unification
 * (2026-05-26) `peerDependencies` is also persisted on the lockfile entry
 * so the fast path can hydrate it back and run the same warn pass that
 * live-resolve does — see `LockfileEntry.peerDependencies` in `linker.ts`.
 *
 * M11 (2026-05-27) added `installPath`: the relative path under the
 * project root where this package's files actually live. For a hoisted
 * package the path is `node_modules/<name>`; for a nested package it is
 * `node_modules/<parent>[…]/node_modules/<name>`. The linker writes by
 * this path; the lockfile keys by it. Pre-M11 every package was flat by
 * name, so the path was implicit.
 */
type PinnedPackage = ResolvedPackage & {
  resolved?: string;
  integrity?: string;
  peerDependencies?: Record<string, string>;
  installPath: string;
};

export interface InstallResult {
  packages: ResolvedPackage[];
  lockfile: Lockfile;
  // Retained for shape compatibility; always empty since A-031 made conflicts
  // throw EVERSIONCONFLICT instead of being collected (nested install lands in M11; see ADR 0023).
  conflicts: { name: string; firstVersion: string; secondVersion: string }[];
}

/**
 * Abstract pin: the source-of-truth fields that a `ResolutionSource` returns
 * for a single (name, range, parent) request. `pinToPackage` is the single
 * adapter that turns one of these (plus the fetched tarball bytes) into a
 * `PinnedPackage`. Before D-F (2026-05-26) the assembly logic was duplicated
 * between the fast path and live-resolve and had drifted once already.
 *
 * Post-ADR-0042-follow-on (2026-05-27) `installPath` is set by
 * lockfile-source replay (where placement is dictated by the matched
 * lockfile key) and left `undefined` by live-source (where placement is
 * computed by the walk). This split exists so the fast path always places
 * packages exactly where the lockfile recorded them, regardless of
 * visit-order changes — re-deriving placement on the fast path would risk
 * silent layout drift if the operator reorders `dependencies` between
 * installs.
 */
interface ResolvedPin {
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity?: string;
  readonly dependencies: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  /** Optional dependencies, only relevant on the live-resolve path. The
   * lockfile source returns an empty object — by the time the lockfile was
   * written, optionals that succeeded made it into `dependencies` and ones
   * that didn't were dropped, so there's nothing to re-traverse. */
  readonly optionalDependencies: Record<string, string>;
  /** Pre-determined install path (lockfile-source only). When set, the walk
   *  honours it verbatim; when undefined, the walk applies first-wins-flat
   *  + nest-on-conflict placement. */
  readonly installPath?: string;
}

/**
 * Resolution request context. `parentName` carries the parent package's name
 * (used by the registry source for `parent>child` override scope);
 * `parentInstallPath` carries the parent's actual on-disk path (used by the
 * lockfile source's walk-up lookup). For top-level requests both are root:
 * `parentName` is the project's root name and `parentInstallPath` is `''`.
 */
interface ResolveContext {
  readonly parentName: string | undefined;
  readonly parentInstallPath: string;
}

/**
 * Strategy for "given a (name, range, context), return its pinned form."
 *
 * Two implementations:
 *   - {@link createLockfileSource}: pure lockfile replay, no network. Uses
 *     `parentInstallPath` for the walk-up lookup (ADR-0042 follow-on,
 *     2026-05-27) so nested entries replay correctly.
 *   - {@link createRegistrySource}: packument fetch + pickBestVersion +
 *     overrides. Uses `parentName` for parent-scoped override resolution.
 *
 * Both implementations throw on failure rather than returning `null`. The
 * lockfile source throws `EBROKENLOCK` when a transitive dep is missing or
 * malformed; the registry source throws "No matching version" when an
 * explicit range matches no published version. Diamond version conflicts
 * are NOT a source-level error post-M11 — the walk handles them by nesting
 * the second version under the requesting parent (see {@link walkAndPin}).
 * Either way, the walk fails fast on unrecoverable errors — a partial
 * install is worse than a loud failure.
 */
interface ResolutionSource {
  resolve(name: string, range: string | null, ctx: ResolveContext): Promise<ResolvedPin>;
}

export async function install(
  rootName: string,
  rootVersion: string,
  dependencies: Record<string, string>,
  opts: InstallOptions,
): Promise<InstallResult> {
  const tarballCache: TarballCache = opts.tarballCache ?? new VfsTarballCache(opts.vfs);
  const fetchCtx: FetchAndUnpackCtx = {
    cache: tarballCache,
    getTarball: (url) => opts.registry.getTarball(url),
  };

  // Pre-flight: decide whether to use the lockfile fast path or live-resolve.
  // The choice is made once here; the walk below doesn't care which source
  // it's driving.
  const existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);
  const source = chooseSource(existingLockfile, dependencies, rootName, opts);

  const resolved = await walkAndPin(source, dependencies, rootName, fetchCtx);
  const packages = [...resolved.values()];

  // Peer-warning pass runs on both paths now (D-F, 2026-05-26): the
  // lockfile entries carry `peerDependencies` since this PR, so the
  // observable warn output is the same regardless of whether the install
  // hit the fast path or the live-resolve path.
  warnUnsatisfiedPeers(packages);
  await link(opts.vfs, opts.cwd, packages);
  const lockfile = buildLockfile(rootName, rootVersion, packages);
  // Diff-before-write preserves user-visible mtime when the install was a
  // functional no-op (ADR-0023). `writeLockfileIfChanged` skips the write
  // entirely if the serialized bytes match.
  await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
  return { packages, lockfile, conflicts: [] };
}

/**
 * Pick the resolution strategy. Lockfile fast path wins iff a valid v3
 * lockfile exists, covers every top-level request after override
 * application, and no override redirects the locked subgraph to a name the
 * lockfile doesn't pin. Otherwise we fall through to live-resolve.
 *
 * Pre-ADR-0042-follow-on (2026-05-27) this function additionally bailed
 * whenever the lockfile contained any nested entry. That opt-out is gone
 * now that `createLockfileSource` walks up the parent's install path via
 * `pinnedEntryForParent` — diamond-bearing lockfiles replay in full from
 * the fast path with no packument round-trips.
 */
function chooseSource(
  existingLockfile: Lockfile | null,
  dependencies: Record<string, string>,
  rootName: string,
  opts: InstallOptions,
): ResolutionSource {
  if (existingLockfile) {
    const effectiveRequest = applyOverridesToRequest(dependencies, rootName, opts.overrides);
    const topLevelPins = lockfileCovers(existingLockfile, effectiveRequest);
    if (
      topLevelPins &&
      subgraphFreeOfOverrideDivergence(existingLockfile, topLevelPins, opts.overrides)
    ) {
      return createLockfileSource(existingLockfile);
    }
  }
  return createRegistrySource(opts);
}

/**
 * Single traversal driver. Walks the dependency graph starting from
 * `dependencies` (the top-level request) and, for each node, asks `source`
 * for its pin, decides where the package lives on disk, fetches the
 * tarball, and records the result. Recurses into `dependencies` (always
 * required) and `optionalDependencies` (registry-source only; lockfile-
 * source returns empty optionalDependencies, see `ResolvedPin` doc).
 *
 * **Placement rule (M11 nested install, 2026-05-27).** Per-visit decision:
 *
 *   1. Resolve the pin via `source.resolve`. The lockfile source returns
 *      a `pin.installPath` (the matched entry's lockfile key) — the walk
 *      uses it verbatim. The live source returns `pin.installPath ===
 *      undefined`; the walk then computes placement.
 *   2. If `name` has not yet won a flat (hoisted) slot at `node_modules/<name>`:
 *      take that slot, install path = `node_modules/<name>`.
 *   3. Else, if the flat slot already holds **this same version**: dedupe —
 *      no new fetch, no new entry, no recursion.
 *   4. Else (flat slot holds a different version — diamond conflict): nest
 *      the package under the parent's `node_modules`, install path =
 *      `<parentInstallPath>/node_modules/<name>`.
 *
 * The algorithm is intentionally simpler than npm's full v3 hoisting: a
 * conflicting version always nests under its immediate parent, even when
 * a sibling-ancestor already has a compatible nested copy that Node's
 * resolver could have reused. The result is correct in all cases; the only
 * downside is a few duplicated nested copies in deeply-shared subgraphs,
 * which costs disk but never breaks resolution. The fuller "hoist as high
 * as possible without conflict" algorithm is a follow-on optimisation.
 *
 * Why two placement paths? On lockfile replay we already have a recorded
 * installPath per entry and want the on-disk layout to match the lockfile
 * exactly, regardless of visit order. Live resolve has no such oracle —
 * it computes placement from the first-seen-flat-wins rule. Both paths
 * converge: the lockfile was originally written by the live path, so
 * replaying its paths reproduces the same layout the live walk would
 * have produced for the same visit order.
 *
 * Returns the map keyed by **install path**, not by name, since post-M11
 * the same `name` can appear at multiple paths (one flat + one or more
 * nested copies).
 */
async function walkAndPin(
  source: ResolutionSource,
  topLevelDependencies: Record<string, string>,
  rootName: string,
  fetchCtx: FetchAndUnpackCtx,
): Promise<Map<string, PinnedPackage>> {
  /** What's installed at `node_modules/<name>` (the hoisted slot). */
  const flatByName = new Map<string, string /* version */>();
  /** Every installed copy, keyed by install path. */
  const pinned = new Map<string, PinnedPackage>();

  async function visit(
    name: string,
    range: string | null,
    parentInstallPath: string,
    parentName: string | undefined,
  ): Promise<void> {
    const pin = await source.resolve(name, range, { parentName, parentInstallPath });

    const installPath = pin.installPath ?? choosePlacement(pin, parentInstallPath, flatByName);
    // Keep `flatByName` consistent regardless of which placement path was
    // taken: if the chosen path is the flat slot, record it so any later
    // live-source visit (in a mixed run, were that to ever exist) honours
    // first-wins. Today only one source drives a given install, but the
    // bookkeeping is cheap and removes a foot-gun.
    if (installPath === `node_modules/${pin.name}` && !flatByName.has(pin.name)) {
      flatByName.set(pin.name, pin.version);
    }
    if (pinned.has(installPath)) return;

    const { bytes, integrity } = await fetchAndUnpackToCache(
      {
        name: pin.name,
        version: pin.version,
        resolved: pin.resolved,
        integrity: pin.integrity,
      },
      fetchCtx,
    );
    pinned.set(installPath, await pinToPackage(pin, bytes, integrity, installPath));

    for (const [depName, depRange] of Object.entries(pin.dependencies)) {
      await visit(depName, depRange, installPath, pin.name);
    }
    // Optional deps: try to resolve, warn on failure, never abort the install.
    // npm's contract is that a missing optional dep is non-fatal — typical use
    // case is platform-specific native helpers (fsevents on macOS only, etc).
    // Only the registry source ever returns a non-empty `optionalDependencies`
    // here; the lockfile source has already filtered them down to whatever
    // actually got installed last time.
    for (const [depName, depRange] of Object.entries(pin.optionalDependencies)) {
      try {
        await visit(depName, depRange, installPath, pin.name);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(
          `optional dependency ${depName}@${depRange} of ${pin.name} could not be installed: ${reason}`,
        );
      }
    }
  }

  for (const [depName, depRange] of Object.entries(topLevelDependencies)) {
    await visit(depName, depRange, '', rootName);
  }
  return pinned;
}

/**
 * Live-source placement: first-wins-flat + nest-on-conflict. See
 * `walkAndPin` step 2-4. Returns the install path for `pin`; the caller
 * is responsible for updating `flatByName` (so the same logic can be
 * reused if the lockfile source ever needs to fall back).
 */
function choosePlacement(
  pin: ResolvedPin,
  parentInstallPath: string,
  flatByName: Map<string, string>,
): string {
  const flatVersion = flatByName.get(pin.name);
  if (flatVersion === undefined) {
    flatByName.set(pin.name, pin.version);
    return `node_modules/${pin.name}`;
  }
  if (flatVersion === pin.version) {
    return `node_modules/${pin.name}`;
  }
  return `${parentInstallPath}/node_modules/${pin.name}`;
}

/**
 * Adapter: `ResolvedPin × tarballBytes × actualIntegrity → PinnedPackage`.
 *
 * Single place that knows how to take any pinned-package representation
 * (lockfile entry, registry manifest) plus the verified tarball bytes and
 * assemble the in-memory record that goes into the resolved map. Before
 * D-F (2026-05-26) this logic was copy-pasted across the two pipelines
 * and had already drifted on peer-deps hydration; centralising it kills
 * a whole class of "the fast path forgot to do X" bugs.
 */
async function pinToPackage(
  pin: ResolvedPin,
  bytes: Uint8Array,
  integrity: string,
  installPath: string,
): Promise<PinnedPackage> {
  const files = await extractTarGz(bytes);
  const pkg: PinnedPackage = {
    name: pin.name,
    version: pin.version,
    files,
    dependencies: pin.dependencies,
    resolved: pin.resolved,
    integrity,
    installPath,
  };
  if (pin.peerDependencies && Object.keys(pin.peerDependencies).length > 0) {
    pkg.peerDependencies = pin.peerDependencies;
  }
  return pkg;
}

/**
 * Lockfile-replay source. For each `(name, _range, { parentInstallPath })`,
 * walks up the parent's path via `pinnedEntryForParent` and returns the
 * first matching entry. `range` is ignored — the lockfile records exact
 * versions. `parentName` is ignored — override resolution was pre-validated
 * by `subgraphFreeOfOverrideDivergence` before this source was chosen.
 *
 * Pre-ADR-0042-follow-on (2026-05-27) this source did a bare-name lookup
 * (`node_modules/<name>`) only. That broke for any lockfile with a nested
 * entry, which forced `chooseSource` to opt out of the fast path entirely
 * — one extra packument round-trip per package on every reinstall of any
 * real-world project (express, vite, opencode all hit this). The walk-up
 * lookup lifts that limitation: the lockfile fast path now replays nested
 * placement in full from cache.
 *
 * Returns `pin.installPath = <matched lockfile key>` so the walk places
 * the package exactly where the lockfile recorded it, regardless of visit
 * order — protects against silent layout drift if the operator reorders
 * `dependencies` between installs.
 *
 * Throws `EBROKENLOCK` when no ancestor scope contains the name, or when
 * the matched entry is malformed (missing `resolved` / `integrity`). The
 * pre-2026-05-27 behaviour was to return `null` and let the walk stop
 * with a partial pinned set — corruption disguised as network slowness in
 * user reports. The contract is "lockfile is authoritative or it's an
 * error".
 */
function createLockfileSource(lockfile: Lockfile): ResolutionSource {
  return {
    async resolve(name, _range, ctx): Promise<ResolvedPin> {
      const hit = pinnedEntryForParent(lockfile, name, ctx.parentInstallPath);
      if (!hit) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: lockfile coverage gap — '${name}' is reachable from the dep graph but missing from package-lock.json (searched walk-up from parent path '${ctx.parentInstallPath}'). Delete the lockfile and re-install.`,
          ),
          { code: 'EBROKENLOCK', packageName: name, reason: 'missing-entry' as const },
        );
      }
      const { entry, installPath } = hit;
      if (!entry.resolved || !entry.integrity) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: lockfile entry for '${name}' at '${installPath}' is malformed (missing ${
              !entry.resolved ? 'resolved' : 'integrity'
            }). Delete the lockfile and re-install.`,
          ),
          {
            code: 'EBROKENLOCK',
            packageName: name,
            reason: 'malformed-entry' as const,
          },
        );
      }
      return {
        name,
        version: entry.version,
        resolved: entry.resolved,
        integrity: entry.integrity,
        dependencies: entry.dependencies ?? {},
        peerDependencies: entry.peerDependencies,
        // Optionals already filtered at lockfile-write time; nothing to
        // re-traverse here.
        optionalDependencies: {},
        installPath,
      };
    },
  };
}

/**
 * Live-resolve source. For each (name, range, parent):
 *   1. Apply overrides (user + baked-in) to compute effective name/range.
 *   2. Load the packument (with caching across calls).
 *   3. `pickBestVersion`. When no version satisfies an explicit range we
 *      throw "No matching version" — silently substituting `dist-tags.latest`
 *      would violate the operator's semver intent (caught the 2026-05-27
 *      live-express regression where `^4` was silently resolved to 5.x).
 *   4. Fall back to the existing lockfile entry for an integrity hash when
 *      the manifest doesn't supply one — preserves the partial-re-resolve
 *      cache-warmth behaviour.
 *
 * Diamond version conflicts are NOT detected here post-M11. Each
 * `resolve(name, range, parent)` call independently picks the best version
 * for THAT call's (name, range); the walk decides placement (flat vs
 * nested under parent). Before M11 this source threw `EVERSIONCONFLICT`
 * because the flat-only linker had no way to install two versions of the
 * same name; the live express install (`debug → ms@^2.1` vs
 * `finalhandler → ms@2.0`) made that limitation hard-blocking.
 */
/**
 * Native-dependency gate (ADR-0051, D-005 source #6). rifty runs JS + WASI
 * WASM only — it can never load `.node` addons or execute native compiled
 * binaries. A package whose manifest pins `cpu` to a non-empty set that
 * excludes `wasm` (and isn't a `!`-negation that admits everything else) is a
 * compiled artifact (e.g. `opencode-ai`, `better-sqlite3`, esbuild's
 * `@esbuild/*` platform packages). Throw a clear, actionable error pointing at
 * the documented incompatibility list. `cpu` (not `os`) is the signal: pure-JS
 * packages almost never pin `cpu`, whereas every real native does; `os`-only is
 * a soft warning many JS packages use (`fsevents` is also optional anyway).
 */
function assertNativeSupported(name: string, version: string, manifest: VersionManifest): void {
  const cpu = manifest.cpu;
  if (!Array.isArray(cpu) || cpu.length === 0) return;
  if (cpu.includes('wasm') || cpu.some((c) => c.startsWith('!'))) return;
  throw Object.assign(
    new Error(
      `ENATIVEUNSUPPORTED: '${name}@${version}' ships a native binary ` +
        `(cpu: ${JSON.stringify(cpu)}, os: ${JSON.stringify(manifest.os ?? null)}) that cannot ` +
        `run in rifty's JS+WASI runtime, and no shadow-registry substitution is ` +
        `registered for it. See docs/compat/incompatible-packages.md.`,
    ),
    {
      code: 'ENATIVEUNSUPPORTED',
      packageName: name,
      version,
      reason: 'cpu-constraint',
      platform: { os: manifest.os ?? null, cpu },
    },
  );
}

function createRegistrySource(opts: InstallOptions): ResolutionSource {
  const packumentCache = opts.packumentCache ?? new Map<string, Packument>();
  // Lockfile may still exist (live-resolve was chosen because coverage
  // failed for some top-level pin) — its other entries can still seed
  // integrity for the rest of the graph.
  let existingLockfile: Lockfile | null = null;
  const ensureLockfileLoaded = async (): Promise<Lockfile | null> => {
    if (existingLockfile) return existingLockfile;
    existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);
    return existingLockfile;
  };

  return {
    async resolve(name, range, ctx): Promise<ResolvedPin> {
      const override = resolveOverride(name, ctx.parentName, opts.overrides);
      const effectiveName = override?.name ?? name;
      const effectiveRange = override?.range ?? range;

      let packument = packumentCache.get(effectiveName);
      if (!packument) {
        packument = await opts.registry.getPackument(effectiveName);
        packumentCache.set(effectiveName, packument);
      }
      const versions = Object.keys(packument.versions);
      let pick = pickBestVersion(versions, effectiveRange);
      if (!pick && rangeIsUnconstrained(effectiveRange)) {
        // No explicit range AND `pickBestVersion` returned null — only happens
        // when the packument has zero `versions` entries. A `dist-tags.latest`
        // pointing at an unlisted version is the last resort before failing.
        const tag = packument['dist-tags']?.latest;
        if (tag) pick = tag;
      }
      if (!pick) {
        throw new Error(`No matching version for ${effectiveName}@${effectiveRange ?? '*'}`);
      }

      const manifest = packument.versions[pick];
      if (!manifest) {
        throw new Error(`Packument missing version manifest ${effectiveName}@${pick}`);
      }

      // Native-dependency policy (ADR-0051). A shadow substitution (`override`)
      // already redirected to a trusted (pure-JS) target, so only gate the
      // un-substituted resolution. A required native aborts the install; an
      // OPTIONAL native is caught + warned by `walkAndPin`'s optional loop
      // (so esbuild's `@esbuild/*` platform optionals skip and Vite still
      // installs).
      if (!override) assertNativeSupported(effectiveName, pick, manifest);

      // Resolve the integrity to verify against. Prefer the manifest's pin;
      // fall back to the lockfile entry's pin for the same (name, version)
      // so that a partial re-resolve (e.g. one range bumped) still serves
      // unchanged transitive deps from the cache. When neither source
      // supplies an integrity, `fetchAndUnpackToCache` computes one from
      // the fetched bytes and surfaces it back to us.
      let expectedIntegrity = manifest.dist.integrity;
      if (!expectedIntegrity) {
        const lf = await ensureLockfileLoaded();
        const pinned = lf?.packages[`node_modules/${effectiveName}`];
        if (pinned && pinned.version === pick && pinned.integrity) {
          expectedIntegrity = pinned.integrity;
        }
      }

      return {
        name: effectiveName,
        version: pick,
        resolved: manifest.dist.tarball,
        integrity: expectedIntegrity,
        dependencies: manifest.dependencies ?? {},
        peerDependencies: manifest.peerDependencies,
        optionalDependencies: manifest.optionalDependencies ?? {},
      };
    },
  };
}

/**
 * "No-constraint" ranges that the picker treats as matching every version.
 * Mirrors the special-cases in `matchesRange`; centralised here so the
 * `dist-tags.latest` fallback in {@link createRegistrySource} stays
 * symmetric with the matcher.
 */
function rangeIsUnconstrained(range: string | null | undefined): boolean {
  return !range || range === '*' || range === 'latest' || range === '';
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
