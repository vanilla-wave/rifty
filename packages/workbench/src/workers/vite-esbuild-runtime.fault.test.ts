import { ShadowAssetReadError, type ShadowAssetRuntimeReader } from '@riftydev/npm-client';
import { readRuntimeEsbuild } from '@riftydev/runtime-js';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';

const packageRoot = '/workspace/node_modules/vite';
const ESBUILD_ASSET_ID = 'esbuild-wasm@0.28.0/package/esbuild.wasm';

function exactViteFs(version = '7.3.6'): MemoryFsSync {
  const fs = new MemoryFsSync();
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    `${packageRoot}/package.json`,
    new TextEncoder().encode(JSON.stringify({ name: 'vite', version })),
  );
  return fs;
}

async function prepare(
  shadowAssets: ShadowAssetRuntimeReader | undefined,
  decision: 'start' | 'skip-rolldown' = 'start',
): Promise<void> {
  const runtime = await import('./vite-esbuild-runtime.ts');
  await runtime.prepareViteEsbuildRuntime({
    fs: exactViteFs(),
    cwd: '/workspace',
    decision,
    ...(shadowAssets === undefined ? {} : { shadowAssets }),
  });
}

afterEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
});

describe('Vite esbuild capability fault matrix', () => {
  it('preserves the typed wrong-plan failure and never consults host fetch', async () => {
    const failure = new ShadowAssetReadError({
      message: 'wrong exact plan',
      assetId: ESBUILD_ASSET_ID,
      reason: 'unknown-asset',
    });
    const readVerified = vi.fn(() => Promise.reject(failure));
    const fetch = vi.spyOn(globalThis, 'fetch');

    await expect(prepare({ readVerified })).rejects.toBe(failure);
    expect(readVerified).toHaveBeenCalledWith(ESBUILD_ASSET_ID);
    expect(fetch).not.toHaveBeenCalled();
    expect(readRuntimeEsbuild()).toBeNull();
  });

  it('loud-throws when a Vite 7 caller supplies no verified reader', async () => {
    const failure = await prepare(undefined).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({
      name: 'NotImplementedError',
      feature: 'vite.esbuild.shadowAssets',
    });
    expect(readRuntimeEsbuild()).toBeNull();
  });

  it('does not read a supplied capability for the Vite 8 Rolldown decision', async () => {
    const readVerified = vi.fn(() => Promise.reject(new Error('must not read')));

    await expect(prepare({ readVerified }, 'skip-rolldown')).resolves.toBeUndefined();
    expect(readVerified).not.toHaveBeenCalled();
    expect(readRuntimeEsbuild()).toBeNull();
  });

  it('does not retry a failed verified read inside one Worker realm', async () => {
    const failure = new Error('capability peer closed');
    const readVerified = vi.fn(() => Promise.reject(failure));
    const reader = { readVerified };

    await expect(prepare(reader)).rejects.toBe(failure);
    await expect(prepare(reader)).rejects.toBe(failure);
    expect(readVerified).toHaveBeenCalledTimes(1);
    expect(readRuntimeEsbuild()).toBeNull();
  });
});
