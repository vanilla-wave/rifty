import { describe, expect, it } from 'vitest';
import { builtinShadowCatalogSource } from './catalog-source.ts';
import { decodeBuiltinShadowSubstitutionCatalog } from './codec.ts';
import {
  builtinShadowSubstitutionCatalog,
  canonicalShadowJson,
  shadowDigest,
  shadowSha256,
} from './index.ts';
import type { BuiltinShadowSubstitutionCatalog } from './model.ts';
import sha256FixedVectors from './sha256-fixed-vectors.json';

function recordAt(value: unknown, path: readonly PropertyKey[]): Record<PropertyKey, unknown> {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object') {
      throw new Error(`test fixture path ${path.map(String).join('.')} is not an object`);
    }
    current = Reflect.get(current, key);
  }
  if (current === null || typeof current !== 'object') {
    throw new Error(`test fixture path ${path.map(String).join('.')} is not an object`);
  }
  return current as Record<PropertyKey, unknown>;
}

function resignCatalog(catalog: BuiltinShadowSubstitutionCatalog): void {
  for (const recipe of catalog.recipes) {
    const record = recipe as unknown as Record<string, unknown>;
    const { digest: _digest, ...payload } = record;
    Reflect.set(record, 'digest', shadowDigest(payload));
  }
  const record = catalog as unknown as Record<string, unknown>;
  const { digest: _digest, ...payload } = record;
  Reflect.set(record, 'digest', shadowDigest(payload));
}

