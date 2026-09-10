import type { PersistFailureReport } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import type { FsRequest } from './protocol.ts';
import { type WorkerFsRpcDeps, handleWorkerFsRequest } from './worker-fs-rpc.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const memoryReceipt = { applied: 'yes', persistence: 'memory' };
const flushedReceipt = { applied: 'yes', persistence: 'flushed' };

function harness(flush?: () => Promise<PersistFailureReport | undefined>) {
  const fs = new MemoryFsSync();
  let invalidations = 0;
  const deps = {
    fs,
    invalidate: () => {
      invalidations += 1;
    },
    ...(flush === undefined ? {} : { flush }),
  } as unknown as WorkerFsRpcDeps;
  return {
    fs,
    invalidations: () => invalidations,
    request: (request: Readonly<Record<string, unknown>>) =>
      handleWorkerFsRequest({ id: 1, ...request } as unknown as FsRequest, deps),
  };
}

describe('structured Worker FS operations over the real VFS', () => {
  it('lists and stats the root-anchored tree with structured metadata', async () => {
    const h = harness();
    h.fs.mkdirSync('/project/src', { recursive: true });
    h.fs.mkdirSync('/workspace/project', { recursive: true });
    h.fs.writeFileSync('/project/a.txt', encoder.encode('actual'));
    h.fs.writeFileSync('/workspace/project/decoy.txt', encoder.encode('wrong cwd'));

    await expect(h.request({ op: 'readdir', path: './project/' })).resolves.toEqual({
      id: 1,
      ok: true,
      value: [
        { name: 'a.txt', isFile: true, isDirectory: false },
        { name: 'src', isFile: false, isDirectory: true },
      ],
    });
    await expect(h.request({ op: 'stat', path: 'project/a.txt' })).resolves.toEqual({
      id: 1,
      ok: true,
      value: h.fs.statSync('/project/a.txt'),
    });
    await expect(h.request({ op: 'stat', path: 'project/src' })).resolves.toMatchObject({
      ok: true,
      value: { isFile: false, isDirectory: true, size: 0, mtime: expect.any(Number) },
    });
    expect(h.invalidations()).toBe(0);
  });

  it('creates, renames, and removes the same files guest fs sees', async () => {
    const h = harness();
    await expect(
      h.request({ op: 'mkdir', path: 'project/src', options: { recursive: true } }),
    ).resolves.toEqual({ id: 1, ok: true, value: memoryReceipt });
    await expect(
      h.request({ op: 'writeFile', path: 'project/src/a.txt', data: 'source' }),
    ).resolves.toEqual({ id: 1, ok: true });
    await expect(
      h.request({ op: 'rename', sourcePath: 'project/src', targetPath: '/project/lib' }),
    ).resolves.toEqual({ id: 1, ok: true, value: memoryReceipt });
    expect(h.fs.existsSync('/project/src')).toBe(false);
    expect(decoder.decode(h.fs.readFileBytesSync('/project/lib/a.txt'))).toBe('source');
    await expect(
      h.request({ op: 'rm', path: 'project/lib', options: { recursive: true } }),
    ).resolves.toEqual({ id: 1, ok: true, value: memoryReceipt });
    expect(h.fs.existsSync('/project/lib')).toBe(false);
    expect(h.invalidations()).toBe(4);
  });

  it('keeps writeFile parent creation and detached byte ownership', async () => {
    const h = harness();
    const data = Uint8Array.from([0, 255, 17]);
    await expect(h.request({ op: 'writeFile', path: 'nested/deep/data', data })).resolves.toEqual({
      id: 1,
      ok: true,
    });
    data[0] = 99;
    const result = await h.request({ op: 'readFile', path: 'nested/deep/data' });
    expect(result).toEqual({ id: 1, ok: true, value: Uint8Array.from([0, 255, 17]) });
    if (!result.ok || !(result.value instanceof Uint8Array)) throw new Error('missing bytes');
    result.value[1] = 0;
    expect(h.fs.readFileBytesSync('/nested/deep/data')).toEqual(Uint8Array.from([0, 255, 17]));
  });

  it('reports missing entries and non-directory traversal with VFS codes and paths', async () => {
    const h = harness();
    h.fs.writeFileSync('/file', encoder.encode('x'));
    for (const op of ['stat', 'readdir']) {
      await expect(h.request({ op, path: '/missing' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'ENOENT', path: '/missing' },
      });
    }
    await expect(h.request({ op: 'stat', path: '/file/child' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'ENOTDIR', path: '/file/child' },
    });
  });

  it('rejects malformed paths and write data before changing the real tree', async () => {
    const h = harness();
    for (const path of [null, 7, {}, '/bad\0name']) {
      await expect(h.request({ op: 'writeFile', path, data: 'no' })).resolves.toMatchObject({
        ok: false,
      });
    }
    for (const data of [null, {}, [1, 2], 12]) {
      await expect(h.request({ op: 'writeFile', path: '/new/child', data })).resolves.toMatchObject(
        {
          ok: false,
        },
      );
    }
    expect(h.fs.readdirSync('/')).toEqual([]);
    expect(h.invalidations()).toBe(0);
  });

  it('rejects malformed options before admitting mkdir or removal', async () => {
    const h = harness();
    h.fs.mkdirSync('/keep', {});
    h.fs.writeFileSync('/keep/file', encoder.encode('keep'));
    for (const options of [null, 'recursive', { recursive: 'yes' }, { recursive: 1 }]) {
      await expect(h.request({ op: 'mkdir', path: '/new/child', options })).resolves.toMatchObject({
        ok: false,
      });
      await expect(h.request({ op: 'rm', path: '/keep', options })).resolves.toMatchObject({
        ok: false,
      });
    }
    await expect(
      h.request({ op: 'rm', path: '/keep', options: { recursive: true, force: 'yes' } }),
    ).resolves.toMatchObject({ ok: false });
    expect(h.fs.existsSync('/new')).toBe(false);
    expect(decoder.decode(h.fs.readFileBytesSync('/keep/file'))).toBe('keep');
    expect(h.invalidations()).toBe(0);
  });

  it('preserves applied uncertainty when an underlying mutation throws', async () => {
    const h = harness();
    h.fs.mkdirSync('/occupied', {});
    await expect(
      h.request({ op: 'writeFile', path: '/occupied', data: 'cannot replace directory' }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'EISDIR',
        effects: { applied: 'unknown', persistence: 'unknown' },
      },
    });
    await expect(
      h.request({ op: 'rename', sourcePath: '/missing', targetPath: '/target' }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'ENOENT', effects: { applied: 'unknown', persistence: 'unknown' } },
    });
    expect(h.fs.statSync('/occupied').isDirectory).toBe(true);
    expect(h.fs.existsSync('/target')).toBe(false);
  });

  it('awaits flush settlement before returning a successful mutation receipt', async () => {
    let release!: (report: PersistFailureReport) => void;
    const barrier = new Promise<PersistFailureReport>((resolve) => {
      release = resolve;
    });
    const h = harness(() => barrier);
    let settled = false;
    const pending = h.request({ op: 'mkdir', path: '/created' }).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(h.fs.statSync('/created').isDirectory).toBe(true);
    expect(settled).toBe(false);
    release({ failures: [], total: 0 });
    await expect(pending).resolves.toEqual({ id: 1, ok: true, value: flushedReceipt });
  });

  it.each(['mkdir', 'writeFile', 'rename', 'rm'])(
    '%s exposes applied effects when OPFS reports unhealed persistence failures',
    async (op) => {
      const h = harness(async () => ({
        failures: [{ path: '/project', op: 'write', message: 'quota exceeded' }],
        total: 1,
      }));
      h.fs.mkdirSync('/project', {});
      h.fs.writeFileSync('/project/source', encoder.encode('source'));
      const request =
        op === 'rename'
          ? { op, sourcePath: '/project/source', targetPath: '/project/target' }
          : op === 'writeFile'
            ? { op, path: '/project/target', data: 'written' }
            : { op, path: op === 'mkdir' ? '/project/new' : '/project/source' };
      await expect(h.request(request)).resolves.toMatchObject({
        ok: false,
        error: {
          name: 'SandboxPersistenceError',
          effects: { applied: 'yes', persistence: 'failed' },
        },
      });
      if (op === 'mkdir') expect(h.fs.statSync('/project/new').isDirectory).toBe(true);
      if (op === 'writeFile') {
        expect(decoder.decode(h.fs.readFileBytesSync('/project/target'))).toBe('written');
      }
      if (op === 'rename') {
        expect(h.fs.existsSync('/project/source')).toBe(false);
        expect(decoder.decode(h.fs.readFileBytesSync('/project/target'))).toBe('source');
      }
      if (op === 'rm') expect(h.fs.existsSync('/project/source')).toBe(false);
    },
  );

  it('retains the applied file when the external flush rejects', async () => {
    const h = harness(async () => {
      throw new Error('storage permission lost');
    });
    await expect(
      h.request({ op: 'writeFile', path: '/saved', data: 'visible' }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        message: 'storage permission lost',
        effects: { applied: 'yes', persistence: 'failed' },
      },
    });
    expect(decoder.decode(h.fs.readFileBytesSync('/saved'))).toBe('visible');
  });

  it('provides an explicit flush barrier and checks total rather than the failure sample', async () => {
    const memory = harness();
    await expect(memory.request({ op: 'flush' })).resolves.toEqual({
      id: 1,
      ok: true,
      value: memoryReceipt,
    });
    const clean = harness(async () => ({ failures: [], total: 0 }));
    await expect(clean.request({ op: 'flush' })).resolves.toEqual({
      id: 1,
      ok: true,
      value: flushedReceipt,
    });
    const failed = harness(async () => ({ failures: [], total: 1 }));
    await expect(failed.request({ op: 'flush' })).resolves.toMatchObject({
      ok: false,
      error: {
        name: 'SandboxPersistenceError',
        effects: { applied: 'yes', persistence: 'failed' },
      },
    });
  });
});
