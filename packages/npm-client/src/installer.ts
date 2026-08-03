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
 * Pipeline (D-F unification): lockfile replay and live resolution share one
 * traversal driver (`walkAndPin`) and compose per edge:
 *
 *   - {@link createLockfileSource} — replays pins from a v3 lockfile entry,
 *     parent-aware walk-up for nested copies.
 *   - {@link createRegistrySource} — packument fetch + `pickBestVersion`,
 *     applies overrides per node.
 *
 * Covered edges replay exact pins; a missing root/policy frontier resolves from
 * metadata without discarding compatible retained subgraphs. {@link
 * pinToPackage} is the shared materialization seam.
 */

import { NotImplementedError } from '@riftydev/io';
import {
  type BuiltinShadowSubstitutionRecipe,
  type ShadowRegistryDependencyProjection,
  builtinShadowSubstitutionCatalog,
} from '@riftydev/shadow-registry/internal';
import { type Vfs, joinPath, normalizePath } from '@riftydev/vfs';
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
  isIsoDateString,
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
  bundleCompletenessGapForPaths,
  lockfilePathBareName,
  pinnedEntryForParent,
  readExistingLockfile,
  writeLockfileIfChanged,
} from './installer-lockfile-reader.ts';
import { assertShadowRecipeAdmission } from './internal/shadow/admission.ts';
import { recordShadowAssetPlanForInstallResult } from './internal/shadow/install-result.ts';
import {
  type AppliedShadowSubstitution,
  type RegistryShadowEmbeddedDependency,
  type RegistryShadowEmbeddedSource,
  type ShadowAssetPlan,
  attestBuiltinShadowSubstitution,
  materializeRegistryShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
  planTrustedAppliedShadowSubstitutions,
  registryAcquisitionInstallPath,
  registryShadowEmbeddedSourcesFromLockfile,
} from './internal/shadow/planner.ts';
import {
  type Lockfile,
  type PackageBinClaim,
  type PackageBinSource,
  type PreparedInstallPackage,
  type ResolvedPackage,
  type RootLockfileDependencyMaps,
  buildPreparedInstallLockfile,
  linkInstallPackageBins,
  linkInstallPackageFiles,
  normalizePackageBinSource,
  normalizePackageBinSources,
  preflightPackageBins,
  preflightPackageInstallPaths,
} from './linker.ts';
import type { OverrideMap } from './overrides.ts';
import type { Packument, RegistryClient, VersionManifest } from './registry.ts';
import { matchesRange, pickBestVersion } from './semver.ts';
import {
  applyInternalsShims,
  assertShimSupported,
  companionRequestsFor,
  resolveEffectivePackageRequest,
} from './shadow-shims.ts';
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
  /** Caller-owned lifecycle cancellation, forwarded through every network wait. */
  signal?: AbortSignal;
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
   * Host-owned all-or-nothing namespace policy. Called once with every package
   * root and file target after every tarball is parsed, before link creates its
   * first directory. Rifty uses this for non-transferable authority metadata
   * (ADR-0261); standalone clients may omit it.
   */
  assertPortablePaths?: (paths: readonly string[]) => void;
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
   * shadow-registry substitution — catalog materializations (`npm:
   * esbuild@^0.28.0 materialized from shadow registry (...)`), retained baked
   * redirects, and internals-shim applications — on fresh install AND
   * lockfile replay. User `overrides` do not report (the user authored those).
   * Default: `console.warn` — a substitution is never silent.
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

function abortReason(signal: AbortSignal, label: string): Error {
  return signal.reason instanceof Error ? signal.reason : new Error(`${label}: aborted`);
}

function throwIfAborted(signal: AbortSignal | undefined, label = 'npm install'): void {
  if (signal?.aborted) throw abortReason(signal, label);
}

