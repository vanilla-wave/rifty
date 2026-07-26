const SCHEMA_ONE_CATALOG_ID = 'rifty.shadow-substitutions.builtin.v1';
const SCHEMA_ONE_RECIPE_IDS: Readonly<Record<string, true>> = {
  'rifty.shadow-substitution.esbuild.v1': true,
  'rifty.shadow-substitution.lightningcss.v1': true,
};

export function isSchemaOneBuiltinShadowSubstitutionIdentity(
  catalogId: unknown,
  recipeId: unknown,
): boolean {
  return (
    catalogId === SCHEMA_ONE_CATALOG_ID &&
    typeof recipeId === 'string' &&
    Object.hasOwn(SCHEMA_ONE_RECIPE_IDS, recipeId)
  );
}
