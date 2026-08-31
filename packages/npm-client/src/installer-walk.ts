/**
 * Resolution walk + placement (extracted from installer.ts, move-only): the
 * single traversal driver shared by lockfile replay and live resolution, the
 * shared resolution-source types, per-edge lockfile reuse decisions, and the
 * `pinToPackage` materialization seam.
 */

import type { BuiltinShadowSubstitutionRecipe } from '@riftydev/shadow-registry/internal';
import {
  type FetchAndUnpackCtx,
  type FetchAndUnpackResult,
  fetchAndUnpackToCache,
} from './fetch-and-unpack.ts';
import { pinnedEntryForParent } from './installer-lockfile-reader.ts';
import {
  type LockfilePathTranslation,
  type LockfileReplayAccounting,
  createLockfileReplayAccounting,
  recordReplayReached,
  recordReplaySkippedError,
  recordReplaySkippedPin,
  translateRecordedInstallPath,
  warnOptional,
} from './installer-lockfile-replay.ts';
import type { InstallProgressEvent } from './installer.ts';
import {
  builtinRecipeForRequest,
  registryRecipeForResolution,
} from './internal/shadow/admission.ts';
import type { RegistryShadowEmbeddedDependency } from './internal/shadow/planner.ts';
import { attestBuiltinShadowSubstitution } from './internal/shadow/planner.ts';
import type { ShadowSubstitutionPlan } from './internal/shadow/planner.ts';
import {
  assertRegistryShadowEmbeddedManifests,
  pinnedShadowSubstitutions,
  readRegistryShadowReplayCache,
  replayedShadowFact,
  shadowMaterializationInstallPath,
} from './internal/shadow/substitution.ts';
import type { Lockfile, NormalizedResolvedPackage } from './linker.ts';
import type { OverrideMap } from './overrides.ts';
import { type PackageBin, normalizePackageBin } from './package-bin.ts';
import { matchesRange } from './semver.ts';
import {
  assertShimSupported,
  companionRequestsFor,
  resolveEffectivePackageRequest,
} from './shadow-shims.ts';
import { extractTarGz } from './unpacker.ts';
import { throwIfAborted } from './utils/abort-signal.ts';
import { Semaphore } from './utils/semaphore.ts';

/** ResolvedPackage + lockfile provenance + peer-dep metadata for the warn pass.
 * `peerDependencies` is persisted on the lockfile entry (D-F) so the fast path
 * hydrates it back and runs the same warn pass live-resolve does.
 *
 * `installPath` (M11) is the package's relative path under the project root:
 * `node_modules/<name>` when hoisted, else
 * `node_modules/<parent>[…]/node_modules/<name>`. The linker writes by it; the
 * lockfile keys by it.
 */
export type PinnedPackage = NormalizedResolvedPackage & {
  resolved?: string;
  integrity?: string;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  cpu?: string[];
  os?: string[];
  installPath: string;
};

export interface WalkAndPinResult {
  readonly packages: Map<string, PinnedPackage>;
  readonly companionOnlyBinInstallPaths: ReadonlySet<string>;
  readonly replayAccounting: LockfileReplayAccounting;
}

/**
 * Source-of-truth fields a `ResolutionSource` returns for a single (name,
 * range, parent) request; {@link pinToPackage} adapts it (+ tarball bytes) into
 * a `PinnedPackage`.
 */
