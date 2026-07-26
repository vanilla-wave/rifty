import generatedCatalog from '../../generated/shadow-substitution-catalog.json';
import {
  canonicalShadowJson,
  decodeDenseDataArray,
  shadowDigest,
  shadowSha256,
} from './canonical.ts';
import type {
  BuiltinShadowSubstitutionCatalog,
  BuiltinShadowSubstitutionRecipe,
  ShadowDependencyProjection,
  ShadowRecipeAdmission,
  ShadowRuntimeAsset,
} from './model.ts';

const SHA = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._@/+-]*$/;
const PACKAGE_NAME = /^(?:@[A-Za-z0-9][A-Za-z0-9._-]*\/)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

export class ShadowRegistryCodecError extends TypeError {
  readonly code = 'ESHADOWREGISTRYCODEC' as const;
  constructor(
    readonly path: string,
    detail: string,
  ) {
    super(`shadow registry ${path}: ${detail}`);
    this.name = 'ShadowRegistryCodecError';
  }
}

function record(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ShadowRegistryCodecError(path, 'must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new ShadowRegistryCodecError(path, 'symbol members are forbidden');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new ShadowRegistryCodecError(path, 'extra or missing fields');
  }
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor))
      throw new ShadowRegistryCodecError(path, 'accessors are forbidden');
    if (descriptor.enumerable !== true)
      throw new ShadowRegistryCodecError(path, 'non-enumerable fields are forbidden');
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, path: string, pattern: RegExp = ID): string {
  if (typeof value !== 'string' || !pattern.test(value))
    throw new ShadowRegistryCodecError(path, 'invalid string');
  return value;
}

function packagePath(value: unknown, path: string): string {
  const result = text(value, path, /^[^\\]+$/);
  const parts = result.split('/');
  if (
    result.startsWith('/') ||
    parts.some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new ShadowRegistryCodecError(path, 'must be a normalized relative path');
  }
  return result;
}

function integrity(value: unknown, path: string): string {
  const result = text(value, path, /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/);
  const dash = result.indexOf('-');
  const algorithm = result.slice(0, dash);
  const encoded = result.slice(dash + 1);
  let decoded: string;
  try {
    decoded = atob(encoded);
  } catch {
    throw new ShadowRegistryCodecError(path, 'invalid base64');
  }
  const expected = algorithm === 'sha256' ? 32 : algorithm === 'sha384' ? 48 : 64;
  if (decoded.length !== expected || btoa(decoded) !== encoded) {
    throw new ShadowRegistryCodecError(path, 'non-canonical or wrong-length digest');
  }
  return result;
}

function positive(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    throw new ShadowRegistryCodecError(path, 'must be a positive safe integer');
  return value as number;
}

function array(value: unknown, path: string): readonly unknown[] {
  try {
    return decodeDenseDataArray(value, path);
  } catch (error) {
    throw new ShadowRegistryCodecError(
      path,
      error instanceof Error ? error.message : 'invalid array',
    );
  }
}

function sortedUnique(values: readonly string[], path: string): void {
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0 && values[index - 1]! >= values[index]!) {
      throw new ShadowRegistryCodecError(path, 'duplicate file/member or non-canonical ordering');
    }
  }
}

function stringMap(value: unknown, path: string, keyPattern: RegExp = ID): Record<string, string> {
  const input = plainRecord(value, path);
  const output: Record<string, string> = {};
  for (const key of Object.keys(input).sort()) {
    text(key, `${path} key`, keyPattern);
    output[key] = text(input[key], `${path}.${key}`, /^.+$/);
  }
  return output;
}

function binMap(value: unknown, path: string): Record<string, string> {
  const input = stringMap(value, path);
  const output: Record<string, string> = {};
  for (const [command, target] of Object.entries(input)) {
    if (command.includes('/') || command.includes('\\')) {
      throw new ShadowRegistryCodecError(`${path}.${command}`, 'invalid command');
    }
    output[command] = packagePath(target, `${path}.${command}`);
  }
  return output;
}

function defaultBinName(name: string): string {
  return name.startsWith('@') ? (name.split('/')[1] ?? name) : name;
}

