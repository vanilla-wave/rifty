import { NotImplementedError } from '@riftydev/io';
import {
  type BuiltinShadowSubstitutionRecipe,
  builtinShadowSubstitutionCatalog,
} from '@riftydev/shadow-registry/internal';
import type { OverrideMap } from '../../overrides.ts';
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
): BuiltinShadowSubstitutionRecipe | null {
  const { override } = resolveEffectivePackageRequest(name, range, parent, overrides);
  if (override?.source === 'user') return null;
  const recipe = builtinShadowSubstitutionCatalog.recipes.find(
    (candidate) => candidate.trigger.name === name,
  );
  if (!recipe) return null;
  // Replay admits only a CONSISTENT recorded fact: the pinned entry is the
  // attested product AND the recorded range semantically admits the trigger
  // version (npm refuses an out-of-sync lock too — `npm ci` EUSAGE).
  if (
    replayedEntryVersion !== attestedProductVersion(recipe) ||
    !matchesRange(recipe.trigger.version, range)
  ) {
    assertShadowRecipeAdmission(recipe, range);
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
): void {
  for (const [name, range] of [
    ...Object.entries(dependencies),
    ...Object.entries(optionalDependencies),
  ]) {
    builtinRecipeForRequest(name, range, rootName, overrides);
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
    recipe.acquisition.version !== version
  ) {
    return null;
  }
  return recipe;
}

export function assertShadowRecipeAdmission(
  recipe: Readonly<{
    trigger: Pick<BuiltinShadowSubstitutionRecipe['trigger'], 'version'>;
    admission: BuiltinShadowSubstitutionRecipe['admission'];
  }>,
  requestedRange: string | null,
): void {
  const admitted =
    recipe.admission.kind === 'semver-admits'
      ? matchesRange(recipe.trigger.version, requestedRange)
      : requestedRange === recipe.trigger.version;
  if (admitted) return;
  throw new NotImplementedError(
    recipe.admission.unsupportedFeature,
    `shadow recipe does not admit ${requestedRange ?? '*'}`,
  );
}
