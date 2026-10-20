export {
  canonicalShadowJson,
  decodeDenseDataArray,
  shadowDigest,
  shadowSha256,
} from './canonical.ts';
export { builtinShadowSubstitutionCatalog } from './codec.ts';
export type {
  BuiltinShadowSubstitutionRecipe,
  ShadowRecipeAdmission,
  ShadowRecipeAcquisition,
  ShadowRegistryDependencyProjection,
} from './model.ts';

export {
  builtinRecipeForTier,
  builtinRecipeById,
  specializeShadowRecipe,
  type ShadowRuntimeTier,
} from './recipe-selection.ts';
