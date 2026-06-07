/**
 * Top-level installer: resolve a name+range, walk transitive deps, fetch
 * tarballs, unpack into the VFS.
 *
 * Placement (ADR-0042): first-wins-flat + nest-on-conflict. A package lives at
 * `node_modules/<name>` when it wins the hoisted slot, else at
 * `<parentInstallPath>/node_modules/<name>`. The walk nests conflicts instead
 * of aborting (`EVERSIONCONFLICT` is dead).
 *
 * ADR-0023: subsequent invocations replay the existing `package-lock.json` and
 * skip network calls when the pin still satisfies the range. Tarballs are
 * cached at `/.rifty/tarball-cache/` so an absent lockfile won't re-download
 * once the cache is warm. The fast path also handles nested entries — see
 * `createLockfileSource` / `pinnedEntryForParent`.
 *
 * Pipeline (D-F unification): the lockfile fast path and live-resolve share one
 * traversal driver (`walkAndPin`) that pulls each node's pin from a
 * `ResolutionSource`:
 *
 *   - {@link createLockfileSource} — replays pins from a v3 lockfile entry,
 *     parent-aware walk-up for nested copies.
 *   - {@link createRegistrySource} — packument fetch + `pickBestVersion`,
 *     applies overrides per node.
 *
 * The fast-path/live-path choice is made once pre-flight (see {@link
 * chooseSource}); the walk doesn't care which source it drives. {@link
 * pinToPackage} is the single adapter from a resolved pin + tarball bytes to a
 * `PinnedPackage`.
 */

import type { Vfs } from '@riftydev/vfs';
import {
  type FetchAndUnpackCtx,
  type FetchAndUnpackResult,
  fetchAndUnpackToCache,
} from './fetch-and-unpack.ts';
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
import { Semaphore } from './utils/semaphore.ts';

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

/** ResolvedPackage + lockfile provenance + peer-dep metadata for the warn pass.
 * `peerDependencies` is persisted on the lockfile entry (D-F) so the fast path
 * hydrates it back and runs the same warn pass live-resolve does.
 *
 * `installPath` (M11) is the package's relative path under the project root:
 * `node_modules/<name>` when hoisted, else
 * `node_modules/<parent>[…]/node_modules/<name>`. The linker writes by it; the
 * lockfile keys by it.
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
  /** Retained for shape compat; always empty since M11 nests conflicts (ADR-0042). */
  conflicts: { name: string; firstVersion: string; secondVersion: string }[];
}

/**
 * Source-of-truth fields a `ResolutionSource` returns for a single (name,
 * range, parent) request; {@link pinToPackage} adapts it (+ tarball bytes) into
 * a `PinnedPackage`.
 */
interface ResolvedPin {
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity?: string;
  readonly dependencies: Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  /** Live-resolve only. The lockfile source returns `{}`: at write time,
   * succeeding optionals were folded into `dependencies` and failures dropped,
   * so there's nothing to re-traverse. */
  readonly optionalDependencies: Record<string, string>;
  /** Pre-determined install path (lockfile-source only). When set, the walk
   *  honours it verbatim, so the fast path always reproduces the recorded
   *  layout regardless of visit order; when undefined, the walk computes
   *  first-wins-flat + nest-on-conflict placement. */
  readonly installPath?: string;
}

/**
 * `parentName` scopes `parent>child` overrides (registry source);
 * `parentInstallPath` drives the lockfile source's walk-up lookup. Top-level:
 * `parentName` = root name, `parentInstallPath` = `''`.
 */
interface ResolveContext {
  readonly parentName: string | undefined;
  readonly parentInstallPath: string;
}

