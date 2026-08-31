import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import {
  type WorkbenchRuntimeAssetClient,
  activateWorkbenchRuntimeAdapters,
} from './workbench-runtime-adapters.ts';

interface InTreeRuntimeBinding {
  readonly adapterId: string;
  readonly packagePath: string;
}

const activateInTree = activateWorkbenchRuntimeAdapters as unknown as (options: {
  readonly bindings: readonly InTreeRuntimeBinding[];
  readonly fs: MemoryFsSync;
  readonly cwd: string;
}) => Promise<void>;

const ESBUILD_IN_TREE_BINDING = Object.freeze({
  adapterId: 'rifty.runtime-adapter.esbuild.v1',
  packagePath: '/workspace/node_modules/esbuild-wasm',
});

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

describe('Workbench in-tree runtime adapter dispatch', () => {
  it('does no VFS or compile work when the admitted tree has no binding', async () => {
    const fs = new MemoryFsSync();
    const read = vi.spyOn(fs, 'readFileBytesSync');
    const compile = vi.spyOn(WebAssembly, 'compile');

    await activateInTree({ bindings: [], fs, cwd: '/workspace' });

    expect(read).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects unknown and duplicate adapter ids before reading the tree', async () => {
    const cases = [
      {
        bindings: [{ adapterId: 'rifty.runtime-adapter.forged.v1', packagePath: '/forged' }],
        message: 'runtime-adapter.rifty.runtime-adapter.forged.v1',
      },
      {
        bindings: [ESBUILD_IN_TREE_BINDING, ESBUILD_IN_TREE_BINDING],
        message: 'duplicate admitted runtime adapter: rifty.runtime-adapter.esbuild.v1',
      },
    ] as const;
    for (const { bindings, message } of cases) {
      const fs = new MemoryFsSync();
      const read = vi.spyOn(fs, 'readFileBytesSync');
      await expect(activateInTree({ bindings, fs, cwd: '/workspace' })).rejects.toThrow(message);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('loud-fails a missing admitted package member before compile', async () => {
    const fs = new MemoryFsSync();
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateInTree({ bindings: [ESBUILD_IN_TREE_BINDING], fs, cwd: '/workspace' }),
    ).rejects.toThrow(/esbuild\.wasm/u);

    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects a wrong-size member before compile', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync(ESBUILD_IN_TREE_BINDING.packagePath, { recursive: true });
    fs.writeFileSync(
      `${ESBUILD_IN_TREE_BINDING.packagePath}/esbuild.wasm`,
      new Uint8Array([0, 97, 115, 109]),
    );
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateInTree({ bindings: [ESBUILD_IN_TREE_BINDING], fs, cwd: '/workspace' }),
    ).rejects.toThrow(/size|13.?918.?738/u);
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects forged package paths before reading the tree', async () => {
    for (const packagePath of [
      '/forged/node_modules/esbuild-wasm',
      '/workspace/node_modules/not-esbuild-wasm',
    ]) {
      const fs = new MemoryFsSync();
      const read = vi.spyOn(fs, 'readFileBytesSync');
      await expect(
        activateInTree({
          bindings: [{ ...ESBUILD_IN_TREE_BINDING, packagePath }],
          fs,
          cwd: '/workspace',
        }),
      ).rejects.toThrow(/packagePath|esbuild-wasm|runtime-adapter/u);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('rejects exact-size but wrong-digest bytes before compile', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync(ESBUILD_IN_TREE_BINDING.packagePath, { recursive: true });
    fs.writeFileSync(
      `${ESBUILD_IN_TREE_BINDING.packagePath}/esbuild.wasm`,
      new Uint8Array(13_918_738),
    );
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateInTree({ bindings: [ESBUILD_IN_TREE_BINDING], fs, cwd: '/workspace' }),
    ).rejects.toThrow(/digest|sha/u);
    expect(compile).not.toHaveBeenCalled();
  });
});
