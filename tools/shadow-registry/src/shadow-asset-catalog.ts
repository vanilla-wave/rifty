import generatedCatalog from '../generated/shadow-asset-catalog.json';
import { bakedOverrides } from './index-data.ts';

export interface ShadowAssetSourceDescriptor {
  readonly name: string;
  readonly version: string;
  readonly integrity: string;
}

export interface ShadowAssetDescriptor {
  readonly id: string;
  readonly source: ShadowAssetSourceDescriptor;
  readonly member: string;
  readonly memberSha256: string;
  readonly memberSize: number;
  readonly maxTarballBytes: number;
  readonly maxUnpackedBytes: number;
}

export interface BuiltinShadowAssetSubstitution {
  readonly id: string;
  readonly publicName: string;
  readonly builtin: true;
  readonly runtimeAdapterId: string;
  readonly versions: Readonly<Record<string, readonly string[]>>;
}

export interface BuiltinShadowAssetCatalog {
  readonly schema: 1;
  readonly id: string;
  readonly digest: string;
  readonly substitutions: readonly BuiltinShadowAssetSubstitution[];
  readonly assets: readonly ShadowAssetDescriptor[];
}

export type BuiltinShadowAssetCatalogDefinition = Omit<BuiltinShadowAssetCatalog, 'digest'> & {
  readonly digest?: string;
};

const SHA256 = /^[0-9a-f]{64}$/;
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

function assertSri(value: string, label: string): void {
  if (!SRI.test(value)) throw new TypeError(`shadow asset catalog: invalid ${label}`);
  const dash = value.indexOf('-');
  const algorithm = value.slice(0, dash);
  const encoded = value.slice(dash + 1);
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new TypeError(`shadow asset catalog: invalid ${label}`);
  }
  const expectedLength = algorithm === 'sha256' ? 32 : algorithm === 'sha384' ? 48 : 64;
  if (binary.length !== expectedLength || btoa(binary) !== encoded) {
    throw new TypeError(`shadow asset catalog: invalid ${label}`);
  }
}

function sourcePackageNames(): ReadonlySet<string> {
  const names = new Set(Object.keys(bakedOverrides));
  for (const target of Object.values(bakedOverrides)) {
    const value = target.startsWith('npm:') ? target.slice(4) : target;
    const at = value.lastIndexOf('@');
    names.add(at > 0 ? value.slice(0, at) : value);
  }
  return names;
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._@/+-]*$/.test(value)) {
    throw new TypeError(`shadow asset catalog: invalid ${label}`);
  }
}

function assertMember(value: string): void {
  const parts = value.split('/');
  if (value.startsWith('/') || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`shadow asset catalog: invalid member ${JSON.stringify(value)}`);
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`shadow asset catalog: ${label} must be a positive safe integer`);
  }
}

function sourceCollision(name: string): Error {
  return Object.assign(
    new Error(
      `Shadow asset source package collides with builtin substitution or override: ${name}`,
    ),
    { code: 'ESHADOWASSETSOURCE' as const, packageName: name },
  );
}

function freezeRecord<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      freezeRecord(child as object);
    }
  }
  return Object.freeze(value);
}

