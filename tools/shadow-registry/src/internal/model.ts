export interface ShadowMaterializationFile {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
  readonly bytes: number;
}

export type ShadowRecipeAcquisition =
  | Readonly<{ kind: 'synthetic' }>
  | Readonly<{ kind: 'registry'; name: string; version: string }>;

export interface ShadowRuntimeAsset {
  readonly id: string;
  readonly source: Readonly<{ name: string; version: string; integrity: string }>;
  readonly member: string;
  readonly memberSha256: string;
  readonly memberSize: number;
  readonly maxTarballBytes: number;
  readonly maxUnpackedBytes: number;
}

export interface BuiltinShadowSubstitutionRecipe {
  readonly schema: 1;
  readonly id: string;
  readonly digest: string;
  readonly trigger: Readonly<{ name: string; version: string }>;
  readonly acquisition: ShadowRecipeAcquisition;
  readonly materialization: Readonly<{
    name: string;
    version: string;
    files: readonly Readonly<ShadowMaterializationFile>[];
  }>;
  readonly binding?: Readonly<{ adapterId: string; assets: readonly string[] }>;
}

export interface BuiltinShadowSubstitutionCatalog {
  readonly schema: 1;
  readonly id: string;
  readonly digest: string;
  readonly recipes: readonly Readonly<BuiltinShadowSubstitutionRecipe>[];
  readonly assets: readonly Readonly<ShadowRuntimeAsset>[];
}

export type ShadowCatalogRecipeDefinition = Omit<BuiltinShadowSubstitutionRecipe, 'digest'>;
export interface ShadowCatalogDefinition {
  readonly schema: 1;
  readonly id: string;
  readonly recipes: readonly Readonly<ShadowCatalogRecipeDefinition>[];
  readonly assets: readonly Readonly<ShadowRuntimeAsset>[];
}
