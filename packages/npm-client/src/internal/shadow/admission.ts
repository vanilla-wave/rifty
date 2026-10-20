import { NotImplementedError } from '@riftydev/io';
import {
  type BuiltinShadowSubstitutionRecipe,
  type ShadowRuntimeTier,
  builtinRecipeForTier,
  specializeShadowRecipe,
} from '@riftydev/shadow-registry/internal';
import { type OverrideMap, userOverrideSpec } from '../../overrides.ts';
import { matchesRange } from '../../semver.ts';
import { resolveEffectivePackageRequest } from '../../shadow-shims.ts';

/**
 * Recipe lookup for one (name, range, parent) request. Live resolution passes
 * no `replayedEntryVersion` and gets pure request-shape admission (ADR-0361:
 * unchanged). Lockfile replay passes the recorded entry version found at the
 * effective path: the recorded pin is the admission fact — request admission
 * re-runs only when that pin is NOT the recipe's attested product, so foreign
 * and stale locks keep the loud NotImplementedError.
 */
export function builtinRecipeForRequest(
  name: string,
  range: string | null,
  parent: string | undefined,
  overrides: OverrideMap | undefined,
  replayedEntryVersion?: string,
  runtimeTier?: ShadowRuntimeTier,
): BuiltinShadowSubstitutionRecipe | null {
  const { override } = resolveEffectivePackageRequest(name, range, parent, overrides, runtimeTier);
  if (override?.source === 'user') return null;
  const recipe = builtinRecipeForTier(name, runtimeTier);
  if (!recipe) return null;
  // A user version/range override IS the edge spec the recipe admits (ADR-0451).
  const requested = userOverrideSpec(name, parent, overrides) ?? range;
  if (
    recipe.runtimeTier === 'no-coi' &&
    replayedEntryVersion !== undefined &&
    replayedEntryVersion !== attestedProductVersion(recipe)
  ) {
    throw new NotImplementedError(
      recipe.admission.unsupportedFeature,
      `no-COI cannot run lock pin ${replayedEntryVersion}`,
    );
  }

  // Replay admits only a CONSISTENT recorded fact: the pinned entry is the
  // attested product AND the recorded range semantically admits the trigger
  // version (npm refuses an out-of-sync lock too — `npm ci` EUSAGE).
  if (
    replayedEntryVersion !== attestedProductVersion(recipe) ||
    !matchesRange(recipe.trigger.version, requested)
  ) {
    assertShadowRecipeAdmission(recipe, requested);
  }
  return recipe;
}

/** The exact version the recipe pins at the effective path (ADR-0361). */
function attestedProductVersion(recipe: BuiltinShadowSubstitutionRecipe): string {
  return recipe.acquisition.kind === 'registry'
    ? recipe.acquisition.version
    : recipe.materialization.version;
}

/** Root-request admission preflight: every direct dependency edge must clear
 * request-shape admission before any resolution work. */
export function assertDirectShadowRecipeAdmissions(
  dependencies: Readonly<Record<string, string>>,
  optionalDependencies: Readonly<Record<string, string>>,
  rootName: string,
  overrides: OverrideMap | undefined,
  runtimeTier?: ShadowRuntimeTier,
): void {
  for (const [name, range] of [
    ...Object.entries(dependencies),
    ...Object.entries(optionalDependencies),
  ]) {
    builtinRecipeForRequest(name, range, rootName, overrides, undefined, runtimeTier);
  }
}

/** Recipe applies to a concrete registry resolution only when its exact
 * acquisition matches the resolved (name, version). */
export function registryRecipeForResolution(
  recipe: BuiltinShadowSubstitutionRecipe | null,
  effectiveName: string,
  version: string,
): BuiltinShadowSubstitutionRecipe | null {
  if (
    recipe?.acquisition.kind !== 'registry' ||
    recipe.acquisition.name !== effectiveName ||
    (recipe.acquisition.version !== version && recipe.admission.kind !== 'requested-range')
  ) {
    return null;
  }
  return specializeShadowRecipe(recipe, version);
}

export function assertShadowRecipeAdmission(
  recipe: Readonly<{
    trigger: Pick<BuiltinShadowSubstitutionRecipe['trigger'], 'version'>;
    admission: BuiltinShadowSubstitutionRecipe['admission'];
    runtimeTier?: ShadowRuntimeTier;
  }>,
  requestedRange: string | null,
): void {
  if (recipe.admission.kind === 'requested-range') return;
  const admitted =
    recipe.admission.kind === 'semver-admits'
      ? matchesRange(recipe.trigger.version, requestedRange)
      : requestedRange === recipe.trigger.version;
  if (admitted) return;
  throw new NotImplementedError(
    recipe.admission.unsupportedFeature,
    `${recipe.runtimeTier === 'no-coi' ? 'no-COI ' : ''}shadow recipe does not admit ${requestedRange ?? '*'}`,
  );
}
