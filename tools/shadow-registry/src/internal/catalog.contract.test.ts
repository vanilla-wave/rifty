import { describe, expect, it } from 'vitest';
import { builtinShadowCatalogSource } from './catalog-source.ts';
import { decodeBuiltinShadowSubstitutionCatalog } from './codec.ts';
import {
  builtinShadowSubstitutionCatalog,
  canonicalShadowJson,
  shadowDigest,
  shadowSha256,
} from './index.ts';
import sha256FixedVectors from './sha256-fixed-vectors.json';

const ESBUILD_V2_MAIN = `const esbuild = globalThis.__rifty?.esbuild;
if (esbuild == null) {
  throw new Error('rifty invariant: esbuild runtime slot is not initialized');
}
module.exports = esbuild;
`;

const ESBUILD_V2_BIN = `#!/usr/bin/env node
class NotImplementedError extends Error {
  constructor(feature) {
    super(\`Not implemented: \${feature}\`);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}
throw new NotImplementedError('esbuild.cli');
`;

const ESBUILD_V2_PACKAGE = JSON.stringify(
  {
    name: 'esbuild',
    version: '0.28.0',
    main: './lib/main.cjs',
    module: './lib/main.cjs',
    type: 'commonjs',
    bin: { esbuild: 'bin/esbuild' },
    exports: {
      '.': { import: './lib/main.cjs', require: './lib/main.cjs', default: './lib/main.cjs' },
    },
  },
  null,
  2,
);

const LIGHTNINGCSS_V2_CJS = `module.exports = require('lightningcss-wasm');
`;

const LIGHTNINGCSS_V2_ESM = `export {
  Features,
  browserslistToTargets,
  bundle,
  bundleAsync,
  composeVisitors,
  transform,
  transformStyleAttribute,
} from 'lightningcss-wasm';

import * as lightningcss from 'lightningcss-wasm';
export default lightningcss;
`;

const LIGHTNINGCSS_V2_PACKAGE = JSON.stringify(
  {
    name: 'lightningcss',
    version: '1.32.0',
    main: './index.cjs',
    module: './index.mjs',
    type: 'module',
    exports: { '.': { import: './index.mjs', require: './index.cjs', default: './index.mjs' } },
  },
  null,
  2,
);

function rawFile(path: string, content: string) {
  return {
    path,
    content,
    sha256: shadowSha256(content),
    bytes: new TextEncoder().encode(content).byteLength,
  };
}

function withDigest<T extends object>(value: T): T & Readonly<{ digest: string }> {
  return { ...value, digest: shadowDigest(value) };
}

/**
 * Exact next-schema builtin value. Deliberately does not clone the currently
 * generated v1 catalog: malformed v2 cases must reach the codec, not crash
 * while looking up fields that v1 cannot have.
 */
function rawSchema2Catalog() {
  const recipes = [
    withDigest({
      schema: 2 as const,
      id: 'rifty.shadow-substitution.esbuild.v2',
      admission: {
        kind: 'semver-admits' as const,
        unsupportedFeature: 'esbuild.version',
      },
      trigger: { name: 'esbuild', version: '0.28.0' },
      acquisition: { kind: 'synthetic' as const },
      materialization: {
        name: 'esbuild',
        version: '0.28.0',
        bin: { esbuild: 'bin/esbuild' },
        files: [
          rawFile('bin/esbuild', ESBUILD_V2_BIN),
          rawFile('lib/main.cjs', ESBUILD_V2_MAIN),
          rawFile('package.json', ESBUILD_V2_PACKAGE),
        ],
      },
      binding: {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
      },
    }),
    withDigest({
      schema: 2 as const,
      id: 'rifty.shadow-substitution.lightningcss.v2',
      admission: {
        kind: 'semver-admits' as const,
        unsupportedFeature: 'lightningcss.version',
      },
      trigger: { name: 'lightningcss', version: '1.32.0' },
      acquisition: {
        kind: 'registry' as const,
        name: 'lightningcss-wasm',
        version: '1.32.0',
        dependencyProjection: {
          dependencies: {},
          optionalDependencies: {},
          omittedOptionalDependencies: {},
          peerDependencies: {},
          unsupportedFeature: 'lightningcss.acquisitionDependencies',
        },
      },
      materialization: {
        name: 'lightningcss',
        version: '1.32.0',
        bin: {},
        files: [
          rawFile('index.cjs', LIGHTNINGCSS_V2_CJS),
          rawFile('index.mjs', LIGHTNINGCSS_V2_ESM),
          rawFile('package.json', LIGHTNINGCSS_V2_PACKAGE),
        ],
      },
    }),
  ];
  const payload = {
    schema: 2 as const,
    id: 'rifty.shadow-substitutions.builtin.v2',
    recipes,
    assets: [
      {
        id: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
        source: {
          name: 'esbuild-wasm',
          version: '0.28.0',
          integrity:
            'sha512-5TRVKExcEmeMkccIZMzUq+Az6X2RoMAJyfl6SMMO1dMVhmvt0I2mx7gAb6zYi42n4d1ETcatFXazGKzA+aW7fg==',
        },
        member: 'package/esbuild.wasm',
        memberSha256: '9d99d51a13469befdcfca172855f62724b87bdfc0c87a6a0729ddbb455d0fa3b',
        memberSize: 13_918_738,
        maxTarballBytes: 3_845_798,
        maxUnpackedBytes: 14_483_968,
      },
    ],
  };
  return { ...payload, digest: shadowDigest(payload) };
}