async function awaitWithSignal<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
  label: string,
): Promise<T> {
  if (!signal) return await operation;
  throwIfAborted(signal, label);
  operation.catch(() => {}); // abort can win while the independently owned prefetch settles later
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        onAbort = () => reject(abortReason(signal, label));
        signal.addEventListener('abort', onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}

/** Payload for {@link InstallOptions.onPackage}. */
export interface InstallProgressEvent {
  readonly name: string;
  readonly version: string;
  /**
   * True when bytes came from the local tarball cache. Lossy: cached bytes may
   * have been seeded by Eddy, so use `InstallResult.provenance` for transport.
   */
  readonly cacheHit: boolean;
}

export type InstallResolution = 'lockfile' | 'metadata';
export type PackageTransport = 'cache' | 'eddy' | 'registry' | 'shadow-registry';

export interface InstallPackageProvenance {
  readonly name: string;
  readonly version: string;
  readonly transport: PackageTransport;
}

export interface InstallAcquisitionProvenance {
  readonly resolution: InstallResolution;
  readonly packages: readonly InstallPackageProvenance[];
  readonly eddyFallback?: { readonly reason: string };
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

interface WalkAndPinResult {
  readonly packages: Map<string, PinnedPackage>;
  readonly companionOnlyBinInstallPaths: ReadonlySet<string>;
}

interface PinnedShadowState {
  readonly substitution: AppliedShadowSubstitution;
  readonly embeddedSource?: RegistryShadowEmbeddedSource;
}

const pinnedShadowSubstitutions = new WeakMap<PinnedPackage, PinnedShadowState>();

export interface InstallResult {
  packages: ResolvedPackage[];
  lockfile: Lockfile;
  /** Retained for shape compat; always empty since M11 nests conflicts (ADR-0042). */
  conflicts: { name: string; firstVersion: string; secondVersion: string }[];
  /** Exact acquisition facts; ADR-0258. Never infer these from `source`. */
  provenance: InstallAcquisitionProvenance;
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
   * The REQUEST KIND that served the adopted bundle — a prefetch counts as
   * its underlying request: `'get'` is a CACHE serve of a content-addressed
   * closure (pinned GET or pinned prefetch); `'post'` is a SERVER-VOUCHED
   * resolution (direct POST or unpinned prefetch) — the server answered this
   * request now, though its answer may itself come from eddy's mutable tier
   * (≤ `EDDY_TTL_SECONDS`); only `prefer:'online'` guarantees a fresh
   * recompute. The playground's pin policy hangs off this — only a POST
   * re-vouches a resolution's age (savedAt), and only a cache serve of a
   * stale pin owes the `as-of` honesty line. Hash equality alone cannot
   * distinguish the two: a pinned-GET miss whose POST fallback lands the
   * SAME closure is a server-vouched resolution, not a cache hit.
   */
  resolvedVia?: 'get' | 'post';
}

/**
 * Source-of-truth fields a `ResolutionSource` returns for a single (name,
 * range, parent) request; {@link pinToPackage} adapts it (+ tarball bytes) into
 * a `PinnedPackage`.
 */
interface ResolvedPin {
  readonly origin: 'lockfile' | 'metadata';
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
  /** Preferred recorded install path (lockfile-source only). The mixed walk
   *  may relocate it when another identity owns that path. */
  readonly installPath?: string;
  readonly shadow?: Readonly<{
    recipe: BuiltinShadowSubstitutionRecipe;
    trigger: Readonly<{ name: string; requestedRange: string | null; version: string }>;
    acquisition:
      | Readonly<{ kind: 'synthetic' }>
      | Readonly<{
          kind: 'registry';
          name: string;
          version: string;
          resolved: string;
          integrity?: string;
        }>;
    materializationInstallPath?: string;
    expectedEmbeddedDependencies?: readonly RegistryShadowEmbeddedDependency[];
  }>;
}

interface NormalizedInstallRequest {
  readonly rootName: string;
  readonly rootVersion: string;
  readonly dependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
  readonly rootLockfileDependencyMaps: RootLockfileDependencyMaps;
  readonly opts: InstallOptions;
}

interface SourcePlan {
  readonly source: ResolutionSource;
  readonly resolution: () => InstallResolution;
  readonly dependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
}

interface LockfilePathTranslation {
  readonly recordedPrefix: string;
  readonly actualPrefix: string;
}

/**
 * The actual tree path may differ from the recorded lockfile scope when mixed
 * replay relocates a retained package under a new conflict.
 */
interface ResolveContext {
  readonly parentName: string | undefined;
  readonly parentInstallPath: string;
  readonly parentLockfilePath: string;
  readonly parentOrigin: 'root' | 'lockfile' | 'metadata';
  readonly lockfilePathTranslations: readonly LockfilePathTranslation[];
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
    rootLockfileDependencyMaps,
    opts,
  } = request;
  throwIfAborted(opts.signal);
  assertDirectShadowRecipeAdmissions(dependencies, optionalDependencies, rootName, opts.overrides);
  const tarballCache: TarballCache = opts.tarballCache ?? new VfsTarballCache(opts.vfs);
  const fetchCtx: FetchAndUnpackCtx = {
    cache: tarballCache,
    getTarball: (url) =>
      opts.registry.getTarball(url, opts.signal === undefined ? {} : { signal: opts.signal }),
    ...(opts.signal === undefined ? {} : { signal: opts.signal }),
  };
  const substitutions = createSubstitutionReporter(
    opts.onSubstitution ?? ((line) => console.warn(line)),
  );
  const directEffectiveNameCollision = hasEffectiveTopLevelNameCollision(
    dependencies,
    optionalDependencies,
    rootName,
    opts.overrides,
  );

  const priorLockfile = await readExistingLockfile(opts.vfs, opts.cwd);
  // Decode once at lockfile ingress; frozen owner-internal consumers receive
  // this plan rather than reparsing the same clone at every dependency edge.
  const priorShadowPlan = priorLockfile ? planShadowSubstitutionsFromLockfile(priorLockfile) : null;
  let existingLockfile = priorLockfile;
  let existingShadowPlan = priorShadowPlan;

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
  let eddyResolvedVia: 'get' | 'post' | undefined;
  let eddyFallbackReason: string | undefined;
  let eddyFallbackCause: Error | undefined;
  if (
    opts.resolverUrl &&
    !directEffectiveNameCollision &&
    !existingLockfilePreemptsEddy(
      existingLockfile,
      existingShadowPlan,
      dependencies,
      optionalDependencies,
      rootName,
      opts,
    )
  ) {
    const staged = await tryEddyFastPath(
      opts,
      rootName,
      dependencies,
      optionalDependencies,
      tarballCache,
    );
    if (staged.kind === 'adopted') {
      source = 'eddy';
      eddyClosureHash = staged.closureHash;
      eddyResolvedAt = staged.resolvedAt;
      eddyResolvedVia = staged.resolvedVia;
      existingLockfile = staged.lockfile;
      existingShadowPlan = staged.shadowPlan;
    } else {
      eddyFallbackReason = staged.reason;
      eddyFallbackCause = staged.cause;
    }
  }

  const plan = chooseSource(
    existingLockfile,
    existingShadowPlan,
    dependencies,
    optionalDependencies,
    opts,
    substitutions,
  );

  const cacheHits = new Map<string, boolean>();
  let resolved: WalkAndPinResult;
  try {
    resolved = await walkAndPin(
      plan.source,
      plan.dependencies,
      plan.optionalDependencies,
      rootName,
      fetchCtx,
      (event) => {
        cacheHits.set(`${event.name}@${event.version}`, event.cacheHit);
        opts.onPackage?.(event);
      },
    );
  } catch (error) {
    throwIfAborted(opts.signal);
    if (eddyFallbackReason !== undefined) {
      const registryError = error instanceof Error ? error : new Error(String(error));
      throw new AggregateError(
        [
          eddyFallbackCause ?? new Error(`Eddy acquisition failed: ${eddyFallbackReason}`),
          registryError,
        ],
        'npm install failed after Eddy fallback',
      );
    }
    throw error;
  }
  throwIfAborted(opts.signal);
  const packages = [...resolved.packages.values()];
  const provenancePackages: InstallPackageProvenance[] = [];
  const seenProvenance = new Set<string>();
  for (const pkg of packages) {
    const key = `${pkg.name}@${pkg.version}`;
    if (seenProvenance.has(key)) continue;
    seenProvenance.add(key);
    const shadow = pinnedShadowSubstitutions.get(pkg)?.substitution;
    const cacheHit = cacheHits.get(key);
    if (cacheHit === undefined && shadow?.acquisition.kind !== 'synthetic') {
      throw new Error(`install provenance missing fetch result for ${key}`);
    }
    provenancePackages.push({
      name: pkg.name,
      version: pkg.version,
      transport:
        shadow?.acquisition.kind === 'synthetic'
          ? 'shadow-registry'
          : cacheHit
            ? source === 'eddy'
              ? 'eddy'
              : 'cache'
            : 'registry',
    });
  }

  // Runs on both paths (D-F): lockfile entries carry `peerDependencies`, so
  // warn output is identical whichever path the install took.
  const shadowPlan = planTrustedAppliedShadowSubstitutions(
    packages.flatMap((pkg) => {
      const substitution = pinnedShadowSubstitutions.get(pkg)?.substitution;
      return substitution === undefined ? [] : [substitution];
    }),
  );
  const embeddedSources = packages.flatMap((pkg) => {
    const source = pinnedShadowSubstitutions.get(pkg)?.embeddedSource;
    return source === undefined ? [] : [source];
  });
  warnUnsatisfiedPeers(packages);
  const preparedPackages = preflightPackageInstallPaths(packages);
  opts.assertPortablePaths?.(packageLinkTargets(opts.cwd, preparedPackages));
  const currentBinSources = installPackageBinSources(
    preparedPackages,
    shadowPlan,
    resolved.companionOnlyBinInstallPaths,
  );
  const binClaims = preflightPackageBins(
    currentBinSources,
    lockfilePackageBinSources(
      priorLockfile,
      priorShadowPlan,
      resolved.companionOnlyBinInstallPaths,
      currentBinSources,
      preparedPackages,
    ),
  );
  throwIfAborted(opts.signal);
  try {
    const checkpoint = () => throwIfAborted(opts.signal);
    await linkInstallPackageFiles(opts.vfs, opts.cwd, preparedPackages, checkpoint);
    await materializeRegistryShadowSubstitutions(
      opts.vfs,
      opts.cwd,
      shadowPlan,
      substitutions.line,
      checkpoint,
    );
    await linkInstallPackageBins(opts.vfs, opts.cwd, binClaims, checkpoint);
    // ADR-0188: install-time internals shims into the actual installed dirs —
    // AFTER package files, aliases, and bins. Both paths (+ eddy).
    await applyInternalsShims(
      opts.vfs,
      opts.cwd,
      packages.filter((pkg) => !pinnedShadowSubstitutions.has(pkg)),
      substitutions.line,
      checkpoint,
    );
  } catch (error) {
    throwIfAborted(opts.signal);
    throw error;
  }
  throwIfAborted(opts.signal);
  const lockfile = buildPreparedInstallLockfile(
    rootName,
    normalizedRootVersion,
    preparedPackages,
    shadowPlan,
    embeddedSources,
    rootLockfileDependencyMaps,
  );
  // Diff-before-write preserves user-visible mtime on a no-op install (ADR-0023).
  await writeLockfileIfChanged(opts.vfs, opts.cwd, lockfile);
  throwIfAborted(opts.signal);
  substitutions.flush();
  const result: InstallResult = {
    packages,
    lockfile,
    conflicts: [],
    provenance: {
      resolution: plan.resolution(),
      packages: provenancePackages,
      ...(eddyFallbackReason === undefined ? {} : { eddyFallback: { reason: eddyFallbackReason } }),
    },
    source,
    ...(eddyClosureHash === undefined ? {} : { closureHash: eddyClosureHash }),
    ...(eddyResolvedAt === undefined ? {} : { resolvedAt: eddyResolvedAt }),
    ...(eddyResolvedVia === undefined ? {} : { resolvedVia: eddyResolvedVia }),
  };
  recordShadowAssetPlanForInstallResult(result, shadowPlan);
  return result;
}

/** Compute and contain the complete tarball target set before link mutates. */
export function packageLinkTargets(
  root: string,
  packages: readonly PreparedInstallPackage[],
): readonly string[] {
  const canonicalRoot = normalizePath(root);
  const targets = new Set<string>();
  for (const prepared of packages) {
    const pkg = prepared.package;
    const packageRoot = joinPath(canonicalRoot, prepared.relativePath);
    if (!isStrictDescendant(canonicalRoot, packageRoot)) {
      throw invalidPackageLinkPath(prepared.relativePath, `install path for ${pkg.name}`);
    }
    targets.add(packageRoot);
    for (const entryPath of Object.keys(pkg.files)) {
      assertSafePackageRelativePath(entryPath, `tar entry for ${pkg.name}`);
      const target = joinPath(packageRoot, entryPath);
      if (!isStrictDescendant(packageRoot, target)) {
        throw invalidPackageLinkPath(entryPath, `tar entry for ${pkg.name}`);
      }
      targets.add(target);
    }
  }
  return [...targets];
}

function installPackageBinSources(
  packages: readonly PreparedInstallPackage<PinnedPackage>[],
  shadowPlan: ShadowAssetPlan,
  companionOnlyInstallPaths: ReadonlySet<string>,
): readonly PackageBinSource[] {
  const sources: PackageBinSource[] = packages.map((prepared) => ({
    package:
      companionOnlyInstallPaths.has(prepared.relativePath) ||
      pinnedShadowSubstitutions.has(prepared.package)
        ? { name: prepared.package.name }
        : prepared.package,
    nodeModulesDir: prepared.nodeModulesDir,
  }));
  for (const substitution of shadowPlan.substitutions) {
    const recipe = builtinShadowSubstitutionCatalog.recipes.find(
      (candidate) => candidate.id === substitution.substitutionId,
    );
    if (!recipe) {
      throw new NotImplementedError(
        `shadow-registry.substitutionRecipe.${substitution.substitutionId}`,
      );
    }
    sources.push({
      package: {
        name: substitution.materialization.name,
        bin: { ...recipe.materialization.bin },
      },
      nodeModulesDir: packageNodeModulesDir(
        substitution.materialization.installPath,
        substitution.materialization.name,
      ),
    });
  }
  return sources;
}

function lockfilePackageBinSources(
  lockfile: Lockfile | null,
  shadowPlan: ShadowAssetPlan | null,
  companionOnlyInstallPaths: ReadonlySet<string>,
  currentSources: readonly PackageBinSource[],
  currentPackages: readonly PreparedInstallPackage<PinnedPackage>[],
): readonly PackageBinSource[] {
  if (!lockfile) return [];
  const excluded = new Set(companionOnlyInstallPaths);
  for (const substitution of shadowPlan?.substitutions ?? []) {
    if (substitution.acquisition.kind === 'registry') {
      excluded.add(registryAcquisitionInstallPath(substitution));
    }
  }
  const upgradedCompanionClaims = companionDemandUpgradePriorClaims(
    lockfile,
    currentSources,
    currentPackages,
    companionOnlyInstallPaths,
  );
  const sources: PackageBinSource[] = [];
  for (const [installPath, entry] of Object.entries(lockfile.packages)) {
    if (installPath === '' || entry.bin === undefined || excluded.has(installPath)) continue;
    const name = lockfilePathBareName(installPath);
    const source: PackageBinSource = {
      package: { name, bin: entry.bin },
      nodeModulesDir: packageNodeModulesDir(installPath, name),
    };
    for (const claim of normalizePackageBinSource(source)) {
      if (upgradedCompanionClaims.has(packageBinClaimKey(claim))) continue;
      sources.push({
        package: { name: claim.owner, bin: { [claim.command]: claim.target } },
        nodeModulesDir: claim.nodeModulesDir,
      });
    }
  }
  return sources;
}

/** ADR-0343: raw lock metadata retains inactive companion bins. A current
 * ordinary edge upgrades that exact companion claim, not a reify owner change. */
function companionDemandUpgradePriorClaims(
  lockfile: Lockfile,
  currentSources: readonly PackageBinSource[],
  currentPackages: readonly PreparedInstallPackage<PinnedPackage>[],
  companionOnlyInstallPaths: ReadonlySet<string>,
): ReadonlySet<string> {
  const currentClaims = new Set(normalizePackageBinSources(currentSources).map(packageBinClaimKey));
  const currentByPath = new Map(
    currentPackages.map((prepared) => [prepared.relativePath, prepared.package]),
  );
  const excluded = new Set<string>();
  for (const [triggerPath, triggerEntry] of Object.entries(lockfile.packages)) {
    if (triggerPath === '' || triggerEntry.bin === undefined || currentByPath.has(triggerPath)) {
      continue;
    }
    const triggerName = lockfilePathBareName(triggerPath);
    const triggerSource: PackageBinSource = {
      package: { name: triggerName, bin: triggerEntry.bin },
      nodeModulesDir: packageNodeModulesDir(triggerPath, triggerName),
    };
    const triggerClaims = normalizePackageBinSource(triggerSource);
    for (const [companionName, companionVersion] of Object.entries(
      companionRequestsFor(triggerName, triggerEntry.version),
    )) {
      const companion = pinnedEntryForParent(lockfile, companionName, triggerPath);
      if (
        !companion ||
        companion.entry.version !== companionVersion ||
        companion.entry.bin === undefined ||
        companionOnlyInstallPaths.has(companion.installPath)
      ) {
        continue;
      }
      const currentCompanion = currentByPath.get(companion.installPath);
      if (
        currentCompanion?.name !== companionName ||
        currentCompanion.version !== companionVersion
      ) {
        continue;
      }
      const companionSource: PackageBinSource = {
        package: { name: companionName, bin: companion.entry.bin },
        nodeModulesDir: packageNodeModulesDir(companion.installPath, companionName),
      };
      for (const companionClaim of normalizePackageBinSource(companionSource)) {
        if (!currentClaims.has(packageBinClaimKey(companionClaim))) continue;
        for (const triggerClaim of triggerClaims) {
          if (
            triggerClaim.nodeModulesDir === companionClaim.nodeModulesDir &&
            triggerClaim.command === companionClaim.command
          ) {
            excluded.add(packageBinClaimKey(triggerClaim));
          }
        }
      }
    }
  }
  return excluded;
}

function packageBinClaimKey(claim: PackageBinClaim): string {
  return `${claim.nodeModulesDir}\0${claim.command}\0${claim.owner}`;
}

function packageNodeModulesDir(installPath: string, packageName: string): string {
  const suffix = `/${packageName}`;
  if (!installPath.endsWith(suffix)) {
    throw new TypeError(`package bin source has invalid install path ${installPath}`);
  }
  return installPath.slice(0, -suffix.length);
}

function isStrictDescendant(root: string, path: string): boolean {
  return path !== root && path.startsWith(root === '/' ? '/' : `${root}/`);
}

function assertSafePackageRelativePath(path: string, label: string): void {
  if (path === '' || path.startsWith('/') || path.split('/').includes('..')) {
    throw invalidPackageLinkPath(path, label);
  }
}

function invalidPackageLinkPath(path: string, label: string): Error {
  return Object.assign(new Error(`Invalid package ${label}: ${path}`), {
    code: 'EINVALIDPACKAGETAR' as const,
    path,
  });
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
  let rootLockfileDependencyMaps: RootLockfileDependencyMaps | undefined;
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
    rootLockfileDependencyMaps = {
      dependencies: { ...manifest.dependencies },
      devDependencies: { ...manifest.devDependencies },
      optionalDependencies: { ...manifest.optionalDependencies },
    };
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
  rootLockfileDependencyMaps ??= {
    dependencies: { ...dependencies },
    devDependencies: {},
    optionalDependencies: { ...optionalDependencies },
  };
  rootName ??= 'root';
  normalizedRootVersion ??= '0.0.0';
  assertRegistryDependencySpecs(dependencies, optionalDependencies);
  assertRegistryOverrideTargets(opts.overrides);
  return {
    rootName,
    rootVersion: normalizedRootVersion,
    dependencies,
    optionalDependencies,
    rootLockfileDependencyMaps,
    opts,
  };
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

/** Skip Eddy when the existing lock owns replay or a loud structural failure. */
function existingLockfilePreemptsEddy(
  existingLockfile: Lockfile | null,
  shadowPlan: ShadowAssetPlan | null,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  opts: InstallOptions,
): boolean {
  if (!existingLockfile) return false;
  if (!shadowPlan) throw new TypeError('decoded lockfile shadow plan is missing');
  if (
    hasEffectiveTopLevelNameCollision(dependencies, optionalDependencies, rootName, opts.overrides)
  ) {
    return false;
  }
  return (
    analyzeLockfileRequest(
      existingLockfile,
      shadowPlan,
      dependencies,
      optionalDependencies,
      rootName,
      opts.overrides,
    ).ownership !== 'metadata'
  );
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
): Promise<
  | {
      kind: 'adopted';
      closureHash?: string;
      resolvedAt?: string;
      resolvedVia: 'get' | 'post';
      lockfile: Lockfile;
      shadowPlan: ShadowAssetPlan;
    }
  | {
      kind: 'declined';
      reason: string;
      cause: Error;
    }
> {
  const url = opts.resolverUrl;
  if (!url) return declineEddy('resolver URL unavailable');

  const online = opts.prefer === 'online';
  const body: EddyRequestBody = { dependencies, optionalDependencies };
  if (opts.overrides) body.overrides = opts.overrides;
  const requestKey = canonicalEddyRequestKey(body, opts.prefer ?? 'cached');

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
  // `via` = the underlying REQUEST KIND, the provenance `InstallResult`
  // carries: a prefetch is just an early GET (pinned) or POST (unpinned) —
  // labelling it 'prefetch' would hide that an unpinned boot prefetch is a
  // server-vouched resolution and the profile would never learn its pin.
  type EddyAttempt =
    | {
        kind: 'prefetch';
        label: 'prefetch';
        via: 'get' | 'post';
        expectedHash?: string;
        response: Promise<Response>;
      }
    | {
        kind: 'fetch';
        label: 'get' | 'post';
        via: 'get' | 'post';
        expectedHash?: string;
        run: (signal: AbortSignal) => Promise<Response>;
      };
  const attempts: EddyAttempt[] = [];
  if (prefetched) {
    attempts.push({
      kind: 'prefetch',
      label: 'prefetch',
      via: opts.resolverPrefetch?.closureHash ? 'get' : 'post',
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
      via: 'get',
      expectedHash: pin,
      run: (signal) => fetch(bundleUrlFor(bundleBase, pin), { signal }),
    });
  }
  attempts.push({
    kind: 'fetch',
    label: 'post',
    via: 'post',
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
  const causes: Error[] = [];
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
          ? await awaitWithSignal(attempt.response, opts.signal, 'eddy prefetch')
          : await fetchHeadersBounded(
              attempt.run,
              headersStallMs,
              `eddy ${attempt.label}`,
              opts.signal,
            );
      const outcome = await consumeEddyResponse(
        response,
        dependencies,
        optionalDependencies,
        rootName,
        opts,
        tarballCache,
        attempt.expectedHash,
      );
      if (typeof outcome !== 'string') {
        return {
          kind: 'adopted',
          ...(outcome.closureHash === undefined ? {} : { closureHash: outcome.closureHash }),
          ...(outcome.resolvedAt === undefined ? {} : { resolvedAt: outcome.resolvedAt }),
          resolvedVia: attempt.via,
          lockfile: outcome.lockfile,
          shadowPlan: outcome.shadowPlan,
        };
      }
      const cause = new Error(`${attempt.label}: ${outcome}`);
      reasons.push(cause.message);
      causes.push(cause);
    } catch (err) {
      if (opts.signal?.aborted) throw abortReason(opts.signal, 'npm install');
      const cause = err instanceof Error ? err : new Error(String(err));
      reasons.push(`${attempt.label}: ${cause.message}`);
      causes.push(cause);
    }
  }
  return declineEddy(reasons.join('; '), causes);
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
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  opts: InstallOptions,
  tarballCache: TarballCache,
  expectedClosureHash?: string,
): Promise<
  | {
      adopted: true;
      closureHash?: string;
      resolvedAt?: string;
      lockfile: Lockfile;
      shadowPlan: ShadowAssetPlan;
    }
  | string
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
      const bytes = await drainBodyBounded(response, {
        label: 'eddy decline body',
        ...(opts.resolverStallTimeoutMs === undefined
          ? {}
          : { stallTimeoutMs: opts.resolverStallTimeoutMs }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      });
      declineText = eddyDecoder.decode(bytes);
    } catch {
      if (opts.signal?.aborted) throw abortReason(opts.signal, 'npm install');
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
    ? streamTarEntries(response.body, {
        ...(opts.resolverStallTimeoutMs === undefined
          ? {}
          : { stallTimeoutMs: opts.resolverStallTimeoutMs }),
        ...(opts.signal === undefined ? {} : { signal: opts.signal }),
      })
    : bufferedTarEntries(new Uint8Array(await response.arrayBuffer()));

  let manifest: EddyBundleManifestV1 | null = null;
  let lockfile: Lockfile | null = null;
  let shadowPlan: ShadowAssetPlan | null = null;
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
      // A v3 lockfile records effective pins, not which parent-scoped policy
      // selected them. Local replay has the current request context; an
      // imported bundle cannot prove that provenance, so keep Eddy additive
      // and fall back to the standard resolver for this policy shape.
      if (hasParentScopedOverride(opts.overrides)) {
        return 'bundle lockfile does not cover the request (or an override forces a re-resolve)';
      }
      const requestAnalysis = analyzeLockfileRequest(
        parsed,
        planShadowSubstitutionsFromLockfile(parsed),
        dependencies,
        optionalDependencies,
        rootName,
        opts.overrides,
      );
      if (requestAnalysis.ownership !== 'replay') {
        return 'bundle lockfile does not cover the request (or an override forces a re-resolve)';
      }
      // Completeness (round 6): a covering lockfile whose reachable packages
      // lack a matching manifest tarball would replay the omissions from the
      // ORDINARY registry on cache miss while claiming `source: 'eddy'` — a
      // provenance lie (and a learned pin to a partial bundle). Gate at member
      // 2, before any tarball seed or lockfile write.
      const gap = bundleCompletenessGapForPaths(
        parsed,
        requestAnalysis.reachablePaths,
        manifest?.tarballs ?? [],
      );
      if (gap) return gap;
      lockfile = parsed;
      shadowPlan = requestAnalysis.shadowPlan;
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
  if (manifest === null || lockfile === null || shadowPlan === null) {
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
  const resolvedAt = isIsoDateString(rawResolvedAt) ? rawResolvedAt : undefined;
  return {
    adopted: true,
    ...(closureHash === undefined ? {} : { closureHash }),
    ...(resolvedAt === undefined ? {} : { resolvedAt }),
    lockfile,
    shadowPlan,
  };
}

function declineEddy(
  reason: string,
  causes: readonly Error[] = [],
): { readonly kind: 'declined'; readonly reason: string; readonly cause: Error } {
  console.warn(`npm: fast install (eddy) unavailable, using standard install — ${reason}`);
  const cause =
    causes.length === 0
      ? new Error(reason)
      : causes.length === 1
        ? causes[0]!
        : new AggregateError([...causes], `Eddy acquisition declined: ${reason}`);
  return { kind: 'declined', reason, cause };
}

/**
 * Per-install substitution-provenance reporter (ADR-0188). Lines stay ordered
 * and staged until lock commit. `redirect` dedupes the same baked redirect
 * surfacing through both the top-level pre-pass and walk.
 */
interface SubstitutionReporter {
  redirect(source: string, range: string | null, target: string, version: string): void;
  line(text: string): void;
  flush(): void;
}

function createSubstitutionReporter(sink: (line: string) => void): SubstitutionReporter {
  const seen = new Set<string>();
  const staged: string[] = [];
  return {
    redirect(source, range, target, version): void {
      const key = `${source}@${range ?? '*'}→${target}@${version}`;
      if (seen.has(key)) return;
      seen.add(key);
      staged.push(
        `npm: ${source}@${range ?? '*'} → ${target}@${version} (substituted from shadow registry, ADR-0051)`,
      );
    },
    line(text): void {
      staged.push(text);
    },
    flush(): void {
      for (const line of staged) sink(line);
      staged.length = 0;
    },
  };
}

function builtinRecipeForRequest(
  name: string,
  range: string | null,
  parent: string | undefined,
  overrides: OverrideMap | undefined,
): BuiltinShadowSubstitutionRecipe | null {
  const { override } = resolveEffectivePackageRequest(name, range, parent, overrides);
  if (override?.source === 'user') return null;
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.trigger.name === name,
  );
  if (!recipe) return null;
  assertShadowRecipeAdmission(recipe, range);
  return recipe;
}

function registryRecipeForResolution(
  recipe: BuiltinShadowSubstitutionRecipe | null,
  effectiveName: string,
  version: string,
): BuiltinShadowSubstitutionRecipe | null {
  if (
    recipe?.acquisition.kind !== 'registry' ||
    recipe.acquisition.name !== effectiveName ||
    recipe.acquisition.version !== version
  ) {
    return null;
  }
  return recipe;
}

function exactStringRecord(actual: unknown, expected: Readonly<Record<string, string>>): boolean {
  if (actual === undefined) return Object.keys(expected).length === 0;
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false;
  const entries = Object.entries(actual as Record<string, unknown>);
  return (
    entries.length === Object.keys(expected).length &&
    entries.every(([name, range]) => typeof range === 'string' && expected[name] === range)
  );
}

function exactStringMembership(actual: unknown, expected: readonly string[]): boolean {
  if (actual === undefined) return expected.length === 0;
  if (!Array.isArray(actual) || actual.some((name) => typeof name !== 'string')) return false;
  const actualNames = new Set(actual as string[]);
  return (
    actualNames.size === actual.length &&
    actualNames.size === expected.length &&
    expected.every((name) => actualNames.has(name))
  );
}

function assertRegistryShadowProjection(
  recipe: BuiltinShadowSubstitutionRecipe,
  manifest: VersionManifest,
): ShadowRegistryDependencyProjection {
  if (recipe.acquisition.kind !== 'registry') {
    throw new TypeError(`shadow recipe ${recipe.id} has no registry acquisition`);
  }
  const projection = recipe.acquisition.dependencyProjection;
  const manifestWithBundleAliases = manifest as VersionManifest & {
    readonly bundleDependencies?: unknown;
    readonly bundledDependencies?: unknown;
  };
  const bundleAliases = [
    manifestWithBundleAliases.bundleDependencies,
    manifestWithBundleAliases.bundledDependencies,
  ].filter((value) => value !== undefined);
  const expectedOptionalDependencies = {
    ...projection.optionalDependencies,
    ...projection.omittedOptionalDependencies,
  };
  const matches =
    exactStringRecord(manifest.dependencies, projection.dependencies) &&
    exactStringRecord(manifest.optionalDependencies, expectedOptionalDependencies) &&
    exactStringRecord(manifest.peerDependencies, projection.peerDependencies) &&
    (bundleAliases.length === 0
      ? projection.bundledDependencies.length === 0
      : bundleAliases.every((value) =>
          exactStringMembership(value, projection.bundledDependencies),
        ));
  if (matches) return projection;
  throw new NotImplementedError(
    projection.unsupportedFeature,
    `shadow recipe ${recipe.id} registry dependency projection drifted`,
  );
}

function assertDirectShadowRecipeAdmissions(
  dependencies: Readonly<Record<string, string>>,
  optionalDependencies: Readonly<Record<string, string>>,
  rootName: string,
  overrides: OverrideMap | undefined,
): void {
  for (const [name, range] of [
    ...Object.entries(dependencies),
    ...Object.entries(optionalDependencies),
  ]) {
    builtinRecipeForRequest(name, range, rootName, overrides);
  }
}

function syntheticResolvedIdentity(recipe: BuiltinShadowSubstitutionRecipe): string {
  return `rifty:shadow-substitution/${recipe.id}@${recipe.digest}`;
}

function syntheticManifest(recipe: BuiltinShadowSubstitutionRecipe): Readonly<{
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bin?: string | Record<string, string>;
}> {
  const file = recipe.materialization.files.find((candidate) => candidate.path === 'package.json');
  if (!file) throw new TypeError(`synthetic recipe ${recipe.id} has no package.json`);
  const value = JSON.parse(file.content) as unknown;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`synthetic recipe ${recipe.id} package.json is not an object`);
  }
  const manifest = value as Record<string, unknown>;
  if (
    manifest.name !== recipe.materialization.name ||
    manifest.version !== recipe.materialization.version
  ) {
    throw new TypeError(`synthetic recipe ${recipe.id} package identity drifted`);
  }
  const record = (field: string): Record<string, string> => {
    const candidate = manifest[field];
    if (candidate === undefined) return {};
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new TypeError(`synthetic recipe ${recipe.id} ${field} is invalid`);
    }
    const output: Record<string, string> = {};
    for (const [key, entry] of Object.entries(candidate as Record<string, unknown>)) {
      if (typeof entry !== 'string') {
        throw new TypeError(`synthetic recipe ${recipe.id} ${field}.${key} is invalid`);
      }
      output[key] = entry;
    }
    return output;
  };
  const binValue = manifest.bin;
  let bin: string | Record<string, string> | undefined;
  if (typeof binValue === 'string') bin = binValue;
  else if (binValue !== undefined) {
    if (binValue === null || typeof binValue !== 'object' || Array.isArray(binValue)) {
      throw new TypeError(`synthetic recipe ${recipe.id} bin is invalid`);
    }
    bin = record('bin');
  }
  const peerDependencies = record('peerDependencies');
  return {
    dependencies: record('dependencies'),
    optionalDependencies: record('optionalDependencies'),
    ...(Object.keys(peerDependencies).length === 0 ? {} : { peerDependencies }),
    ...(bin === undefined ? {} : { bin }),
  };
}

