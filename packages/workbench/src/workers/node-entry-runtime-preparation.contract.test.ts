import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareNodeEntryRuntime } from './node-entry-runtime-preparation.ts';

const previousRuntimeRoot = Object.getOwnPropertyDescriptor(globalThis, '__riftyShadowRegistry');

afterEach(() => {
  if (previousRuntimeRoot === undefined) Reflect.deleteProperty(globalThis, '__riftyShadowRegistry');
  else Object.defineProperty(globalThis, '__riftyShadowRegistry', previousRuntimeRoot);
});

describe('node-entry runtime preparation', () => {
  it('does not read adapter files for an admitted empty binding set', async () => {
    const fs = new MemoryFsSync();
    const read = vi.spyOn(fs, 'readFileBytesSync');

    await prepareNodeEntryRuntime({
      bin: false,
      args: [],
      entryPath: '/workspace/direct.cjs',
      root: '/workspace',
      runtimeBindings: [],
      fs,
    });

    expect(read).not.toHaveBeenCalled();
  });

  it('rejects a forged bootstrap binding before guest import can begin', async () => {
    const fs = new MemoryFsSync();
    const read = vi.spyOn(fs, 'readFileBytesSync');

    await expect(
      prepareNodeEntryRuntime({
        bin: false,
        args: [],
        entryPath: '/workspace/direct.cjs',
        root: '/workspace',
        runtimeBindings: [
          { adapterId: 'rifty.runtime-adapter.forged.v1', packagePath: '/workspace/forged' },
        ],
        fs,
      }),
    ).rejects.toThrow(/runtime-adapter/u);

    expect(read).not.toHaveBeenCalled();
  });
});
