import generatedRecipes from '../generated/synthetic-package-recipes.json';
import { builtinShadowAssetCatalog } from './shadow-asset-catalog.ts';

export const SYNTHESIZED_SHADOW_DELEGATE_KIND = 'synthesized-shadow-delegate' as const;

export interface BuiltinSyntheticPackageRecipe {
  readonly substitutionId: string;
  readonly publicName: string;
  readonly version: string;
  readonly runtimeAdapterId: string;
  readonly kind: typeof SYNTHESIZED_SHADOW_DELEGATE_KIND;
  readonly recipeSha256: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bin: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
}

const RECIPE_KEYS = [
  'bin',
  'dependencies',
  'files',
  'kind',
  'optionalDependencies',
  'peerDependencies',
  'publicName',
  'recipeSha256',
  'runtimeAdapterId',
  'substitutionId',
  'version',
] as const;
const SHA256 = /^[a-f0-9]{64}$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function exactPlainObject(
  value: unknown,
  keys: readonly string[] | null,
  label: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) throw new TypeError(`${label}.${key} must be a data field`);
  }
  if (keys !== null) {
    const actual = Object.keys(descriptors).sort();
    const expected = [...keys].sort();
    if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
      throw new TypeError(`${label} has extra or missing fields`);
    }
  }
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  exactPlainObject(value, null, label);
  const clone: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') throw new TypeError(`${label}.${key} must be a string`);
    clone[key] = entry;
  }
  return clone;
}

function packageRelativePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    path.split('/').every((part) => part !== '' && part !== '.' && part !== '..')
  );
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child as object);
    }
  }
  return Object.freeze(value);
}

function validateRecipe(value: unknown): BuiltinSyntheticPackageRecipe {
  exactPlainObject(value, RECIPE_KEYS, 'builtin synthetic package recipe');
  const substitutionId = value.substitutionId;
  const publicName = value.publicName;
  const runtimeAdapterId = value.runtimeAdapterId;
  if (typeof substitutionId !== 'string' || substitutionId.length === 0) {
    throw new TypeError('builtin synthetic package recipe has invalid substitutionId');
  }
  if (typeof publicName !== 'string' || publicName.length === 0) {
    throw new TypeError('builtin synthetic package recipe has invalid publicName');
  }
  if (typeof runtimeAdapterId !== 'string' || runtimeAdapterId.length === 0) {
    throw new TypeError('builtin synthetic package recipe has invalid runtimeAdapterId');
  }
  if (typeof value.version !== 'string' || !EXACT_VERSION.test(value.version)) {
    throw new TypeError('builtin synthetic package recipe version must be exact');
  }
  if (value.kind !== SYNTHESIZED_SHADOW_DELEGATE_KIND) {
    throw new TypeError('builtin synthetic package recipe has unsupported kind');
  }
  if (typeof value.recipeSha256 !== 'string' || !SHA256.test(value.recipeSha256)) {
    throw new TypeError('builtin synthetic package recipe has invalid digest');
  }
  const dependencies = stringRecord(value.dependencies, 'synthetic dependencies');
  const optionalDependencies = stringRecord(
    value.optionalDependencies,
    'synthetic optionalDependencies',
  );
  const peerDependencies = stringRecord(value.peerDependencies, 'synthetic peerDependencies');
  const bin = stringRecord(value.bin, 'synthetic bin');
  const files = stringRecord(value.files, 'synthetic files');
  if (Object.keys(files).length === 0) throw new TypeError('builtin synthetic recipe has no files');
  for (const path of Object.keys(files)) {
    if (!packageRelativePath(path)) {
      throw new TypeError(`builtin synthetic recipe has invalid file path ${JSON.stringify(path)}`);
    }
  }
  const catalog = builtinShadowAssetCatalog.substitutions.find(
    (candidate) => candidate.id === substitutionId,
  );
  if (
    catalog === undefined ||
    catalog.publicName !== publicName ||
    catalog.runtimeAdapterId !== runtimeAdapterId ||
    catalog.versions[value.version] === undefined
  ) {
    throw new TypeError('builtin synthetic recipe drifted from shadow asset catalog');
  }
  return {
    substitutionId,
    publicName,
    version: value.version,
    runtimeAdapterId,
    kind: value.kind,
    recipeSha256: value.recipeSha256,
    dependencies,
    optionalDependencies,
    peerDependencies,
    bin,
    files,
  };
}

if (!Array.isArray(generatedRecipes)) {
  throw new TypeError('builtin synthetic package recipes must be an array');
}
export const builtinSyntheticPackageRecipes: readonly Readonly<BuiltinSyntheticPackageRecipe>[] =
  deepFreeze(generatedRecipes.map(validateRecipe));