function mutateMaterializationFile(
  catalog: BuiltinShadowSubstitutionCatalog,
  recipeIndex: number,
  path: string,
): void {
  const files = recordAt(catalog, ['recipes', recipeIndex, 'materialization']).files;
  if (!Array.isArray(files)) throw new Error('sass materialization files are missing');
  const file = files.find(
    (candidate) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      Reflect.get(candidate, 'path') === path,
  );
  if (!file) throw new Error(`sass materialization file ${path} is missing`);
  const current = String(Reflect.get(file, 'content'));
  const content =
    path === 'package.json'
      ? JSON.stringify({
          ...(JSON.parse(current) as Record<string, unknown>),
          description: 'drift',
        })
      : `${current}\n// drift`;
  Reflect.set(file, 'content', content);
  Reflect.set(file, 'bytes', new TextEncoder().encode(content).byteLength);
  Reflect.set(file, 'sha256', shadowSha256(content));
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

  it('models runtime-bound esbuild and install-only lightningcss with one clone-safe recipe', () => {
    const esbuild = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'esbuild',
    );
    const lightningcss = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'lightningcss',
    );

    expect(esbuild).toMatchObject({
      schema: 2,
      id: 'rifty.shadow-substitution.esbuild.v2',
      trigger: { name: 'esbuild', version: '0.28.0' },
      admission: { kind: 'semver-admits', unsupportedFeature: 'esbuild.version' },
      acquisition: { kind: 'synthetic' },
      materialization: {
        name: 'esbuild',
        version: '0.28.0',
        bin: { esbuild: 'bin/esbuild' },
      },
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
    expect(esbuildPackage.bin).toEqual({ esbuild: './bin/esbuild' });
    expect(
      esbuild?.materialization.files.find((file) => file.path === 'bin/esbuild')?.content,
    ).toContain("new NotImplementedError('esbuild.cli')");
    expect(lightningcss).toMatchObject({
      schema: 2,
      id: 'rifty.shadow-substitution.lightningcss.v2',
      trigger: { name: 'lightningcss', version: '1.32.0' },
      admission: { kind: 'semver-admits', unsupportedFeature: 'lightningcss.version' },
      acquisition: {
        kind: 'registry',
        name: 'lightningcss-wasm',
        version: '1.32.0',
        dependencyProjection: {
          dependencies: { 'napi-wasm': '^1.0.1' },
          optionalDependencies: {},
          omittedOptionalDependencies: {},
          peerDependencies: {},
          bundledDependencies: ['napi-wasm'],
          unsupportedFeature: 'lightningcss.acquisition',
        },
      },
      materialization: { name: 'lightningcss', version: '1.32.0', bin: {} },
    });
    expect(lightningcss?.binding).toBeUndefined();
    expect(structuredClone(builtinShadowSubstitutionCatalog)).toEqual(
      builtinShadowSubstitutionCatalog,
    );
  });

  it('owns the exact install-only sass-embedded facade over the official Sass projection', () => {
    const sass = builtinShadowSubstitutionCatalog.recipes.find(
      (recipe) => recipe.trigger.name === 'sass-embedded',
    );
    if (!sass) throw new Error('builtin sass-embedded recipe is missing');

    expect(sass).toMatchObject({
      schema: 2,
      id: 'rifty.shadow-substitution.sass-embedded.v2',
      trigger: { name: 'sass-embedded', version: '1.100.0' },
      admission: { kind: 'exact-only', unsupportedFeature: 'sass-embedded.version' },
      acquisition: {
        kind: 'registry',
        name: 'sass',
        version: '1.100.0',
        dependencyProjection: {
          dependencies: {
            chokidar: '^5.0.0',
            immutable: '^5.1.5',
            'source-map-js': '>=0.6.2 <2.0.0',
          },
          optionalDependencies: {},
          omittedOptionalDependencies: { '@parcel/watcher': '^2.4.1' },
          peerDependencies: {},
          bundledDependencies: [],
          unsupportedFeature: 'sass-embedded.acquisition',
        },
      },
      materialization: {
        name: 'sass-embedded',
        version: '1.100.0',
        bin: { sass: 'dist/bin/sass.js' },
      },
    });
    expect(sass.binding).toBeUndefined();
    expect(sass.materialization.files.map((file) => file.path)).toEqual([
      'dist/bin/sass.js',
      'dist/lib/index.js',
      'dist/lib/index.mjs',
      'package.json',
    ]);

    const manifestFile = sass.materialization.files.find((file) => file.path === 'package.json');
    if (!manifestFile) throw new Error('sass-embedded facade manifest is missing');
    const manifest = JSON.parse(manifestFile.content) as Readonly<Record<string, unknown>>;
    expect(manifest).toEqual({
      name: 'sass-embedded',
      version: '1.100.0',
      main: 'dist/lib/index.js',
      exports: {
        import: { default: './dist/lib/index.mjs' },
        default: './dist/lib/index.js',
      },
      bin: { sass: 'dist/bin/sass.js' },
    });
    const paths = new Set(sass.materialization.files.map((file) => file.path));
    expect(paths.has('dist/lib/index.js')).toBe(true);
    expect(paths.has('dist/lib/index.mjs')).toBe(true);
    expect(paths.has('dist/bin/sass.js')).toBe(true);
  });

  it('rejects forged identity and duplicate materialization members at ingress', () => {
    expect(() =>
      decodeBuiltinShadowSubstitutionCatalog({
        ...structuredClone(builtinShadowSubstitutionCatalog),
        digest: '0'.repeat(64),
      }),
    ).toThrow(/digest/i);

    const duplicate = structuredClone(builtinShadowSubstitutionCatalog);
    const recipe = duplicate.recipes[0];
    if (!recipe) throw new Error('test fixture lacks a builtin recipe');
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
    expect(() => decodeBuiltinShadowSubstitutionCatalog(forged)).toThrow(/duplicate path/i);
  });

  it('rejects every re-signed Sass policy or materialization mutation at builtin ingress', () => {
    const baseline = structuredClone(builtinShadowSubstitutionCatalog);
    const sassIndex = baseline.recipes.findIndex(
      (recipe) => recipe.trigger.name === 'sass-embedded',
    );
    if (sassIndex === -1) throw new Error('builtin sass-embedded recipe is missing');

    const cases: readonly Readonly<{
      label: string;
      mutate: (catalog: BuiltinShadowSubstitutionCatalog, recipeIndex: number) => void;
    }>[] = [
      {
        label: 'admission kind',
        mutate(catalog, recipeIndex) {
          Reflect.set(
            recordAt(catalog, ['recipes', recipeIndex, 'admission']),
            'kind',
            'semver-admits',
          );
        },
      },
      {
        label: 'required dependencies',
        mutate(catalog, recipeIndex) {
          Reflect.set(
            recordAt(catalog, [
              'recipes',
              recipeIndex,
              'acquisition',
              'dependencyProjection',
              'dependencies',
            ]),
            'immutable',
            '^6.0.0',
          );
        },
      },
      {
        label: 'retained optional dependencies',
        mutate(catalog, recipeIndex) {
          const projection = recordAt(catalog, [
            'recipes',
            recipeIndex,
            'acquisition',
            'dependencyProjection',
          ]);
          Reflect.set(recordAt(projection, ['optionalDependencies']), '@parcel/watcher', '^2.4.1');
          Reflect.deleteProperty(
            recordAt(projection, ['omittedOptionalDependencies']),
            '@parcel/watcher',
          );
        },
      },
      {
        label: 'omitted optional dependencies',
        mutate(catalog, recipeIndex) {
          Reflect.set(
            recordAt(catalog, [
              'recipes',
              recipeIndex,
              'acquisition',
              'dependencyProjection',
              'omittedOptionalDependencies',
            ]),
            '@parcel/watcher',
            '^3.0.0',
          );
        },
      },
      {
        label: 'peer dependencies',
        mutate(catalog, recipeIndex) {
          Reflect.set(
            recordAt(catalog, [
              'recipes',
              recipeIndex,
              'acquisition',
              'dependencyProjection',
              'peerDependencies',
            ]),
            'unexpected-peer',
            '^1.0.0',
          );
        },
      },
      {
        label: 'bundled dependencies',
        mutate(catalog, recipeIndex) {
          const projection = recordAt(catalog, [
            'recipes',
            recipeIndex,
            'acquisition',
            'dependencyProjection',
          ]);
          Reflect.set(projection, 'bundledDependencies', ['chokidar']);
        },
      },
      ...(
        ['dist/bin/sass.js', 'dist/lib/index.js', 'dist/lib/index.mjs', 'package.json'] as const
      ).map((path) => ({
        label: `${path} bytes`,
        mutate(catalog: BuiltinShadowSubstitutionCatalog, recipeIndex: number) {
          mutateMaterializationFile(catalog, recipeIndex, path);
        },
      })),
      {
        label: 'bin target',
        mutate(catalog, recipeIndex) {
          Reflect.set(
            recordAt(catalog, ['recipes', recipeIndex, 'materialization', 'bin']),
            'sass',
            'dist/bin/missing.js',
          );
        },
      },
      {
        label: 'runtime binding',
        mutate(catalog, recipeIndex) {
          Reflect.set(recordAt(catalog, ['recipes', recipeIndex]), 'binding', {
            adapterId: 'rifty.runtime-adapter.esbuild.v1',
            assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
          });
        },
      },
    ];

    for (const mutation of cases) {
      const forged = structuredClone(baseline);
      mutation.mutate(forged, sassIndex);
      resignCatalog(forged);
      expect(() => decodeBuiltinShadowSubstitutionCatalog(forged), mutation.label).toThrow();
    }
  });

  it('rejects getters, non-normal paths, invalid SRI, and recomputed foreign builtin ids', () => {
    let getterRan = false;
    const getter = structuredClone(builtinShadowSubstitutionCatalog);
    Object.defineProperty(getter.recipes[0]!, 'acquisition', {
      enumerable: true,
      get() {
        getterRan = true;
        return { kind: 'synthetic' };
      },
    });
    expect(() => decodeBuiltinShadowSubstitutionCatalog(getter)).toThrow(/accessor/i);
    expect(getterRan).toBe(false);
    const arrayGetter = structuredClone(builtinShadowSubstitutionCatalog);
    Object.defineProperty(arrayGetter.recipes, '0', {
      enumerable: true,
      get() {
        getterRan = true;
        return getter.recipes[0];
      },
    });
    expect(() => decodeBuiltinShadowSubstitutionCatalog(arrayGetter)).toThrow(
      /element 0 must be a data property/i,
    );
    expect(getterRan).toBe(false);

    for (const path of ['.', '..', 'double//slash', 'dir/..', String.raw`dir\file`]) {
      const invalid = structuredClone(builtinShadowSubstitutionCatalog);
      Reflect.set(invalid.recipes[0]!.materialization.files[0]!, 'path', path);
      expect(() => decodeBuiltinShadowSubstitutionCatalog(invalid)).toThrow(/path|normalized/i);
    }

    const sri = structuredClone(builtinShadowSubstitutionCatalog);
    Reflect.set(sri.assets[0]!.source, 'integrity', 'sha256-YQ==');
    expect(() => decodeBuiltinShadowSubstitutionCatalog(sri)).toThrow(/wrong-length/i);

    const foreign = structuredClone(builtinShadowSubstitutionCatalog);
    Reflect.set(foreign, 'id', 'foreign.builtin');
    const { digest: _oldDigest, ...foreignPayload } = foreign;
    Reflect.set(foreign, 'digest', shadowDigest(foreignPayload));
    expect(() => decodeBuiltinShadowSubstitutionCatalog(foreign)).toThrow(/admitted builtin/i);
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
