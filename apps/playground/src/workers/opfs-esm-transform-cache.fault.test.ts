/**
 * Fault tests for the persistent ESM transform cache store (ADR-0200):
 * corrupt-input / unbounded-read / false-fallback / torn-state-adjacent write
 * failure. The storage port is faked (OPFS is the unavoidable browser
 * boundary); the hydrate/flush logic under test is real.
 */
import { ESM_TRANSFORM_FORMAT } from '@riftydev/runtime-js/loader';
import { describe, expect, it, vi } from 'vitest';
import { type EsmTransformCacheStorage, hydrateEsmTransformCache } from './opfs-esm-transform-cache.ts';

const ENTRY = {
  source: 'export const a = 1;\n',
  result: { body: 'body', lineMap: [1], staticImports: [], helpers: {} },
} as never;

function memStorage(initial: string | null = null) {
  let file: string | null = initial;
  const storage: EsmTransformCacheStorage = {
    size: vi.fn(async () => (file === null ? null : file.length)),
    read: vi.fn(async () => file),
    write: vi.fn(async (text: string) => {
      file = text;
    }),
    remove: vi.fn(async () => {
      file = null;
    }),
  };
  return { storage, current: () => file };
}

const tick = () => new Promise((r) => setTimeout(r, 1));

describe('esm transform cache store faults (ADR-0200)', () => {
  it('round-trips node_modules entries across a re-hydrate (the whole point)', async () => {
    const { storage, current } = memStorage();
    const warn = vi.fn();
    const cache = await hydrateEsmTransformCache(storage, { warn, flushDelayMs: 0 });
    cache.put('/p/node_modules/vite/dist/x.js', ENTRY);
    cache.put('/p/src/user-file.js', ENTRY); // user files never persist
    await tick();
    expect(current()).toContain('node_modules/vite/dist/x.js');
    expect(current()).not.toContain('user-file');

    const next = await hydrateEsmTransformCache(storage, { warn, flushDelayMs: 0 });
    expect(next.get('/p/node_modules/vite/dist/x.js')).toEqual(ENTRY);
    expect(next.get('/p/src/user-file.js')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('corrupt JSON → discard + delete + one warn; store stays usable', async () => {
    const { storage, current } = memStorage('{"format":1,"entries":{tru');
    const warn = vi.fn();
    const cache = await hydrateEsmTransformCache(storage, { warn, flushDelayMs: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalled();
    expect(cache.get('/p/node_modules/a.js')).toBeUndefined();
    cache.put('/p/node_modules/a.js', ENTRY);
    await tick();
    expect(current()).toContain(`"format":${ESM_TRANSFORM_FORMAT}`);
  });

  it('wrong format version → discard (yesterday’s transform never replays)', async () => {
    const { storage } = memStorage(
      JSON.stringify({ format: ESM_TRANSFORM_FORMAT + 1, entries: { '/p/node_modules/a.js': ENTRY } }),
    );
    const warn = vi.fn();
    const cache = await hydrateEsmTransformCache(storage, { warn, flushDelayMs: 0 });
    expect(cache.get('/p/node_modules/a.js')).toBeUndefined();
    expect(storage.remove).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('foreign-shaped entry → whole store discarded, nothing partial served', async () => {
    const { storage } = memStorage(
      JSON.stringify({
        format: ESM_TRANSFORM_FORMAT,
        entries: { '/p/node_modules/ok.js': ENTRY, '/p/node_modules/bad.js': { source: 5 } },
      }),
    );
    const warn = vi.fn();
    const cache = await hydrateEsmTransformCache(storage, { warn, flushDelayMs: 0 });
    expect(cache.get('/p/node_modules/ok.js')).toBeUndefined();
    expect(storage.remove).toHaveBeenCalled();
  });

  it('oversized file → discarded WITHOUT reading it (bounded hydrate)', async () => {
    const { storage } = memStorage('x');
    (storage.size as ReturnType<typeof vi.fn>).mockResolvedValue(65 * 1024 * 1024);
    const warn = vi.fn();
    await hydrateEsmTransformCache(storage, { warn, flushDelayMs: 0 });
    expect(storage.read).not.toHaveBeenCalled();
    expect(storage.remove).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('write failure → ONE warn, writes disabled, get/put never throw', async () => {
    const { storage } = memStorage();
    (storage.write as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('quota'));
    const warn = vi.fn();
    const cache = await hydrateEsmTransformCache(storage, { warn, flushDelayMs: 0 });
    cache.put('/p/node_modules/a.js', ENTRY);
    await tick();
    cache.put('/p/node_modules/b.js', ENTRY);
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(cache.get('/p/node_modules/a.js')).toEqual(ENTRY); // in-memory keeps serving
  });

  it('puts landing during an in-flight flush are not lost (re-flush follows)', async () => {
    const { storage, current } = memStorage();
    let releaseFirstWrite: () => void = () => {};
    (storage.write as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseFirstWrite = resolve;
        }),
    );
    const cache = await hydrateEsmTransformCache(storage, { warn: vi.fn(), flushDelayMs: 0 });
    cache.put('/p/node_modules/a.js', ENTRY);
    await tick(); // flush #1 starts and parks in the mocked write
    cache.put('/p/node_modules/b.js', ENTRY); // lands mid-flight → dirty
    releaseFirstWrite();
    await tick(); // finally → dirty re-schedule
    await tick(); // flush #2 writes through the real mem impl
    expect(current()).toContain('node_modules/b.js');
  });
});
