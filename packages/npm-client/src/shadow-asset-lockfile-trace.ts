import { NotImplementedError } from '@riftydev/io';
import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { canonicalShadowJson } from './canonical-shadow-json.ts';
import {
  type AppliedShadowSubstitution,
  type ShadowAssetPlan,
  planBuiltinShadowAssets,
  validateShadowAssetPlan,
} from './shadow-asset-plan.ts';

export const RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL =
  'rifty.lockfile-shadow-substitutions/v1' as const;

export interface LockfileAppliedShadowSubstitution {
  readonly publicName: string;
  readonly requestedRange: string | null;
  readonly resolvedPublicVersion: string;
  /** Executable owner-adapter binding proven when the recipe was applied. */
  readonly runtimeAdapterId: string;
  /** Immutable identity of the installed-tree substitution recipe. */
  readonly substitutionId: string;
}

export interface ShadowSubstitutionLockfileTrace {
  readonly protocol: typeof RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL;
  readonly applied: readonly Readonly<LockfileAppliedShadowSubstitution>[];
}

const EVIDENCE_KEYS = [
  'publicName',
  'requestedRange',
  'resolvedPublicVersion',
  'runtimeAdapterId',
  'substitutionId',
] as const;

function exactPlainObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (
    value === null ||
    typeof value !== 'object' ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Object.getOwnPropertySymbols(value).length !== 0
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
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

function projectApplied(
  substitution: Readonly<AppliedShadowSubstitution>,
): LockfileAppliedShadowSubstitution {
  return Object.freeze({
    publicName: substitution.publicName,
    requestedRange: substitution.requestedRange,
    resolvedPublicVersion: substitution.resolvedPublicVersion,
    runtimeAdapterId: substitution.runtimeAdapterId,
    substitutionId: substitution.substitutionId,
  });
}

/** Installer-owned stable tree-recipe evidence; asset catalog facts stay out. */
export function createShadowSubstitutionLockfileTrace(
  plan: ShadowAssetPlan,
): ShadowSubstitutionLockfileTrace {
  validateShadowAssetPlan(plan);
  return Object.freeze({
    protocol: RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL,
    applied: Object.freeze(plan.substitutions.map(projectApplied)),
  });
}

function appliedFromEvidence(value: unknown): AppliedShadowSubstitution {
  exactPlainObject(value, EVIDENCE_KEYS, 'lockfile applied shadow substitution');
  const publicName = value.publicName;
  const requestedRange = value.requestedRange;
  const resolvedPublicVersion = value.resolvedPublicVersion;
  const runtimeAdapterId = value.runtimeAdapterId;
  const substitutionId = value.substitutionId;
  if (typeof publicName !== 'string' || publicName.length === 0) {
    throw new TypeError('lockfile applied shadow substitution has invalid publicName');
  }
  if (requestedRange !== null && typeof requestedRange !== 'string') {
    throw new TypeError('lockfile applied shadow substitution has invalid requestedRange');
  }
  if (typeof resolvedPublicVersion !== 'string' || resolvedPublicVersion.length === 0) {
    throw new TypeError('lockfile applied shadow substitution has invalid resolvedPublicVersion');
  }
  if (typeof substitutionId !== 'string' || substitutionId.length === 0) {
    throw new TypeError('lockfile applied shadow substitution has invalid substitutionId');
  }
  if (typeof runtimeAdapterId !== 'string' || runtimeAdapterId.length === 0) {
    throw new TypeError('lockfile applied shadow substitution has invalid runtimeAdapterId');
  }
  const recipe = builtinShadowAssetCatalog.substitutions.find(
    (substitution) => substitution.id === substitutionId,
  );
  if (recipe === undefined) {
    throw new NotImplementedError(`shadow-registry.substitutionRecipe.${substitutionId}`);
  }
  if (recipe.publicName !== publicName) {
    throw new TypeError('lockfile applied shadow substitution recipe/publicName drifted');
  }
  if (recipe.runtimeAdapterId !== runtimeAdapterId) {
    throw new TypeError('lockfile applied shadow substitution runtime adapter drifted');
  }
  return {
    catalog: { id: builtinShadowAssetCatalog.id, digest: builtinShadowAssetCatalog.digest },
    publicName,
    requestedRange,
    resolvedPublicVersion,
    substitutionId,
    runtimeAdapterId,
    builtin: true,
  };
}

/** Stable persisted recipe evidence -> exact current builtin asset plan. */
export function planBuiltinShadowAssetsFromLockfileTrace(value: unknown): ShadowAssetPlan {
  exactPlainObject(value, ['applied', 'protocol'], 'shadow substitution lockfile trace');
  if (value.protocol !== RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL) {
    throw new TypeError('shadow substitution lockfile trace protocol is unsupported');
  }
  if (!Array.isArray(value.applied)) {
    throw new TypeError('shadow substitution lockfile applied trace must be an array');
  }
  const plan = planBuiltinShadowAssets(value.applied.map(appliedFromEvidence));
  const canonicalTrace = createShadowSubstitutionLockfileTrace(plan);
  if (canonicalShadowJson(value) !== canonicalShadowJson(canonicalTrace)) {
    throw new TypeError('shadow substitution lockfile applied trace is not canonical');
  }
  return plan;
}