/**
 * Strategy for "given a (name, range, context), return its pinned form."
 * {@link createLockfileSource} replays a lockfile (no network);
 * {@link createRegistrySource} fetches packuments + applies overrides.
 *
 * Both throw on failure rather than returning `null` (a partial install is
 * worse than a loud failure): lockfile → `EBROKENLOCK` on a missing/malformed
 * entry; registry → "No matching version". Diamond conflicts are not a
 * source-level error — the walk nests the second version (see {@link
 * walkAndPin}).
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

  const existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);
  const source = chooseSource(existingLockfile, dependencies, rootName, opts);

  const resolved = await walkAndPin(source, dependencies, rootName, fetchCtx);
  const packages = [...resolved.values()];

  // Runs on both paths (D-F): lockfile entries carry `peerDependencies`, so
  // warn output is identical whichever path the install took.
  warnUnsatisfiedPeers(packages);
  await link(opts.vfs, opts.cwd, packages);
  const lockfile = buildLockfile(rootName, rootVersion, packages);
  // Diff-before-write preserves user-visible mtime on a no-op install (ADR-0023).
  await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
  return { packages, lockfile, conflicts: [] };
}

/**
 * Pick the resolution strategy. Lockfile fast path wins iff a valid v3 lockfile
 * exists, covers every top-level request after override application, and no
 * override redirects the locked subgraph to an unpinned name. Else live-resolve.
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
 * Single traversal driver: for each node, ask `source` for its pin, decide
 * placement, fetch the tarball, record it, recurse into `dependencies` and
 * `optionalDependencies` (registry-source only).
 *
 * Placement rule (M11):
 *   1. Lockfile source returns a `pin.installPath` — use it verbatim; live
 *      source returns `undefined` and the walk computes placement.
 *   2. Name has no flat slot yet → take `node_modules/<name>`.
 *   3. Flat slot holds the same version → dedupe (no fetch/entry/recursion).
 *   4. Diamond conflict → nest under parent: `<parentInstallPath>/node_modules/<name>`.
 *
 * Intentionally simpler than npm v3 hoisting: a conflict always nests under its
 * immediate parent even when a sibling-ancestor has a reusable nested copy.
 * Correct in all cases; costs a few duplicated nested copies (disk, never
 * resolution). Full "hoist as high as possible" is a follow-on.
 *
 * Two paths converge because the lockfile was written by the live path, so
 * replaying its recorded paths reproduces the live layout for the same visit
 * order — and replay matches the lockfile regardless of visit order.
 *
 * Keyed by **install path**, not name: post-M11 one name can sit at several
 * paths (one flat + nested copies).
 */
