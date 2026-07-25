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
    expect(esbuildPackage.bin).toEqual({ esbuild: './bin/esbuild' });
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
    expect(() => decodeBuiltinShadowSubstitutionCatalog(forged)).toThrow(/duplicate.*file/i);
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
    expect(() => decodeBuiltinShadowSubstitutionCatalog(arrayGetter)).toThrow(/data element/i);
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