export interface ResolvedPin {
  readonly origin: 'lockfile' | 'metadata';
  readonly name: string;
  readonly version: string;
  readonly resolved: string;
  readonly integrity?: string;
  readonly dependencies: Record<string, string>;
  readonly bin?: PackageBin;
  readonly peerDependencies?: Record<string, string>;
  /** Optional edges (lock entry or manifest). The writer re-emits them on every
   * origin: a recorded optional subtree must stay reachable through its
   * parent's edges or the replay coverage gate refuses the written lock. */
  readonly optionalDependencies: Record<string, string>;
  readonly cpu?: string[];
  readonly os?: string[];
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

/**
 * The actual tree path may differ from the recorded lockfile scope when mixed
 * replay relocates a retained package under a new conflict.
 */
export interface ResolveContext {
  readonly parentName: string | undefined;
  readonly parentInstallPath: string;
  readonly parentLockfilePath: string;
  readonly parentOrigin: 'root' | 'lockfile' | 'metadata';
  readonly lockfilePathTranslations: readonly LockfilePathTranslation[];
}

/**
 * Strategy for "given a (name, range, context), return its pinned form."
 * `createLockfileSource` replays a lockfile (no network);
 * `createRegistrySource` fetches packuments + applies overrides (both in
 * installer-sources.ts).
 *
 * Both throw on failure rather than returning `null` (a partial install is
 * worse than a loud failure): lockfile → `EBROKENLOCK` on a missing/malformed
 * entry; registry → "No matching version". Diamond conflicts are not a
 * source-level error — the walk nests the second version (see {@link
 * walkAndPin}).
 */
export interface ResolutionSource {
  resolve(name: string, range: string | null, ctx: ResolveContext): Promise<ResolvedPin>;
  prefetch?(name: string, range: string | null, ctx: ResolveContext): void;
  hasLockEntry?(name: string, ctx: ResolveContext): boolean;
}

export type LockfileReuseDecision =
  | { readonly kind: 'reuse' }
  | {
      readonly kind: 'miss';
      readonly reason: 'missing-entry' | 'range-drift';
      readonly policyFrontier: boolean;
    };

/** Per-edge ADR-0023 coverage. Strict lockfile decoding errors stay fatal. */
export function lockfileReuseDecision(
  lockfile: Lockfile,
  shadowPlan: ShadowSubstitutionPlan,
  name: string,
  range: string | null,
  ctx: ResolveContext,
  overrides: OverrideMap | undefined,
): LockfileReuseDecision {
  const { override, effectiveName, effectiveRange } = resolveEffectivePackageRequest(
    name,
    range,
    ctx.parentName,
    overrides,
  );
  const hit = pinnedEntryForParent(lockfile, effectiveName, ctx.parentLockfilePath);
  const recipe = builtinRecipeForRequest(
    name,
    range,
    ctx.parentName,
    overrides,
    hit?.entry.version,
  );
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
export function registryOwnsIncrementalMiss(
  decision: Exclude<LockfileReuseDecision, { readonly kind: 'reuse' }>,
  ctx: ResolveContext,
): boolean {
  return (
    decision.reason === 'range-drift' || ctx.parentOrigin !== 'lockfile' || decision.policyFrontier
  );
}

/**
 * "No-constraint" ranges that match every version. Mirrors `matchesRange`'s
 * special-cases so the `dist-tags.latest` fallback in `createRegistrySource`
 * stays symmetric with the matcher.
 */
export function rangeIsUnconstrained(range: string | null | undefined): boolean {
  return !range || range === '*' || range === 'latest' || range === '';
}

/** Exact package identity shared by direct reservation, placement, and fetch dedup. */
function resolvedPinIdentity(pin: ResolvedPin): string {
  return `${pin.name}\0${pin.version}\0${pin.resolved}\0${pin.integrity ?? ''}`;
}

type PinAcquisitionResult =
  | Readonly<{ kind: 'synthetic' }>
  | Readonly<{ kind: 'tarball'; result: FetchAndUnpackResult }>;

/**
 * Single traversal driver: resolve pin → place → fetch → recurse into
 * `dependencies`, `optionalDependencies`, and lock-pinned `peerDependencies`.
 *
 * Placement (M11 + direct-root tier): surviving direct identities reserve
 * root-visible slots; recorded paths reuse-when-free, relocate on mixed-source
 * conflict; descendants first-wins-flat + nest-on-conflict. Intentionally
 * simpler than npm v3 hoisting: a conflict always nests under its immediate
 * parent (costs a few duplicated nested copies — disk, never resolution);
 * full "hoist as high as possible" is a follow-on. Full replay reproduces
 * recorded paths; mixed replay rebases descendants when a retained parent
 * moves. Keyed by **install path**, not name: post-M11 one name can sit at
 * several paths (one flat + nested copies).
 */
export async function walkAndPin(
  source: ResolutionSource,
  topLevelDependencies: Record<string, string>,
  topLevelOptionalDependencies: Record<string, string>,
  rootName: string,
  fetchCtx: FetchAndUnpackCtx,
  onPackage?: (event: InstallProgressEvent) => void,
): Promise<WalkAndPinResult> {
  // Direct roots resolve first and reserve flat slots before descendant DFS.
  // Tarball fetches parallelize (bounded semaphore, `inFlight` dedup); bytes
  // never feed the dep walk, so fetch order cannot perturb layout. ONE
  // exception: an OPTIONAL-boundary node awaits acquisition pre-recursion, so
  // its failure skips the subtree before it is walked.
  const FETCH_CONCURRENCY = 8; // perf knob only; any value yields the identical tree.
  const sem = new Semaphore(FETCH_CONCURRENCY);

  /** Identity installed at `node_modules/<name>` (the hoisted slot). */
  const flatByName = new Map<string, Readonly<{ version: string; identity: string }>>();
  /** Every installed copy, keyed by install path. */
  const pinned = new Map<string, PinnedPackage>();
  const replayAccounting = createLockfileReplayAccounting();
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
    // Optional subtree descriptor; failures warn-and-skip.
    optional: { depName: string; depRange: string; parentName: string } | null,
    ordinaryBinDemand = true,
    preparedPin?: ResolvedPin,
  ): Promise<void> {
    return (async () => {
      const pin = preparedPin ?? (await source.resolve(name, range, ctx));
      // ADR-0188: a shimmed package outside its shim's proven range must fail
      // loudly BEFORE anything installs — never a stale shim silently applied.
      assertShimSupported(pin.name, pin.version);

      // Did THIS visit newly claim the flat slot? An optional-boundary failure
      // rolls back ONLY a claim it owns. Pre-placement: `choosePlacement` mutates `flatByName`.
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
        // TODO(backlog: npm-client/registry-twin-codemand-order-loss)
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
            recordReplayReached(replayAccounting, pin);
          }
        } catch (err) {
          throwIfAborted(fetchCtx.signal);
          recordReplaySkippedPin(replayAccounting, pin);
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

      // Deps come from the pin, not tarball bytes. Required children of an
      // optional boundary INHERIT `optional`: failed grandchild warns-and-skips,
      // survivors pin (salvage, not npm's rollback; pinned — Q-2026-06-07-324).
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
          recordReplaySkippedError(replayAccounting, err);
          warnOptional(desc, err);
        }
      }
      if (pin.origin === 'lockfile' && source.hasLockEntry) {
        for (const [peerName, peerRange] of Object.entries(pin.peerDependencies ?? {})) {
          if (source.hasLockEntry(peerName, childContext)) {
            await visit(peerName, peerRange, childContext, optional);
          }
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
        recordReplaySkippedError(replayAccounting, error);
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
        recordReplaySkippedPin(replayAccounting, task.pin);
        warnOptional(optionalFailure, outcome.reason);
        continue;
      }
      throw outcome.reason;
    }
    if (pinned.has(task.installPath)) continue;
    try {
      pinned.set(task.installPath, await pinToPackage(task.pin, outcome.value, task.installPath));
      recordReplayReached(replayAccounting, task.pin);
    } catch (error) {
      throwIfAborted(fetchCtx.signal);
      if (optionalFailure === null) throw error;
      recordReplaySkippedPin(replayAccounting, task.pin);
      warnOptional(optionalFailure, error);
    }
  }
  const companionOnlyBinInstallPaths = new Set<string>();
  for (const [installPath, scheduledPackage] of scheduled) {
    if (!scheduledPackage.ordinaryBinDemand && pinned.has(installPath)) {
      companionOnlyBinInstallPaths.add(installPath);
    }
  }
  return {
    packages: pinned,
    companionOnlyBinInstallPaths,
    replayAccounting,
  };
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
  const bin = normalizePackageBin(
    pin.name,
    pin.shadow
      ? pin.shadow.acquisition.kind === 'registry'
        ? undefined
        : { ...pin.shadow.recipe.materialization.bin }
      : pin.bin,
  );
  const pkg: PinnedPackage = {
    name: pin.name,
    version: pin.version,
    files,
    dependencies: pin.dependencies,
    ...(bin === undefined ? {} : { bin }),
    resolved: pin.resolved,
    installPath,
    ...(acquisition.kind === 'tarball' ? { integrity: acquisition.result.integrity } : {}),
    ...(Object.keys(pin.optionalDependencies).length > 0
      ? { optionalDependencies: pin.optionalDependencies }
      : {}),
    ...(pin.cpu !== undefined ? { cpu: pin.cpu } : {}),
    ...(pin.os !== undefined ? { os: pin.os } : {}),
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
