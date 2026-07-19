import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';

export interface LockfileShadowSubstitutionRecipe {
  readonly substitutionId: string;
  readonly publicName: string;
  readonly materialization: Readonly<{ kind: 'package'; name: string }>;
}

/** Append-only historical tree recipes; active override removal cannot erase facts. */
export const lockfileShadowSubstitutionRecipes: readonly Readonly<LockfileShadowSubstitutionRecipe>[] =
  Object.freeze([
    Object.freeze({
      substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
      publicName: 'esbuild',
      materialization: Object.freeze({ kind: 'package' as const, name: '@esbuild/wasi-preview1' }),
    }),
    Object.freeze({
      substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
      publicName: 'esbuild',
      materialization: Object.freeze({ kind: 'package' as const, name: 'esbuild' }),
    }),
  ]);

for (const substitution of builtinShadowAssetCatalog.substitutions) {
  const recipe = lockfileShadowSubstitutionRecipes.find(
    (candidate) => candidate.substitutionId === substitution.id,
  );
  if (recipe === undefined || recipe.publicName !== substitution.publicName) {
    throw new TypeError(`builtin shadow substitution lacks a lockfile recipe: ${substitution.id}`);
  }
}

export function lockfileShadowSubstitutionRecipe(
  substitutionId: string,
): Readonly<LockfileShadowSubstitutionRecipe> | null {
  return (
    lockfileShadowSubstitutionRecipes.find(
      (candidate) => candidate.substitutionId === substitutionId,
    ) ?? null
  );
}