function manifestBin(value: unknown, packageName: string, path: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value === 'string') {
    return { [defaultBinName(packageName)]: packagePath(value, path) };
  }
  return binMap(value, path);
}

function decodeDependencyProjection(value: unknown, path: string): ShadowDependencyProjection {
  const projection = record(
    value,
    [
      'dependencies',
      'omittedOptionalDependencies',
      'optionalDependencies',
      'peerDependencies',
      'unsupportedFeature',
    ],
    path,
  );
  const maps = {
    dependencies: stringMap(projection.dependencies, `${path}.dependencies`, PACKAGE_NAME),
    optionalDependencies: stringMap(
      projection.optionalDependencies,
      `${path}.optionalDependencies`,
      PACKAGE_NAME,
    ),
    omittedOptionalDependencies: stringMap(
      projection.omittedOptionalDependencies,
      `${path}.omittedOptionalDependencies`,
      PACKAGE_NAME,
    ),
    peerDependencies: stringMap(
      projection.peerDependencies,
      `${path}.peerDependencies`,
      PACKAGE_NAME,
    ),
  };
  const owners = new Map<string, string>();
  for (const [field, entries] of Object.entries(maps)) {
    for (const name of Object.keys(entries)) {
      const prior = owners.get(name);
      if (prior) {
        throw new ShadowRegistryCodecError(
          path,
          `dependency ${name} overlaps ${prior} and ${field}`,
        );
      }
      owners.set(name, field);
    }
  }
  return {
    ...maps,
    unsupportedFeature: text(projection.unsupportedFeature, `${path}.unsupportedFeature`),
  };
}

function decodeAsset(value: unknown, path: string): ShadowRuntimeAsset {
  const item = record(
    value,
    ['id', 'source', 'member', 'memberSha256', 'memberSize', 'maxTarballBytes', 'maxUnpackedBytes'],
    path,
  );
  const source = record(item.source, ['integrity', 'name', 'version'], `${path}.source`);
  const asset: ShadowRuntimeAsset = {
    id: text(item.id, `${path}.id`),
    source: {
      name: text(source.name, `${path}.source.name`, PACKAGE_NAME),
      version: text(source.version, `${path}.source.version`, VERSION),
      integrity: integrity(source.integrity, `${path}.source.integrity`),
    },
    member: packagePath(item.member, `${path}.member`),
    memberSha256: text(item.memberSha256, `${path}.memberSha256`, SHA),
    memberSize: positive(item.memberSize, `${path}.memberSize`),
    maxTarballBytes: positive(item.maxTarballBytes, `${path}.maxTarballBytes`),
    maxUnpackedBytes: positive(item.maxUnpackedBytes, `${path}.maxUnpackedBytes`),
  };
  if (asset.maxUnpackedBytes < asset.memberSize)
    throw new ShadowRegistryCodecError(path, 'unpacked cap is below member size');
  return asset;
}

