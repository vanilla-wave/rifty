import { shadowDigest, shadowSha256 } from './canonical.ts';
import { builtinShadowSubstitutionCatalog } from './codec.ts';
import type { BuiltinShadowSubstitutionRecipe } from './model.ts';

export type ShadowRuntimeTier = 'coi' | 'no-coi';

/** Explicit host policy; unspecified callers retain the legacy tier. */
export function builtinRecipeForTier(
  name: string,
  tier: ShadowRuntimeTier = 'no-coi',
): BuiltinShadowSubstitutionRecipe | undefined {
  return builtinShadowSubstitutionCatalog.recipes.find(
    (recipe) =>
      recipe.trigger.name === name &&
      (recipe.runtimeTier === undefined || recipe.runtimeTier === tier),
  );
}

/** A range recipe's files/digest derive from the actual registry resolution. */
export function specializeShadowRecipe(
  recipe: BuiltinShadowSubstitutionRecipe,
  version: string,
): BuiltinShadowSubstitutionRecipe {
  if (recipe.admission.kind !== 'requested-range') return recipe;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))
    throw new TypeError('shadow recipe requires a resolved version');
  if (recipe.acquisition.kind !== 'registry')
    throw new TypeError('range recipe requires registry acquisition');
  const { digest: _digest, ...template } = recipe;
  const payload = {
    ...template,
    trigger: { ...recipe.trigger, version },
    acquisition: { ...recipe.acquisition, version },
    materialization: {
      ...recipe.materialization,
      version,
      files: recipe.materialization.files.map((file) => {
        const content = file.content.replaceAll('$version', version);
        return {
          ...file,
          content,
          bytes: new TextEncoder().encode(content).length,
          sha256: shadowSha256(content),
        };
      }),
    },
  };
  return { ...payload, digest: shadowDigest(payload) };
}

export function builtinRecipeById(
  id: string,
  version: string,
): BuiltinShadowSubstitutionRecipe | undefined {
  const recipe = builtinShadowSubstitutionCatalog.recipes.find((recipe) => recipe.id === id);
  return recipe && specializeShadowRecipe(recipe, version);
}
