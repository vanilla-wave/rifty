import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { ESBUILD_ALIAS_MAIN } from '../internal/catalog-source.ts';
import { preparePackageEntryRuntime } from './entry-preparation.ts';
import { ESBUILD_RUNTIME_ADAPTER_ID, activatePackageRuntimeAdapters } from './runtime-adapters.ts';

const prior = Object.getOwnPropertyDescriptor(globalThis, '__riftyShadowRegistry');
afterEach(() => {
  if (prior) Object.defineProperty(globalThis, '__riftyShadowRegistry', prior);
  else Reflect.deleteProperty(globalThis, '__riftyShadowRegistry');
});

it.each(['missing', 'corrupt'] as const)(
  '%s adapter payload permits unrelated Node entry and fails at the actual alias consumer',
  async (fault) => {
    Reflect.deleteProperty(globalThis, '__riftyShadowRegistry');
    const fs = new MemoryFsSync();
    fs.mkdirSync('/project/node_modules/esbuild-wasm', { recursive: true });
    if (fault === 'corrupt')
      fs.writeFileSync('/project/node_modules/esbuild-wasm/esbuild.wasm', new Uint8Array([1]));
    const bindings = [
      { adapterId: ESBUILD_RUNTIME_ADAPTER_ID, packagePath: '/project/node_modules/esbuild-wasm' },
    ];
    // Explicit activation remains strict (including the no-COI toolchain API).
    await expect(
      activatePackageRuntimeAdapters({ bindings, fs, cwd: '/project' }),
    ).rejects.toThrow();
    await expect(
      preparePackageEntryRuntime({ kind: 'eval', root: '/project', runtimeBindings: bindings, fs }),
    ).resolves.toBeUndefined();
    expect(Function('return 6 * 7')()).toBe(42);
    // Execute the exact registry-owned package entry, not a test alias.
    expect(() => Function('module', ESBUILD_ALIAS_MAIN)({ exports: {} })).toThrow(
      /ENOENT|wasm size/,
    );
  },
);
