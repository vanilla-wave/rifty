import { builtinShadowAssetCatalog } from '@riftydev/shadow-registry';
import { describe, expect, it } from 'vitest';
import { closureHashOf } from './closure-hash.ts';
import { type Lockfile, RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL } from './linker.ts';

function lf(packages: Lockfile['packages']): Lockfile {
  return { name: 'r', version: '0.0.0', lockfileVersion: 3, requires: true, packages };
}

describe('closureHashOf', () => {
  it('is identical for the same closure regardless of package key order', async () => {
    const a = lf({
      '': { version: '0.0.0', dependencies: { x: '1.0.0', y: '2.0.0' } },
      'node_modules/x': { version: '1.0.0', integrity: 'sha512-x' },
      'node_modules/y': { version: '2.0.0', integrity: 'sha512-y' },
    });
    const b = lf({
      'node_modules/y': { version: '2.0.0', integrity: 'sha512-y' },
      'node_modules/x': { version: '1.0.0', integrity: 'sha512-x' },
      '': { version: '0.0.0', dependencies: { x: '1.0.0', y: '2.0.0' } },
    });
    expect(await closureHashOf(a)).toBe(await closureHashOf(b));
  });

  it('is identical regardless of NESTED record key order (dependencies/bin/peerDependencies)', async () => {
    // Regression (round 8): only the top-level package keys were sorted; the
    // entry objects were stringified raw, so the same resolved closure with a
    // different `dependencies` insertion order hashed differently — duplicate
    // immutable objects + cache misses for one closure.
    const a = lf({
      'node_modules/x': {
        version: '1.0.0',
        integrity: 'sha512-x',
        dependencies: { p: '1.0.0', q: '2.0.0' },
        bin: { one: 'a.js', two: 'b.js' },
        peerDependencies: { r: '^3' },
      },
    });
    const b = lf({
      'node_modules/x': {
        peerDependencies: { r: '^3' },
        bin: { two: 'b.js', one: 'a.js' },
        dependencies: { q: '2.0.0', p: '1.0.0' },
        integrity: 'sha512-x',
        version: '1.0.0',
      },
    });
    expect(await closureHashOf(a)).toBe(await closureHashOf(b));
  });

  it('differs when a NESTED value (not just order) changes', async () => {
    const a = lf({
      'node_modules/x': { version: '1.0.0', dependencies: { p: '1.0.0' } },
    });
    const b = lf({
      'node_modules/x': { version: '1.0.0', dependencies: { p: '1.0.1' } },
    });
    expect(await closureHashOf(a)).not.toBe(await closureHashOf(b));
  });

  it('differs when any pinned integrity differs', async () => {
    const a = lf({ 'node_modules/x': { version: '1.0.0', integrity: 'sha512-x' } });
    const b = lf({ 'node_modules/x': { version: '1.0.0', integrity: 'sha512-DIFFERENT' } });
    expect(await closureHashOf(a)).not.toBe(await closureHashOf(b));
  });

  it('differs for the same package tree when exact applied-substitution facts differ', async () => {
    const packages: Lockfile['packages'] = {
      '': { version: '0.0.0' },
      'node_modules/@esbuild/wasi-preview1': {
        version: '0.28.0',
        integrity: 'sha512-same-tree',
      },
    };
    const empty: Lockfile = {
      ...lf(packages),
      rifty: {
        shadowSubstitutions: {
          protocol: RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL,
          applied: [],
        },
      },
    };
    const applied: Lockfile = {
      ...lf(packages),
      rifty: {
        shadowSubstitutions: {
          protocol: RIFTY_LOCKFILE_SHADOW_SUBSTITUTIONS_PROTOCOL,
          applied: [
            {
              catalog: {
                id: builtinShadowAssetCatalog.id,
                digest: builtinShadowAssetCatalog.digest,
              },
              publicName: 'esbuild',
              requestedRange: '^0.28.0',
              resolvedPublicVersion: '0.28.0',
              substitutionId: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
              runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
              builtin: true,
            },
          ],
        },
      },
    };

    expect(await closureHashOf(empty)).not.toBe(await closureHashOf(applied));
  });

  it('emits the `sha256-<base64>` shape (byte-matches Node digest(base64))', async () => {
    const hash = await closureHashOf(lf({ 'node_modules/x': { version: '1.0.0' } }));
    expect(hash).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
  });
});
