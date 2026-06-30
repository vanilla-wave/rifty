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

import { NotImplementedError } from '@riftydev/io';
import { type Vfs, joinPath } from '@riftydev/vfs';
import { unpackEddyBundle } from './eddy-bundle.ts';
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
import {
  type TarballCache,
  VfsTarballCache,
  computeIntegrity,
  parseIntegrityAlgorithm,
} from './tarball-cache.ts';
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
  /**
   * Per-package progress hook (ADR-0134). Fires once per unique (name,
   * version) when its tarball resolves (cache or network), on both the
   * lockfile fast path and live resolve; failed fetches (incl. skipped
   * optionals) never fire. Order is fetch-completion order, not dependency
   * order. A throw is caught + warned — a progress sink must not abort an
   * install.
   */
  onPackage?: (event: InstallProgressEvent) => void;
  /**
   * Opt-in eddy fast path (ADR-0182). When set, and no covering lockfile
   * already gives the zero-network fast path, the client POSTs the dep-set to
   * this resolver, verifies the returned `EddyBundleV1` (bytes vs the bundle's
   * integrity — non-disableable, mirror-grade trust), pre-seeds the tarball
   * cache + writes the lockfile, then the existing lockfile fast path installs
   * with zero packument network. Default OFF; the URL comes only from explicit
   * env-config (D-004), never a baked default. ANY failure → standard verifying
   * install (warn, never throw-because-fast-path-down). See `InstallResult.source`.
   */
  resolverUrl?: string;
  /**
   * Forwarded to the resolver: `'online'` forces a fresh server-side recompute
   * (npm `--prefer-online` analogue); `'cached'` (default) uses eddy's bounded
   * resolution cache (`--prefer-offline` analogue). Inert without `resolverUrl`.
   */
  prefer?: 'cached' | 'online';
}

/** Payload for {@link InstallOptions.onPackage}. */
export interface InstallProgressEvent {
  readonly name: string;
  readonly version: string;
  /** True when the tarball came from the tarball cache, false from network. */
  readonly cacheHit: boolean;
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
  /**
   * Which path produced this install (ADR-0182 provenance). `'eddy'` when the
   * opt-in fast path seeded the cache + lockfile; `'standard'` otherwise
   * (resolver off, or it declined/failed and the verifying install ran).
   * Always set by {@link install}; optional only so pre-ADR-0182 result literals
   * (test fakes) stay valid — read it as `result.source ?? 'standard'`.
   */
  source?: 'eddy' | 'standard';
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
  readonly bin?: string | Record<string, string>;
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

interface NormalizedInstallRequest {
  readonly rootName: string;
  readonly rootVersion: string;
  readonly dependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
  readonly opts: InstallOptions;
}

interface SourcePlan {
  readonly source: ResolutionSource;
  readonly dependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
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
  prefetch?(name: string, range: string | null, ctx: ResolveContext): void;
}

export async function install(opts: InstallOptions): Promise<InstallResult>;
export async function install(
  rootName: string,
  rootVersion: string,
  opts: InstallOptions,
): Promise<InstallResult>;
export async function install(
  rootName: string,
  rootVersion: string,
  dependencies: Record<string, string>,
  opts: InstallOptions,
): Promise<InstallResult>;
export async function install(
  rootNameOrOpts: string | InstallOptions,
  rootVersion?: string,
  dependenciesOrOpts?: Record<string, string> | InstallOptions,
  maybeOpts?: InstallOptions,
): Promise<InstallResult> {
  const request = await normalizeInstallArgs(
    rootNameOrOpts,
    rootVersion,
    dependenciesOrOpts,
    maybeOpts,
  );
  const {
    rootName,
    rootVersion: normalizedRootVersion,
    dependencies,
    optionalDependencies,
    opts,
  } = request;
  const tarballCache: TarballCache = opts.tarballCache ?? new VfsTarballCache(opts.vfs);
  const fetchCtx: FetchAndUnpackCtx = {
    cache: tarballCache,
    getTarball: (url) => opts.registry.getTarball(url),
  };

  let existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);

