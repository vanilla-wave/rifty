import { createHash } from 'node:crypto';
import * as shadowRegistry from '@riftydev/shadow-registry';
import { describe, expect, it } from 'vitest';
import { canonicalJson, identityForRecipe } from './install-artifact-recipe.ts';

interface SyntheticRecipe {
  readonly substitutionId: string;
  readonly publicName: string;
  readonly version: string;
  readonly runtimeAdapterId: string;
  readonly kind: string;
  readonly recipeSha256: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly optionalDependencies: Readonly<Record<string, string>>;
  readonly peerDependencies: Readonly<Record<string, string>>;
  readonly bin: Readonly<Record<string, string>>;
  readonly files: Readonly<Record<string, string>>;
}

function recipes(): readonly SyntheticRecipe[] {
  return (
    (
      shadowRegistry as typeof shadowRegistry & {
        readonly builtinSyntheticPackageRecipes?: readonly SyntheticRecipe[];
      }
    ).builtinSyntheticPackageRecipes ?? []
  );
}

function withoutDigest(recipe: SyntheticRecipe): Omit<SyntheticRecipe, 'recipeSha256'> {
  const { recipeSha256: _digest, ...tree } = recipe;
  return tree;
}

function deeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(deeplyFrozen);
}

describe('builtin synthetic package recipes — ADR-0298 Contract+RED', () => {
  it('exports one generated, recursively immutable esbuild delegate recipe', () => {
    expect(recipes()).toHaveLength(1);
    expect(deeplyFrozen(recipes())).toBe(true);
    expect(recipes()[0]).toMatchObject({
      substitutionId: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
      publicName: 'esbuild',
      version: '0.28.0',
      runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
      kind: 'synthesized-shadow-delegate',
      recipeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      dependencies: {},
      optionalDependencies: {},
      peerDependencies: {},
      bin: {},
    });
  });

  it('pins the exact two UTF-8 delegate files and their single-module identity', () => {
    const recipe = recipes()[0];
    expect(recipe?.files).toEqual({
      'lib/main.cjs':
        'const esbuild = globalThis.__rifty?.esbuild;\n' +
        'if (esbuild == null) {\n' +
        "  throw new Error('rifty invariant: esbuild runtime slot is not initialized');\n" +
        '}\n' +
        'module.exports = esbuild;\n',
      'package.json': JSON.stringify(
        {
          name: 'esbuild',
          version: '0.28.0',
          main: './lib/main.cjs',
          module: './lib/main.cjs',
          type: 'commonjs',
          exports: {
            '.': {
              import: './lib/main.cjs',
              require: './lib/main.cjs',
              default: './lib/main.cjs',
            },
          },
        },
        null,
        2,
      ),
    });
  });

  it('derives recipeSha256 from every tree-affecting field except the digest itself', () => {
    const recipe = recipes()[0];
    expect(recipe).toBeDefined();
    if (!recipe) return;
    const actual = createHash('sha256')
      .update(canonicalJson(withoutDigest(recipe)))
      .digest('hex');
    expect(recipe.recipeSha256).toBe(actual);
    expect(
      identityForRecipe({
        ...withoutDigest(recipe),
        files: { ...recipe.files, 'lib/main.cjs': 'x' },
      }),
    ).not.toBe(identityForRecipe(withoutDigest(recipe)));
  });

  it('retires only the esbuild alias override/shim and binds the active asset catalog to v2', () => {
    expect(shadowRegistry.bakedOverrides).not.toHaveProperty('esbuild');
    expect(shadowRegistry.internalsShims).not.toHaveProperty('@esbuild/wasi-preview1');
    expect(shadowRegistry.bakedOverrides).toMatchObject({
      bcrypt: 'bcryptjs',
      lightningcss: 'lightningcss-wasm@1.32.0',
    });
    expect(shadowRegistry.builtinShadowAssetCatalog.substitutions).toEqual([
      expect.objectContaining({
        id: 'rifty.shadow-substitution.esbuild-synthesized-delegate.v2',
        publicName: 'esbuild',
        runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
      }),
    ]);
  });
});
