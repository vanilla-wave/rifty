import { NotImplementedError } from '@riftydev/io';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import type { Lockfile } from './linker.ts';
import { packageMaterializationFromLockfileEntry } from './package-materialization.ts';
import {
  lockfileShadowSubstitutionRecipe,
  lockfileShadowSubstitutionRecipes,
} from './shadow-asset-lockfile-recipes.ts';
import { planBuiltinShadowAssetsFromLockfileTrace } from './shadow-asset-lockfile-trace.ts';
import { EMPTY_SHADOW_ASSET_PLAN, type ShadowAssetPlan } from './shadow-asset-plan.ts';

const decoder = new TextDecoder('utf-8', { fatal: true });

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype &&
    Object.getOwnPropertySymbols(value).length === 0
  );
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has extra or missing fields`);
  }
}

function invalidV3Lockfile(detail: string): never {
  throw new TypeError(`shadow substitution v3 lockfile ${detail}`);
}

function assertStringMap(value: unknown, label: string): void {
  if (!isPlainObject(value)) invalidV3Lockfile(`${label} must be an object`);
  for (const entry of Object.values(value)) {
    if (typeof entry !== 'string') {
      invalidV3Lockfile(`${label} must contain string entries`);
    }
  }
}

function assertPackageEntry(path: string, value: unknown): void {
  const label = `package entry ${JSON.stringify(path)}`;
  if (!isPlainObject(value)) invalidV3Lockfile(`${label} must be an object`);
  if (typeof value.version !== 'string') {
    invalidV3Lockfile(`${label} requires a version`);
  }
  for (const field of ['resolved', 'integrity'] as const) {
    const entry = value[field];
    if (entry !== undefined && typeof entry !== 'string') {
      invalidV3Lockfile(`${label}.${field} must be a string`);
    }
  }
  for (const field of ['dependencies', 'peerDependencies'] as const) {
    const entry = value[field];
    if (entry !== undefined) assertStringMap(entry, `${label}.${field}`);
  }
  const bin = value.bin;
  if (bin !== undefined) {
    if (typeof bin !== 'string') {
      assertStringMap(bin, `${label}.bin`);
    }
  }
}

function assertV3Lockfile(value: Record<string, unknown>): void {
  if (typeof value.name !== 'string') {
    invalidV3Lockfile('requires a name');
  }
  if (typeof value.version !== 'string') {
    invalidV3Lockfile('requires a version');
  }
  if (value.requires !== true) invalidV3Lockfile('requires must be true');
  const packages = value.packages;
  if (!isPlainObject(packages)) invalidV3Lockfile('requires a packages map');
  if (!Object.hasOwn(packages, '')) invalidV3Lockfile('requires a root package entry');
  for (const [path, entry] of Object.entries(packages)) assertPackageEntry(path, entry);
  const root = packages[''];
  if (!isPlainObject(root) || root.version !== value.version) {
    invalidV3Lockfile('root package version must match the lockfile version');
  }
}

function parseLockfile(bytes: Uint8Array): Lockfile {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('shadow substitution lockfile facts require Uint8Array bytes');
  }
  let value: unknown;
  try {
    value = JSON.parse(decoder.decode(bytes));
  } catch (error) {
    throw new TypeError('shadow substitution lockfile facts are not valid UTF-8 JSON', {
      cause: error,
    });
  }
  if (!isPlainObject(value) || value.lockfileVersion !== 3 || !isPlainObject(value.packages)) {
    throw new TypeError('shadow substitution lockfile facts require a v3 packages map');
  }
  assertV3Lockfile(value);
  return value as unknown as Lockfile;
}

function packageNameFromPath(path: string): string | null {
  if (path === '') return null;
  const marker = 'node_modules/';
  const index = path.lastIndexOf(marker);
  if (index < 0) return null;
  return path.slice(index + marker.length);
}

function mayNeedExactFacts(lockfile: Lockfile): boolean {
  const identityNames = new Set<string>();
  for (const recipe of lockfileShadowSubstitutionRecipes) {
    identityNames.add(recipe.publicName);
    identityNames.add(recipe.materialization.name);
  }
  for (const [path, rawEntry] of Object.entries(lockfile.packages)) {
    if (identityNames.has(packageNameFromPath(path) ?? '')) return true;
    if (!isPlainObject(rawEntry)) continue;
    const dependencies = rawEntry.dependencies;
    if (
      isPlainObject(dependencies) &&
      Object.keys(dependencies).some((name) => identityNames.has(name))
    ) {
      return true;
    }
  }
  return false;
}

function traceOf(lockfile: Lockfile): unknown | null {
  const rifty = lockfile.rifty;
  if (rifty === undefined) return null;
  if (!isPlainObject(rifty)) {
    throw new TypeError('shadow substitution lockfile rifty metadata must be a plain object');
  }
  exactKeys(rifty, ['shadowSubstitutions'], 'shadow substitution lockfile rifty metadata');
  return rifty.shadowSubstitutions;
}

function assertTraceTargets(lockfile: Lockfile, plan: ShadowAssetPlan): void {
  for (const applied of plan.substitutions) {
    const recipe = lockfileShadowSubstitutionRecipe(applied.substitutionId);
    if (
      recipe === null ||
      recipe.publicName !== applied.publicName ||
      !Object.entries(lockfile.packages).some(([path, entry]) => {
        if (
          packageNameFromPath(path) !== recipe.materialization.name ||
          !isPlainObject(entry) ||
          entry.version !== applied.resolvedPublicVersion
        ) {
          return false;
        }
        const state = packageMaterializationFromLockfileEntry(entry);
        return (
          state.kind === 'synthesized-shadow-delegate' &&
          state.recipe.substitutionId === applied.substitutionId
        );
      })
    ) {
      throw Object.assign(
        new Error(
          `EBROKENLOCK: shadow substitution ${applied.publicName}@${applied.resolvedPublicVersion} has no matching package materialization. Delete the lockfile and re-install.`,
        ),
        { code: 'EBROKENLOCK' as const, reason: 'trace-materialization-disagreement' as const },
      );
    }
  }
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') continue;
    const state = packageMaterializationFromLockfileEntry(entry);
    if (state.kind !== 'synthesized-shadow-delegate') continue;
    if (packageNameFromPath(path) !== state.recipe.publicName) {
      throw Object.assign(
        new Error(
          `EBROKENLOCK: package materialization at ${path} does not match recipe package ${state.recipe.publicName}. Delete the lockfile and re-install.`,
        ),
        { code: 'EBROKENLOCK' as const, reason: 'materialization-path-disagreement' as const },
      );
    }
    const matchingTrace = plan.substitutions.some(
      (applied) =>
        applied.substitutionId === state.recipe.substitutionId &&
        applied.publicName === state.recipe.publicName &&
        applied.resolvedPublicVersion === state.recipe.version &&
        applied.runtimeAdapterId === state.recipe.runtimeAdapterId,
    );
    if (!matchingTrace) {
      throw Object.assign(
        new Error(
          `EBROKENLOCK: package materialization at ${path} has no matching shadow substitution trace. Delete the lockfile and re-install.`,
        ),
        { code: 'EBROKENLOCK' as const, reason: 'materialization-trace-disagreement' as const },
      );
    }
  }
}

/** Historical active evidence forces live resolve; it is never hydrated as current policy. */
export function lockfileHasHistoricalShadowSubstitution(lockfile: Lockfile): boolean {
  const trace = traceOf(lockfile);
  let historical = false;
  if (trace !== null) {
    if (!isPlainObject(trace)) return false;
    exactKeys(trace, ['applied', 'protocol'], 'shadow substitution lockfile trace');
    if (
      trace.protocol !== 'rifty.lockfile-shadow-substitutions/v1' ||
      !Array.isArray(trace.applied)
    ) {
      return false;
    }
    for (const value of trace.applied) {
      if (!isPlainObject(value)) return false;
      exactKeys(
        value,
        [
          'publicName',
          'requestedRange',
          'resolvedPublicVersion',
          'runtimeAdapterId',
          'substitutionId',
        ],
        'lockfile applied shadow substitution',
      );
      if (typeof value.substitutionId !== 'string') return false;
      const recipe = lockfileShadowSubstitutionRecipe(value.substitutionId);
      if (recipe === null) return false;
      if (
        !builtinShadowRecipeIsActive(value.substitutionId, value.publicName, value.runtimeAdapterId)
      ) {
        historical = true;
      }
    }
  }
  for (const [path, entry] of Object.entries(lockfile.packages)) {
    if (path === '') continue;
    if (packageMaterializationFromLockfileEntry(entry).kind === 'historical') historical = true;
  }
  return historical;
}

function builtinShadowRecipeIsActive(
  substitutionId: string,
  publicName: unknown,
  runtimeAdapterId: unknown,
): boolean {
  const active = builtinShadowAssetCatalog.substitutions.find(
    (candidate) => candidate.id === substitutionId,
  );
  return (
    active !== undefined &&
    active.publicName === publicName &&
    active.runtimeAdapterId === runtimeAdapterId
  );
}

/** Object-level producer shared by exact bytes and post-tree evidence. */
export function shadowAssetPlanFromLockfileFacts(lockfile: Lockfile): ShadowAssetPlan {
  const trace = traceOf(lockfile);
  if (trace === null) {
    if (mayNeedExactFacts(lockfile)) {
      throw new NotImplementedError('npm-client.lockfile.shadowSubstitutionFacts');
    }
    return EMPTY_SHADOW_ASSET_PLAN;
  }
  const plan = planBuiltinShadowAssetsFromLockfileTrace(trace);
  assertTraceTargets(lockfile, plan);
  return plan;
}

/** Concrete npm-client v0 reader; caller must already attest the exact bytes. */
export function shadowAssetPlanFromLockfileBytes(bytes: Uint8Array): ShadowAssetPlan {
  return shadowAssetPlanFromLockfileFacts(parseLockfile(bytes));
}
