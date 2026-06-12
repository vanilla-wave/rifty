import type { FsSync } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { handleWorkerFsRequest } from './worker-fs-rpc.ts';

class TestFs implements FsSync {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['/']);
  readonly mkdirs: string[] = [];

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readFileBytesSync(path: string): Uint8Array {
    const bytes = this.files.get(path);
    if (!bytes)
      throw Object.assign(new Error(`ENOENT: ${path}`), { name: 'VfsError', code: 'ENOENT', path });
    return bytes;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    if (!this.dirs.has(parent)) {
      throw Object.assign(new Error(`ENOENT: ${parent}`), {
        name: 'VfsError',
        code: 'ENOENT',
        path: parent,
      });
    }
    this.files.set(path, new Uint8Array(data));
  }

  readdirSync(): readonly [] {
    return [];
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.mkdirs.push(path);
    if (!options.recursive) this.dirs.add(path);
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      this.dirs.add(current);
    }
  }

  rmSync(): void {}

  statSync(): { isFile: boolean; isDirectory: boolean } {
    return { isFile: false, isDirectory: true };
  }

  statSyncOrNull(): { isFile: boolean; isDirectory: boolean } | null {
    return null;
  }

  utimes(): void {}

  copyFileSync(): void {}

  cpSync(): void {}

  renameSync(): void {}
}

describe('worker FS RPC', () => {
  it('reads raw bytes', async () => {
    const fs = new TestFs();
    fs.files.set('/bin.dat', Uint8Array.from([0, 255, 7]));

    await expect(
      handleWorkerFsRequest(
        { id: 1, op: 'readFile', path: '/bin.dat' },
        { fs, invalidate: () => {}, flush: () => Promise.resolve() },
      ),
    ).resolves.toEqual({ id: 1, ok: true, value: Uint8Array.from([0, 255, 7]) });
  });

  it('reads utf8 text for string and object encoding options', async () => {
    const fs = new TestFs();
    fs.files.set('/msg.txt', new TextEncoder().encode('hello'));

    await expect(
      handleWorkerFsRequest(
        { id: 1, op: 'readFile', path: '/msg.txt', encoding: 'utf8' },
        { fs, invalidate: () => {}, flush: () => Promise.resolve() },
      ),
    ).resolves.toEqual({ id: 1, ok: true, value: 'hello' });
    await expect(
      handleWorkerFsRequest(
        { id: 2, op: 'readFile', path: '/msg.txt', encoding: { encoding: 'utf8' } },
        { fs, invalidate: () => {}, flush: () => Promise.resolve() },
      ),
    ).resolves.toEqual({ id: 2, ok: true, value: 'hello' });
  });

  it('writes string and byte files after creating parent directories', async () => {
    const fs = new TestFs();

    await handleWorkerFsRequest(
      { id: 1, op: 'writeFile', path: '/a/b/text.txt', data: 'text' },
      { fs, invalidate: () => {}, flush: () => Promise.resolve() },
    );
    await handleWorkerFsRequest(
      { id: 2, op: 'writeFile', path: '/a/c/bin.dat', data: Uint8Array.from([1, 2]) },
      { fs, invalidate: () => {}, flush: () => Promise.resolve() },
    );

    expect(fs.mkdirs).toEqual(['/a/b', '/a/c']);
    expect(new TextDecoder().decode(fs.files.get('/a/b/text.txt'))).toBe('text');
    expect(fs.files.get('/a/c/bin.dat')).toEqual(Uint8Array.from([1, 2]));
  });

  it('normalizes relative paths before reading, writing, and creating parent directories', async () => {
    const fs = new TestFs();

    await handleWorkerFsRequest(
      { id: 1, op: 'writeFile', path: 'rel/../rel/file.txt', data: 'relative' },
      { fs, invalidate: () => {}, flush: () => Promise.resolve() },
    );

    expect(fs.mkdirs).toEqual(['/rel']);
    expect(new TextDecoder().decode(fs.files.get('/rel/file.txt'))).toBe('relative');
    await expect(
      handleWorkerFsRequest(
        { id: 2, op: 'readFile', path: 'rel/file.txt', encoding: 'utf8' },
        { fs, invalidate: () => {}, flush: () => Promise.resolve() },
      ),
    ).resolves.toEqual({ id: 2, ok: true, value: 'relative' });
  });

  it('invalidates the module loader and awaits flush before resolving writes', async () => {
    const fs = new TestFs();
    const events: string[] = [];

    const result = await handleWorkerFsRequest(
      { id: 1, op: 'writeFile', path: '/x/y.js', data: 'module.exports = 1;' },
      {
        fs,
        invalidate: () => events.push('invalidate'),
        flush: async () => {
          await Promise.resolve();
          events.push('flush');
        },
      },
    );

    expect(result).toEqual({ id: 1, ok: true });
    expect(events).toEqual(['invalidate', 'flush']);
  });

  it('serializes ENOENT with name, message, code, and path', async () => {
    const fs = new TestFs();

    await expect(
      handleWorkerFsRequest(
        { id: 1, op: 'readFile', path: '/missing.txt' },
        { fs, invalidate: () => {}, flush: () => Promise.resolve() },
      ),
    ).resolves.toMatchObject({
      id: 1,
      ok: false,
      error: {
        name: 'VfsError',
        message: 'ENOENT: /missing.txt',
        code: 'ENOENT',
        path: '/missing.txt',
      },
    });
  });
});
