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
import { discardBody, fetchHeadersBounded } from './bounded-fetch.ts';
import { closureHashOf } from './closure-hash.ts';
import {
  DEFAULT_BUNDLE_STALL_MS,
  drainBodyBounded,
  streamTarEntries,
} from './eddy-bundle-stream.ts';
import {
  EDDY_BUNDLE_FORMAT,
  type EddyBundleManifestV1,
  type EddyBundleTarballEntry,
  LOCKFILE_FILE,
  MANIFEST_FILE,
} from './eddy-bundle.ts';
import type { EddyPrefetchHandle } from './eddy-prefetch.ts';
import {
  EDDY_STORE_DURABLE_HEADER,
  type EddyRequestBody,
  bundleUrlFor,
  canonicalEddyRequestKey,
} from './eddy-request.ts';
import {
  type FetchAndUnpackCtx,
  type FetchAndUnpackResult,
  fetchAndUnpackToCache,
} from './fetch-and-unpack.ts';
import {
  bundleCompletenessGap,
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
import { applyInternalsShims, assertShimSupported, companionRequestsFor } from './shadow-shims.ts';
import {
  type TarballCache,
  VfsTarballCache,
  computeIntegrity,
  parseIntegrityAlgorithm,
} from './tarball-cache.ts';
import { extractTarGz, parseTarEntries } from './unpacker.ts';
import { Semaphore } from './utils/semaphore.ts';

/**
 * Minimal packument-cache surface (`Map` satisfies it structurally). Widened
 * from `Map<string, Packument>` (ADR-0194) so callers can inject policy-aware
 * caches — e.g. eddy's process-wide TTL cache — without a Map subclass.
 */
export interface PackumentCacheLike {
  get(name: string): Packument | undefined;
  set(name: string, packument: Packument): void;
}

export interface InstallOptions {
  vfs: Vfs;
  cwd: string;
  registry: RegistryClient;
  overrides?: OverrideMap;
  /** Cache of already-loaded packuments (lets multiple installs share). */
  packumentCache?: PackumentCacheLike;
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
   * (npm `--prefer-online` analogue) — it also BYPASSES the pinned
   * GET/prefetch attempts client-side (those serve a content-addressed cached
   * closure, the opposite of online); `'cached'` (default) uses eddy's bounded
   * resolution cache (`--prefer-offline` analogue). Inert without `resolverUrl`.
   */
  prefer?: 'cached' | 'online';
  /**
   * Substitution-provenance sink (ADR-0188). One complete line per
   * shadow-registry substitution — baked redirects (`npm: esbuild@^0.28.0 →
   * @esbuild/wasi-preview1@0.28.0 (substituted from shadow registry, ADR-0051)`)
   * and internals-shim applications (`npm: rollup@4.62.2 internals patched
   * from shadow registry`) — on fresh install AND lockfile replay. User
   * `overrides` do not report (the user authored those). Default:
   * `console.warn` — a substitution is never silent.
   */
  onSubstitution?: (line: string) => void;
  /**
   * Pinned closure hash: try the cacheable `GET <base>/bundle/<hash>` first
   * (browser-HTTP-cache/CDN friendly, preflight-free); ANY failure — miss,
   * network, verification — falls through to the POST resolve. The returned
   * bundle passes the same non-disableable gates as a POSTed one, so a stale
   * pin degrades to POST, never to a wrong install. Ignored under
   * `prefer: 'online'` (a pin serves a cached closure). Inert without
   * `resolverUrl`.
   */
  resolverClosureHash?: string;
  /**
   * Base URL for the pinned bundle GET (defaults to `resolverUrl`). Lets a
   * CDN host serve GET-by-hash while the POST resolve stays on the origin —
   * Yandex CDN (and most edges) won't proxy POST, so the two bases can
   * differ (ADR-0195). Inert without `resolverClosureHash`.
   */
  resolverBundleBaseUrl?: string;
  /**
   * A bundle prefetch started earlier (`startEddyPrefetch`) so the round-trip
   * overlaps boot work. Consumed at most once, and ONLY when its canonical
   * request matches this install's — a prefetch for stale deps is ignored,
   * never trusted. Inert without `resolverUrl`.
   */
  resolverPrefetch?: EddyPrefetchHandle;
  /**
   * No-progress bound (ms) on the eddy attempts (default
   * {@link DEFAULT_BUNDLE_STALL_MS}), covering BOTH phases: the header wait
   * (a fetch whose connection/headers hang) and the direct GET/POST bundle
   * streams (a resolver that stalls mid-body). Either makes the attempt FAIL
   * (→ next attempt / standard install) instead of parking the install
   * forever. The prefetch path carries its own bound
   * (`StartEddyPrefetchOptions.stallTimeoutMs`). Inert without `resolverUrl`.
   */
  resolverStallTimeoutMs?: number;
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
  /**
   * The adopted bundle's `manifest.asOf.closureHash`, exposed only when it is
   * safe to persist as a learned pin: a content-addressed GET/prefetch, or a
   * POST whose server proved the immutable store is durable.
   */
  closureHash?: string;
  /**
   * The adopted bundle's `manifest.asOf.resolvedAt` (ISO-8601, validated —
   * a malformed stamp is dropped, never surfaced raw) — when eddy resolved
   * this closure. Feeds the stale-pin honesty line (`as-of <resolvedAt>`),
   * which must report the SERVED resolution's age, not the pin file's.
   */
  resolvedAt?: string;
  /**
   * Which eddy attempt actually served the adopted bundle: `'prefetch'`/`'get'`
   * are CACHE serves of a content-addressed closure; `'post'` is a fresh
   * server-side resolution. The playground's pin policy hangs off this —
   * only a POST re-vouches a resolution's age (savedAt), and only a cache
   * serve of a stale pin owes the `as-of` honesty line. Hash equality alone
   * cannot distinguish the two: a pinned-GET miss whose POST fallback
   * recomputes the SAME closure is a fresh resolution, not a cache hit.
   */
  resolvedVia?: 'prefetch' | 'get' | 'post';
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
  const substitutions = createSubstitutionReporter(
    opts.onSubstitution ?? ((line) => console.warn(line)),
  );

  let existingLockfile = await readExistingLockfile(opts.vfs, opts.cwd);

  // ADR-0182 opt-in fast path: when a resolver is configured AND no covering
  // lockfile already gives the zero-network fast path, fetch + verify eddy's
  // bundle, seed the cache, and STAGE its lockfile in memory so the existing
  // fast path below runs with zero packument network. Nothing is committed to
  // disk here: the on-disk lockfile is written ONLY at the end of a successful
  // install (after link + shims, same as the standard path) — a failure at any
  // later point leaves the user's pre-existing lockfile untouched instead of
  // clobbering it with the resolver's root metadata.
  let source: 'eddy' | 'standard' = 'standard';
  let eddyClosureHash: string | undefined;
  let eddyResolvedAt: string | undefined;
  let eddyResolvedVia: 'prefetch' | 'get' | 'post' | undefined;
  if (
    opts.resolverUrl &&
    !hasLockfileFastPath(existingLockfile, dependencies, optionalDependencies, rootName, opts)
  ) {
    const staged = await tryEddyFastPath(
      opts,
      rootName,
      dependencies,
      optionalDependencies,
      tarballCache,
    );
    if (staged !== null) {
      source = 'eddy';
      eddyClosureHash = staged.closureHash;
      eddyResolvedAt = staged.resolvedAt;
      eddyResolvedVia = staged.resolvedVia;
      existingLockfile = staged.lockfile;
    }
  }

  const plan = chooseSource(
    existingLockfile,
    dependencies,
    optionalDependencies,
    rootName,
    opts,
    substitutions,
  );

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
  // ADR-0188: install-time internals shims into the actual installed dirs —
  // AFTER link so tarball bytes never clobber a shim. Both paths (+ eddy).
  await applyInternalsShims(opts.vfs, opts.cwd, packages, substitutions.line);
  const lockfile = buildLockfile(rootName, normalizedRootVersion, packages);
  // Diff-before-write preserves user-visible mtime on a no-op install (ADR-0023).
  await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
  return {
    packages,
    lockfile,
    conflicts: [],
    source,
    ...(eddyClosureHash === undefined ? {} : { closureHash: eddyClosureHash }),
    ...(eddyResolvedAt === undefined ? {} : { resolvedAt: eddyResolvedAt }),
    ...(eddyResolvedVia === undefined ? {} : { resolvedVia: eddyResolvedVia }),
  };
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
 * ADR-0182 opt-in fast path. Obtain an `EddyBundleV1` from the resolver, verify
 * it (bytes vs the bundle integrity — NON-disableable, mirror-grade trust),
 * check the bundle lockfile covers the request, seed the tarball cache, write
 * the lockfile. Returns the adopted bundle's optional learnable closureHash +
 * its STAGED lockfile on success (the existing lockfile fast path then runs
 * with zero packument network from the in-memory lockfile; the hash feeds
 * learned pins only when the response is safe to persist, ADR-0194 — the caller
 * commits the lockfile to disk only after link/shims succeed); on ANY failure
 * it warns and returns `null`, leaving the pre-existing lockfile untouched so
 * the standard verifying install runs. Never throws.
 *
 * The bundle can arrive via THREE attempts, first survivor wins, each failure
 * falls through to the next: a prefetched response (`resolverPrefetch`,
 * consumed only on a canonical-request match), the pinned cacheable
 * `GET /bundle/<closureHash>` (`resolverClosureHash`), and the POST resolve.
 * `prefer: 'online'` runs the POST ONLY — pinned GET/prefetch serve a
 * content-addressed CACHED closure, exactly what online promises to bypass
 * (the POST carries `prefer` so the server skips its mutable tier too).
 */
async function tryEddyFastPath(
  opts: InstallOptions,
  rootName: string,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  tarballCache: TarballCache,
): Promise<{
  closureHash?: string;
  resolvedAt?: string;
  resolvedVia: 'prefetch' | 'get' | 'post';
  lockfile: Lockfile;
} | null> {
  const url = opts.resolverUrl;
  if (!url) return null;

  const online = opts.prefer === 'online';
  const body: EddyRequestBody = { dependencies, optionalDependencies };
  if (opts.overrides) body.overrides = opts.overrides;
  const requestKey = canonicalEddyRequestKey(body, opts.prefer ?? 'cached');

  // The EXACT condition `chooseSource` uses for its lockfile fast path
  // (coverage AND no override divergence) — a bundle passing it GUARANTEES
  // `chooseSource` fast-paths the eddy lockfile; without the divergence half, a
  // parent-scoped override would make `chooseSource` silently live-resolve
  // while we'd already have claimed `source: 'eddy'` (a provenance lie).
  const effectiveRequest = {
    ...applyOverridesToRequest(dependencies, rootName, opts.overrides),
    ...applyOverridesToRequest(optionalDependencies, rootName, opts.overrides),
  };

  // prefer:'online' (the `--prefer-online` analogue) promises a FRESH
  // server-side recompute — a pinned prefetch/GET would serve a cached
  // closure, so neither enters the pipeline (only the POST, which carries
  // `prefer` to the server).
  const prefetched = online ? null : (opts.resolverPrefetch?.take(requestKey) ?? null);
  // `expectedHash` names the hash a CONTENT-ADDRESSED fetch must return: a pinned
  // GET (or a pinned prefetch) is `GET /bundle/<hash>`, so the bundle's manifest
  // MUST self-report that hash — else the CDN/cache served the wrong object and we
  // decline (defence-in-depth over the origin's own key check). A POST has no
  // pre-known hash (the server computes it), so it carries none.
  type EddyAttempt =
    | {
        kind: 'prefetch';
        label: 'prefetch';
        expectedHash?: string;
        response: Promise<Response>;
      }
    | {
        kind: 'fetch';
        label: 'get' | 'post';
        expectedHash?: string;
        run: (signal: AbortSignal) => Promise<Response>;
      };
  const attempts: EddyAttempt[] = [];
  if (prefetched) {
    attempts.push({
      kind: 'prefetch',
      label: 'prefetch',
      ...(opts.resolverPrefetch?.closureHash
        ? { expectedHash: opts.resolverPrefetch.closureHash }
        : {}),
      response: prefetched,
    });
  }
  const pin = online ? undefined : opts.resolverClosureHash;
  // The pinned GET is ALWAYS in the (cached-preference) pipeline
  // (prefetch → GET → POST): a SUCCESSFUL same-pin prefetch short-circuits
  // before reaching it (first survivor wins), so this only runs when the
  // prefetch failed/stalled/was declined — where retrying the direct GET is
  // exactly the contract (and a consumed-prefetch decline over a CDN mixup can
  // still succeed here).
  if (pin) {
    const bundleBase = opts.resolverBundleBaseUrl ?? url;
    attempts.push({
      kind: 'fetch',
      label: 'get',
      expectedHash: pin,
      run: (signal) => fetch(bundleUrlFor(bundleBase, pin), { signal }),
    });
  }
  attempts.push({
    kind: 'fetch',
    label: 'post',
    run: (signal) => {
      const requestBody: Record<string, unknown> = { ...body };
      if (opts.prefer) requestBody.prefer = opts.prefer;
      // No content-type header: a string body defaults to `text/plain` — a
      // CORS-simple request, so a cross-origin browser skips the OPTIONS
      // preflight (one RTT off the cold path). The server parses the body
      // unconditionally.
      return fetch(url, { method: 'POST', body: JSON.stringify(requestBody), signal });
    },
  });

  const headersStallMs = opts.resolverStallTimeoutMs ?? DEFAULT_BUNDLE_STALL_MS;
  const reasons: string[] = [];
  for (const attempt of attempts) {
    try {
      // Header-phase bound (shared chokepoint): `resolverStallTimeoutMs` (and
      // the default stall bound) only start once a body exists — a fetch whose
      // connection/headers hang parked `npm install` before any body bound
      // could run. Prefetch carries its own header + eager-drain bounds in
      // `startEddyPrefetch`; racing its already-buffering promise here would
      // abandon a slow-but-progressing download and duplicate the request.
      const response =
        attempt.kind === 'prefetch'
          ? await attempt.response
          : await fetchHeadersBounded(attempt.run, headersStallMs, `eddy ${attempt.label}`);
      const outcome = await consumeEddyResponse(
        response,
        effectiveRequest,
        opts,
        tarballCache,
        attempt.expectedHash,
      );
      if (typeof outcome !== 'string') {
        return {
          ...(outcome.closureHash === undefined ? {} : { closureHash: outcome.closureHash }),
          ...(outcome.resolvedAt === undefined ? {} : { resolvedAt: outcome.resolvedAt }),
          resolvedVia: attempt.label,
          lockfile: outcome.lockfile,
        };
      }
      reasons.push(`${attempt.label}: ${outcome}`);
    } catch (err) {
      reasons.push(`${attempt.label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return declineEddy(reasons.join('; '));
}

const eddyDecoder = new TextDecoder('utf-8');

async function* bufferedTarEntries(
  bytes: Uint8Array,
): AsyncGenerator<{ name: string; data: Uint8Array }, void, undefined> {
  for (const e of parseTarEntries(bytes)) yield e;
}

/**
 * Verify + adopt ONE bundle response; `{adopted, closureHash?}` on success, a
 * decline reason string otherwise (ADR-0194 threads a learnable hash out for
 * learned pins). The bundle is consumed AS A STREAM (network overlaps hash +
 * cache writes): the format/v3/coverage gates run on the manifest + lockfile members
 * — the first two, by bundle contract — so a decline cancels the download
 * before tarball bytes transfer. Each tarball is verified against the
 * integrity the BUNDLE carries (ADR-0182 §5, non-disableable) and seeded into
 * the content-addressed cache as it arrives: a mid-bundle failure leaves only
 * verified bytes (the cache re-verifies on every `get`). The lockfile is
 * returned STAGED (in memory), never written here: the caller commits the
 * final lockfile only after link/shims succeed, so a failure at ANY point —
 * including after adoption — leaves the pre-existing lockfile untouched.
 *
 * Content-addressed integrity (ADR-0194): the manifest's self-reported
 * `closureHash` must (a) equal `expectedClosureHash` when the fetch was a pinned
 * GET/prefetch — else the CDN served the wrong object — and (b) re-derive from
 * the bundle's own lockfile — else the bundle lies about its identity. Both gate
 * BEFORE any tarball seed or lockfile write.
 */
async function consumeEddyResponse(
  response: Response,
  effectiveRequest: Record<string, string>,
  opts: InstallOptions,
  tarballCache: TarballCache,
  expectedClosureHash?: string,
): Promise<
  { adopted: true; closureHash?: string; resolvedAt?: string; lockfile: Lockfile } | string
> {
  // A JSON body is a typed decline (server.ts sends them as 422 + JSON), so
  // parse it BEFORE the status gate — otherwise `!response.ok` swallows the
  // 422 as an opaque `HTTP 422` and the `feature` reason is never surfaced.
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    // A JSON decline body is proxy/attacker-controlled just like the tar stream:
    // `response.json()` has NO timeout, so a resolver that sends
    // `content-type: application/json` then holds the body open parks
    // `npm install` forever — bypassing `resolverStallTimeoutMs`. Drain it
    // through the same no-progress/byte bound, then parse.
    let declineText: string;
    try {
      const bytes = await drainBodyBounded(
        response,
        opts.resolverStallTimeoutMs === undefined
          ? { label: 'eddy decline body' }
          : { stallTimeoutMs: opts.resolverStallTimeoutMs, label: 'eddy decline body' },
      );
      declineText = eddyDecoder.decode(bytes);
    } catch {
      return 'resolver decline body stalled or exceeded its byte cap';
    }
    let decline: { feature?: string; error?: string } | null;
    try {
      decline = JSON.parse(declineText) as { feature?: string; error?: string };
    } catch {
      decline = null;
    }
    return `resolver declined (${decline?.feature ?? decline?.error ?? 'unsupported'})`;
  }
  if (!response.ok) {
    // Never-consumed body (the attempt pipeline moves on) — hits every
    // unpinned 404 GET miss; see discardBody.
    discardBody(response);
    return `resolver returned HTTP ${response.status}`;
  }

  // Bounded stream (round 6): a stall/runaway on the DIRECT GET/POST paths
  // must fail the attempt (→ fallback), exactly like the prefetch's bounded
  // drain — an unbounded read here parked `npm install` forever on a resolver
  // that sent a covering manifest+lockfile then hung mid-tarball.
  const entries = response.body
    ? streamTarEntries(
        response.body,
        opts.resolverStallTimeoutMs === undefined
          ? {}
          : { stallTimeoutMs: opts.resolverStallTimeoutMs },
      )
    : bufferedTarEntries(new Uint8Array(await response.arrayBuffer()));

  let manifest: EddyBundleManifestV1 | null = null;
  let lockfile: Lockfile | null = null;
  const byFile = new Map<string, EddyBundleTarballEntry>();
  const seededFiles = new Set<string>();
  const seededTarballs: EddyBundleTarballEntry[] = [];
  for await (const entry of entries) {
    if (manifest === null) {
      if (entry.name !== MANIFEST_FILE) return `bundle does not start with ${MANIFEST_FILE}`;
      const parsed = JSON.parse(eddyDecoder.decode(entry.data)) as EddyBundleManifestV1;
      if (parsed.format !== EDDY_BUNDLE_FORMAT) {
        return `unsupported EddyBundle format: ${JSON.stringify(parsed.format)}`;
      }
      // Content-addressed GET/prefetch: the served object must BE the hash we
      // asked for (a wrong one = CDN/cache mixup). Checked at member 1, before
      // any seed/write.
      if (expectedClosureHash !== undefined && parsed.asOf.closureHash !== expectedClosureHash) {
        return `bundle closure hash ${parsed.asOf.closureHash} ≠ requested ${expectedClosureHash}`;
      }
      for (const t of parsed.tarballs) {
        // Duplicate `file` values collapse in this map: two required
        // name@version entries sharing one member would pass BOTH the
        // seeded-count check (1 === 1) and the completeness gate (both
        // name@version present in the manifest ARRAY) while only one package
        // ever gets seeded — a partial adoption. Malformed → decline.
        if (byFile.has(t.file)) {
          return `bundle manifest names duplicate member ${t.file}`;
        }
        byFile.set(t.file, t);
      }
      manifest = parsed;
      continue;
    }
    if (lockfile === null) {
      if (entry.name !== LOCKFILE_FILE) return `bundle missing ${LOCKFILE_FILE} before tarballs`;
      const parsed = JSON.parse(eddyDecoder.decode(entry.data)) as Lockfile;
      // Refuse a non-v3 bundle lockfile BEFORE seeding/writing. Honest eddy
      // always emits v3 (`linker.ts` hardcode), but a divergent/buggy resolver
      // could send another shape; writing it would clobber the user's lockfile
      // AND make the post-seed re-read throw `NotImplementedError(v1/v2)` —
      // breaking BOTH the never-throw and lockfile-untouched promises.
      if ((parsed.lockfileVersion as number) !== 3) {
        return `bundle lockfile is not v3 (got ${JSON.stringify(parsed.lockfileVersion)})`;
      }
      // Self-consistency: a content-addressed bundle must hash to the hash it
      // names. Re-derive from the bundle's OWN lockfile (member 2, before any
      // seed/write) so a manifest that lies about its closure is refused, never
      // adopted or learned as a pin.
      if (manifest !== null && manifest.asOf.closureHash !== (await closureHashOf(parsed))) {
        return `bundle manifest closure hash ${manifest.asOf.closureHash} does not match its lockfile`;
      }
      // Coverage gap / override divergence → fallback (no partial install).
      const pins = lockfileCovers(parsed, effectiveRequest);
      if (!pins || !subgraphFreeOfOverrideDivergence(parsed, pins, opts.overrides)) {
        return 'bundle lockfile does not cover the request (or an override forces a re-resolve)';
      }
      // Completeness (round 6): a covering lockfile whose reachable packages
      // lack a matching manifest tarball would replay the omissions from the
      // ORDINARY registry on cache miss while claiming `source: 'eddy'` — a
      // provenance lie (and a learned pin to a partial bundle). Gate at member
      // 2, before any tarball seed or lockfile write.
      const gap = bundleCompletenessGap(parsed, effectiveRequest, manifest?.tarballs ?? []);
      if (gap) return gap;
      lockfile = parsed;
      continue;
    }
    const t = byFile.get(entry.name);
    if (!t) return `unexpected bundle member ${entry.name}`;
    const algorithm = parseIntegrityAlgorithm(t.integrity);
    if (!algorithm) return `unparseable integrity for ${t.name}@${t.version}`;
    if ((await computeIntegrity(entry.data, algorithm)) !== t.integrity) {
      return `integrity mismatch for ${t.name}@${t.version}`;
    }
    await tarballCache.put(t.name, t.version, t.integrity, entry.data);
    seededFiles.add(entry.name);
    seededTarballs.push(t);
  }
  if (manifest === null || lockfile === null) {
    return 'malformed EddyBundleV1 bundle: missing manifest or lockfile';
  }
  if (seededFiles.size !== byFile.size) {
    return 'bundle is missing tarball member(s) named by its manifest';
  }
  // Provenance guard: adoption reports `source: 'eddy'` and then REPLAYS the
  // install by reading `tarballCache` back. A NON-RETENTIVE or bounded cache
  // could silently re-fetch some packages from the REGISTRY under an eddy label
  // (and fail outright if the registry is unreachable). Prove every seeded
  // tarball is still retained; a miss means eddy cannot honestly own this
  // install → decline to the standard verifying path (which uses the same cache
  // and is labelled `source: 'standard'`, no lie).
  for (const seeded of seededTarballs) {
    const back = await tarballCache.get(seeded.name, seeded.version, seeded.integrity);
    if (back === null) {
      return 'tarball cache did not retain seeded bytes (a non-retentive cache cannot back an eddy install)';
    }
  }
  const canLearnClosureHash =
    expectedClosureHash !== undefined || response.headers.get(EDDY_STORE_DURABLE_HEADER) === '1';
  const closureHash = canLearnClosureHash ? manifest.asOf.closureHash : undefined;
  // The served bundle's as-of stamp: the stale-pin honesty line reports THIS
  // (the resolution's age), never the pin file's savedAt. Validated — a
  // malformed stamp reads as absent (the line then says `unknown`), never a
  // raw junk string on the terminal.
  const rawResolvedAt = manifest.asOf.resolvedAt;
  const resolvedAt =
    typeof rawResolvedAt === 'string' && !Number.isNaN(Date.parse(rawResolvedAt))
      ? rawResolvedAt
      : undefined;
  return {
    adopted: true,
    ...(closureHash === undefined ? {} : { closureHash }),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    lockfile,
  };
}

function declineEddy(reason: string): null {
  console.warn(`npm: fast install (eddy) unavailable, using standard install — ${reason}`);
  return null;
}

/**
 * Per-install substitution-provenance reporter (ADR-0188). `redirect` dedupes
 * within one run (the same baked redirect can surface via the top-level
 * pre-pass AND the walk); wording is the backlog contract — it MUST name the
 * shadow registry.
 */
interface SubstitutionReporter {
  redirect(source: string, range: string | null, target: string, version: string): void;
  line(text: string): void;
}

function createSubstitutionReporter(sink: (line: string) => void): SubstitutionReporter {
  const seen = new Set<string>();
  return {
    redirect(source, range, target, version): void {
      const key = `${source}@${range ?? '*'}→${target}@${version}`;
      if (seen.has(key)) return;
      seen.add(key);
      sink(
        `npm: ${source}@${range ?? '*'} → ${target}@${version} (substituted from shadow registry, ADR-0051)`,
      );
    },
    line(text): void {
      sink(text);
    },
  };
}

/**
 * Replay-path top-level redirects: the walk only sees post-override names
 * (`applyOverridesToRequest` rewrote the request), so a top-level baked
 * redirect must be reported here, with the version the lockfile pins.
 */
function reportTopLevelBakedRedirects(
  request: Record<string, string>,
  parent: string,
  overrides: OverrideMap | undefined,
  topLevelPins: Map<string, string>,
  reporter: SubstitutionReporter,
): void {
  for (const [name, range] of Object.entries(request)) {
    const override = resolveOverride(name, parent, overrides);
    if (!override || override.source !== 'baked' || override.name === name) continue;
    const version = topLevelPins.get(override.name);
    if (version) reporter.redirect(name, range, override.name, version);
  }
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
  substitutions: SubstitutionReporter,
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
      reportTopLevelBakedRedirects(
        { ...dependencies, ...optionalDependencies },
        rootName,
        opts.overrides,
        topLevelPins,
        substitutions,
      );
      return {
        source: createLockfileSource(existingLockfile, opts, substitutions),
        dependencies: effectiveDependencies,
        optionalDependencies: effectiveOptionalDependencies,
      };
    }
  }
  return {
    source: createRegistrySource(opts, substitutions),
    dependencies,
    optionalDependencies,
  };
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
      // ADR-0188: a shimmed package outside its shim's proven range must fail
      // loudly BEFORE anything installs — never a stale shim silently applied.
      assertShimSupported(pin.name, pin.version);

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
      // ADR-0188: same-version companion pins for shadow internals shims
      // (rollup ↔ @rollup/wasm-node lockstep). Injected on BOTH sources —
      // replay re-derives them from (name, version); a pre-shim lockfile
      // misses the entry and throws EBROKENLOCK (delete + re-install).
      const companions = companionRequestsFor(pin.name, pin.version);
      prefetchPackuments(companions, installPath, pin.name);
      for (const [depName, depRange] of Object.entries(companions)) {
        await visit(depName, depRange, installPath, pin.name, optional);
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
 * exact versions); `name`/`parentName` are override-resolved first so a redirect
 * target's recorded key is what gets looked up. Returns `installPath = <matched
 * lockfile key>` so the walk reproduces the recorded layout regardless of visit
 * order.
 *
 * Throws `EBROKENLOCK` on a missing or malformed (no `resolved`/`integrity`)
 * entry: the contract is "lockfile is authoritative or it's an error".
 * Returning `null` would leave a partial set that reads as network slowness.
 */
function createLockfileSource(
  lockfile: Lockfile,
  opts: InstallOptions,
  substitutions: SubstitutionReporter,
): ResolutionSource {
  return {
    async resolve(name, range, ctx): Promise<ResolvedPin> {
      // Apply the same shadow/user override the live-resolve source does
      // (`createRegistrySource`, ADR-0015 baked table + user `overrides`) BEFORE
      // the lockfile lookup. The writer stores a redirect under its TARGET key
      // (`esbuild` → `@esbuild/wasi-preview1`), leaving no `node_modules/esbuild`
      // entry, so replaying the SOURCE name verbatim would miss the pin and throw
      // EBROKENLOCK — the exact break eddy's pre-seeded lockfile hit on vite →
      // esbuild. `subgraphFreeOfOverrideDivergence` cannot pre-empt it: the
      // source name has no entry, so `lockfileSubgraph` never surfaces it.
      const override = resolveOverride(name, ctx.parentName, opts.overrides);
      const effectiveName = override?.name ?? name;
      const hit = pinnedEntryForParent(lockfile, effectiveName, ctx.parentInstallPath);
      if (!hit) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: lockfile coverage gap — '${effectiveName}' is reachable from the dep graph but missing from package-lock.json (searched walk-up from parent path '${ctx.parentInstallPath}'). Delete the lockfile and re-install.`,
          ),
          { code: 'EBROKENLOCK', packageName: effectiveName, reason: 'missing-entry' as const },
        );
      }
      const { entry, installPath } = hit;
      if (!entry.resolved || !entry.integrity) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: lockfile entry for '${effectiveName}' at '${installPath}' is malformed (missing ${
              !entry.resolved ? 'resolved' : 'integrity'
            }). Delete the lockfile and re-install.`,
          ),
          {
            code: 'EBROKENLOCK',
            packageName: effectiveName,
            reason: 'malformed-entry' as const,
          },
        );
      }
      // Override redirected to a target NAME the lockfile pins, but a moved
      // override RANGE (e.g. the baked table bumps, or a user edits `overrides`)
      // can leave the locked version stale. The live-resolve source would pick a
      // satisfying version; the fast path must NOT silently reuse a version the
      // current override no longer admits. `subgraphFreeOfOverrideDivergence`
      // misses it (the source name has no entry to surface), so refuse here —
      // loud, per the "lockfile is authoritative or it's an error" contract.
      if (override?.range && !matchesRange(entry.version, override.range)) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: override '${name}' → '${effectiveName}@${override.range}' but package-lock.json pins ${effectiveName}@${entry.version}, which no longer satisfies it. Delete the lockfile and re-install.`,
          ),
          {
            code: 'EBROKENLOCK',
            packageName: effectiveName,
            reason: 'override-range-drift' as const,
          },
        );
      }
      // ADR-0188: replay prints the same substitution line live-resolve does.
      if (override && override.source === 'baked' && override.name !== name) {
        substitutions.redirect(name, range, effectiveName, entry.version);
      }
      return {
        name: effectiveName,
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
function createRegistrySource(
  opts: InstallOptions,
  substitutions: SubstitutionReporter,
): ResolutionSource {
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

      // ADR-0188: baked redirects are never silent — user-visible provenance.
      if (override && override.source === 'baked' && override.name !== name) {
        substitutions.redirect(name, range, effectiveName, pick);
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
