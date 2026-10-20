import { describe, expect, it } from 'vitest';
import { shadowDigest } from './canonical.ts';
import { builtinShadowSubstitutionCatalog, decodeShadowSubstitutionCatalog } from './codec.ts';
import { builtinRecipeForTier, specializeShadowRecipe } from './recipe-selection.ts';

function resign(value: unknown): void {
  const catalog = value as { recipes: Record<string, unknown>[]; digest: string };
  for (const recipe of catalog.recipes) {
    const { digest: _digest, ...payload } = recipe;
    recipe.digest = shadowDigest(payload);
  }
  const { digest: _digest, ...payload } = catalog;
  catalog.digest = shadowDigest(payload);
}

describe('requested-range recipe', () => {
  it('specializes versions outside the verified set without adding a recipe', () => {
    const template = builtinRecipeForTier('esbuild', 'coi')!;
    for (const version of ['0.27.7', '0.29.0-next.1', '1.0.0+build.2']) {
      const recipe = specializeShadowRecipe(template, version);
      expect(recipe.materialization.version).toBe(version);
      expect(
        JSON.parse(recipe.materialization.files.find((f) => f.path === 'package.json')!.content)
          .version,
      ).toBe(version);
      expect(recipe.binding).toBeUndefined();
    }
    expect(template.trigger.version).toBe('$version');
    expect(builtinRecipeForTier('esbuild')!.trigger.version).toBe('0.28.0');
  });

  it('rejects an ambiguous trigger within a tier', () => {
    const forged = structuredClone(builtinShadowSubstitutionCatalog);
    const recipe = forged.recipes.find((recipe) => recipe.runtimeTier === 'coi')!;
    Reflect.set(recipe, 'runtimeTier', 'no-coi');
    resign(forged);
    expect(() => decodeShadowSubstitutionCatalog(forged)).toThrow(/ambiguous trigger/);
  });

  it('requires version placeholders to agree across a range template', () => {
    const forged = structuredClone(builtinShadowSubstitutionCatalog);
    const recipe = forged.recipes.find((recipe) => recipe.runtimeTier === 'coi')!;
    Reflect.set(recipe.trigger, 'version', '0.28.2');
    resign(forged);
    expect(() => decodeShadowSubstitutionCatalog(forged)).toThrow(/version placeholders/);
  });
});