/** Pick per-edge lockfile replay or fresh metadata resolution. */
function chooseSource(
  existingLockfile: Lockfile | null,
  existingShadowPlan: ShadowAssetPlan | null,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  opts: InstallOptions,
  substitutions: SubstitutionReporter,
): SourcePlan {
  if (existingLockfile) {
    if (!existingShadowPlan) throw new TypeError('decoded lockfile shadow plan is missing');
    const incremental = createIncrementalSource(
      existingLockfile,
      existingShadowPlan,
      opts,
      substitutions,
    );
    return {
      source: incremental.source,
      resolution: incremental.resolution,
      dependencies,
      optionalDependencies,
    };
  }
  return {
    source: createRegistrySource(opts, substitutions),
    resolution: () => 'metadata',
    dependencies,
    optionalDependencies,
  };
}

type LockfileReuseDecision =
  | { readonly kind: 'reuse' }
  | {
      readonly kind: 'miss';
      readonly reason: 'missing-entry' | 'range-drift';
      readonly policyFrontier: boolean;
    };

function replayedShadowFact(
  plan: ShadowAssetPlan,
  recipe: BuiltinShadowSubstitutionRecipe,
  entry: Lockfile['packages'][string],
  materializationInstallPath: string,
): AppliedShadowSubstitution | undefined {
  return plan.substitutions.find((fact) => {
    if (
      fact.substitutionId !== recipe.id ||
      fact.materialization.installPath !== materializationInstallPath
    ) {
      return false;
    }
    if (recipe.acquisition.kind === 'synthetic') {
      return fact.acquisition.kind === 'synthetic';
    }
    return (
      fact.acquisition.kind === 'registry' &&
      fact.acquisition.name === recipe.acquisition.name &&
      fact.acquisition.version === entry.version &&
      fact.acquisition.resolved === entry.resolved &&
      fact.acquisition.integrity === entry.integrity
    );
  });
}

