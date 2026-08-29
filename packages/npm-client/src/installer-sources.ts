/**
 * Resolution sources (extracted from installer.ts, move-only): lockfile
 * replay, live registry resolve, and the per-edge incremental mix
 * (`chooseSource`/`createIncrementalSource`) that picks between them.
 */

import { pinnedEntryForParent, readExistingLockfile } from './installer-lockfile-reader.ts';
import {
  assertNativeSupported,
  lockfileStringArray,
  lockfileStringMap,
} from './installer-lockfile-replay.ts';
import {
  REGISTRY_TARBALL_LIFECYCLE_SCRIPTS,
  assertNoLifecycleScripts,
} from './installer-request.ts';
import {
  type ResolutionSource,
  type ResolveContext,
  type ResolvedPin,
  lockfileReuseDecision,
  rangeIsUnconstrained,
  registryOwnsIncrementalMiss,
} from './installer-walk.ts';
import type { InstallOptions, InstallResolution } from './installer.ts';
import {
  builtinRecipeForRequest,
  registryRecipeForResolution,
} from './internal/shadow/admission.ts';
import type { ShadowAssetPlan } from './internal/shadow/planner.ts';
import { registryShadowEmbeddedSourcesFromLockfile } from './internal/shadow/planner.ts';
import {
  type SubstitutionReporter,
  assertRegistryShadowProjection,
  replayedShadowFact,
  shadowMaterializationInstallPath,
  syntheticManifest,
  syntheticResolvedIdentity,
} from './internal/shadow/substitution.ts';
import type { Lockfile } from './linker.ts';
import type { Packument } from './registry.ts';
import { matchesRange, pickBestVersion } from './semver.ts';
import { resolveEffectivePackageRequest } from './shadow-shims.ts';
import { Semaphore } from './utils/semaphore.ts';

export interface SourcePlan {
  readonly source: ResolutionSource;
  readonly resolution: () => InstallResolution;
  readonly dependencies: Record<string, string>;
  readonly optionalDependencies: Record<string, string>;
}

/** Pick per-edge lockfile replay or fresh metadata resolution. */
export function chooseSource(
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
      hasLockEntry(name, ctx): boolean {
        return locked.hasLockEntry?.(name, ctx) ?? false;
      },
      prefetch(name, range, ctx): void {
        // Advisory warm-up only: resolve owns every error in its boundary
        // (an optional edge's admission throw here would escape the optional
        // catch and fail the install npm would warn-and-skip).
        try {
          if (!useRegistry(name, range, ctx)) return;
          metadataUsed = true;
          registry.prefetch?.(name, range, ctx);
        } catch {
          /* resolve re-raises in the correct error-order slot */
        }
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
    hasLockEntry(name, ctx): boolean {
      return pinnedEntryForParent(lockfile, name, ctx.parentLockfilePath) !== undefined;
    },
    async resolve(name, range, ctx): Promise<ResolvedPin> {
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
      // Recorded-pin admission fact (ADR-0361); absent entry keeps the
      // request-shape throw ahead of the missing-entry EBROKENLOCK below.
      const recipe = builtinRecipeForRequest(
        name,
        range,
        ctx.parentName,
        opts.overrides,
        hit?.entry.version,
      );
      const synthetic = recipe?.acquisition.kind === 'synthetic' ? recipe : null;
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
      const dependencies = lockfileStringMap(
        entry.dependencies,
        'dependencies',
        effectiveName,
        installPath,
      );
      const peerDependencies = lockfileStringMap(
        entry.peerDependencies,
        'peerDependencies',
        effectiveName,
        installPath,
      );
      const optionalDependencies = lockfileStringMap(
        entry.optionalDependencies,
        'optionalDependencies',
        effectiveName,
        installPath,
      );
      const cpu = lockfileStringArray(entry.cpu, 'cpu', effectiveName, installPath);
      const os = lockfileStringArray(entry.os, 'os', effectiveName, installPath);
      if (!override) assertNativeSupported(effectiveName, entry.version, { cpu, os }, installPath);
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
        dependencies,
        bin: entry.bin,
        peerDependencies,
        optionalDependencies,
        ...(cpu === undefined ? {} : { cpu }),
        ...(os === undefined ? {} : { os }),
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
      // Advisory warm-up only — admission throws belong to resolve's boundary.
      try {
        const recipe = builtinRecipeForRequest(name, range, ctx.parentName, opts.overrides);
        if (recipe?.acquisition.kind === 'synthetic') return;
        const { effectiveName } = resolveEffectivePackageRequest(
          name,
          range,
          ctx.parentName,
          opts.overrides,
        );
        void loadPackument(effectiveName);
      } catch {
        /* resolve re-raises in the correct error-order slot */
      }
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
        ...(manifest.cpu === undefined ? {} : { cpu: manifest.cpu }),
        ...(manifest.os === undefined ? {} : { os: manifest.os }),
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
