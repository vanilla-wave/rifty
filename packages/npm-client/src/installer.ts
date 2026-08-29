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
 * traversal driver (`walkAndPin`, installer-walk.ts) and compose per edge
 * (installer-sources.ts):
 *
 *   - `createLockfileSource` — replays pins from a v3 lockfile entry,
 *     parent-aware walk-up for nested copies.
 *   - `createRegistrySource` — packument fetch + `pickBestVersion`,
 *     applies overrides per node.
 *
 * Covered edges replay exact pins; a missing root/policy frontier resolves from
 * metadata without discarding compatible retained subgraphs. `pinToPackage`
 * (installer-walk.ts) is the shared materialization seam. This module keeps
 * only the `install` overloads and their orchestration.
 */

import type { Vfs } from '@riftydev/vfs';
import { existingLockfilePreemptsEddy, tryEddyFastPath } from './eddy-fast-path.ts';
import type { EddyPrefetchHandle } from './eddy-prefetch.ts';
import type { FetchAndUnpackCtx } from './fetch-and-unpack.ts';
import {
  installPackageBinSources,
  lockfilePackageBinSources,
  packageLinkTargets,
} from './installer-bin-claims.ts';
import { readExistingLockfile, writeLockfileIfChanged } from './installer-lockfile-reader.ts';
import {
  assertLockfileReplayCoverage,
  expandReplaySkipClosure,
  lockfileRootMatchesRequest,
  preserveSkippedLockfileEntries,
} from './installer-lockfile-replay.ts';
import { hasEffectiveTopLevelNameCollision, warnUnsatisfiedPeers } from './installer-peers.ts';
import { normalizeInstallArgs } from './installer-request.ts';
import { chooseSource } from './installer-sources.ts';
import { type WalkAndPinResult, walkAndPin } from './installer-walk.ts';
import { assertDirectShadowRecipeAdmissions } from './internal/shadow/admission.ts';
import { recordShadowAssetPlanForInstallResult } from './internal/shadow/install-result.ts';
import {
  materializeRegistryShadowSubstitutions,
  planShadowSubstitutionsFromLockfile,
  planTrustedAppliedShadowSubstitutions,
} from './internal/shadow/planner.ts';
import {
  createSubstitutionReporter,
  pinnedShadowSubstitutions,
} from './internal/shadow/substitution.ts';
import {
  type Lockfile,
  type NormalizedResolvedPackage,
  buildPreparedInstallLockfile,
  linkInstallPackageBins,
  linkInstallPackageFiles,
  preflightPackageBins,
  preflightPackageInstallPaths,
} from './linker.ts';
import type { OverrideMap } from './overrides.ts';
import type { Packument, RegistryClient } from './registry.ts';
import { applyInternalsShims } from './shadow-shims.ts';
import { type TarballCache, VfsTarballCache } from './tarball-cache.ts';
import { throwIfAborted } from './utils/abort-signal.ts';

// Parity-2 forwarding re-export: `packageLinkTargets` stays reachable through
// the installer module and absent from the package root (src/index.ts).
export { packageLinkTargets } from './installer-bin-claims.ts';

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
   * `DEFAULT_BUNDLE_STALL_MS`, eddy-bundle-stream.ts), covering BOTH phases:
   * the header wait (a fetch whose connection/headers hang) and the direct
   * GET/POST bundle streams (a resolver that stalls mid-body). Either makes
   * the attempt FAIL (→ next attempt / standard install) instead of parking
   * the install forever. The prefetch path carries its own bound
   * (`StartEddyPrefetchOptions.stallTimeoutMs`). Inert without `resolverUrl`.
   */
  resolverStallTimeoutMs?: number;
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

export interface InstallResult {
  packages: NormalizedResolvedPackage[];
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
  const fullLockfileReplay =
    existingLockfile !== null &&
    plan.resolution() === 'lockfile' &&
    lockfileRootMatchesRequest(existingLockfile, rootLockfileDependencyMaps);
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
  // Unreached-entry gate AFTER the bin-claim preflight (continuity ceilings
  // outrank the orphan refusal), BEFORE any mutation/linking/lock rewrite.
  if (fullLockfileReplay) {
    expandReplaySkipClosure(existingLockfile!, resolved.replayAccounting);
    assertLockfileReplayCoverage(
      existingLockfile!,
      resolved.replayAccounting.reachedLockfilePaths,
      resolved.replayAccounting.skippedLockfilePaths,
      existingShadowPlan!,
    );
  }
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
  if (fullLockfileReplay) {
    preserveSkippedLockfileEntries(
      lockfile,
      existingLockfile!,
      resolved.replayAccounting.skippedLockfilePaths,
    );
  }
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