/** Per-edge ADR-0023 coverage. Strict lockfile decoding errors stay fatal. */
function lockfileReuseDecision(
  lockfile: Lockfile,
  shadowPlan: ShadowAssetPlan,
  name: string,
  range: string | null,
  ctx: ResolveContext,
  overrides: OverrideMap | undefined,
): LockfileReuseDecision {
  const recipe = builtinRecipeForRequest(name, range, ctx.parentName, overrides);
  const { override, effectiveName, effectiveRange } = resolveEffectivePackageRequest(
    name,
    range,
    ctx.parentName,
    overrides,
  );
  const hit = pinnedEntryForParent(lockfile, effectiveName, ctx.parentLockfilePath);
  const policyFrontier = override !== null || recipe !== null;
  if (!hit) return { kind: 'miss', reason: 'missing-entry', policyFrontier };
  if (
    (!rangeIsUnconstrained(effectiveRange) && !matchesRange(hit.entry.version, effectiveRange)) ||
    (override?.range !== null &&
      override?.range !== undefined &&
      !matchesRange(hit.entry.version, override.range))
  ) {
    return { kind: 'miss', reason: 'range-drift', policyFrontier };
  }
  const shadowRecipe =
    recipe?.acquisition.kind === 'synthetic'
      ? recipe
      : registryRecipeForResolution(recipe, effectiveName, hit.entry.version);
  const materializationInstallPath = shadowRecipe
    ? shadowMaterializationInstallPath(
        hit.installPath,
        effectiveName,
        shadowRecipe.materialization.name,
      )
    : undefined;
  if (
    shadowRecipe &&
    replayedShadowFact(shadowPlan, shadowRecipe, hit.entry, materializationInstallPath!) ===
      undefined
  ) {
    return { kind: 'miss', reason: 'missing-entry', policyFrontier: true };
  }
  return { kind: 'reuse' };
}