function decodeRecipe(
  value: unknown,
  path: string,
  assetIds: ReadonlySet<string>,
): BuiltinShadowSubstitutionRecipe {
  if (value === null || typeof value !== 'object')
    throw new ShadowRegistryCodecError(path, 'must be an object');
  const hasBinding = Object.hasOwn(value, 'binding');
  const item = record(
    value,
    hasBinding
      ? [
          'schema',
          'id',
          'digest',
          'admission',
          'trigger',
          'acquisition',
          'materialization',
          'binding',
        ]
      : ['schema', 'id', 'digest', 'admission', 'trigger', 'acquisition', 'materialization'],
    path,
  );
  if (item.schema !== 2) throw new ShadowRegistryCodecError(`${path}.schema`, 'unsupported schema');
  const admission = record(item.admission, ['kind', 'unsupportedFeature'], `${path}.admission`);
  if (admission.kind !== 'semver-admits' && admission.kind !== 'exact-only') {
    throw new ShadowRegistryCodecError(`${path}.admission.kind`, 'unsupported admission');
  }
  const admissionKind = admission.kind as ShadowRecipeAdmission['kind'];
  const trigger = record(item.trigger, ['name', 'version'], `${path}.trigger`);
  const acquisitionRaw = plainRecord(item.acquisition, `${path}.acquisition`);
  const acquisitionKind = acquisitionRaw.kind;
  const acquisition =
    acquisitionKind === 'synthetic'
      ? record(acquisitionRaw, ['kind'], `${path}.acquisition`)
      : record(
          acquisitionRaw,
          ['dependencyProjection', 'kind', 'name', 'version'],
          `${path}.acquisition`,
        );
  if (acquisitionKind !== 'synthetic' && acquisitionKind !== 'registry')
    throw new ShadowRegistryCodecError(`${path}.acquisition.kind`, 'unsupported acquisition');
  const materialization = record(
    item.materialization,
    ['bin', 'files', 'name', 'version'],
    `${path}.materialization`,
  );
  const files = array(materialization.files, `${path}.materialization.files`).map(
    (candidate, index) => {
      const file = record(
        candidate,
        ['bytes', 'content', 'path', 'sha256'],
        `${path}.materialization.files[${index}]`,
      );
      const content =
        typeof file.content === 'string'
          ? file.content
          : (() => {
              throw new ShadowRegistryCodecError(
                `${path}.materialization.files[${index}].content`,
                'must be text',
              );
            })();
      const bytes = positive(file.bytes, `${path}.materialization.files[${index}].bytes`);
      const sha256 = text(file.sha256, `${path}.materialization.files[${index}].sha256`, SHA);
      if (
        new TextEncoder().encode(content).byteLength !== bytes ||
        shadowSha256(content) !== sha256
      ) {
        throw new ShadowRegistryCodecError(
          `${path}.materialization.files[${index}]`,
          'content identity mismatch',
        );
      }
      return {
        path: packagePath(file.path, `${path}.materialization.files[${index}].path`),
        content,
        sha256,
        bytes,
      };
    },
  );
  sortedUnique(
    files.map((file) => file.path),
    `${path}.materialization.files`,
  );
  const materializationName = text(
    materialization.name,
    `${path}.materialization.name`,
    PACKAGE_NAME,
  );
  const materializationVersion = text(
    materialization.version,
    `${path}.materialization.version`,
    VERSION,
  );
  const bin = binMap(materialization.bin, `${path}.materialization.bin`);
  const filePaths = new Set(files.map((file) => file.path));
  for (const [command, target] of Object.entries(bin)) {
    if (!filePaths.has(target)) {
      throw new ShadowRegistryCodecError(
        `${path}.materialization.bin.${command}`,
        `target ${target} is missing`,
      );
    }
  }
  const packageFile = files.find((file) => file.path === 'package.json');
  if (!packageFile) {
    throw new ShadowRegistryCodecError(`${path}.materialization.files`, 'package.json is missing');
  }
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(packageFile.content);
  } catch {
    throw new ShadowRegistryCodecError(
      `${path}.materialization.files.package.json`,
      'invalid JSON',
    );
  }
  const manifest = plainRecord(manifestValue, `${path}.materialization.files.package.json`);
  if (manifest.name !== materializationName || manifest.version !== materializationVersion) {
    throw new ShadowRegistryCodecError(
      `${path}.materialization.files.package.json`,
      'package identity disagrees with materialization',
    );
  }
  if (
    canonicalShadowJson(
      manifestBin(
        manifest.bin,
        materializationName,
        `${path}.materialization.files.package.json.bin`,
      ),
    ) !== canonicalShadowJson(bin)
  ) {
    throw new ShadowRegistryCodecError(
      `${path}.materialization.files.package.json.bin`,
      'disagrees with materialization bin',
    );
  }
  const recipeWithoutDigest = {
    schema: 2 as const,
    id: text(item.id, `${path}.id`),
    admission: {
      kind: admissionKind,
      unsupportedFeature: text(
        admission.unsupportedFeature,
        `${path}.admission.unsupportedFeature`,
      ),
    },
    trigger: {
      name: text(trigger.name, `${path}.trigger.name`, PACKAGE_NAME),
      version: text(trigger.version, `${path}.trigger.version`, VERSION),
    },
    acquisition:
      acquisitionKind === 'synthetic'
        ? { kind: 'synthetic' as const }
        : {
            kind: 'registry' as const,
            name: text(acquisition.name, `${path}.acquisition.name`, PACKAGE_NAME),
            version: text(acquisition.version, `${path}.acquisition.version`, VERSION),
            dependencyProjection: decodeDependencyProjection(
              acquisition.dependencyProjection,
              `${path}.acquisition.dependencyProjection`,
            ),
          },
    materialization: {
      name: materializationName,
      version: materializationVersion,
      bin,
      files,
    },
    ...(hasBinding
      ? (() => {
          const binding = record(item.binding, ['adapterId', 'assets'], `${path}.binding`);
          const assets = array(binding.assets, `${path}.binding.assets`).map((id, index) =>
            text(id, `${path}.binding.assets[${index}]`),
          );
          sortedUnique(assets, `${path}.binding.assets`);
          for (const id of assets)
            if (!assetIds.has(id))
              throw new ShadowRegistryCodecError(`${path}.binding.assets`, `unknown asset ${id}`);
          return {
            binding: { adapterId: text(binding.adapterId, `${path}.binding.adapterId`), assets },
          };
        })()
      : {}),
  };
  const digest = text(item.digest, `${path}.digest`, SHA);
  if (shadowDigest(recipeWithoutDigest) !== digest)
    throw new ShadowRegistryCodecError(`${path}.digest`, 'recipe digest mismatch');
  return { ...recipeWithoutDigest, digest };
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export function decodeBuiltinShadowSubstitutionCatalog(
  value: unknown,
): BuiltinShadowSubstitutionCatalog {
  const decoded = decodeCatalogShape(value);
  if (
    decoded.id !== builtinShadowSubstitutionCatalog.id ||
    decoded.digest !== builtinShadowSubstitutionCatalog.digest
  ) {
    throw new ShadowRegistryCodecError('catalog', 'not the admitted builtin catalog identity');
  }
  return decoded;
}

