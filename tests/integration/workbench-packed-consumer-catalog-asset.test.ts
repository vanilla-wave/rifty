import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDeclaredCatalogAsset } from './workbench-packed-consumer-catalog-asset.mjs';

const integrity = `sha512-${'A'.repeat(88)}`;

async function fixture(options: { declaredVersion?: string; installedVersion?: string }) {
  const root = await mkdtemp(resolve(tmpdir(), 'rifty-packed-catalog-asset-'));
  const producerRoot = resolve(root, 'tools/shadow-registry');
  const installedRoot = resolve(root, 'node_modules/esbuild-wasm');
  await mkdir(producerRoot, { recursive: true });
  await mkdir(installedRoot, { recursive: true });
  await writeFile(
    resolve(producerRoot, 'package.json'),
    JSON.stringify({
      name: '@riftydev/shadow-registry',
      devDependencies:
        options.declaredVersion === undefined ? {} : { 'esbuild-wasm': options.declaredVersion },
    }),
  );
  await writeFile(
    resolve(installedRoot, 'package.json'),
    JSON.stringify({ name: 'esbuild-wasm', version: options.installedVersion ?? '0.28.0' }),
  );
  return { root, producerRoot, installedRoot };
}

describe('packed Workbench catalog asset source', () => {
  it('resolves only the producer-declared exact installed catalog package', async () => {
    const files = await fixture({ declaredVersion: '0.28.0' });
    try {
      await expect(
        resolveDeclaredCatalogAsset({
          producerRoot: files.producerRoot,
          name: 'esbuild-wasm',
          version: '0.28.0',
          integrity,
        }),
      ).resolves.toEqual({
        dir: await realpath(files.installedRoot),
        manifest: { name: 'esbuild-wasm', version: '0.28.0' },
        expectedIntegrity: integrity,
      });
    } finally {
      await rm(files.root, { recursive: true, force: true });
    }
  });

  it('rejects an ambient package absent from the catalog producer manifest', async () => {
    const files = await fixture({});
    try {
      await expect(
        resolveDeclaredCatalogAsset({
          producerRoot: files.producerRoot,
          name: 'esbuild-wasm',
          version: '0.28.0',
          integrity,
        }),
      ).rejects.toThrow('must declare exact esbuild-wasm@0.28.0');
    } finally {
      await rm(files.root, { recursive: true, force: true });
    }
  });

  it('rejects installed bytes from a different package version', async () => {
    const files = await fixture({ declaredVersion: '0.28.0', installedVersion: '0.27.0' });
    try {
      await expect(
        resolveDeclaredCatalogAsset({
          producerRoot: files.producerRoot,
          name: 'esbuild-wasm',
          version: '0.28.0',
          integrity,
        }),
      ).rejects.toThrow('expected esbuild-wasm@0.28.0, got esbuild-wasm@0.27.0');
    } finally {
      await rm(files.root, { recursive: true, force: true });
    }
  });
});