async function walkAndPin(
  source: ResolutionSource,
  topLevelDependencies: Record<string, string>,
  rootName: string,
  fetchCtx: FetchAndUnpackCtx,
): Promise<Map<string, PinnedPackage>> {
  // Determinism-vs-throughput invariant (#24, perf-audit 2026-06-05): the
  // placement walk (resolve -> choosePlacement -> flatByName claim -> recurse)
  // stays STRICTLY SERIAL and REQUEST-ORDERED. First-wins-flat is claimed AFTER
  // `await source.resolve` (version known only post-resolve), so the claim
  // straddles an await; running placement concurrently would make which version
  // wins the flat slot depend on resolve-completion order, not request order,
  // breaking the express-diamond contract (installer.test.ts:225 — ms@2.1.3
  // flat, ms@2.0.0 nested). ONLY the tarball fetch is parallelized (bounded
  // semaphore): tarball bytes feed extractTarGz/files alone, never the dep walk
  // (pin.dependencies comes from the packument/lockfile, not the tarball), so
  // fetch order cannot perturb layout. Concurrent same-(name,version) fetches
  // dedupe to one network call via `inFlight`. ONE exception to the deferred
  // fetch: an OPTIONAL-boundary node awaits its own fetch BEFORE recursing (see
  // the `isOptionalBoundary` site) so a failed optional fetch skips its WHOLE
  // subtree before it is walked — npm parity, and identical to the old serial
  // walk. Tree + on-disk layout identical to the serial version =>
  // behavior-preserving (ADR-0081 rule 4 does not fire; CHANGELOG-only).
  const FETCH_CONCURRENCY = 8; // perf knob only; any value yields the identical tree.
  const sem = new Semaphore(FETCH_CONCURRENCY);

  /** What's installed at `node_modules/<name>` (the hoisted slot). */
  const flatByName = new Map<string, string /* version */>();
  /** Every installed copy, keyed by install path. */
  const pinned = new Map<string, PinnedPackage>();
  /** Install paths already scheduled this walk (synchronous path-level dedup,
   * replaces `pinned.has` since `pinned` is now populated at the await site). */
  const scheduled = new Set<string>();
  /** Collapse concurrent same-(name,version) fetches to one network call. */
  const inFlight = new Map<string, Promise<FetchAndUnpackResult>>();
  /** Deferred fetch tasks; `optional` carries the warn descriptor (or null). */
  const fetchTasks: Array<{
    promise: Promise<FetchAndUnpackResult>;
    pin: ResolvedPin;
    installPath: string;
    optional: { depName: string; depRange: string; parentName: string } | null;
  }> = [];

  function visit(
    name: string,
    range: string | null,
    parentInstallPath: string,
    parentName: string | undefined,
    // When set, this node (and its subtree) is reached via an optional dep; a
    // fetch failure warns-and-skips instead of aborting, with this descriptor.
    optional: { depName: string; depRange: string; parentName: string } | null,
  ): Promise<void> {
    return (async () => {
      const pin = await source.resolve(name, range, { parentName, parentInstallPath });

      const installPath = pin.installPath ?? choosePlacement(pin, parentInstallPath, flatByName);
      // Record the flat slot so a later live-source visit honours first-wins.
      // Only one source drives a given install today, but the bookkeeping is
      // cheap and removes a foot-gun in a hypothetical mixed run.
      if (installPath === `node_modules/${pin.name}` && !flatByName.has(pin.name)) {
        flatByName.set(pin.name, pin.version);
      }
      if (scheduled.has(installPath)) return;
      scheduled.add(installPath);

      // Defer the fetch through the bounded semaphore; dedupe concurrent
      // same-(name,version) fetches (flat + nested same-version, or two parents
      // racing the same version) to a single network call.
      const key = `${pin.name}@${pin.version}`;
      let p = inFlight.get(key);
      if (!p) {
        p = sem.run(() =>
          fetchAndUnpackToCache(
            {
              name: pin.name,
              version: pin.version,
              resolved: pin.resolved,
              integrity: pin.integrity,
            },
            fetchCtx,
          ),
        );
        inFlight.set(key, p);
      }

      // Optional-subtree skip-on-failure (npm parity, regression fix): when THIS
      // node IS the optional boundary (reached as a direct optional child), its
      // fetch must be awaited BEFORE recursing, exactly like the old serial walk.
      // If it rejects, the throw propagates to the parent's optional try/catch
      // (warn-and-skip) before any child `visit` runs, so the WHOLE optional
      // subtree — the dep and its transitive required children — is skipped
      // (not pinned, not on disk). Recursing first (the required-dep fast path)
      // would orphan those required grandchildren on a failed optional fetch,
      // diverging from real npm. Required deps keep the deferred/concurrent
      // fetch; only the boundary trades concurrency for correctness here.
      const isOptionalBoundary =
        optional !== null && optional.depName === name && optional.parentName === parentName;
      if (isOptionalBoundary) {
        // Awaits here (and pins on success) instead of deferring to `fetchTasks`,
        // so a rejection skips the subtree before it is walked.
        const result = await p;
        if (!pinned.has(installPath)) {
          pinned.set(
            installPath,
            await pinToPackage(pin, result.bytes, result.integrity, installPath),
          );
        }
      } else {
        fetchTasks.push({ promise: p, pin, installPath, optional });
      }

      // Recurse: deps are known from the resolved pin, not the tarball bytes, so
      // traversal order / placement is unchanged. For the optional boundary the
      // fetch above already settled, so a failed optional never reaches here.
      // Required children of an optional boundary INHERIT `optional`, so a later
      // failed grandchild is warned-and-skipped while surviving siblings still
      // pin — rifty SALVAGES the optional subtree's survivors rather than doing
      // npm's atomic-rollback. Characterization-pinned; see Q-2026-06-07-324.
      for (const [depName, depRange] of Object.entries(pin.dependencies)) {
        await visit(depName, depRange, installPath, pin.name, optional);
      }
      // npm contract: a missing optional dep is non-fatal (typically
      // platform-specific native helpers like fsevents). A resolve-time failure
      // is caught here; a fetch-time failure is attributed at the await site via
      // the `optional` descriptor propagated into the subtree.
      for (const [depName, depRange] of Object.entries(pin.optionalDependencies)) {
        const desc = { depName, depRange, parentName: pin.name };
        try {
          await visit(depName, depRange, installPath, pin.name, desc);
        } catch (err) {
          warnOptional(desc, err);
        }
      }
    })();
  }

  for (const [depName, depRange] of Object.entries(topLevelDependencies)) {
    await visit(depName, depRange, '', rootName, null);
  }

  // The ordered walk has assigned every installPath; now await the parallelized
  // fetches and build `pinned`. A required-dep fetch failure rejects; an
  // optional-dep fetch failure warns-and-skips (preserving the exact message),
  // mirroring the old serial loop. Settle all so one optional failure can't
  // strand siblings already in flight.
  const results = await Promise.allSettled(fetchTasks.map((t) => t.promise));
  for (let i = 0; i < fetchTasks.length; i++) {
    const task = fetchTasks[i];
    const outcome = results[i];
    if (!task || !outcome) continue;
    if (outcome.status === 'rejected') {
      if (task.optional) {
        warnOptional(task.optional, outcome.reason);
        continue;
      }
      throw outcome.reason;
    }
    if (pinned.has(task.installPath)) continue;
    pinned.set(
      task.installPath,
      await pinToPackage(task.pin, outcome.value.bytes, outcome.value.integrity, task.installPath),
    );
  }
  return pinned;
}

