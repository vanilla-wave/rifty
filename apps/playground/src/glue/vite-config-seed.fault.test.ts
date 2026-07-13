import { describe, expect, it } from 'vitest';
import {
  type ViteConfigSeedStore,
  claimViteConfigSeed,
  viteConfigSeedClaimPath,
} from './vite-config-seed.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();
const root = '/scratch';
const config = '/scratch/vite.config.js';
const seed = 'export default {};';
const starter = { id: 'real-vite', seedFiles: { [config]: seed } };
const marker = viteConfigSeedClaimPath(root);

function faultStore(failPersistOnce: string): ViteConfigSeedStore & {
  readonly files: Map<string, string>;
  failed: boolean;
} {
  const files = new Map<string, string>();
  let lastWrite = '';
  return {
    files,
    failed: false,
    async read(path) {
      const value = files.get(path);
      return value === undefined ? null : enc.encode(value);
    },
    async write(path, data) {
      lastWrite = path;
      files.set(path, dec.decode(data));
    },
    async flush() {
      if (!this.failed && lastWrite === failPersistOnce) {
        this.failed = true;
        throw new Error(`persist failed: ${lastWrite}`);
      }
    },
  };
}

describe('Vite config seed claim fault matrix', () => {
  it('config persist failure writes no claim; retry heals exact config first', async () => {
    const store = faultStore(config);
    await expect(claimViteConfigSeed(root, store, starter)).rejects.toThrow(/persist failed/);
    expect(store.files.get(config)).toBe(seed);
    expect(store.files.has(marker)).toBe(false);

    await expect(claimViteConfigSeed(root, store, starter)).resolves.toBe(false);
    expect(store.files.has(marker)).toBe(true);
  });

  it('claim persist failure is loud; retry rewrites and drains the claim', async () => {
    const store = faultStore(marker);
    await expect(claimViteConfigSeed(root, store, starter)).rejects.toThrow(/persist failed/);
    expect(store.files.get(config)).toBe(seed);
    expect(store.files.has(marker)).toBe(true);

    await expect(claimViteConfigSeed(root, store, starter)).resolves.toBe(false);
    expect(JSON.parse(store.files.get(marker) ?? '')).toMatchObject({ schema: 1 });
  });

  it('exact config without claim completes a two-drain recovery', async () => {
    const store = faultStore('never');
    store.files.set(config, seed);
    await expect(claimViteConfigSeed(root, store, starter)).resolves.toBe(false);
    expect(store.files.has(marker)).toBe(true);
  });
});
