export interface ShadowMaterializationFile {
  readonly path: string;
  readonly content: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ShadowRecipeAdmission {
  readonly kind: 'semver-admits' | 'exact-only';
  readonly unsupportedFeature: string;
}

export interface ShadowRegistryDependencyProjection {
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly omittedOptionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bundledDependencies: readonly string[];
  readonly unsupportedFeature: string;
}

export type ShadowRecipeAcquisition =
  | Readonly<{ kind: 'synthetic' }>
  | Readonly<{
      kind: 'registry';
      name: string;
      version: string;
      dependencyProjection: ShadowRegistryDependencyProjection;
    }>;

export interface BuiltinShadowSubstitutionRecipe {
  readonly schema: 2;
  readonly id: string;
  readonly digest: string;
  readonly trigger: Readonly<{ name: string; version: string }>;
  readonly admission: Readonly<ShadowRecipeAdmission>;
  readonly acquisition: ShadowRecipeAcquisition;
  readonly materialization: Readonly<{
    name: string;
    version: string;
    bin: Readonly<Record<string, string>>;
    files: readonly Readonly<ShadowMaterializationFile>[];
  }>;
  readonly binding?: Readonly<{ adapterId: string }>;
}

export interface BuiltinShadowSubstitutionCatalog {
  readonly schema: 2;
  readonly id: string;
  readonly digest: string;
  readonly recipes: readonly Readonly<BuiltinShadowSubstitutionRecipe>[];
}

export type ShadowCatalogRecipeDefinition = Omit<BuiltinShadowSubstitutionRecipe, 'digest'>;
export interface ShadowCatalogDefinition {
  readonly schema: 2;
  readonly id: string;
  readonly recipes: readonly Readonly<ShadowCatalogRecipeDefinition>[];
}