/** ADR-0023/npm install: repair range drift; ordinary retained-parent absence stays loud. */
function registryOwnsIncrementalMiss(
  decision: Exclude<LockfileReuseDecision, { readonly kind: 'reuse' }>,
  ctx: ResolveContext,
): boolean {
  return (
    decision.reason === 'range-drift' || ctx.parentOrigin !== 'lockfile' || decision.policyFrontier
  );
}

type LockfileRequestOwnership = 'replay' | 'metadata' | 'broken';

function mergeLockfileRequestOwnership(
  left: LockfileRequestOwnership,
  right: LockfileRequestOwnership,
): LockfileRequestOwnership {
  if (left === 'broken' || right === 'broken') return 'broken';
  if (left === 'metadata' || right === 'metadata') return 'metadata';
  return 'replay';
}

interface LockfileRequestAnalysis {
  readonly ownership: LockfileRequestOwnership;
  readonly reachablePaths: ReadonlySet<string>;
  readonly shadowPlan: ShadowAssetPlan;
}

/** No-I/O mirror of the mixed resolver, used by the Eddy provenance gates. */
function analyzeLockfileRequest(
  lockfile: Lockfile,
  shadowPlan: ShadowAssetPlan,
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  overrides: OverrideMap | undefined,
): LockfileRequestAnalysis {
  const reachablePaths = new Set<string>();
  const embeddedPaths = new Set(
    registryShadowEmbeddedSourcesFromLockfile(lockfile, shadowPlan).flatMap((source) =>
      source.dependencies.map((dependency) => dependency.installPath),
    ),
  );
  let ownership: LockfileRequestOwnership = 'replay';
  const recordOwnership = (next: LockfileRequestOwnership): void => {
    ownership = mergeLockfileRequestOwnership(ownership, next);
  };

  const visit = (name: string, range: string | null, ctx: ResolveContext): void => {
    const decision = lockfileReuseDecision(lockfile, shadowPlan, name, range, ctx, overrides);
    if (decision.kind === 'miss') {
      recordOwnership(registryOwnsIncrementalMiss(decision, ctx) ? 'metadata' : 'broken');
      return;
    }
    const recipe = builtinRecipeForRequest(name, range, ctx.parentName, overrides);
    const { effectiveName } = resolveEffectivePackageRequest(
      name,
      range,
      ctx.parentName,
      overrides,
    );
    const hit = pinnedEntryForParent(lockfile, effectiveName, ctx.parentLockfilePath);
    if (
      !hit ||
      (recipe?.acquisition.kind !== 'synthetic' && (!hit.entry.resolved || !hit.entry.integrity))
    ) {
      recordOwnership('broken');
      return;
    }
    assertShimSupported(effectiveName, hit.entry.version);
    if (reachablePaths.has(hit.installPath)) return;
    reachablePaths.add(hit.installPath);
    const childContext: ResolveContext = {
      parentName: effectiveName,
      parentInstallPath: hit.installPath,
      parentLockfilePath: hit.installPath,
      parentOrigin: 'lockfile',
      lockfilePathTranslations: [],
    };
    for (const [childName, childRange] of Object.entries(hit.entry.dependencies ?? {})) {
      if (embeddedPaths.has(`${hit.installPath}/node_modules/${childName}`)) continue;
      visit(childName, childRange, childContext);
    }
    for (const [companionName, companionRange] of Object.entries(
      companionRequestsFor(effectiveName, hit.entry.version),
    )) {
      visit(companionName, companionRange, childContext);
    }
  };

  const rootContext: ResolveContext = {
    parentName: rootName,
    parentInstallPath: '',
    parentLockfilePath: '',
    parentOrigin: 'root',
    lockfilePathTranslations: [],
  };
  for (const [name, range] of Object.entries(dependencies)) {
    visit(name, range, rootContext);
  }
  for (const [name, range] of Object.entries(optionalDependencies)) {
    try {
      visit(name, range, rootContext);
    } catch (error) {
      const code = (error as { code?: unknown })?.code;
      if (code === 'EBROKENLOCK' || code === 'EINSTALLPATHCONFLICT') {
        recordOwnership('broken');
      }
    }
  }
  return { ownership, reachablePaths, shadowPlan };
}

/** Covered edges replay; only uncovered or policy-drifted frontiers use metadata. */
function createIncrementalSource(
  lockfile: Lockfile,
  shadowPlan: ShadowAssetPlan,
  opts: InstallOptions,
  substitutions: SubstitutionReporter,
): Readonly<{ source: ResolutionSource; resolution: () => InstallResolution }> {
  const locked = createLockfileSource(lockfile, shadowPlan, opts, substitutions);
  const registry = createRegistrySource(opts, substitutions);
  let metadataUsed = false;
  const useRegistry = (name: string, range: string | null, ctx: ResolveContext): boolean => {
    const decision = lockfileReuseDecision(lockfile, shadowPlan, name, range, ctx, opts.overrides);
    return decision.kind === 'miss' && registryOwnsIncrementalMiss(decision, ctx);
  };

  return {
    source: {
      prefetch(name, range, ctx): void {
        if (!useRegistry(name, range, ctx)) return;
        metadataUsed = true;
        registry.prefetch?.(name, range, ctx);
      },
      async resolve(name, range, ctx): Promise<ResolvedPin> {
        if (useRegistry(name, range, ctx)) {
          metadataUsed = true;
          return await registry.resolve(name, range, ctx);
        }
        return await locked.resolve(name, range, ctx);
      },
    },
    resolution: () => (metadataUsed ? 'metadata' : 'lockfile'),
  };
}

/** Exact package identity shared by direct reservation, placement, and fetch dedup. */
function resolvedPinIdentity(pin: ResolvedPin): string {
  return `${pin.name}\0${pin.version}\0${pin.resolved}\0${pin.integrity ?? ''}`;
}

type PinAcquisitionResult =
  | Readonly<{ kind: 'synthetic' }>
  | Readonly<{ kind: 'tarball'; result: FetchAndUnpackResult }>;

function brokenShadowReplayCache(pin: ResolvedPin, detail: string): Error {
  return Object.assign(
    new Error(`EBROKENLOCK: shadow recipe ${pin.shadow?.recipe.id ?? pin.name} ${detail}`),
    {
      code: 'EBROKENLOCK' as const,
      packageName: pin.name,
      reason: 'shadow-trace-drift' as const,
    },
  );
}

async function readRegistryShadowReplayCache(
  pin: ResolvedPin,
  fetchCtx: FetchAndUnpackCtx,
): Promise<FetchAndUnpackResult> {
  const acquisition = pin.shadow?.acquisition;
  if (pin.origin !== 'lockfile' || acquisition?.kind !== 'registry') {
    throw new TypeError('registry shadow replay cache requires a lockfile acquisition');
  }
  throwIfAborted(fetchCtx.signal);
  const integrity = acquisition.integrity;
  const algorithm = integrity === undefined ? null : parseIntegrityAlgorithm(integrity);
  if (integrity === undefined || algorithm === null) {
    throw brokenShadowReplayCache(pin, 'has an invalid replay-cache integrity');
  }
  const bytes = await fetchCtx.cache.get(acquisition.name, acquisition.version, integrity);
  throwIfAborted(fetchCtx.signal);
  if (bytes === null) throw brokenShadowReplayCache(pin, 'is missing its pinned cache bytes');
  const actual = await computeIntegrity(bytes, algorithm);
  throwIfAborted(fetchCtx.signal);
  if (actual !== integrity) {
    throw brokenShadowReplayCache(pin, 'has corrupt pinned cache bytes');
  }
  return { bytes, cacheHit: true, integrity };
}

