import { NotImplementedError } from '@riftydev/io';
import type { BuiltinShadowSubstitutionRecipe } from '@riftydev/shadow-registry/internal';
import { matchesRange } from '../../semver.ts';

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
