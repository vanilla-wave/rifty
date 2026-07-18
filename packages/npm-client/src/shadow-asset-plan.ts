import { NotImplementedError } from '@riftydev/io';
import { type ShadowAssetDescriptor, builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { canonicalShadowDigest, canonicalShadowJson } from './canonical-shadow-json.ts';

export type { ShadowAssetDescriptor, ShadowAssetSourceDescriptor } from '@riftydev/shadow-registry';

export interface AppliedShadowSubstitution {
  readonly catalog: Readonly<{ id: string; digest: string }>;
  readonly publicName: string;
  readonly requestedRange: string | null;
  readonly resolvedPublicVersion: string;
  readonly substitutionId: string;
  readonly runtimeAdapterId: string;
  readonly builtin: boolean;
}

export interface ShadowAssetPlan {
  readonly requiredSetDigest: string;
  readonly substitutions: readonly Readonly<AppliedShadowSubstitution>[];
  readonly assets: readonly Readonly<ShadowAssetDescriptor>[];
}

const SHA256 = /^[0-9a-f]{64}$/;
const EXACT_KEYS = [
  'builtin',
  'catalog',
  'publicName',
  'requestedRange',
  'resolvedPublicVersion',
  'runtimeAdapterId',
  'substitutionId',
] as const;

function exactPlainObject(value: unknown, keys: readonly string[], label: string): void {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  if (Object.getOwnPropertySymbols(value).length !== 0) throw new TypeError(`${label} has symbols`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const actual = Object.keys(descriptors).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new TypeError(`${label} has extra or missing fields`);
  }
  for (const key of actual) {
    if (!('value' in (descriptors[key] ?? {}))) throw new TypeError(`${label} has accessors`);
  }
}

function validateApplied(value: AppliedShadowSubstitution): void {
  exactPlainObject(value, EXACT_KEYS, 'applied shadow substitution');
  exactPlainObject(value.catalog, ['digest', 'id'], 'applied shadow substitution catalog');
  if (
    value.catalog.id !== builtinShadowAssetCatalog.id ||
    value.catalog.digest !== builtinShadowAssetCatalog.digest
  ) {
    throw new TypeError('applied shadow substitution names a non-builtin or drifted catalog');
  }
  if (value.builtin !== true) throw new TypeError('applied shadow substitution must be builtin');
  for (const [field, entry] of [
    ['publicName', value.publicName],
    ['resolvedPublicVersion', value.resolvedPublicVersion],
    ['substitutionId', value.substitutionId],
    ['runtimeAdapterId', value.runtimeAdapterId],
  ] as const) {
    if (typeof entry !== 'string' || entry.length === 0) throw new TypeError(`invalid ${field}`);
  }
  if (value.requestedRange !== null && typeof value.requestedRange !== 'string') {
    throw new TypeError('invalid requestedRange');
  }
}

function cloneApplied(value: AppliedShadowSubstitution): AppliedShadowSubstitution {
  return {
    catalog: { id: value.catalog.id, digest: value.catalog.digest },
    publicName: value.publicName,
    requestedRange: value.requestedRange,
    resolvedPublicVersion: value.resolvedPublicVersion,
    substitutionId: value.substitutionId,
    runtimeAdapterId: value.runtimeAdapterId,
    builtin: value.builtin,
  };
}

function cloneAsset(value: ShadowAssetDescriptor): ShadowAssetDescriptor {
  return { ...value, source: { ...value.source } };
}

function deepFreeze<T extends object>(value: T): Readonly<T> {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object' && !Object.isFrozen(child)) {
      deepFreeze(child as object);
    }
  }
  return Object.freeze(value);
}

function finishPlan(
  substitutions: readonly AppliedShadowSubstitution[],
  assets: readonly ShadowAssetDescriptor[],
): ShadowAssetPlan {
  const payload = { schema: 1, substitutions, assets };
  return deepFreeze({
    requiredSetDigest: canonicalShadowDigest(payload),
    substitutions: substitutions.map(cloneApplied),
    assets: assets.map(cloneAsset),
  }) as ShadowAssetPlan;
}

export const EMPTY_SHADOW_ASSET_PLAN: ShadowAssetPlan = finishPlan([], []);

/** Exact value born only when npm-client proves a builtin redirect was applied. */
export function appliedBuiltinShadowSubstitution(
  publicName: string,
  requestedRange: string | null,
  resolvedPublicVersion: string,
): AppliedShadowSubstitution | null {
  const substitution = builtinShadowAssetCatalog.substitutions.find(
    (candidate) => candidate.publicName === publicName,
  );
  if (!substitution) return null;
  return {
    catalog: { id: builtinShadowAssetCatalog.id, digest: builtinShadowAssetCatalog.digest },
    publicName,
    requestedRange,
    resolvedPublicVersion,
    substitutionId: substitution.id,
    runtimeAdapterId: substitution.runtimeAdapterId,
    builtin: true,
  };
}

/** Builtin-only, sync, state-free planner. */
export function planBuiltinShadowAssets(
  applied: readonly AppliedShadowSubstitution[],
): ShadowAssetPlan {
  if (!Array.isArray(applied)) throw new TypeError('applied substitutions must be an array');
  if (applied.length === 0) return EMPTY_SHADOW_ASSET_PLAN;
  const byValue = new Map<string, AppliedShadowSubstitution>();
  const assetsById = new Map<string, ShadowAssetDescriptor>();
  for (const candidate of applied) {
    validateApplied(candidate);
    const substitution = builtinShadowAssetCatalog.substitutions.find(
      (entry) => entry.publicName === candidate.publicName,
    );
    if (
      !substitution ||
      substitution.id !== candidate.substitutionId ||
      substitution.runtimeAdapterId !== candidate.runtimeAdapterId
    ) {
      throw new TypeError(
        `applied shadow substitution metadata drifted for ${candidate.publicName}`,
      );
    }
    const assetIds = substitution.versions[candidate.resolvedPublicVersion];
    if (!assetIds) {
      throw new NotImplementedError(
        `shadow-registry.${candidate.publicName}@${candidate.resolvedPublicVersion}.assets`,
      );
    }
    const cloned = cloneApplied(candidate);
    byValue.set(canonicalShadowJson(cloned), cloned);
    for (const id of assetIds) {
      const descriptor = builtinShadowAssetCatalog.assets.find((asset) => asset.id === id);
      if (!descriptor) throw new TypeError(`builtin shadow asset descriptor is missing: ${id}`);
      const existing = assetsById.get(id);
      if (existing && canonicalShadowJson(existing) !== canonicalShadowJson(descriptor)) {
        throw new TypeError(`conflicting builtin shadow asset descriptor: ${id}`);
      }
      assetsById.set(id, cloneAsset(descriptor));
    }
  }
  const substitutions = [...byValue.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([, value]) => value);
  const assets = [...assetsById.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const plan = finishPlan(substitutions, assets);
  if (!SHA256.test(plan.requiredSetDigest)) throw new TypeError('invalid required-set digest');
  return plan;
}

export function validateShadowAssetPlan(plan: ShadowAssetPlan): void {
  exactPlainObject(plan, ['assets', 'requiredSetDigest', 'substitutions'], 'shadow asset plan');
  if (!SHA256.test(plan.requiredSetDigest)) throw new TypeError('invalid required-set digest');
  const planned = planBuiltinShadowAssets(plan.substitutions);
  if (canonicalShadowJson(planned) !== canonicalShadowJson(plan)) {
    throw new TypeError('shadow asset plan is not the canonical builtin plan');
  }
}