/**
 * Single traversal driver: for each node, ask `source` for its pin, decide
 * placement, fetch the tarball, record it, recurse into `dependencies` and
 * `optionalDependencies` (registry-source only).
 *
 * Placement rule (M11 + direct-root tier):
 *   0. Surviving direct identities reserve their root-visible slots.
 *   1. Reuse a recorded path when free; relocate it on a mixed-source conflict.
 *   2. Descendants use first-wins-flat + nest-on-conflict.
 *
 * Intentionally simpler than npm v3 hoisting: a conflict always nests under its
 * immediate parent even when a sibling-ancestor has a reusable nested copy.
 * Correct in all cases; costs a few duplicated nested copies (disk, never
 * resolution). Full "hoist as high as possible" is a follow-on.
 *
 * Full replay reproduces recorded paths. Mixed replay preserves free recorded
 * paths and rebases descendants when a retained parent moves.
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
): Promise<WalkAndPinResult> {
  // Direct roots resolve first and surviving identities reserve flat slots
  // before descendant DFS. Descendant placement stays serial/request-ordered;
  // packument prefetch and tarball acquisition may overlap without owning paths.
  // Tarball fetch is parallelized (bounded
  // semaphore): tarball bytes feed extractTarGz/files alone, never the dep walk
  // (pin.dependencies comes from the packument/lockfile, not the tarball), so
  // fetch order cannot perturb layout. Concurrent same-(name,version) fetches
  // dedupe to one network call via `inFlight`. ONE exception to the deferred
  // fetch: an OPTIONAL-boundary node awaits acquisition + materialization
  // before recursing, so its own failure skips the subtree before it is walked.
  const FETCH_CONCURRENCY = 8; // perf knob only; any value yields the identical tree.
  const sem = new Semaphore(FETCH_CONCURRENCY);

  /** Identity installed at `node_modules/<name>` (the hoisted slot). */
  const flatByName = new Map<string, Readonly<{ version: string; identity: string }>>();
  /** Every installed copy, keyed by install path. */
  const pinned = new Map<string, PinnedPackage>();
  /** Install paths already scheduled this walk (synchronous path-level dedup,
   * replaces `pinned.has` since `pinned` is now populated at the await site). */
  const scheduled = new Map<string, { readonly identity: string; ordinaryBinDemand: boolean }>();
  /** Paths reached by at least one non-optional edge; demand only strengthens. */
  const requiredDemandPaths = new Set<string>();
  /** Collapse concurrent same-package acquisitions to one network call. */
  const inFlight = new Map<string, Promise<PinAcquisitionResult>>();
  /** Optional direct roots materialized before they may reserve a flat slot. */
  const preparedOptionalPackages = new Map<string, PinnedPackage>();
  /** Deferred fetch tasks; `optional` carries the warn descriptor (or null). */
  const fetchTasks: Array<{
    promise: Promise<PinAcquisitionResult>;
    pin: ResolvedPin;
    installPath: string;
    optional: { depName: string; depRange: string; parentName: string } | null;
  }> = [];

  function prefetchPackuments(dependencies: Record<string, string>, ctx: ResolveContext): void {
    prefetchDependencyEntries(Object.entries(dependencies), ctx);
  }

  function prefetchDependencyEntries(
    dependencies: readonly (readonly [string, string])[],
    ctx: ResolveContext,
  ): void {
    if (!source.prefetch) return;
    for (const [depName, depRange] of dependencies) {
      source.prefetch(depName, depRange, ctx);
    }
  }

  function traversedDependencyEntries(
    pin: ResolvedPin,
    dependencies: Record<string, string>,
  ): [string, string][] {
    const bundled =
      pin.shadow?.recipe.acquisition.kind === 'registry'
        ? pin.shadow.recipe.acquisition.dependencyProjection.bundledDependencies
        : [];
    return Object.entries(dependencies).filter(([name]) => !bundled.includes(name));
  }

  function acquirePin(pin: ResolvedPin): Promise<PinAcquisitionResult> {
    const key = resolvedPinIdentity(pin);
    let pending = inFlight.get(key);
    if (pending) return pending;
    if (pin.shadow?.acquisition.kind === 'synthetic') {
      pending = Promise.resolve({ kind: 'synthetic' });
    } else if (pin.origin === 'lockfile' && pin.shadow?.acquisition.kind === 'registry') {
      pending = sem.run(async () => ({
        kind: 'tarball' as const,
        result: await readRegistryShadowReplayCache(pin, fetchCtx),
      }));
    } else {
      pending = sem.run(async () => ({
        kind: 'tarball' as const,
        result: await fetchAndUnpackToCache(
          {
            name: pin.name,
            version: pin.version,
            resolved: pin.resolved,
            integrity: pin.integrity,
          },
          fetchCtx,
        ),
      }));
    }
    if (onPackage && pin.shadow?.acquisition.kind !== 'synthetic') {
      const hook = onPackage;
      const { name: pinName, version: pinVersion } = pin;
      pending = pending.then((acquisition) => {
        if (acquisition.kind !== 'tarball') return acquisition;
        try {
          hook({
            name: pinName,
            version: pinVersion,
            cacheHit: acquisition.result.cacheHit,
          });
        } catch (err) {
          console.warn(
            `install onPackage hook threw for ${pinName}@${pinVersion}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
        return acquisition;
      });
    }
    inFlight.set(key, pending);
    return pending;
  }

  function visit(
    name: string,
    range: string | null,
    ctx: ResolveContext,
    // When set, this node (and its subtree) is reached via an optional dep; a
    // fetch failure warns-and-skips instead of aborting, with this descriptor.
    optional: { depName: string; depRange: string; parentName: string } | null,
    ordinaryBinDemand = true,
    preparedPin?: ResolvedPin,
  ): Promise<void> {
    return (async () => {
      const pin = preparedPin ?? (await source.resolve(name, range, ctx));
      // ADR-0188: a shimmed package outside its shim's proven range must fail
      // loudly BEFORE anything installs — never a stale shim silently applied.
      assertShimSupported(pin.name, pin.version);

      // Did THIS visit newly claim the flat slot? (Either `choosePlacement`'s
      // first-wins set, or the block below.) Needed so an optional-boundary
      // fetch failure rolls back ONLY a claim it owns — never a slot a prior
      // visit already won. Captured pre-placement because `choosePlacement`
      // mutates `flatByName` as a side effect.
      const flatSlotFreeBefore = !flatByName.has(pin.name);
      const key = resolvedPinIdentity(pin);
      let installPath =
        pin.installPath === undefined
          ? undefined
          : translateRecordedInstallPath(pin.installPath, ctx.lockfilePathTranslations);
      if (installPath === undefined) {
        installPath = choosePlacement(pin, ctx.parentInstallPath, flatByName);
      } else {
        const preferredIdentity = scheduled.get(installPath)?.identity;
        const flat =
          installPath === `node_modules/${pin.name}` ? flatByName.get(pin.name) : undefined;
        if (
          (preferredIdentity !== undefined && preferredIdentity !== key) ||
          (flat !== undefined && flat.identity !== key)
        ) {
          installPath = choosePlacement(pin, ctx.parentInstallPath, flatByName);
        }
      }
      // Record the flat slot so a later live-source visit honours first-wins.
      if (installPath === `node_modules/${pin.name}` && !flatByName.has(pin.name)) {
        flatByName.set(pin.name, { version: pin.version, identity: key });
      }
      if (optional === null) requiredDemandPaths.add(installPath);
      const scheduledPackage = scheduled.get(installPath);
      if (scheduledPackage !== undefined) {
        if (scheduledPackage.identity !== key) {
          throw Object.assign(
            new Error(
              `EINSTALLPATHCONFLICT: '${installPath}' was assigned to two different package identities`,
            ),
            { code: 'EINSTALLPATHCONFLICT', installPath },
          );
        }
        if (ordinaryBinDemand) scheduledPackage.ordinaryBinDemand = true;
        return;
      }
      scheduled.set(installPath, { identity: key, ordinaryBinDemand });
      const claimedFlat = flatSlotFreeBefore && installPath === `node_modules/${pin.name}`;

      const p = acquirePin(pin);

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
        optional !== null && optional.depName === name && optional.parentName === ctx.parentName;
      if (isOptionalBoundary) {
        // Awaits here (and pins on success) instead of deferring to `fetchTasks`,
        // so acquisition and archive parsing both belong to the boundary.
        try {
          const result = await p;
          if (!pinned.has(installPath)) {
            const preparedKey = `${key}\0${installPath}`;
            const pkg =
              preparedOptionalPackages.get(preparedKey) ??
              (await pinToPackage(pin, result, installPath));
            pinned.set(installPath, pkg);
          }
        } catch (err) {
          throwIfAborted(fetchCtx.signal);
          // Roll back the synchronous claims THIS visit made before re-throwing
          // to the parent's optional catch (#24 dedup-gate bug): `scheduled` was
          // added pre-fetch, so without this a later REQUIRED visit of the SAME
          // name (via another parent) would hit `scheduled.has` → early-return →
          // silently drop a required dep while reporting success. npm aborts.
          scheduled.delete(installPath);
          if (claimedFlat) flatByName.delete(pin.name);
          throw err;
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
      const childContext: ResolveContext = {
        parentName: pin.name,
        parentInstallPath: installPath,
        parentLockfilePath:
          pin.origin === 'lockfile' ? (pin.installPath ?? installPath) : installPath,
        parentOrigin: pin.origin,
        lockfilePathTranslations:
          pin.origin === 'lockfile' &&
          pin.installPath !== undefined &&
          pin.installPath !== installPath
            ? [
                ...ctx.lockfilePathTranslations,
                { recordedPrefix: pin.installPath, actualPrefix: installPath },
              ]
            : ctx.lockfilePathTranslations,
      };
      const requiredDependencies = traversedDependencyEntries(pin, pin.dependencies);
      prefetchDependencyEntries(requiredDependencies, childContext);
      for (const [depName, depRange] of requiredDependencies) {
        await visit(depName, depRange, childContext, optional);
      }
      // npm contract: a missing optional dep is non-fatal (typically
      // platform-specific native helpers like fsevents). A resolve-time failure
      // is caught here; a fetch-time failure is attributed at the await site via
      // the `optional` descriptor propagated into the subtree.
      const optionalDependencies = traversedDependencyEntries(pin, pin.optionalDependencies);
      prefetchDependencyEntries(optionalDependencies, childContext);
      for (const [depName, depRange] of optionalDependencies) {
        const desc = { depName, depRange, parentName: pin.name };
        try {
          await visit(depName, depRange, childContext, desc);
        } catch (err) {
          throwIfAborted(fetchCtx.signal);
          warnOptional(desc, err);
        }
      }
      // ADR-0188: same-version companion pins for shadow internals shims
      // (rollup ↔ @rollup/wasm-node lockstep). Injected on BOTH sources —
      // replay re-derives them from (name, version); a pre-shim lockfile
      // misses the entry and throws EBROKENLOCK (delete + re-install).
      const companions = companionRequestsFor(pin.name, pin.version);
      prefetchPackuments(companions, childContext);
      for (const [depName, depRange] of Object.entries(companions)) {
        await visit(depName, depRange, childContext, optional, false);
      }
    })();
  }

  let traversalFailure: { readonly error: unknown } | undefined;
  try {
    const rootContext: ResolveContext = {
      parentName: rootName,
      parentInstallPath: '',
      parentLockfilePath: '',
      parentOrigin: 'root',
      lockfilePathTranslations: [],
    };
    prefetchPackuments(topLevelDependencies, rootContext);
    prefetchPackuments(topLevelOptionalDependencies, rootContext);

    interface PreparedRoot {
      readonly name: string;
      readonly range: string;
      readonly pin: ResolvedPin;
      readonly optional: { depName: string; depRange: string; parentName: string } | null;
    }
    const requiredRoots: PreparedRoot[] = [];
    for (const [name, range] of Object.entries(topLevelDependencies)) {
      const pin = await source.resolve(name, range, rootContext);
      assertShimSupported(pin.name, pin.version);
      requiredRoots.push({ name, range, pin, optional: null });
    }
    const optionalRoots: PreparedRoot[] = [];
    for (const [name, range] of Object.entries(topLevelOptionalDependencies)) {
      const desc = { depName: name, depRange: range, parentName: rootName };
      try {
        const pin = await source.resolve(name, range, rootContext);
        assertShimSupported(pin.name, pin.version);
        const result = await acquirePin(pin);
        const installPath = `node_modules/${pin.name}`;
        preparedOptionalPackages.set(
          `${resolvedPinIdentity(pin)}\0${installPath}`,
          await pinToPackage(pin, result, installPath),
        );
        optionalRoots.push({ name, range, pin, optional: desc });
      } catch (error) {
        throwIfAborted(fetchCtx.signal);
        warnOptional(desc, error);
      }
    }

    for (const { pin } of [...requiredRoots, ...optionalRoots]) {
      const identity = resolvedPinIdentity(pin);
      const prior = flatByName.get(pin.name);
      if (prior !== undefined && prior.identity !== identity) {
        throw Object.assign(
          new Error(
            `EINSTALLPATHCONFLICT: direct requests resolve '${pin.name}' to incompatible package identities`,
          ),
          { code: 'EINSTALLPATHCONFLICT', installPath: `node_modules/${pin.name}` },
        );
      }
      flatByName.set(pin.name, { version: pin.version, identity });
    }

    for (const root of requiredRoots) {
      await visit(root.name, root.range, rootContext, null, true, root.pin);
    }
    for (const root of optionalRoots) {
      try {
        await visit(root.name, root.range, rootContext, root.optional, true, root.pin);
      } catch (error) {
        warnOptional(root.optional!, error);
      }
    }
  } catch (error) {
    traversalFailure = { error };
  }
  if (traversalFailure !== undefined) {
    await Promise.allSettled([...inFlight.values()]);
    throw traversalFailure.error;
  }

  // The ordered walk has assigned every installPath; now await the parallelized
  // fetches and build `pinned`. Settle all before publishing any failure.
  const results = await Promise.allSettled(fetchTasks.map((t) => t.promise));
  for (let i = 0; i < fetchTasks.length; i++) {
    const task = fetchTasks[i];
    const outcome = results[i];
    if (!task || !outcome) continue;
    const optionalFailure = requiredDemandPaths.has(task.installPath) ? null : task.optional;
    if (outcome.status === 'rejected') {
      throwIfAborted(fetchCtx.signal);
      if (optionalFailure !== null) {
        warnOptional(optionalFailure, outcome.reason);
        continue;
      }
      throw outcome.reason;
    }
    if (pinned.has(task.installPath)) continue;
    try {
      pinned.set(task.installPath, await pinToPackage(task.pin, outcome.value, task.installPath));
    } catch (error) {
      throwIfAborted(fetchCtx.signal);
      if (optionalFailure === null) throw error;
      warnOptional(optionalFailure, error);
    }
  }
  const companionOnlyBinInstallPaths = new Set<string>();
  for (const [installPath, scheduledPackage] of scheduled) {
    if (!scheduledPackage.ordinaryBinDemand && pinned.has(installPath)) {
      companionOnlyBinInstallPaths.add(installPath);
    }
  }
  return { packages: pinned, companionOnlyBinInstallPaths };
}

/** Emit the existing optional-dependency warn message verbatim. */
function warnOptional(
  desc: { depName: string; depRange: string; parentName: string },
  err: unknown,
): void {
  const code = (err as { code?: unknown })?.code;
  if (code === 'EBROKENLOCK' || code === 'EINSTALLPATHCONFLICT' || code === 'EINVALIDPACKAGETAR') {
    throw err;
  }
  // A platform-native optional sibling (e.g. one of Rolldown's
  // `@rolldown/binding-<platform>` packages) is EXPECTED to be skipped — rifty's
  // JS+WASI runtime can never run a native binary (ADR-0051), and the matching
  // wasm/WASI sibling is the one that installs. Phrase it as an expected skip so a
  // pack of these does not read as a wall of install errors (it is not a failure).
  if (code === 'ENATIVEUNSUPPORTED') {
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

/** Descendant placement: first-wins-flat + nest-on-conflict. */
function choosePlacement(
  pin: ResolvedPin,
  parentInstallPath: string,
  flatByName: Map<string, Readonly<{ version: string; identity: string }>>,
): string {
  const identity = resolvedPinIdentity(pin);
  const flat = flatByName.get(pin.name);
  if (flat === undefined) {
    flatByName.set(pin.name, { version: pin.version, identity });
    return `node_modules/${pin.name}`;
  }
  if (flat.identity === identity) {
    return `node_modules/${pin.name}`;
  }
  return `${parentInstallPath}/node_modules/${pin.name}`;
}

/** Rebase a recorded descendant through the most-specific relocated ancestor. */
function translateRecordedInstallPath(
  installPath: string,
  translations: readonly LockfilePathTranslation[],
): string {
  let match: LockfilePathTranslation | undefined;
  for (const candidate of translations) {
    if (
      (installPath === candidate.recordedPrefix ||
        installPath.startsWith(`${candidate.recordedPrefix}/node_modules/`)) &&
      (match === undefined || candidate.recordedPrefix.length > match.recordedPrefix.length)
    ) {
      match = candidate;
    }
  }
  return match === undefined
    ? installPath
    : `${match.actualPrefix}${installPath.slice(match.recordedPrefix.length)}`;
}

/**
 * Adapter: `ResolvedPin × tarballBytes × actualIntegrity → PinnedPackage`. The
 * single assembly point for both sources — before D-F this was copy-pasted and
 * had drifted on peer-deps hydration.
 */
async function pinToPackage(
  pin: ResolvedPin,
  acquisition: PinAcquisitionResult,
  installPath: string,
): Promise<PinnedPackage> {
  const files =
    acquisition.kind === 'synthetic'
      ? Object.fromEntries(
          pin.shadow!.recipe.materialization.files.map((file) => [
            file.path,
            new TextEncoder().encode(file.content),
          ]),
        )
      : await extractTarGz(acquisition.result.bytes);
  const embeddedDependencies = assertRegistryShadowEmbeddedManifests(pin, files, installPath);
  const bin = pin.shadow
    ? pin.shadow.acquisition.kind === 'registry'
      ? undefined
      : { ...pin.shadow.recipe.materialization.bin }
    : pin.bin;
  const pkg: PinnedPackage = {
    name: pin.name,
    version: pin.version,
    files,
    dependencies: pin.dependencies,
    ...(bin === undefined ? {} : { bin }),
    resolved: pin.resolved,
    installPath,
    ...(acquisition.kind === 'tarball' ? { integrity: acquisition.result.integrity } : {}),
  };
  if (pin.peerDependencies && Object.keys(pin.peerDependencies).length > 0) {
    pkg.peerDependencies = pin.peerDependencies;
  }
  if (pin.shadow) {
    const materializationInstallPath = shadowMaterializationInstallPath(
      installPath,
      pin.name,
      pin.shadow.recipe.materialization.name,
    );
    const fact = attestBuiltinShadowSubstitution({
      trigger: pin.shadow.trigger,
      installPath: materializationInstallPath,
      acquisition:
        pin.shadow.acquisition.kind === 'synthetic'
          ? { kind: 'synthetic' }
          : {
              kind: 'registry',
              name: pin.shadow.acquisition.name,
              version: pin.shadow.acquisition.version,
              resolved: pin.shadow.acquisition.resolved,
              integrity:
                acquisition.kind === 'tarball'
                  ? acquisition.result.integrity
                  : pin.shadow.acquisition.integrity!,
            },
    });
    pinnedShadowSubstitutions.set(pkg, {
      substitution: fact,
      ...(embeddedDependencies.length === 0
        ? {}
        : {
            embeddedSource: {
              acquisitionInstallPath: installPath,
              dependencies: embeddedDependencies,
            },
          }),
    });
  }
  return pkg;
}

function assertRegistryShadowEmbeddedManifests(
  pin: ResolvedPin,
  files: Readonly<Record<string, Uint8Array>>,
  installPath: string,
): readonly RegistryShadowEmbeddedDependency[] {
  if (pin.shadow?.acquisition.kind !== 'registry') return [];
  const acquisition = pin.shadow.recipe.acquisition;
  if (acquisition.kind !== 'registry') {
    throw new TypeError(`shadow recipe ${pin.shadow.recipe.id} has no registry acquisition`);
  }
  const projection = acquisition.dependencyProjection;
  const embeddedDependencies: RegistryShadowEmbeddedDependency[] = [];
  for (const name of projection.bundledDependencies) {
    const range = projection.dependencies[name] ?? projection.optionalDependencies[name];
    const bytes = files[`node_modules/${name}/package.json`];
    let manifest: Record<string, unknown> | null = null;
    if (bytes !== undefined) {
      try {
        const value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          manifest = value as Record<string, unknown>;
        }
      } catch {
        // The named acquisition feature owns every malformed embedded manifest.
      }
    }
    const version = typeof manifest?.version === 'string' ? manifest.version : undefined;
    const validManifest =
      range !== undefined &&
      manifest?.name === name &&
      version !== undefined &&
      matchesRange(version, range);
    const expected = pin.shadow.expectedEmbeddedDependencies?.find(
      (dependency) => dependency.name === name,
    );
    if (
      validManifest &&
      (pin.origin !== 'lockfile' || (expected?.range === range && expected.version === version))
    ) {
      embeddedDependencies.push({
        name,
        range,
        version,
        installPath: `${installPath}/node_modules/${name}`,
      });
      continue;
    }
    if (pin.origin === 'lockfile') {
      throw Object.assign(
        new Error(
          `EBROKENLOCK: shadow recipe ${pin.shadow.recipe.id} embedded dependency ${name} disagrees with its lockfile fact`,
        ),
        {
          code: 'EBROKENLOCK' as const,
          packageName: pin.name,
          reason: 'shadow-trace-drift' as const,
        },
      );
    }
    throw new NotImplementedError(
      projection.unsupportedFeature,
      `shadow recipe ${pin.shadow.recipe.id} embedded dependency ${name} drifted`,
    );
  }
  return embeddedDependencies;
}

function shadowMaterializationInstallPath(
  installPath: string,
  acquiredName: string,
  materializedName: string,
): string {
  const suffix = `node_modules/${acquiredName}`;
  if (!installPath.endsWith(suffix)) {
    throw new TypeError(`shadow acquisition has invalid install path ${installPath}`);
  }
  return `${installPath.slice(0, installPath.length - acquiredName.length)}${materializedName}`;
}

/**
 * Lockfile-replay source. Walks up the recorded parent scope and validates the
 * current edge range. The matched key is a preferred path; mixed traversal may
 * relocate it when another identity now owns that slot.
 *
 * Throws `EBROKENLOCK` on a missing or malformed (no `resolved`/`integrity`)
 * entry: the contract is "lockfile is authoritative or it's an error".
 * Returning `null` would leave a partial set that reads as network slowness.
 */
function createLockfileSource(
  lockfile: Lockfile,
  shadowPlan: ShadowAssetPlan,
  opts: InstallOptions,
  substitutions: SubstitutionReporter,
): ResolutionSource {
  const embeddedSources = registryShadowEmbeddedSourcesFromLockfile(lockfile, shadowPlan);
  return {
    async resolve(name, range, ctx): Promise<ResolvedPin> {
      const recipe = builtinRecipeForRequest(name, range, ctx.parentName, opts.overrides);
      const synthetic = recipe?.acquisition.kind === 'synthetic' ? recipe : null;
      // Apply the same retained redirect/user override as live resolution
      // before lookup. Synthetic catalog recipes keep their source identity
      // and are validated separately against the lockfile recipe trace.
      const { override, effectiveName } = resolveEffectivePackageRequest(
        name,
        range,
        ctx.parentName,
        opts.overrides,
      );
      const hit = pinnedEntryForParent(lockfile, effectiveName, ctx.parentLockfilePath);
      if (!hit) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: lockfile coverage gap — '${effectiveName}' is reachable from the dep graph but missing from package-lock.json (searched walk-up from recorded parent path '${ctx.parentLockfilePath}'). Delete the lockfile and re-install.`,
          ),
          { code: 'EBROKENLOCK', packageName: effectiveName, reason: 'missing-entry' as const },
        );
      }
      const { entry, installPath } = hit;
      if (!entry.resolved || (!synthetic && !entry.integrity)) {
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
      // satisfying version; replay must NOT silently reuse a version the
      // current override no longer admits.
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
      const shadowRecipe =
        synthetic ?? registryRecipeForResolution(recipe, effectiveName, entry.version);
      const shadowFact = shadowRecipe
        ? replayedShadowFact(
            shadowPlan,
            shadowRecipe,
            entry,
            shadowMaterializationInstallPath(
              installPath,
              effectiveName,
              shadowRecipe.materialization.name,
            ),
          )
        : undefined;
      if (shadowRecipe && !shadowFact) {
        throw Object.assign(
          new Error(
            `EBROKENLOCK: shadow substitution ${shadowRecipe.id} is missing its replay trace`,
          ),
          {
            code: 'EBROKENLOCK',
            packageName: effectiveName,
            reason: 'shadow-trace-drift' as const,
          },
        );
      }
      const embeddedSource =
        shadowRecipe?.acquisition.kind === 'registry'
          ? embeddedSources.find((source) => source.acquisitionInstallPath === installPath)
          : undefined;
      if (synthetic) {
        substitutions.line(
          `npm: ${name}@${range ?? '*'} materialized from shadow registry (${synthetic.id})`,
        );
      }
      return {
        origin: 'lockfile',
        name: effectiveName,
        version: entry.version,
        resolved: entry.resolved ?? syntheticResolvedIdentity(synthetic!),
        integrity: entry.integrity,
        dependencies: entry.dependencies ?? {},
        bin: entry.bin,
        peerDependencies: entry.peerDependencies,
        // Optionals already filtered at lockfile-write time.
        optionalDependencies: {},
        installPath,
        ...(shadowRecipe
          ? {
              shadow: {
                recipe: shadowRecipe,
                trigger: {
                  name,
                  requestedRange: range,
                  version: shadowRecipe.trigger.version,
                },
                acquisition:
                  shadowRecipe.acquisition.kind === 'synthetic'
                    ? ({ kind: 'synthetic' } as const)
                    : ({
                        kind: 'registry',
                        name: effectiveName,
                        version: entry.version,
                        resolved: entry.resolved!,
                        integrity: entry.integrity,
                      } as const),
                ...(embeddedSource === undefined
                  ? {}
                  : { expectedEmbeddedDependencies: embeddedSource.dependencies }),
              },
            }
          : {}),
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
  // Mixed installs may consult metadata at any uncovered edge; retained entries
  // can still seed integrity for matching registry pins.
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
          const packument = await opts.registry.getPackument(
            name,
            opts.signal === undefined ? {} : { signal: opts.signal },
          );
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

  return {
    prefetch(name, range, ctx): void {
      const recipe = builtinRecipeForRequest(name, range, ctx.parentName, opts.overrides);
      if (recipe?.acquisition.kind === 'synthetic') return;
      const { effectiveName } = resolveEffectivePackageRequest(
        name,
        range,
        ctx.parentName,
        opts.overrides,
      );
      void loadPackument(effectiveName);
    },

    async resolve(name, range, ctx): Promise<ResolvedPin> {
      const recipe = builtinRecipeForRequest(name, range, ctx.parentName, opts.overrides);
      const synthetic = recipe?.acquisition.kind === 'synthetic' ? recipe : null;
      if (synthetic) {
        const manifest = syntheticManifest(synthetic);
        substitutions.line(
          `npm: ${name}@${range ?? '*'} materialized from shadow registry (${synthetic.id})`,
        );
        return {
          origin: 'metadata',
          name: synthetic.materialization.name,
          version: synthetic.materialization.version,
          resolved: syntheticResolvedIdentity(synthetic),
          dependencies: manifest.dependencies,
          bin: manifest.bin,
          peerDependencies: manifest.peerDependencies,
          optionalDependencies: manifest.optionalDependencies,
          shadow: {
            recipe: synthetic,
            trigger: {
              name,
              requestedRange: range,
              version: synthetic.trigger.version,
            },
            acquisition: { kind: 'synthetic' },
          },
        };
      }
      const { override, effectiveName, effectiveRange } = resolveEffectivePackageRequest(
        name,
        range,
        ctx.parentName,
        opts.overrides,
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
      const shadowRecipe = registryRecipeForResolution(recipe, effectiveName, pick);
      const shadowProjection = shadowRecipe
        ? assertRegistryShadowProjection(shadowRecipe, manifest)
        : undefined;

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
        origin: 'metadata',
        name: effectiveName,
        version: pick,
        resolved: manifest.dist.tarball,
        integrity: expectedIntegrity,
        dependencies:
          shadowProjection === undefined
            ? (manifest.dependencies ?? {})
            : { ...shadowProjection.dependencies },
        bin: manifest.bin,
        peerDependencies:
          shadowProjection === undefined
            ? manifest.peerDependencies
            : { ...shadowProjection.peerDependencies },
        optionalDependencies:
          shadowProjection === undefined
            ? (manifest.optionalDependencies ?? {})
            : { ...shadowProjection.optionalDependencies },
        ...(shadowRecipe
          ? {
              shadow: {
                recipe: shadowRecipe,
                trigger: {
                  name,
                  requestedRange: range,
                  version: shadowRecipe.trigger.version,
                },
                acquisition: {
                  kind: 'registry' as const,
                  name: effectiveName,
                  version: pick,
                  resolved: manifest.dist.tarball,
                  integrity: expectedIntegrity,
                },
              },
            }
          : {}),
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

/** Whether distinct direct requests project onto one effective package name. */
function hasEffectiveTopLevelNameCollision(
  dependencies: Record<string, string>,
  optionalDependencies: Record<string, string>,
  rootName: string,
  overrides: OverrideMap | undefined,
): boolean {
  const seen = new Set<string>();
  for (const request of [dependencies, optionalDependencies]) {
    for (const [name, range] of Object.entries(request)) {
      const { effectiveName } = resolveEffectivePackageRequest(name, range, rootName, overrides);
      if (seen.has(effectiveName)) return true;
      seen.add(effectiveName);
    }
  }
  return false;
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