  // ADR-0182 opt-in fast path: when a resolver is configured AND no covering
  // lockfile already gives the zero-network fast path, fetch + verify eddy's
  // bundle, then seed the cache + write the lockfile so the existing fast path
  // below runs with zero packument network. Pre-seeding the (already
  // integrity-verified) tarballs and writing the lockfile happen ONLY after
  // every check passes, so any failure leaves the pre-existing lockfile
  // untouched and the standard verifying install runs (warn, never throw).
  let source: 'eddy' | 'standard' = 'standard';
  if (
    opts.resolverUrl &&
    !hasLockfileFastPath(existingLockfile, dependencies, optionalDependencies, rootName, opts)
  ) {
    const seeded = await tryEddyFastPath(
      opts,
      rootName,
      dependencies,
      optionalDependencies,
      tarballCache,
    );
    if (seeded) {
      source = 'eddy';
      existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);
    }
  }

  const plan = chooseSource(existingLockfile, dependencies, optionalDependencies, rootName, opts);

  const resolved = await walkAndPin(
    plan.source,
    plan.dependencies,
    plan.optionalDependencies,
    rootName,
    fetchCtx,
    opts.onPackage,
  );
  const packages = [...resolved.values()];

  // Runs on both paths (D-F): lockfile entries carry `peerDependencies`, so
  // warn output is identical whichever path the install took.
  warnUnsatisfiedPeers(packages);
  await link(opts.vfs, opts.cwd, packages);
  const lockfile = buildLockfile(rootName, normalizedRootVersion, packages);
  // Diff-before-write preserves user-visible mtime on a no-op install (ADR-0023).
  await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
  return { packages, lockfile, conflicts: [], source };
}

async function normalizeInstallArgs(
  rootNameOrOpts: string | InstallOptions,
  rootVersion: string | undefined,
  dependenciesOrOpts: Record<string, string> | InstallOptions | undefined,
  maybeOpts: InstallOptions | undefined,
): Promise<NormalizedInstallRequest> {
  let rootName: string | undefined;
  let normalizedRootVersion: string | undefined;
  let dependencies: Record<string, string> | undefined;
  let optionalDependencies: Record<string, string> = {};
  let opts: InstallOptions | undefined;
  let shouldReadPackageJson = false;

  if (isInstallOptions(rootNameOrOpts)) {
    opts = rootNameOrOpts;
    shouldReadPackageJson = true;
  } else {
    rootName = rootNameOrOpts;
    normalizedRootVersion = rootVersion;
    if (isInstallOptions(dependenciesOrOpts)) {
      opts = dependenciesOrOpts;
      shouldReadPackageJson = true;
    } else {
      dependencies = dependenciesOrOpts;
      opts = maybeOpts;
    }
  }

  if (!opts) throw new TypeError('install() missing InstallOptions');

  if (shouldReadPackageJson) {
    const manifest = await readRootPackageJson(opts.vfs, opts.cwd);
    rootName = rootName ?? manifest.name ?? 'root';
    normalizedRootVersion = normalizedRootVersion ?? manifest.version ?? '0.0.0';
    dependencies = { ...manifest.devDependencies, ...manifest.dependencies };
    optionalDependencies = { ...manifest.optionalDependencies };
    for (const name of Object.keys(optionalDependencies)) {
      delete dependencies[name];
    }
    opts = {
      ...opts,
      overrides: mergeOverrides(manifest.overrides, opts.overrides),
    };
  }

  dependencies ??= {};
  rootName ??= 'root';
  normalizedRootVersion ??= '0.0.0';
  assertRegistryDependencySpecs(dependencies, optionalDependencies);
  assertRegistryOverrideTargets(opts.overrides);
  return { rootName, rootVersion: normalizedRootVersion, dependencies, optionalDependencies, opts };
}

function isInstallOptions(value: unknown): value is InstallOptions {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<InstallOptions>;
  return !!candidate.vfs && typeof candidate.cwd === 'string' && !!candidate.registry;
}

