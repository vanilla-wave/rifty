import { NotImplementedError } from '@riftydev/io';
import {
  type BuiltinSyntheticPackageRecipe,
  builtinSyntheticPackageRecipes,
} from '@riftydev/shadow-registry';
import { extractTarGz } from './unpacker.ts';

export const LOCKFILE_PACKAGE_MATERIALIZATION_PROTOCOL =
  'rifty.lockfile-package-materialization/v1' as const;
export const SYNTHESIZED_SHADOW_DELEGATE_KIND = 'synthesized-shadow-delegate' as const;
export const HISTORICAL_ESBUILD_ALIAS_SUBSTITUTION_ID =
  'rifty.shadow-substitution.esbuild-wasi-preview1.v1' as const;

export interface LockfilePackageMaterialization {
  readonly protocol: typeof LOCKFILE_PACKAGE_MATERIALIZATION_PROTOCOL;
  readonly kind: typeof SYNTHESIZED_SHADOW_DELEGATE_KIND;
  readonly substitutionId: string;
  readonly recipeSha256: string;
}

export interface RegistryPackageMaterialization {
  readonly kind: 'registry';
  readonly resolved: string;
  readonly expectedIntegrity?: string;
}

export interface SynthesizedPackageMaterialization {
  readonly kind: typeof SYNTHESIZED_SHADOW_DELEGATE_KIND;
  readonly recipe: Readonly<BuiltinSyntheticPackageRecipe>;
}

export type PackageMaterialization =
  | RegistryPackageMaterialization
  | SynthesizedPackageMaterialization;

export type LockfilePackageMaterializationState =
  | { readonly kind: 'registry' }
  | { readonly kind: 'historical'; readonly substitutionId: string }
  | SynthesizedPackageMaterialization;

export type PackageMaterializationTransport = 'cache' | 'eddy' | 'registry' | 'synthesized';

export interface PackageMaterializationPin {
  readonly name: string;
  readonly version: string;
  readonly dependencies: Record<string, string>;
  readonly bin?: string | Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly installPath: string;
  readonly materialization: PackageMaterialization;
}

export interface RegistryPackageBytes {
  readonly bytes: Uint8Array;
  readonly integrity: string;
}

export interface MaterializedPackage {
  readonly name: string;
  readonly version: string;
  readonly files: Record<string, Uint8Array>;
  readonly dependencies: Record<string, string>;
  readonly bin?: string | Record<string, string>;
  readonly peerDependencies?: Record<string, string>;
  readonly installPath: string;
  readonly resolved?: string;
  readonly integrity?: string;
  readonly materialization: PackageMaterialization;
}

const MARKER_KEYS = ['kind', 'protocol', 'recipeSha256', 'substitutionId'] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

function brokenLock(detail: string, reason: string): never {
  throw Object.assign(
    new Error(
      `EBROKENLOCK: package materialization ${detail}. Delete the lockfile and re-install.`,
    ),
    { code: 'EBROKENLOCK' as const, reason },
  );
}

function exactPlainObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    brokenLock(`${label} must be a plain object`, 'malformed-materialization');
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    brokenLock(`${label} has extra or missing fields`, 'malformed-materialization');
  }
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) {
      brokenLock(`${label}.${key} must be a data field`, 'malformed-materialization');
    }
  }
}

function recipeByPublicName(name: string): Readonly<BuiltinSyntheticPackageRecipe> | null {
  return builtinSyntheticPackageRecipes.find((recipe) => recipe.publicName === name) ?? null;
}

function recipeById(id: string): Readonly<BuiltinSyntheticPackageRecipe> | null {
  return builtinSyntheticPackageRecipes.find((recipe) => recipe.substitutionId === id) ?? null;
}

export function registryPackageMaterialization(
  resolved: string,
  expectedIntegrity?: string,
): RegistryPackageMaterialization {
  if (typeof resolved !== 'string' || resolved.length === 0) {
    throw new TypeError('registry package materialization requires a resolved URL');
  }
  if (expectedIntegrity !== undefined && typeof expectedIntegrity !== 'string') {
    throw new TypeError('registry package materialization integrity must be a string');
  }
  return Object.freeze({
    kind: 'registry' as const,
    resolved,
    ...(expectedIntegrity === undefined ? {} : { expectedIntegrity }),
  });
}

