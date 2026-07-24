import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type WorkbenchRuntimeAssetClient,
  activateWorkbenchRuntimeAdapters,
} from './workbench-runtime-adapters.ts';

function client(
  bindings: readonly { readonly adapterId: string; readonly assets: readonly string[] }[],
): WorkbenchRuntimeAssetClient {
  return {
    ready: Promise.resolve({ bindings }),
    read: vi.fn(async () => new Uint8Array([0, 97, 115, 109])),
    dispose: vi.fn(),
  };
}

function esbuildBindings() {
  return [
    {
      adapterId: 'rifty.runtime-adapter.esbuild.v1',
      assets: ['esbuild-wasm@0.28.0/package/esbuild.wasm'],
    },
  ] as const;
}

describe('Workbench runtime adapter dispatch', () => {
  it('rejects an unregistered admitted adapter before reading assets and still disposes', async () => {
    const assets = client([{ adapterId: 'rifty.runtime-adapter.forged.v1', assets: [] }]);

    await expect(
      activateWorkbenchRuntimeAdapters({
        assets,
        fs: new MemoryFsSync(),
        cwd: '/workspace',
      }),
    ).rejects.toThrow('runtime-adapter.rifty.runtime-adapter.forged.v1');

    expect(assets.read).not.toHaveBeenCalled();
    expect(assets.dispose).toHaveBeenCalledOnce();
  });

  it('rejects a mismatched esbuild asset set before startup', async () => {
    const binding = esbuildBindings()[0];
    if (binding === undefined) throw new Error('esbuild recipe has no runtime binding');
    const assets = client([
      {
        adapterId: binding.adapterId,
        assets: ['esbuild-wasm@0.28.0/package/not-esbuild.wasm'],
      },
    ]);
    await expect(
      activateWorkbenchRuntimeAdapters({
        assets,
        fs: new MemoryFsSync(),
        cwd: '/workspace',
      }),
    ).rejects.toThrow('runtime-adapter.esbuild.assets');

    expect(assets.read).not.toHaveBeenCalled();
    expect(assets.dispose).toHaveBeenCalledOnce();
  });
});
