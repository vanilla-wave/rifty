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
  ShadowRuntimeAsset,
} from './model.ts';

const SHA = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._@/+-]*$/;

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
      name: text(source.name, `${path}.source.name`),
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
      ? ['schema', 'id', 'digest', 'trigger', 'acquisition', 'materialization', 'binding']
      : ['schema', 'id', 'digest', 'trigger', 'acquisition', 'materialization'],
    path,
  );
  if (item.schema !== 1) throw new ShadowRegistryCodecError(`${path}.schema`, 'unsupported schema');
  const trigger = record(item.trigger, ['name', 'version'], `${path}.trigger`);
  const acquisitionRaw = plainRecord(item.acquisition, `${path}.acquisition`);
  const acquisitionKind = acquisitionRaw.kind;
  const acquisition =
    acquisitionKind === 'synthetic'
      ? record(acquisitionRaw, ['kind'], `${path}.acquisition`)
      : record(acquisitionRaw, ['kind', 'name', 'version'], `${path}.acquisition`);
  if (acquisitionKind !== 'synthetic' && acquisitionKind !== 'registry')
    throw new ShadowRegistryCodecError(`${path}.acquisition.kind`, 'unsupported acquisition');
  const materialization = record(
    item.materialization,
    ['files', 'name', 'version'],
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
  const recipeWithoutDigest = {
    schema: 1 as const,
    id: text(item.id, `${path}.id`),
    trigger: {
      name: text(trigger.name, `${path}.trigger.name`),
      version: text(trigger.version, `${path}.trigger.version`, VERSION),
    },
    acquisition:
      acquisitionKind === 'synthetic'
        ? { kind: 'synthetic' as const }
        : {
            kind: 'registry' as const,
            name: text(acquisition.name, `${path}.acquisition.name`),
            version: text(acquisition.version, `${path}.acquisition.version`, VERSION),
          },
    materialization: {
      name: text(materialization.name, `${path}.materialization.name`),
      version: text(materialization.version, `${path}.materialization.version`, VERSION),
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
  }
  return value as Record<string, unknown>;
}

function decodeCatalogShape(value: unknown): BuiltinShadowSubstitutionCatalog {
  const item = record(value, ['assets', 'digest', 'id', 'recipes', 'schema'], 'catalog');
  if (item.schema !== 1) throw new ShadowRegistryCodecError('catalog.schema', 'unsupported schema');
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
  const payload = { schema: 1 as const, id: text(item.id, 'catalog.id'), recipes, assets };
  const digest = text(item.digest, 'catalog.digest', SHA);
  if (shadowDigest(payload) !== digest)
    throw new ShadowRegistryCodecError('catalog.digest', 'catalog digest mismatch');
  const decoded = { ...payload, digest };
  if (canonicalShadowJson(decoded) !== canonicalShadowJson(value))
    throw new ShadowRegistryCodecError('catalog', 'non-canonical representation');
  return freeze(decoded);
}

export const builtinShadowSubstitutionCatalog = decodeCatalogShape(generatedCatalog);
