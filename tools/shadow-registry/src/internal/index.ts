export {
  canonicalShadowJson,
  decodeDenseDataArray,
  shadowDigest,
  shadowSha256,
} from './canonical.ts';
export { builtinShadowSubstitutionCatalog } from './codec.ts';
export type {
  BuiltinShadowSubstitutionRecipe,
  ShadowDependencyProjection,
  ShadowRecipeAdmission,
  ShadowRecipeAcquisition,
  ShadowRuntimeAsset,
} from './model.ts';