/** Package-private constructor: external catalogs remain a separate decision. */
export function createBuiltinShadowAssetCatalog(
  definition: BuiltinShadowAssetCatalogDefinition,
): BuiltinShadowAssetCatalog {
  const collisions = sourcePackageNames();
  for (const asset of definition.assets) {
    if (collisions.has(asset.source.name)) throw sourceCollision(asset.source.name);
  }
  if (definition.schema !== 1) throw new TypeError('shadow asset catalog: unsupported schema');
  assertIdentifier(definition.id, 'catalog id');
  if (typeof definition.digest !== 'string' || !SHA256.test(definition.digest)) {
    throw new TypeError('shadow asset catalog: digest must be 64 lowercase hex digits');
  }
  const assetIds = new Set<string>();
  const sourceCoordinates = new Set<string>();
  const assets = definition.assets.map((asset) => {
    assertIdentifier(asset.id, 'asset id');
    if (assetIds.has(asset.id))
      throw new TypeError(`shadow asset catalog: duplicate asset ${asset.id}`);
    assetIds.add(asset.id);
    assertIdentifier(asset.source.name, 'source package');
    if (!EXACT_VERSION.test(asset.source.version)) {
      throw new TypeError(`shadow asset catalog: source version must be exact for ${asset.id}`);
    }
    assertSri(asset.source.integrity, `source integrity for ${asset.id}`);
    const sourceKey = `${asset.source.name}\u0000${asset.source.version}\u0000${asset.source.integrity}`;
    sourceCoordinates.add(sourceKey);
    assertMember(asset.member);
    if (!SHA256.test(asset.memberSha256)) {
      throw new TypeError(`shadow asset catalog: invalid member sha256 for ${asset.id}`);
    }
    assertPositiveSafeInteger(asset.memberSize, `${asset.id}.memberSize`);
    assertPositiveSafeInteger(asset.maxTarballBytes, `${asset.id}.maxTarballBytes`);
    assertPositiveSafeInteger(asset.maxUnpackedBytes, `${asset.id}.maxUnpackedBytes`);
    if (asset.maxUnpackedBytes < asset.memberSize) {
      throw new TypeError(`shadow asset catalog: unpacked cap is smaller than member ${asset.id}`);
    }
    return {
      id: asset.id,
      source: { ...asset.source },
      member: asset.member,
      memberSha256: asset.memberSha256,
      memberSize: asset.memberSize,
      maxTarballBytes: asset.maxTarballBytes,
      maxUnpackedBytes: asset.maxUnpackedBytes,
    } satisfies ShadowAssetDescriptor;
  });
  if (sourceCoordinates.size === 0 && assets.length > 0) {
    throw new TypeError('shadow asset catalog: assets require source coordinates');
  }

  const substitutionIds = new Set<string>();
  const publicNames = new Set<string>();
  const substitutions = definition.substitutions.map((substitution) => {
    assertIdentifier(substitution.id, 'substitution id');
    assertIdentifier(substitution.runtimeAdapterId, 'runtime adapter id');
    assertIdentifier(substitution.publicName, 'public package name');
    if (substitution.builtin !== true) {
      throw new TypeError('shadow asset catalog: builtin substitution must be true');
    }
    if (substitutionIds.has(substitution.id) || publicNames.has(substitution.publicName)) {
      throw new TypeError(
        `shadow asset catalog: duplicate substitution ${substitution.publicName}`,
      );
    }
    substitutionIds.add(substitution.id);
    publicNames.add(substitution.publicName);
    const versions: Record<string, readonly string[]> = {};
    for (const version of Object.keys(substitution.versions).sort()) {
      if (!EXACT_VERSION.test(version)) {
        throw new TypeError(`shadow asset catalog: mapped version must be exact: ${version}`);
      }
      const ids = substitution.versions[version];
      if (!ids || ids.length === 0) {
        throw new TypeError(
          `shadow asset catalog: ${substitution.publicName}@${version} has no assets`,
        );
      }
      const unique = [...new Set(ids)].sort();
      if (unique.length !== ids.length) {
        throw new TypeError(`shadow asset catalog: duplicate mapped asset for ${version}`);
      }
      for (const id of unique) {
        if (!assetIds.has(id)) throw new TypeError(`shadow asset catalog: unknown asset ${id}`);
      }
      versions[version] = unique;
    }
    return { ...substitution, versions } satisfies BuiltinShadowAssetSubstitution;
  });

  return freezeRecord({
    schema: 1,
    id: definition.id,
    digest: definition.digest,
    substitutions,
    assets,
  }) as BuiltinShadowAssetCatalog;
}

export const builtinShadowAssetCatalog = createBuiltinShadowAssetCatalog(
  generatedCatalog as BuiltinShadowAssetCatalog,
);