interface RootPackageJson {
  readonly name?: string;
  readonly version?: string;
  readonly dependencies: Record<string, string>;
  readonly devDependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
  readonly overrides: OverrideMap;
}

async function readRootPackageJson(vfs: Vfs, cwd: string): Promise<RootPackageJson> {
  const text = await vfs.readFileText(joinPath(cwd, 'package.json'));
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`package.json at ${joinPath(cwd, 'package.json')} must be a JSON object`);
  }
  const raw = parsed as Record<string, unknown>;
  assertNoLifecycleScripts(readStringRecord(raw, 'scripts'));
  return {
    name: typeof raw.name === 'string' ? raw.name : undefined,
    version: typeof raw.version === 'string' ? raw.version : undefined,
    dependencies: readStringRecord(raw, 'dependencies'),
    devDependencies: readStringRecord(raw, 'devDependencies'),
    optionalDependencies: readStringRecord(raw, 'optionalDependencies'),
    overrides: readStringRecord(raw, 'overrides'),
  };
}

function readStringRecord(source: Record<string, unknown>, field: string): Record<string, string> {
  const value = source[field];
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`package.json#${field} must be an object of string values`);
  }
  const out: Record<string, string> = {};
  for (const [name, range] of Object.entries(value as Record<string, unknown>)) {
    if (typeof range !== 'string') {
      // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
      throw new NotImplementedError(
        `npm-client.package-json.${field}`,
        'nested/non-string entries',
      );
    }
    out[name] = range;
  }
  return out;
}

