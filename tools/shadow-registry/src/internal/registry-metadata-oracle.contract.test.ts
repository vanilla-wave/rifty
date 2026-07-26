import { describe, expect, it } from 'vitest';
import lightningcssWasmMetadata from '../fixtures/registry-metadata/lightningcss-wasm-1.32.0.json';
import { builtinShadowSubstitutionCatalog } from './index.ts';

interface RegistryMetadataGolden {
  readonly schema: number;
  readonly package: string;
  readonly version: string;
  readonly source: Readonly<{
    kind: string;
    identity: string;
    capturedDate: string;
    publishedAt: string;
  }>;
  readonly dist: Readonly<{ integrity: string; shasum: string }>;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bundleDependencies: readonly string[];
  readonly projection: Readonly<{
    dependencies: Readonly<Record<string, string>>;
    optionalDependencies: Readonly<Record<string, string>>;
    omittedOptionalDependencies: Readonly<Record<string, string>>;
    peerDependencies: Readonly<Record<string, string>>;
  }>;
}

type BuiltinRecipe = (typeof builtinShadowSubstitutionCatalog.recipes)[number];
type RegistryRecipe = BuiltinRecipe &
  Readonly<{
    acquisition: Readonly<{
      kind: 'registry';
      name: string;
      version: string;
      dependencyProjection?: Readonly<{
        dependencies: Readonly<Record<string, string>>;
        optionalDependencies: Readonly<Record<string, string>>;
        omittedOptionalDependencies: Readonly<Record<string, string>>;
        peerDependencies: Readonly<Record<string, string>>;
      }>;
    }>;
  }>;

const registryMetadataGoldens: readonly RegistryMetadataGolden[] = [lightningcssWasmMetadata];
const registryRecipes = builtinShadowSubstitutionCatalog.recipes.filter(
  (recipe): recipe is RegistryRecipe => recipe.acquisition.kind === 'registry',
);

function sourceIdentity(recipe: RegistryRecipe): string {
  return `npm-${recipe.acquisition.kind}:${recipe.acquisition.name}@${recipe.acquisition.version}`;
}

function metadataGoldenFor(recipe: RegistryRecipe): RegistryMetadataGolden {
  const golden = registryMetadataGoldens.find(
    (candidate) => candidate.source.identity === sourceIdentity(recipe),
  );
  if (!golden) throw new Error(`${recipe.id} lacks pinned registry metadata`);
  return golden;
}

describe('registry-backed builtin metadata oracle', () => {
  it('has exactly one external golden for every registry-backed builtin', () => {
    expect(registryMetadataGoldens.map((golden) => golden.source.identity).sort()).toEqual(
      registryRecipes.map(sourceIdentity).sort(),
    );
  });

  it.each(registryRecipes)('$id projects authoritative registry dependencies', (recipe) => {
    const golden = metadataGoldenFor(recipe);

    expect({
      kind: recipe.acquisition.kind,
      name: recipe.acquisition.name,
      version: recipe.acquisition.version,
    }).toEqual({
      kind: 'registry',
      name: golden.package,
      version: golden.version,
    });

    const projection = recipe.acquisition.dependencyProjection;
    expect(projection, `${recipe.id} lacks a dependency projection`).toBeDefined();
    expect(projection?.dependencies).toEqual(golden.projection.dependencies);
    expect(projection?.optionalDependencies).toEqual(golden.projection.optionalDependencies);
    expect(projection?.omittedOptionalDependencies).toEqual(
      golden.projection.omittedOptionalDependencies,
    );
    expect(projection?.peerDependencies).toEqual(golden.projection.peerDependencies);

    expect(golden.projection.dependencies).toEqual(golden.dependencies);
    expect(golden.projection.peerDependencies).toEqual(golden.peerDependencies);
    expect(
      Object.keys(golden.projection.optionalDependencies).filter(
        (name) => name in golden.projection.omittedOptionalDependencies,
      ),
    ).toEqual([]);
    expect({
      ...golden.projection.optionalDependencies,
      ...golden.projection.omittedOptionalDependencies,
    }).toEqual(golden.optionalDependencies);
  });
});