/** Public metadata has already selected `version`; this gate never pins it itself. */
export function builtinSyntheticPackageMaterialization(
  name: string,
  version: string,
): SynthesizedPackageMaterialization | null {
  const byName = recipeByPublicName(name);
  if (byName === null) return null;
  if (byName.version !== version) {
    throw new NotImplementedError(`shadow-registry.${name}@${version}`);
  }
  return Object.freeze({ kind: SYNTHESIZED_SHADOW_DELEGATE_KIND, recipe: byName });
}

export function lockfilePackageMaterialization(
  materialization: PackageMaterialization,
): Readonly<{ readonly materialization: LockfilePackageMaterialization }> | undefined {
  if (materialization.kind === 'registry') return undefined;
  return Object.freeze({
    materialization: Object.freeze({
      protocol: LOCKFILE_PACKAGE_MATERIALIZATION_PROTOCOL,
      kind: SYNTHESIZED_SHADOW_DELEGATE_KIND,
      substitutionId: materialization.recipe.substitutionId,
      recipeSha256: materialization.recipe.recipeSha256,
    }),
  });
}

/** Strict v3 per-entry decoder; no name/version inference or registry fallthrough. */
export function packageMaterializationFromLockfileEntry(
  entry: Readonly<{
    readonly version?: unknown;
    readonly resolved?: unknown;
    readonly integrity?: unknown;
    readonly dependencies?: unknown;
    readonly peerDependencies?: unknown;
    readonly bin?: unknown;
    readonly rifty?: unknown;
  }>,
): LockfilePackageMaterializationState {
  if (entry.rifty === undefined) return { kind: 'registry' };
  exactPlainObject(entry.rifty, ['materialization'], 'entry.rifty');
  const marker = entry.rifty.materialization;
  exactPlainObject(marker, MARKER_KEYS, 'entry.rifty.materialization');
  if (typeof marker.protocol !== 'string') {
    brokenLock('marker protocol must be a string', 'malformed-materialization');
  }
  if (marker.protocol !== LOCKFILE_PACKAGE_MATERIALIZATION_PROTOCOL) {
    throw new NotImplementedError('npm-client.lockfile.packageMaterialization');
  }
  if (typeof marker.kind !== 'string') {
    brokenLock('marker kind must be a string', 'malformed-materialization');
  }
  if (marker.kind !== SYNTHESIZED_SHADOW_DELEGATE_KIND) {
    throw new NotImplementedError('npm-client.lockfile.packageMaterialization');
  }
  if (typeof marker.substitutionId !== 'string' || marker.substitutionId.length === 0) {
    brokenLock('marker substitutionId must be a non-empty string', 'malformed-materialization');
  }
  if (marker.substitutionId === HISTORICAL_ESBUILD_ALIAS_SUBSTITUTION_ID) {
    return { kind: 'historical', substitutionId: marker.substitutionId };
  }
  const recipe = recipeById(marker.substitutionId);
  if (recipe === null) {
    throw new NotImplementedError('npm-client.lockfile.packageMaterialization');
  }
  if (typeof marker.recipeSha256 !== 'string' || !SHA256.test(marker.recipeSha256)) {
    brokenLock('marker recipeSha256 is malformed', 'malformed-materialization');
  }
  if (marker.recipeSha256 !== recipe.recipeSha256) {
    brokenLock('marker recipeSha256 drifted from the active recipe', 'recipe-drift');
  }
  if (entry.version !== recipe.version) {
    brokenLock('entry version drifted from the active recipe', 'recipe-version-drift');
  }
  if (entry.resolved !== undefined || entry.integrity !== undefined) {
    brokenLock('synthetic entry carries tarball replay fields', 'provenance-lie');
  }
  if (!sameStringRecord(entry.dependencies, recipe.dependencies)) {
    brokenLock('synthetic entry dependencies drifted from its recipe', 'recipe-tree-drift');
  }
  if (
    entry.peerDependencies !== undefined ||
    entry.bin !== undefined ||
    Object.keys(recipe.peerDependencies).length !== 0 ||
    Object.keys(recipe.bin).length !== 0
  ) {
    brokenLock('synthetic entry metadata drifted from its recipe', 'recipe-tree-drift');
  }
  return Object.freeze({ kind: SYNTHESIZED_SHADOW_DELEGATE_KIND, recipe });
}