function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new ShadowRegistryCodecError(path, 'must be a plain object');
  }
  if (Object.getOwnPropertySymbols(value).length > 0)
    throw new ShadowRegistryCodecError(path, 'symbol members are forbidden');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const descriptor of Object.values(descriptors)) {
    if (!('value' in descriptor))
      throw new ShadowRegistryCodecError(path, 'accessors are forbidden');
    if (descriptor.enumerable !== true)
      throw new ShadowRegistryCodecError(path, 'non-enumerable fields are forbidden');
  }
  return value as Record<string, unknown>;
}

function decodeCatalogShape(value: unknown): BuiltinShadowSubstitutionCatalog {
  const item = record(value, ['assets', 'digest', 'id', 'recipes', 'schema'], 'catalog');
  if (item.schema !== 2) throw new ShadowRegistryCodecError('catalog.schema', 'unsupported schema');
  const assets = array(item.assets, 'catalog.assets').map((asset, index) =>
    decodeAsset(asset, `catalog.assets[${index}]`),
  );
  sortedUnique(
    assets.map((asset) => asset.id),
    'catalog.assets',
  );
  const assetIds = new Set(assets.map((asset) => asset.id));
  const recipes = array(item.recipes, 'catalog.recipes').map((recipe, index) =>
    decodeRecipe(recipe, `catalog.recipes[${index}]`, assetIds),
  );
  sortedUnique(
    recipes.map((recipe) => recipe.id),
    'catalog.recipes',
  );
  const payload = { schema: 2 as const, id: text(item.id, 'catalog.id'), recipes, assets };
  const digest = text(item.digest, 'catalog.digest', SHA);
  if (shadowDigest(payload) !== digest)
    throw new ShadowRegistryCodecError('catalog.digest', 'catalog digest mismatch');
  const decoded = { ...payload, digest };
  if (canonicalShadowJson(decoded) !== canonicalShadowJson(value))
    throw new ShadowRegistryCodecError('catalog', 'non-canonical representation');
  return freeze(decoded);
}

export const builtinShadowSubstitutionCatalog = decodeCatalogShape(generatedCatalog);