/** Emit the existing optional-dependency warn message verbatim. */
function warnOptional(
  desc: { depName: string; depRange: string; parentName: string },
  err: unknown,
): void {
  const reason = err instanceof Error ? err.message : String(err);
  console.warn(
    `optional dependency ${desc.depName}@${desc.depRange} of ${desc.parentName} could not be installed: ${reason}`,
  );
}

/** Live-source placement: first-wins-flat + nest-on-conflict (`walkAndPin` step 2-4). */
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
 * Adapter: `ResolvedPin × tarballBytes × actualIntegrity → PinnedPackage`. The
 * single assembly point for both sources — before D-F this was copy-pasted and
 * had drifted on peer-deps hydration.
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
 * Lockfile-replay source. Walks up the parent's path via `pinnedEntryForParent`
 * and returns the first matching entry. `range` is ignored (the lockfile pins
 * exact versions); `parentName` is ignored (override divergence pre-validated by
 * `subgraphFreeOfOverrideDivergence`). Returns `installPath = <matched lockfile
 * key>` so the walk reproduces the recorded layout regardless of visit order.
 *
 * Throws `EBROKENLOCK` on a missing or malformed (no `resolved`/`integrity`)
 * entry: the contract is "lockfile is authoritative or it's an error".
 * Returning `null` would leave a partial set that reads as network slowness.
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
        // Optionals already filtered at lockfile-write time.
        optionalDependencies: {},
        installPath,
      };
    },
  };
}

/**
 * Native-dependency gate (ADR-0051, D-005 source #6). rifty runs JS + WASI WASM
 * only — never `.node` addons or native binaries. A manifest pinning `cpu` to a
 * non-empty set that excludes `wasm` (and isn't a `!`-negation admitting
 * everything else) is a compiled artifact (`better-sqlite3`, esbuild's
 * `@esbuild/*` platform packages). `cpu` (not `os`) is the signal: pure-JS rarely
 * pins it, every real native does; `os`-only is a soft warning many JS packages
 * use.
 */
