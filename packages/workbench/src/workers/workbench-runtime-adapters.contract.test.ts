import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it, vi } from 'vitest';
import { activateWorkbenchRuntimeAdapters } from './workbench-runtime-adapters.ts';

const ESBUILD_BINDING = Object.freeze({
  adapterId: 'rifty.runtime-adapter.esbuild.v1',
  packagePath: '/workspace/node_modules/esbuild-wasm',
});
const requireFromRegistry = createRequire(
  new URL('../../../../tools/shadow-registry/package.json', import.meta.url),
);
const exactEsbuildWasm = new Uint8Array(
  readFileSync(requireFromRegistry.resolve('esbuild-wasm/esbuild.wasm')),
);

describe('Workbench in-tree runtime adapter dispatch', () => {
  it('does no VFS or compile work when the admitted tree has no binding', async () => {
    const fs = new MemoryFsSync();
    const read = vi.spyOn(fs, 'readFileBytesSync');
    const compile = vi.spyOn(WebAssembly, 'compile');

    await activateWorkbenchRuntimeAdapters({ bindings: [], fs, cwd: '/workspace' });

    expect(read).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects unknown and duplicate adapter ids before reading the tree', async () => {
    const cases = [
      [{ adapterId: 'rifty.runtime-adapter.forged.v1', packagePath: '/forged' }],
      [ESBUILD_BINDING, ESBUILD_BINDING],
    ] as const;
    for (const bindings of cases) {
      const fs = new MemoryFsSync();
      const read = vi.spyOn(fs, 'readFileBytesSync');
      await expect(
        activateWorkbenchRuntimeAdapters({ bindings, fs, cwd: '/workspace' }),
      ).rejects.toThrow(/runtime-adapter|duplicate/u);
      expect(read).not.toHaveBeenCalled();
    }
  });

  it('loud-fails a missing admitted package member before compile', async () => {
    const fs = new MemoryFsSync();
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateWorkbenchRuntimeAdapters({
        bindings: [ESBUILD_BINDING],
        fs,
        cwd: '/workspace',
      }),
    ).rejects.toThrow(/esbuild\.wasm|runtime-adapter/u);

    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects a wrong-size member before digest or compile', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync(ESBUILD_BINDING.packagePath, { recursive: true });
    fs.writeFileSync(
      `${ESBUILD_BINDING.packagePath}/esbuild.wasm`,
      new Uint8Array([0, 97, 115, 109]),
    );
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateWorkbenchRuntimeAdapters({ bindings: [ESBUILD_BINDING], fs, cwd: '/workspace' }),
    ).rejects.toThrow(/size|13.?918.?738/u);
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects a valid member at a non-ancestor forged absolute package path', async () => {
    const fs = new MemoryFsSync();
    const forged = {
      adapterId: ESBUILD_BINDING.adapterId,
      packagePath: '/forged/node_modules/esbuild-wasm',
    } as const;
    fs.mkdirSync(forged.packagePath, { recursive: true });
    fs.writeFileSync(`${forged.packagePath}/esbuild.wasm`, exactEsbuildWasm);
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateWorkbenchRuntimeAdapters({ bindings: [forged], fs, cwd: '/workspace' }),
    ).rejects.toThrow(/packagePath|ancestor|runtime-adapter/u);
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects an exact member at a normalized in-root sibling path before reading it', async () => {
    const fs = new MemoryFsSync();
    const forged = {
      adapterId: ESBUILD_BINDING.adapterId,
      packagePath: '/workspace/node_modules/not-esbuild-wasm',
    } as const;
    fs.mkdirSync(forged.packagePath, { recursive: true });
    fs.writeFileSync(`${forged.packagePath}/esbuild.wasm`, exactEsbuildWasm);
    const read = vi.spyOn(fs, 'readFileBytesSync');
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateWorkbenchRuntimeAdapters({ bindings: [forged], fs, cwd: '/workspace' }),
    ).rejects.toThrow(/packagePath|esbuild-wasm|runtime-adapter/u);
    expect(read).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects an exact member at a descendant exact-leaf path before reading it', async () => {
    const fs = new MemoryFsSync();
    const forged = {
      adapterId: ESBUILD_BINDING.adapterId,
      packagePath: '/workspace/forged/node_modules/esbuild-wasm',
    } as const;
    fs.mkdirSync(forged.packagePath, { recursive: true });
    fs.writeFileSync(`${forged.packagePath}/esbuild.wasm`, exactEsbuildWasm);
    const read = vi.spyOn(fs, 'readFileBytesSync');
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateWorkbenchRuntimeAdapters({ bindings: [forged], fs, cwd: '/workspace' }),
    ).rejects.toThrow(/packagePath|ancestor|runtime-adapter/u);
    expect(read).not.toHaveBeenCalled();
    expect(compile).not.toHaveBeenCalled();
  });

  it('rejects exact-size but wrong-digest bytes before compile', async () => {
    const fs = new MemoryFsSync();
    fs.mkdirSync(ESBUILD_BINDING.packagePath, { recursive: true });
    fs.writeFileSync(`${ESBUILD_BINDING.packagePath}/esbuild.wasm`, new Uint8Array(13_918_738));
    const compile = vi.spyOn(WebAssembly, 'compile');

    await expect(
      activateWorkbenchRuntimeAdapters({
        bindings: [ESBUILD_BINDING],
        fs,
        cwd: '/workspace',
      }),
    ).rejects.toThrow(/digest|sha|runtime-adapter/u);

    expect(compile).not.toHaveBeenCalled();
  });
});