function mergeOverrides(
  fromPackageJson: OverrideMap,
  fromOptions: OverrideMap | undefined,
): OverrideMap | undefined {
  const merged = { ...fromPackageJson, ...(fromOptions ?? {}) };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function assertRegistryDependencySpecs(
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
): void {
  for (const [name, range] of Object.entries({ ...dependencies, ...optionalDependencies })) {
    const feature = unsupportedDependencyName(name) ?? unsupportedDependencySpec(range);
    if (feature) {
      // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
      throw new NotImplementedError(
        `npm-client.dependency-spec.${feature}`,
        `${name}@${range} is outside registry semver/tag installs`,
      );
    }
  }
}

function assertRegistryOverrideTargets(overrides: OverrideMap | undefined): void {
  if (!overrides) return;
  for (const [name, target] of Object.entries(overrides)) {
    const feature = unsupportedOverrideTargetSpec(target);
    if (!feature) continue;
    // TODO(backlog: npm-client/tar-symlink-and-nonregistry-dep-tracking)
    throw new NotImplementedError(
      `npm-client.dependency-spec.${feature}`,
      `override ${name} -> ${target} is outside registry semver/tag installs`,
    );
  }
}

function unsupportedDependencySpec(range: string): string | null {
  const spec = range.trim();
  if (spec === '.' || spec === '..') return 'file';
  if (/^(?:\.{0,2}\/|\/)/.test(spec)) return 'file';
  if (/^(file|link):/.test(spec)) return 'file';
  if (spec.startsWith('workspace:')) return 'workspace';
  if (/^(git\+|git:|github:|gitlab:|bitbucket:)/.test(spec) || /\.git(?:#|$)/.test(spec)) {
    return 'git';
  }
  if (/^https?:/.test(spec)) return 'http-tarball';
  if (spec.startsWith('npm:')) return 'npm-alias';
  if (isGithubShorthand(spec)) return 'git';
  return null;
}

function unsupportedDependencyName(name: string): string | null {
  return name.includes('/') && !name.startsWith('@') ? 'git' : null;
}

function isGithubShorthand(spec: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[#@].+)?$/.test(spec);
}

function unsupportedOverrideTargetSpec(target: string): string | null {
  const raw = target.trim();
  const withoutAlias = raw.startsWith('npm:') ? raw.slice(4) : raw;
  const direct = unsupportedDependencySpec(withoutAlias);
  if (direct) return direct;
  const at = withoutAlias.lastIndexOf('@');
  if (at <= 0) return null;
  return unsupportedDependencySpec(withoutAlias.slice(at + 1));
}

const ROOT_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare'] as const;
const REGISTRY_TARBALL_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const;

function assertNoLifecycleScripts(
  scripts: Record<string, string> | undefined,
  lifecycleScripts: readonly string[] = ROOT_LIFECYCLE_SCRIPTS,
): void {
  if (!scripts) return;
  for (const name of lifecycleScripts) {
    if (scripts[name] === undefined) continue;
    throw new NotImplementedError(`npm-client.lifecycle.${name}`);
  }
}

/**
 * Would {@link chooseSource} take the zero-network lockfile fast path for this
 * request? Used to skip the eddy round-trip when a covering lockfile already
 * exists (eddy is the COLD-install optimizer). Mirrors chooseSource's
 * lockfile-path condition exactly — keep the two in sync.
 */
function hasLockfileFastPath(
  existingLockfile: Lockfile | null,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  opts: InstallOptions,
): boolean {
  if (!existingLockfile) return false;
  const request = {
    ...applyOverridesToRequest(dependencies, rootName, opts.overrides),
    ...applyOverridesToRequest(optionalDependencies, rootName, opts.overrides),
  };
  const pins = lockfileCovers(existingLockfile, request);
  return !!pins && subgraphFreeOfOverrideDivergence(existingLockfile, pins, opts.overrides);
}

/**
 * ADR-0182 opt-in fast path. POST the dep-set to the resolver, verify the
 * returned `EddyBundleV1` (bytes vs the bundle integrity — NON-disableable,
 * mirror-grade trust), check the bundle lockfile covers the request, then —
 * only after every check passes — pre-seed the tarball cache + write the
 * lockfile. Returns `true` on success (the existing fast path then runs with
 * zero packument network); on ANY failure mode (unreachable, HTTP error,
 * malformed bundle, integrity mismatch, coverage gap, typed `unsupported`
 * decline) it warns and returns `false`, leaving the pre-existing lockfile
 * untouched so the standard verifying install runs. Never throws.
 */
async function tryEddyFastPath(
  opts: InstallOptions,
  rootName: string,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  tarballCache: TarballCache,
): Promise<boolean> {
  const url = opts.resolverUrl;
  if (!url) return false;
  try {
    const requestBody: Record<string, unknown> = { dependencies, optionalDependencies };
    if (opts.overrides) requestBody.overrides = opts.overrides;
    if (opts.prefer) requestBody.prefer = opts.prefer;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) return declineEddy(`resolver returned HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const decline = (await response.json().catch(() => null)) as { feature?: string } | null;
      return declineEddy(`resolver declined (${decline?.feature ?? 'unsupported'})`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    const { lockfileText, tarballs } = unpackEddyBundle(bytes);
    const lockfile = JSON.parse(lockfileText) as Lockfile;

    // Mirror-grade trust (ADR-0182 §5): verify each tarball's bytes against the
    // integrity the BUNDLE carries (not npm source-of-truth). Non-disableable.
    for (const { entry, bytes: tgz } of tarballs) {
      const algorithm = parseIntegrityAlgorithm(entry.integrity);
      if (!algorithm) {
        return declineEddy(`unparseable integrity for ${entry.name}@${entry.version}`);
      }
      if ((await computeIntegrity(tgz, algorithm)) !== entry.integrity) {
        return declineEddy(`integrity mismatch for ${entry.name}@${entry.version}`);
      }
    }

    // Coverage gap → fallback (no partial install). Same condition the fast
    // path uses, so a pass here guarantees `chooseSource` takes the fast path.
    const effectiveRequest = {
      ...applyOverridesToRequest(dependencies, rootName, opts.overrides),
      ...applyOverridesToRequest(optionalDependencies, rootName, opts.overrides),
    };
    if (!lockfileCovers(lockfile, effectiveRequest)) {
      return declineEddy('bundle lockfile does not cover the requested dependencies');
    }

    for (const { entry, bytes: tgz } of tarballs) {
      await tarballCache.put(entry.name, entry.version, entry.integrity, tgz);
    }
    await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
    return true;
  } catch (err) {
    return declineEddy(err instanceof Error ? err.message : String(err));
  }
}

function declineEddy(reason: string): false {
  console.warn(`npm: fast install (eddy) unavailable, using standard install — ${reason}`);
  return false;
}

/**
 * Pick the resolution strategy. Lockfile fast path wins iff a valid v3 lockfile
 * exists, covers every top-level request after override application, and no
 * override redirects the locked subgraph to an unpinned name. Else live-resolve.
 */
function chooseSource(
  existingLockfile: Lockfile | null,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  opts: InstallOptions,
): SourcePlan {
  const effectiveDependencies = applyOverridesToRequest(dependencies, rootName, opts.overrides);
  const effectiveOptionalDependencies = applyOverridesToRequest(
    optionalDependencies,
    rootName,
    opts.overrides,
  );
  if (existingLockfile) {
    // TODO(backlog: npm-client/lockfile-fast-path-failed-optionals) — a root
    // optional that failed resolution is absent from the lockfile, so including
    // optionals here defeats the fast path on every subsequent install.
    const effectiveRequest = { ...effectiveDependencies, ...effectiveOptionalDependencies };
    const topLevelPins = lockfileCovers(existingLockfile, effectiveRequest);
    if (
      topLevelPins &&
      subgraphFreeOfOverrideDivergence(existingLockfile, topLevelPins, opts.overrides)
    ) {
      return {
        source: createLockfileSource(existingLockfile),
        dependencies: effectiveDependencies,
        optionalDependencies: effectiveOptionalDependencies,
      };
    }
  }
  return { source: createRegistrySource(opts), dependencies, optionalDependencies };
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
  topLevelOptionalDependencies: Record<string, string>,
  rootName: string,
  fetchCtx: FetchAndUnpackCtx,
  onPackage?: (event: InstallProgressEvent) => void,
): Promise<Map<string, PinnedPackage>> {
  // Determinism-vs-throughput invariant (#24, perf-audit 2026-06-05): the
  // placement walk (resolve -> choosePlacement -> flatByName claim -> recurse)
  // stays STRICTLY SERIAL and REQUEST-ORDERED. First-wins-flat is claimed AFTER
  // `await source.resolve` (version known only post-resolve), so the claim
  // straddles an await; running placement concurrently would make which version
  // wins the flat slot depend on resolve-completion order, not request order,
  // breaking the express-diamond contract (installer.test.ts:225 — ms@2.1.3
  // flat, ms@2.0.0 nested). Packument prefetch may overlap metadata I/O, but it
  // never places a package. Tarball fetch is also parallelized (bounded
  // semaphore): tarball bytes feed extractTarGz/files alone, never the dep walk
  // (pin.dependencies comes from the packument/lockfile, not the tarball), so
  // fetch order cannot perturb layout. Concurrent same-(name,version) fetches
  // dedupe to one network call via `inFlight`. ONE exception to the deferred
  // fetch: an OPTIONAL-boundary node awaits its own fetch BEFORE recursing (see
  // the `isOptionalBoundary` site) so a failed optional fetch skips its WHOLE
  // subtree before it is walked — npm parity, and identical to the old serial
  // walk.
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

  function prefetchPackuments(
    dependencies: Record<string, string>,
    parentInstallPath: string,
    parentName: string,
  ): void {
    if (!source.prefetch) return;
    for (const [depName, depRange] of Object.entries(dependencies)) {
      source.prefetch(depName, depRange, { parentName, parentInstallPath });
    }
  }

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

      // Did THIS visit newly claim the flat slot? (Either `choosePlacement`'s
      // first-wins set, or the block below.) Needed so an optional-boundary
      // fetch failure rolls back ONLY a claim it owns — never a slot a prior
      // visit already won. Captured pre-placement because `choosePlacement`
      // mutates `flatByName` as a side effect.
      const flatSlotFreeBefore = !flatByName.has(pin.name);
      const installPath = pin.installPath ?? choosePlacement(pin, parentInstallPath, flatByName);
      // Record the flat slot so a later live-source visit honours first-wins.
      // Only one source drives a given install today, but the bookkeeping is
      // cheap and removes a foot-gun in a hypothetical mixed run.
      if (installPath === `node_modules/${pin.name}` && !flatByName.has(pin.name)) {
        flatByName.set(pin.name, pin.version);
      }
      if (scheduled.has(installPath)) return;
      scheduled.add(installPath);
      const claimedFlat = flatSlotFreeBefore && installPath === `node_modules/${pin.name}`;

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
        if (onPackage) {
          // Fire on the dedup'd promise: once per unique (name, version), only
          // on success (ADR-0134). `inFlight` stores the hooked promise so a
          // second visitor of the same key never double-fires.
          const hook = onPackage;
          const { name: pinName, version: pinVersion } = pin;
          p = p.then((result) => {
            try {
              hook({ name: pinName, version: pinVersion, cacheHit: result.cacheHit });
            } catch (err) {
              console.warn(
                `install onPackage hook threw for ${pinName}@${pinVersion}: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
            return result;
          });
        }
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
        let result: FetchAndUnpackResult;
        try {
          result = await p;
        } catch (err) {
          // Roll back the synchronous claims THIS visit made before re-throwing
          // to the parent's optional catch (#24 dedup-gate bug): `scheduled` was
          // added pre-fetch, so without this a later REQUIRED visit of the SAME
          // name (via another parent) would hit `scheduled.has` → early-return →
          // silently drop a required dep while reporting success. npm aborts.
          scheduled.delete(installPath);
          if (claimedFlat) flatByName.delete(pin.name);
          throw err;
        }
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
      prefetchPackuments(pin.dependencies, installPath, pin.name);
      for (const [depName, depRange] of Object.entries(pin.dependencies)) {
        await visit(depName, depRange, installPath, pin.name, optional);
      }
      // npm contract: a missing optional dep is non-fatal (typically
      // platform-specific native helpers like fsevents). A resolve-time failure
      // is caught here; a fetch-time failure is attributed at the await site via
      // the `optional` descriptor propagated into the subtree.
      prefetchPackuments(pin.optionalDependencies, installPath, pin.name);
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

  prefetchPackuments(topLevelDependencies, '', rootName);
  for (const [depName, depRange] of Object.entries(topLevelDependencies)) {
    await visit(depName, depRange, '', rootName, null);
  }
  prefetchPackuments(topLevelOptionalDependencies, '', rootName);
  for (const [depName, depRange] of Object.entries(topLevelOptionalDependencies)) {
    const desc = { depName, depRange, parentName: rootName };
    try {
      await visit(depName, depRange, '', rootName, desc);
    } catch (err) {
      warnOptional(desc, err);
    }
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
  // A platform-native optional sibling (e.g. one of Rolldown's
  // `@rolldown/binding-<platform>` packages) is EXPECTED to be skipped — rifty's
  // JS+WASI runtime can never run a native binary (ADR-0051), and the matching
  // wasm/WASI sibling is the one that installs. Phrase it as an expected skip so a
  // pack of these does not read as a wall of install errors (it is not a failure).
  if ((err as { code?: unknown })?.code === 'ENATIVEUNSUPPORTED') {
    console.warn(
      `npm: skipped optional native dependency ${desc.depName}@${desc.depRange} (expected — rifty runs JS+WASI only, ADR-0051)`,
    );
    return;
  }
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
    bin: pin.bin,
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
        bin: entry.bin,
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
 * non-empty set that excludes WASI/WebAssembly targets (and isn't a `!`-negation admitting
 * everything else) is a compiled artifact (`better-sqlite3`, esbuild's
 * `@esbuild/*` platform packages). `cpu` (not `os`) is the signal: pure-JS rarely
 * pins it, every real native does; `os`-only is a soft warning many JS packages
 * use.
 */
function assertNativeSupported(name: string, version: string, manifest: VersionManifest): void {
  const cpu = manifest.cpu;
  if (!Array.isArray(cpu) || cpu.length === 0) return;
  if (cpu.includes('wasm') || cpu.includes('wasm32') || cpu.some((c) => c.startsWith('!'))) return;
  throw Object.assign(
    new Error(
      `ENATIVEUNSUPPORTED: '${name}@${version}' ships a native binary (cpu: ${JSON.stringify(cpu)}, os: ${JSON.stringify(manifest.os ?? null)}) that cannot run in rifty's JS+WASI runtime, and no shadow-registry substitution is registered for it. See docs/public/compat/incompatible-packages.md.`,
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
 * then choose a version. Bare/unconstrained requests prefer `dist-tags.latest`
 * (npm parity); explicit ranges stay semver-only and throw "No matching
 * version" rather than silently falling back to latest. Diamond conflicts are
 * not detected here post-M11; each call picks the best version for its own
 * (name, range) and the walk decides placement.
 */
function createRegistrySource(opts: InstallOptions): ResolutionSource {
  const packumentCache = opts.packumentCache ?? new Map<string, Packument>();
  const PACKUMENT_CONCURRENCY = 8;
  const packumentSem = new Semaphore(PACKUMENT_CONCURRENCY);
  const inFlightPackuments = new Map<string, Promise<Packument>>();
  // Live-resolve was chosen because coverage failed for some top-level pin, but
  // the lockfile's other entries can still seed integrity for the rest.
  let existingLockfile: Lockfile | null = null;
  const ensureLockfileLoaded = async (): Promise<Lockfile | null> => {
    if (existingLockfile) return existingLockfile;
    existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);
    return existingLockfile;
  };

  const loadPackument = (name: string): Promise<Packument> => {
    const cached = packumentCache.get(name);
    if (cached) return Promise.resolve(cached);
    let pending = inFlightPackuments.get(name);
    if (!pending) {
      pending = packumentSem
        .run(async () => {
          const packument = await opts.registry.getPackument(name);
          packumentCache.set(name, packument);
          return packument;
        })
        .finally(() => {
          inFlightPackuments.delete(name);
        });
      void pending.catch(() => undefined);
      inFlightPackuments.set(name, pending);
    }
    return pending;
  };

  const effectiveRequest = (
    name: string,
    range: string | null,
    parentName: string | undefined,
  ): {
    override: ReturnType<typeof resolveOverride>;
    effectiveName: string;
    effectiveRange: string | null;
  } => {
    const override = resolveOverride(name, parentName, opts.overrides);
    return {
      override,
      effectiveName: override?.name ?? name,
      effectiveRange: override?.range ?? range,
    };
  };

  return {
    prefetch(name, range, ctx): void {
      const { effectiveName } = effectiveRequest(name, range, ctx.parentName);
      void loadPackument(effectiveName);
    },

    async resolve(name, range, ctx): Promise<ResolvedPin> {
      const { override, effectiveName, effectiveRange } = effectiveRequest(
        name,
        range,
        ctx.parentName,
      );

      const packument = await loadPackument(effectiveName);
      const versions = Object.keys(packument.versions);
      const latestTag = rangeIsUnconstrained(effectiveRange)
        ? packument['dist-tags']?.latest
        : undefined;
      const pick = latestTag ?? pickBestVersion(versions, effectiveRange);
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
      // npm does not run dependency `prepare` for registry tarball installs;
      // it is a prepack/git/local-root lifecycle, not a registry install hook.
      assertNoLifecycleScripts(manifest.scripts, REGISTRY_TARBALL_LIFECYCLE_SCRIPTS);

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
        bin: manifest.bin,
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
  if (hasParentScopedOverride(overrides)) return false;
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

function hasParentScopedOverride(overrides: OverrideMap | undefined): boolean {
  return Object.keys(overrides ?? {}).some((key) => key.includes('>'));
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