function assertNativeSupported(name: string, version: string, manifest: VersionManifest): void {
  const cpu = manifest.cpu;
  if (!Array.isArray(cpu) || cpu.length === 0) return;
  if (cpu.includes('wasm') || cpu.some((c) => c.startsWith('!'))) return;
  throw Object.assign(
    new Error(
      `ENATIVEUNSUPPORTED: '${name}@${version}' ships a native binary (cpu: ${JSON.stringify(cpu)}, os: ${JSON.stringify(manifest.os ?? null)}) that cannot run in rifty's JS+WASI runtime, and no shadow-registry substitution is registered for it. See docs/compat/incompatible-packages.md.`,
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

/**
 * Live-resolve source: apply overrides, fetch packument (cached),
 * `pickBestVersion`. Throws "No matching version" rather than silently
 * substituting `dist-tags.latest` — that would violate the operator's semver
 * intent (caught the live-express regression where `^4` resolved to 5.x).
 * Diamond conflicts are not detected here post-M11; each call picks the best
 * version for its own (name, range) and the walk decides placement.
 */
function createRegistrySource(opts: InstallOptions): ResolutionSource {
  const packumentCache = opts.packumentCache ?? new Map<string, Packument>();
  // Live-resolve was chosen because coverage failed for some top-level pin, but
  // the lockfile's other entries can still seed integrity for the rest.
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
        // Unconstrained range with no pick: packument has zero `versions`.
        // `dist-tags.latest` (possibly unlisted) is the last resort.
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

      // ADR-0051. A shadow override already redirected to a trusted pure-JS
      // target, so only gate the un-substituted resolution. A required native
      // aborts; an optional one is caught + warned by `walkAndPin` (so esbuild's
      // `@esbuild/*` optionals skip and Vite still installs).
      if (!override) assertNativeSupported(effectiveName, pick, manifest);

      // Prefer the manifest's integrity; fall back to the lockfile entry's so a
      // partial re-resolve still serves unchanged transitive deps from cache.
      // Neither present → `fetchAndUnpackToCache` computes it from the bytes.
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
 * "No-constraint" ranges that match every version. Mirrors `matchesRange`'s
 * special-cases so the `dist-tags.latest` fallback in {@link
 * createRegistrySource} stays symmetric with the matcher.
 */
function rangeIsUnconstrained(range: string | null | undefined): boolean {
  return !range || range === '*' || range === 'latest' || range === '';
}

/**
 * Apply overrides to the top-level request, yielding effective names → ranges
 * (unmatched names kept verbatim). The fast path queries the lockfile for the
 * names that would actually install — without this, adding `"overrides": {
 * "bcrypt": "bcryptjs" }` after the lockfile was written would silently no-op,
 * since replay would use the original `bcrypt` pin.
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
      // null range ("latest") has no lockfile-pinnable range, so reuse the
      // request's `range`; an operator wanting a specific one writes it into
      // the override target (`"bcrypt": "bcryptjs@2.x"`).
      out[override.name] = override.range ?? range;
    } else {
      out[name] = range;
    }
  }
  return out;
}

/**
 * Walk the lockfile subgraph reachable from the top-level pins; return `false`
 * (forcing live-resolve) if any locked name would be redirected by an override
 * to a name the lockfile doesn't pin.
 *
 * Uses the global (no-parent) `resolveOverride` for transitive entries because
 * the v3 flat lockfile loses parent context — slightly over-eager (a
 * non-applicable `parent>child` override still triggers fallthrough), but the
 * cost is one extra live-resolve vs. silently ignoring an override.
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
    // Redirect to a different name → the lockfile would need that name pinned.
    if (override.name !== name) return false;
    // Same name, narrower range: if the locked version no longer satisfies it,
    // replay would silently differ from live-resolve.
    if (override.range) {
      const entry = lockfile.packages[`node_modules/${name}`];
      if (!entry || !matchesRange(entry.version, override.range)) return false;
    }
  }
  return true;
}

/**
 * Warn once per missing peer dependency. Intentionally checks presence only,
 * not whether the installed version satisfies the range — range-level
 * peer-resolution is its own milestone.
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
