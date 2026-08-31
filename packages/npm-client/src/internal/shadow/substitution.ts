/**
 * Shadow substitution mechanics shared by the installer pipeline (extracted
 * from installer.ts, move-only): the ADR-0188 substitution-provenance
 * reporter, registry projection/synthetic-manifest validation, replayed-fact
 * lookup, the pinned-substitution side table, and the shadow replay/embedded
 * asserts.
 */

import { NotImplementedError } from '@riftydev/io';
import type {
  BuiltinShadowSubstitutionRecipe,
  ShadowRegistryDependencyProjection,
} from '@riftydev/shadow-registry/internal';
import type { FetchAndUnpackCtx, FetchAndUnpackResult } from '../../fetch-and-unpack.ts';
import type { ResolvedPin } from '../../installer-walk.ts';
import type { Lockfile, NormalizedResolvedPackage } from '../../linker.ts';
import type { PackageBin } from '../../package-bin.ts';
import type { VersionManifest } from '../../registry.ts';
import { matchesRange } from '../../semver.ts';
import { computeIntegrity, parseIntegrityAlgorithm } from '../../tarball-cache.ts';
import { throwIfAborted } from '../../utils/abort-signal.ts';
import type {
  AppliedShadowSubstitution,
  RegistryShadowEmbeddedDependency,
  RegistryShadowEmbeddedSource,
  ShadowSubstitutionPlan,
} from './planner.ts';

export interface PinnedShadowState {
  readonly substitution: AppliedShadowSubstitution;
  readonly embeddedSource?: RegistryShadowEmbeddedSource;
}

/** Pin → attested shadow fact side table. Single writer: `pinToPackage`
 * (installer-walk); readers: install orchestration + bin-claim assembly.
 * Keyed by the linker-visible package identity so every cross-module
 * reference stays an erased type edge. */
export const pinnedShadowSubstitutions = new WeakMap<
  NormalizedResolvedPackage,
  PinnedShadowState
>();

/**
 * Per-install substitution-provenance reporter (ADR-0188). Lines stay ordered
 * and staged until lock commit. `redirect` dedupes the same baked redirect
 * surfacing through both the top-level pre-pass and walk.
 */
export interface SubstitutionReporter {
  redirect(source: string, range: string | null, target: string, version: string): void;
  line(text: string): void;
  flush(): void;
}

export function createSubstitutionReporter(sink: (line: string) => void): SubstitutionReporter {
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

export function assertRegistryShadowProjection(
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

export function syntheticResolvedIdentity(recipe: BuiltinShadowSubstitutionRecipe): string {
  return `rifty:shadow-substitution/${recipe.id}@${recipe.digest}`;
}

export function syntheticManifest(recipe: BuiltinShadowSubstitutionRecipe): Readonly<{
  dependencies: Record<string, string>;
  optionalDependencies: Record<string, string>;
  peerDependencies?: Record<string, string>;
  bin?: PackageBin;
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
  let bin: PackageBin | undefined;
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

export function replayedShadowFact(
  plan: ShadowSubstitutionPlan,
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

export async function readRegistryShadowReplayCache(
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

export function assertRegistryShadowEmbeddedManifests(
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

export function shadowMaterializationInstallPath(
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
