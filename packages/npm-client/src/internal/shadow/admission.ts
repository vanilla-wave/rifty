import { NotImplementedError } from '@riftydev/io';
import type { BuiltinShadowSubstitutionRecipe } from '@riftydev/shadow-registry/internal';
import { matchesRange } from '../../semver.ts';

export function shadowRecipeAdmitsRequest(
  recipe: BuiltinShadowSubstitutionRecipe,
  requestedRange: string | null,
): boolean {
  return recipe.admission.kind === 'exact-only'
    ? requestedRange === recipe.trigger.version
    : matchesRange(recipe.trigger.version, requestedRange);
}

export function assertShadowRecipeAdmission(
  recipe: BuiltinShadowSubstitutionRecipe,
  requestedRange: string | null,
): void {
  if (shadowRecipeAdmitsRequest(recipe, requestedRange)) return;
  throw new NotImplementedError(
    recipe.admission.unsupportedFeature,
    `shadow recipe ${recipe.id} does not admit ${requestedRange ?? '*'}`,
  );
}
