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
  ShadowRuntimeAsset,
} from './model.ts';