function sameStringRecord(value: unknown, expected: Readonly<Record<string, string>>): boolean {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return false;
  }
  const actual = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index] && actual[key] === expected[key])
  );
}

export function packageMaterializationKey(
  name: string,
  version: string,
  materialization: PackageMaterialization,
): string {
  return materialization.kind === 'registry'
    ? `registry\0${name}\0${version}\0${materialization.resolved}\0${materialization.expectedIntegrity ?? ''}`
    : `synthesized\0${name}\0${version}\0${materialization.recipe.substitutionId}\0${materialization.recipe.recipeSha256}`;
}

/** Current policy comparison for lockfile coverage; never selects a version. */
export function lockfileMaterializationMatchesCurrentPolicy(
  name: string,
  state: LockfilePackageMaterializationState,
  hasUserOverride: boolean,
): boolean {
  if (state.kind === 'historical') return false;
  const recipe = recipeByPublicName(name);
  if (recipe === null) return state.kind === 'registry';
  if (hasUserOverride) return state.kind === 'registry';
  return (
    state.kind === SYNTHESIZED_SHADOW_DELEGATE_KIND &&
    state.recipe.publicName === name &&
    state.recipe.substitutionId === recipe.substitutionId
  );
}

/** Exact acquisition projection shared by live, replay, and Eddy-backed replay. */
export function packageMaterializationTransport(
  materialization: PackageMaterialization,
  cacheHit: boolean | null,
  source: 'eddy' | 'standard',
): PackageMaterializationTransport {
  if (materialization.kind === SYNTHESIZED_SHADOW_DELEGATE_KIND) return 'synthesized';
  if (cacheHit === null) {
    throw new TypeError('registry package materialization lacks acquisition evidence');
  }
  return cacheHit ? (source === 'eddy' ? 'eddy' : 'cache') : 'registry';
}

export async function materializePackage(
  pin: PackageMaterializationPin,
  registryBytes?: RegistryPackageBytes,
): Promise<MaterializedPackage> {
  let files: Record<string, Uint8Array>;
  let resolved: string | undefined;
  let integrity: string | undefined;
  if (pin.materialization.kind === 'registry') {
    if (registryBytes === undefined) {
      throw new TypeError(`registry materialization missing bytes for ${pin.name}@${pin.version}`);
    }
    files = await extractTarGz(registryBytes.bytes);
    resolved = pin.materialization.resolved;
    integrity = registryBytes.integrity;
  } else {
    if (registryBytes !== undefined) {
      throw new TypeError(`synthetic materialization forbids tarball bytes for ${pin.name}`);
    }
    files = Object.fromEntries(
      Object.entries(pin.materialization.recipe.files).map(([path, contents]) => [
        path,
        encoder.encode(contents),
      ]),
    );
  }
  return {
    name: pin.name,
    version: pin.version,
    files,
    dependencies: pin.dependencies,
    ...(pin.bin && (typeof pin.bin === 'string' || Object.keys(pin.bin).length > 0)
      ? { bin: pin.bin }
      : {}),
    ...(pin.peerDependencies && Object.keys(pin.peerDependencies).length > 0
      ? { peerDependencies: pin.peerDependencies }
      : {}),
    installPath: pin.installPath,
    ...(resolved === undefined ? {} : { resolved }),
    ...(integrity === undefined ? {} : { integrity }),
    materialization: pin.materialization,
  };
}

export function synthesizedSubstitutionLine(
  requestedRange: string | null,
  version: string,
): string {
  return `npm: esbuild@${requestedRange ?? '*'} → esbuild@${version} (synthesized delegate from shadow registry, ADR-0298)`;
}
