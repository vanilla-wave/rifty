import { createHash } from 'node:crypto';

const POLICY_FIELDS = new Set([
  'api',
  'consumer',
  'currentSurfaces',
  'gaps',
  'limitations',
  'patchDescriptions',
  'patches',
  'schema',
  'source',
  'state',
  'tests',
  'validationSource',
  'version',
  'wasm',
]);
const SOURCE_FIELDS = new Set([
  'integrity',
  'maxTarballBytes',
  'maxUnpackedBytes',
  'member',
  'package',
  'sha256',
  'version',
]);

function exactRecord(
  value: unknown,
  fields: ReadonlySet<string>,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${label} has an unclassified symbol field`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be a data field`);
    }
    if (!fields.has(key)) throw new TypeError(`${label} has unclassified field ${key}`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

/** Projection of policy fields that can alter installed tree/runtime JS bytes. */
export function installArtifactTreePolicy(value: unknown): unknown {
  const policy = exactRecord(value, POLICY_FIELDS, 'esbuild runtime policy');
  const source = exactRecord(policy.source, SOURCE_FIELDS, 'esbuild runtime policy source');
  return {
    schema: policy.schema,
    api: policy.api,
    version: policy.version,
    source: {
      package: source.package,
      version: source.version,
      member: source.member,
      sha256: source.sha256,
    },
    validationSource: policy.validationSource,
    patches: policy.patches,
    patchDescriptions: policy.patchDescriptions,
  };
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function identityForRecipe(recipe: unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(recipe)).digest('hex')}`;
}