type RawSchema2Catalog = ReturnType<typeof rawSchema2Catalog>;
type RawSchema2Recipe = RawSchema2Catalog['recipes'][number];
type RawRegistryRecipe = Extract<
  RawSchema2Recipe,
  Readonly<{ acquisition: Readonly<{ kind: 'registry' }> }>
>;

function registryRecipe(catalog: RawSchema2Catalog): RawRegistryRecipe {
  const recipe = catalog.recipes.find(
    (candidate): candidate is RawRegistryRecipe => candidate.acquisition.kind === 'registry',
  );
  if (!recipe) throw new Error('schema-2 fixture lacks registry recipe');
  return recipe;
}

function resignCatalog(catalog: RawSchema2Catalog, recipe?: RawSchema2Recipe): void {
  if (recipe) {
    const { digest: _digest, ...payload } = recipe;
    Reflect.set(recipe, 'digest', shadowDigest(payload));
  }
  const { digest: _digest, ...payload } = catalog;
  Reflect.set(catalog, 'digest', shadowDigest(payload));
}

function expectCodecFailure(value: unknown, path: string, detail: RegExp): void {
  let caught: unknown;
  try {
    decodeBuiltinShadowSubstitutionCatalog(value);
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    name: 'ShadowRegistryCodecError',
    code: 'ESHADOWREGISTRYCODEC',
    path,
    message: expect.stringMatching(detail),
  });
}

