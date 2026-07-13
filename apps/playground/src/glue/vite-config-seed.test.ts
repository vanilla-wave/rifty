import { describe, expect, it } from 'vitest';
import {
  VITE_CONFIG_FILENAMES,
  type ViteConfigSeedStore,
  claimViteConfigSeed,
  syncViteConfigSeedStore,
  viteConfigSeedClaimPath,
} from './vite-config-seed.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function makeStore(initial: Readonly<Record<string, string>> = {}): ViteConfigSeedStore & {
  readonly files: Map<string, string>;
  readonly writes: string[];
  flushes: number;
} {
  const files = new Map<string, string>(Object.entries(initial));
  return {
    files,
    writes: [],
    flushes: 0,
    async read(path) {
      const value = files.get(path);
      return value === undefined ? null : enc.encode(value);
    },
    async write(path, data) {
      this.writes.push(path);
      files.set(path, dec.decode(data));
    },
    async flush() {
      this.flushes += 1;
    },
  };
}

describe('Vite config seed claim', () => {
  const root = '/scratch';
  const config = '/scratch/vite.config.js';
  const marker = viteConfigSeedClaimPath(root);
  const starter = { id: 'real-vite', seedFiles: { [config]: 'export default {};' } };

  it('pins Vite config precedence', () => {
    expect(VITE_CONFIG_FILENAMES).toEqual([
      'vite.config.js',
      'vite.config.mjs',
      'vite.config.ts',
      'vite.config.cjs',
      'vite.config.mts',
      'vite.config.cts',
    ]);
  });

  it('writes config, drains, then writes and drains a versioned claim', async () => {
    const store = makeStore();
    await expect(claimViteConfigSeed(root, store, starter)).resolves.toBe(true);
    expect(store.writes).toEqual([config, marker]);
    expect(store.flushes).toBe(2);
    expect(JSON.parse(store.files.get(marker) ?? '')).toEqual({
      schema: 1,
      file: 'vite.config.js',
      starter: 'real-vite',
    });
  });

  it('preserves deletion and edits after a valid claim', async () => {
    const claim = '{"schema":1,"file":"vite.config.js","starter":"real-vite"}\n';
    const deleted = makeStore({ [marker]: claim });
    await expect(claimViteConfigSeed(root, deleted, starter)).resolves.toBe(false);
    expect(deleted.files.has(config)).toBe(false);

    const edited = makeStore({ [marker]: claim, [config]: 'export default { plugins: [] };' });
    await expect(claimViteConfigSeed(root, edited, starter)).resolves.toBe(false);
    expect(edited.files.get(config)).toContain('plugins');
  });

  it('never shadows or claims a user-owned config variant', async () => {
    const store = makeStore({ '/scratch/vite.config.ts': 'export default {};' });
    await expect(claimViteConfigSeed(root, store, starter)).resolves.toBe(false);
    expect(store.files.has(config)).toBe(false);
    expect(store.files.has(marker)).toBe(false);
    expect(store.writes).toEqual([]);
  });

  it('does not claim an exact seed when another config variant also exists', async () => {
    const store = makeStore({
      [config]: 'export default {};',
      '/scratch/vite.config.ts': 'export default { plugins: [] };',
    });
    await expect(claimViteConfigSeed(root, store, starter)).resolves.toBe(false);
    expect(store.files.has(marker)).toBe(false);
    expect(store.writes).toEqual([]);
  });

  it('loud-fails a starter that defines more than one config slot', async () => {
    const store = makeStore();
    await expect(
      claimViteConfigSeed(root, store, {
        id: 'ambiguous',
        seedFiles: {
          [config]: 'export default {};',
          '/scratch/vite.config.ts': 'export default {};',
        },
      }),
    ).rejects.toThrow('defines multiple Vite config slots');
    expect(store.writes).toEqual([]);
  });

  it('loud-fails corrupt or unsupported claims', async () => {
    for (const value of ['not-json', '{"schema":2,"file":"vite.config.js","starter":"x"}']) {
      const store = makeStore({ [marker]: value });
      await expect(claimViteConfigSeed(root, store, starter)).rejects.toThrow(
        'corrupt Vite config seed claim',
      );
      expect(store.writes).toEqual([]);
    }
  });

  it('does nothing for a starter without a config slot', async () => {
    const store = makeStore();
    await expect(
      claimViteConfigSeed(root, store, { id: 'node-worker', seedFiles: {} }),
    ).resolves.toBe(false);
    expect(store.writes).toEqual([]);
  });

  it('validates an existing claim even when the current starter has no config', async () => {
    const store = makeStore({ [marker]: 'not-json' });
    await expect(
      claimViteConfigSeed(root, store, { id: 'node-worker', seedFiles: {} }),
    ).rejects.toThrow('corrupt Vite config seed claim');
  });

  it('sync adapter creates parents and loud-fails a dirty durability ledger', async () => {
    const files = new Map<string, Uint8Array>();
    const mkdirs: string[] = [];
    const store = syncViteConfigSeedStore(
      {
        existsSync: (path) => files.has(path),
        readFileBytesSync: (path) => files.get(path) as Uint8Array,
        mkdirSync: (path) => {
          mkdirs.push(path);
        },
        writeFileSync: (path, bytes) => {
          files.set(path, bytes);
        },
      },
      async () => ({
        total: 1,
        failures: [{ path: config, op: 'write', message: 'quota' }],
      }),
    );
    await store.write(config, enc.encode('seed'));
    expect(mkdirs).toEqual(['/scratch']);
    await expect(store.flush()).rejects.toMatchObject({
      name: 'PersistFailureError',
      message: expect.stringContaining('write /scratch/vite.config.js: quota'),
    });
  });
});