describe('builtin shadow substitution catalog contract', () => {
  it('is exactly the generated digest projection of the digest-free source', () => {
    const recipes = builtinShadowCatalogSource.recipes.map((recipe) => ({
      ...recipe,
      digest: shadowDigest(recipe),
    }));
    const payload = { ...builtinShadowCatalogSource, recipes };
    expect(builtinShadowSubstitutionCatalog).toEqual({
      ...payload,
      digest: shadowDigest(payload),
    });
  });

  it('strict-decodes the exact schema-2 catalog and both recipe siblings', () => {
    const catalog = rawSchema2Catalog();

    expect(catalog.recipes.map((recipe) => recipe.digest)).toEqual([
      '0d8bdcbf6317aa855da9cf0e8848ee081f3ece2b1b20b1d9b83a38d5bc9f4564',
      '63b1b541baa151411eba6bfab330f2d07533da560e639a2e2ccf19a6f45df555',
    ]);
    expect(catalog.digest).toBe('dda257c2f56c593fe036c24847d678d680197d306da951d864434f49120f107f');

    const decoded = decodeBuiltinShadowSubstitutionCatalog(catalog);
    expect(decoded).toEqual(catalog);
    expect(decoded.schema).toBe(2);
    expect(decoded.recipes.map((recipe) => [recipe.schema, recipe.acquisition.kind])).toEqual([
      [2, 'synthetic'],
      [2, 'registry'],
    ]);
    expect(Object.isFrozen(decoded)).toBe(true);
  });

  it('models runtime-bound esbuild and install-only lightningcss with one clone-safe recipe', () => {
    const esbuild = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'esbuild',
    );
    const lightningcss = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'lightningcss',
    );

    expect(esbuild).toMatchObject({
      trigger: { name: 'esbuild', version: '0.28.0' },
      acquisition: { kind: 'synthetic' },
      materialization: { name: 'esbuild', version: '0.28.0' },
      binding: {
        adapterId: 'rifty.runtime-adapter.esbuild.v1',
        assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
      },
    });
    expect(esbuild?.materialization.files.map((file) => file.path)).toEqual([
      'bin/esbuild',
      'lib/main.cjs',
      'package.json',
    ]);
    const esbuildPackage = JSON.parse(
      esbuild?.materialization.files.find((file) => file.path === 'package.json')?.content ?? '{}',
    ) as { bin?: Record<string, string> };
    expect(esbuildPackage.bin).toEqual({ esbuild: 'bin/esbuild' });
    expect(
      esbuild?.materialization.files.find((file) => file.path === 'bin/esbuild')?.content,
    ).toContain("new NotImplementedError('esbuild.cli')");
    expect(lightningcss).toMatchObject({
      trigger: { name: 'lightningcss', version: '1.32.0' },
      acquisition: { kind: 'registry', name: 'lightningcss-wasm', version: '1.32.0' },
      materialization: { name: 'lightningcss', version: '1.32.0' },
    });
    expect(lightningcss?.binding).toBeUndefined();
    expect(structuredClone(builtinShadowSubstitutionCatalog)).toEqual(
      builtinShadowSubstitutionCatalog,
    );
  });

  it('accepts exact-only admission at the strict recipe shape boundary', () => {
    const catalog = rawSchema2Catalog();
    const recipe = registryRecipe(catalog);
    Reflect.set(recipe.admission, 'kind', 'exact-only');
    resignCatalog(catalog, recipe);

    expectCodecFailure(catalog, 'catalog', /not the admitted builtin catalog identity/i);
  });

  it.each([
    'dependencies',
    'optionalDependencies',
    'omittedOptionalDependencies',
    'peerDependencies',
  ] as const)('accepts scoped package names in registry %s', (field) => {
    const catalog = rawSchema2Catalog();
    const recipe = registryRecipe(catalog);
    Reflect.set(recipe.acquisition.dependencyProjection[field], '@scope/package', '1.0.0');
    resignCatalog(catalog, recipe);

    expectCodecFailure(catalog, 'catalog', /not the admitted builtin catalog identity/i);
  });

  it.each([
    'dependencies',
    'optionalDependencies',
    'omittedOptionalDependencies',
    'peerDependencies',
  ] as const)('rejects invalid package names in registry %s', (field) => {
    const catalog = rawSchema2Catalog();
    const recipe = registryRecipe(catalog);
    Reflect.set(recipe.acquisition.dependencyProjection[field], 'unscoped/slash', '1.0.0');

    expectCodecFailure(
      catalog,
      `catalog.recipes[1].acquisition.dependencyProjection.${field} key`,
      /invalid string/i,
    );
  });

  it('keeps every dependency projection map independently owned', () => {
    for (const field of [
      'dependencies',
      'optionalDependencies',
      'omittedOptionalDependencies',
      'peerDependencies',
    ] as const) {
      const catalog = rawSchema2Catalog();
      const recipe = registryRecipe(catalog);
      Reflect.set(recipe.acquisition.dependencyProjection[field], 'sibling', '1.0.0');
      const collision = field === 'dependencies' ? 'peerDependencies' : 'dependencies';
      Reflect.set(recipe.acquisition.dependencyProjection[collision], 'sibling', '1.0.0');

      expectCodecFailure(
        catalog,
        'catalog.recipes[1].acquisition.dependencyProjection',
        /overlaps/i,
      );
    }
  });

  it('rejects forged identity and duplicate materialization members at ingress', () => {
    expectCodecFailure(
      { ...rawSchema2Catalog(), digest: '0'.repeat(64) },
      'catalog.digest',
      /catalog digest mismatch/i,
    );

    const duplicate = rawSchema2Catalog();
    const recipe = duplicate.recipes[0];
    if (!recipe) throw new Error('schema-2 fixture lacks a builtin recipe');
    const forged = {
      ...duplicate,
      recipes: [
        {
          ...recipe,
          materialization: {
            ...recipe.materialization,
            files: [...recipe.materialization.files, recipe.materialization.files[0]],
          },
        },
        ...duplicate.recipes.slice(1),
      ],
    };
    expectCodecFailure(forged, 'catalog.recipes[0].materialization.files', /duplicate.*file/i);
  });

  it.each([
    [
      'catalog v1 schema',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged, 'schema', 1);
        return forged;
      },
      'catalog.schema',
      /schema.*unsupported/i,
    ],
    [
      'synthetic recipe v1 schema',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!, 'schema', 1);
        return forged;
      },
      'catalog.recipes[0].schema',
      /schema.*unsupported/i,
    ],
    [
      'registry recipe v1 schema',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[1]!, 'schema', 1);
        return forged;
      },
      'catalog.recipes[1].schema',
      /schema.*unsupported/i,
    ],
    [
      'sparse catalog recipes',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged, 'recipes', new Array<unknown>(1));
        return forged;
      },
      'catalog.recipes',
      /dense/i,
    ],
    [
      'sparse synthetic materialization files',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.materialization, 'files', new Array<unknown>(1));
        return forged;
      },
      'catalog.recipes[0].materialization.files',
      /dense/i,
    ],
    [
      'unknown catalog field',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged, 'unexpected', true);
        return forged;
      },
      'catalog',
      /extra or missing fields/i,
    ],
    [
      'unknown synthetic recipe field',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!, 'unexpected', true);
        return forged;
      },
      'catalog.recipes[0]',
      /extra or missing fields/i,
    ],
    [
      'unknown registry recipe field',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[1]!, 'unexpected', true);
        return forged;
      },
      'catalog.recipes[1]',
      /extra or missing fields/i,
    ],
    [
      'unknown synthetic admission field',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.admission, 'unexpected', true);
        return forged;
      },
      'catalog.recipes[0].admission',
      /extra or missing fields/i,
    ],
    [
      'unknown registry admission field',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[1]!.admission, 'unexpected', true);
        return forged;
      },
      'catalog.recipes[1].admission',
      /extra or missing fields/i,
    ],
    [
      'missing nested admission field',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.deleteProperty(forged.recipes[0]!.admission, 'unsupportedFeature');
        return forged;
      },
      'catalog.recipes[0].admission',
      /extra or missing fields/i,
    ],
    [
      'unsupported admission policy',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.admission, 'kind', 'range-ish');
        return forged;
      },
      'catalog.recipes[0].admission.kind',
      /unsupported admission/i,
    ],
    [
      'missing dependency projection field',
      () => {
        const forged = rawSchema2Catalog();
        const recipe = registryRecipe(forged);
        Reflect.deleteProperty(
          recipe.acquisition.dependencyProjection,
          'omittedOptionalDependencies',
        );
        return forged;
      },
      'catalog.recipes[1].acquisition.dependencyProjection',
      /extra or missing fields/i,
    ],
    [
      'extra dependency projection field',
      () => {
        const forged = rawSchema2Catalog();
        const recipe = registryRecipe(forged);
        Reflect.set(recipe.acquisition.dependencyProjection, 'unexpected', {});
        return forged;
      },
      'catalog.recipes[1].acquisition.dependencyProjection',
      /extra or missing fields/i,
    ],
    [
      'overlapping dependency projection',
      () => {
        const forged = rawSchema2Catalog();
        const recipe = registryRecipe(forged);
        Reflect.set(recipe.acquisition.dependencyProjection.dependencies, 'collision', '1.0.0');
        Reflect.set(recipe.acquisition.dependencyProjection.peerDependencies, 'collision', '1.0.0');
        return forged;
      },
      'catalog.recipes[1].acquisition.dependencyProjection',
      /overlaps/i,
    ],
    [
      'invalid trigger package name',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.trigger, 'name', 'unscoped/slash');
        return forged;
      },
      'catalog.recipes[0].trigger.name',
      /invalid string/i,
    ],
    [
      'invalid synthetic materialization package name',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.materialization, 'name', 'unscoped/slash');
        return forged;
      },
      'catalog.recipes[0].materialization.name',
      /invalid string/i,
    ],
    [
      'invalid registry trigger package name',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(registryRecipe(forged).trigger, 'name', 'unscoped/slash');
        return forged;
      },
      'catalog.recipes[1].trigger.name',
      /invalid string/i,
    ],
    [
      'invalid registry acquisition package name',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(registryRecipe(forged).acquisition, 'name', 'unscoped/slash');
        return forged;
      },
      'catalog.recipes[1].acquisition.name',
      /invalid string/i,
    ],
    [
      'invalid registry materialization package name',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(registryRecipe(forged).materialization, 'name', 'unscoped/slash');
        return forged;
      },
      'catalog.recipes[1].materialization.name',
      /invalid string/i,
    ],
    [
      'invalid asset source package name',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.assets[0]!.source, 'name', 'unscoped/slash');
        return forged;
      },
      'catalog.assets[0].source.name',
      /invalid string/i,
    ],
    [
      'invalid bin command',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.materialization.bin, 'bad/command', 'bin/esbuild');
        return forged;
      },
      'catalog.recipes[0].materialization.bin.bad/command',
      /invalid command/i,
    ],
    [
      'escaping bin target',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.materialization.bin, 'esbuild', '../escape');
        return forged;
      },
      'catalog.recipes[0].materialization.bin.esbuild',
      /normalized relative path/i,
    ],
    [
      'missing bin target',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.materialization.bin, 'esbuild', 'bin/missing');
        return forged;
      },
      'catalog.recipes[0].materialization.bin.esbuild',
      /target.*missing/i,
    ],
    [
      'package manifest bin disagreement',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.materialization.bin, 'esbuild', 'lib/main.cjs');
        return forged;
      },
      'catalog.recipes[0].materialization.files.package.json.bin',
      /disagrees.*bin/i,
    ],
    [
      'forged synthetic recipe behavior digest',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.recipes[0]!.admission, 'unsupportedFeature', 'forged.feature');
        return forged;
      },
      'catalog.recipes[0].digest',
      /recipe digest mismatch/i,
    ],
    [
      'forged registry recipe behavior digest',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(
          registryRecipe(forged).acquisition.dependencyProjection,
          'unsupportedFeature',
          'forged.feature',
        );
        return forged;
      },
      'catalog.recipes[1].digest',
      /recipe digest mismatch/i,
    ],
    [
      'forged catalog behavior digest',
      () => {
        const forged = rawSchema2Catalog();
        Reflect.set(forged.assets[0]!, 'maxTarballBytes', 4_000_000);
        return forged;
      },
      'catalog.digest',
      /catalog digest mismatch/i,
    ],
  ] as const)('rejects recipe-v2 %s', (_name, value, path, expected) => {
    expectCodecFailure(value(), path, expected);
  });

  it('rejects getters, non-normal paths, invalid SRI, and recomputed foreign builtin ids', () => {
    let getterRan = false;
    for (const index of [0, 1] as const) {
      const getter = rawSchema2Catalog();
      Object.defineProperty(getter.recipes[index], 'acquisition', {
        enumerable: true,
        get() {
          getterRan = true;
          return { kind: 'synthetic' };
        },
      });
      expectCodecFailure(getter, `catalog.recipes[${index}]`, /accessor/i);
      expect(getterRan).toBe(false);
    }

    const arrayGetter = rawSchema2Catalog();
    Object.defineProperty(arrayGetter.recipes, '0', {
      enumerable: true,
      get() {
        getterRan = true;
        return rawSchema2Catalog().recipes[0];
      },
    });
    expectCodecFailure(arrayGetter, 'catalog.recipes', /data element/i);
    expect(getterRan).toBe(false);

    for (const index of [0, 1] as const) {
      for (const path of ['.', '..', 'double//slash', 'dir/..', String.raw`dir\file`]) {
        const invalid = rawSchema2Catalog();
        const recipe = invalid.recipes[index];
        if (!recipe) throw new Error(`schema-2 fixture lacks recipe ${index}`);
        Reflect.set(recipe.materialization.files[0]!, 'path', path);
        expectCodecFailure(
          invalid,
          `catalog.recipes[${index}].materialization.files[0].path`,
          /path|normalized/i,
        );
      }
    }

    const sri = rawSchema2Catalog();
    Reflect.set(sri.assets[0]!.source, 'integrity', 'sha256-YQ==');
    expectCodecFailure(sri, 'catalog.assets[0].source.integrity', /wrong-length/i);

    const foreign = rawSchema2Catalog();
    Reflect.set(foreign, 'id', 'foreign.builtin');
    resignCatalog(foreign);
    expectCodecFailure(foreign, 'catalog', /admitted builtin/i);
  });

  it('shares the fixed SHA vectors used by the esbuild contract probe', () => {
    for (const vector of sha256FixedVectors) {
      expect(
        shadowSha256(
          Uint8Array.from(vector.hex.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16)),
        ),
        vector.name,
      ).toBe(vector.sha256);
    }
  });

  it('rejects sparse, accessor, extra-field, and subclass arrays canonically', () => {
    const sparse = new Array<unknown>(2);
    expect(() => canonicalShadowJson(sparse)).toThrow(/dense/);

    let getterRan = false;
    const accessor = [1];
    Object.defineProperty(accessor, '0', {
      enumerable: true,
      get() {
        getterRan = true;
        return 1;
      },
    });
    expect(() => canonicalShadowJson(accessor)).toThrow(/data element/);
    expect(getterRan).toBe(false);

    const extra = [1] as number[] & { extra?: boolean };
    extra.extra = true;
    expect(() => canonicalShadowJson(extra)).toThrow(/extra fields/);

    class ArraySubclass<T> extends Array<T> {}
    expect(() => canonicalShadowJson(new ArraySubclass(1))).toThrow(/plain array/);
  });
});
