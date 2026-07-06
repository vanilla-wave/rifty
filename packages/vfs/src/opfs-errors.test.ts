/**
 * Tests for the OPFS error-translation helper (ADR-0013). Exercises both the
 * helper directly and the integrated behaviour of `OpfsVfs` via a fake
 * `FileSystemDirectoryHandle` that rejects with each documented error class.
 */
import { describe, expect, it } from 'vitest';
import { VfsError } from './errors.ts';
import { mapOpfsError } from './opfs-errors.ts';
import { OpfsVfs } from './opfs.ts';

class FakeDomException extends Error {
  constructor(name: string, message = '') {
    super(message);
    this.name = name;
  }
}

describe('mapOpfsError', () => {
  it('maps NotFoundError → ENOENT', () => {
    const e = mapOpfsError(new FakeDomException('NotFoundError', 'missing'), '/x', 'file');
    expect(e).toBeInstanceOf(VfsError);
    expect(e.code).toBe('ENOENT');
    expect(e.path).toBe('/x');
  });

  it('maps NotAllowedError → EACCES', () => {
    const e = mapOpfsError(new FakeDomException('NotAllowedError'), '/x', 'file');
    expect(e.code).toBe('EACCES');
  });

  it('maps QuotaExceededError → EDQUOT', () => {
    const e = mapOpfsError(new FakeDomException('QuotaExceededError'), '/x', 'file');
    expect(e.code).toBe('EDQUOT');
  });

  it('maps TypeMismatchError → EISDIR when expecting a file', () => {
    const e = mapOpfsError(new FakeDomException('TypeMismatchError'), '/x', 'file');
    expect(e.code).toBe('EISDIR');
  });

  it('maps TypeMismatchError → ENOTDIR when expecting a directory', () => {
    const e = mapOpfsError(new FakeDomException('TypeMismatchError'), '/x', 'dir');
    expect(e.code).toBe('ENOTDIR');
  });

  it('maps InvalidModificationError → ENOTEMPTY (Node parity for rm)', () => {
    const e = mapOpfsError(new FakeDomException('InvalidModificationError'), '/dir', 'dir');
    expect(e.code).toBe('ENOTEMPTY');
  });

  it('maps unknown error → EIO with original as cause', () => {
    const raw = new FakeDomException('SomeWeirdError', 'boom');
    const e = mapOpfsError(raw, '/x', 'file');
    expect(e.code).toBe('EIO');
    expect(e.cause).toBe(raw);
  });

  it('handles non-Error throwables (string, plain object)', () => {
    const e = mapOpfsError('opaque', '/x', 'file');
    expect(e.code).toBe('EIO');
  });
});

// --- Integration: OpfsVfs paths translate errors via the helper. ----------

type ErrorKind =
  | 'NotFoundError'
  | 'NotAllowedError'
  | 'QuotaExceededError'
  | 'TypeMismatchError'
  | 'InvalidModificationError'
  | 'GremlinError';

interface FakeDirOpts {
  /** Children to enumerate. Used by `readdir`. */
  children?: ReadonlyMap<string, { kind: 'file' | 'directory' }>;
  /** Behaviour for `getFileHandle`. */
  fileError?: ErrorKind;
  /** Behaviour for `getDirectoryHandle`. */
  dirError?: ErrorKind;
  /** Behaviour for `removeEntry`. */
  removeError?: ErrorKind;
}

function makeFakeRoot(opts: FakeDirOpts): FileSystemDirectoryHandle {
  const handle = {
    kind: 'directory' as const,
    name: '/',
    getFileHandle(_name: string, _o?: { create?: boolean }) {
      if (opts.fileError) {
        return Promise.reject(new FakeDomException(opts.fileError));
      }
      throw new Error('unexpected fake getFileHandle call without fileError set');
    },
    getDirectoryHandle(_name: string, _o?: { create?: boolean }) {
      if (opts.dirError) {
        return Promise.reject(new FakeDomException(opts.dirError));
      }
      throw new Error('unexpected fake getDirectoryHandle call without dirError set');
    },
    removeEntry(_name: string, _o?: { recursive?: boolean }) {
      if (opts.removeError) {
        return Promise.reject(new FakeDomException(opts.removeError));
      }
      return Promise.resolve();
    },
  };
  return handle as unknown as FileSystemDirectoryHandle;
}

/** Inject a fake root into an OpfsVfs so `init()` is a no-op. */
function fakeVfs(opts: FakeDirOpts): OpfsVfs {
  const vfs = new OpfsVfs();
  (vfs as unknown as { root: FileSystemDirectoryHandle }).root = makeFakeRoot(opts);
  return vfs;
}

describe('OpfsVfs error mapping', () => {
  it('NotFoundError on getFileHandle → ENOENT', async () => {
    const vfs = fakeVfs({ fileError: 'NotFoundError' });
    await expect(vfs.readFile('/missing')).rejects.toMatchObject({
      name: 'VfsError',
      code: 'ENOENT',
    });
  });

  it('NotAllowedError on getFileHandle → EACCES', async () => {
    const vfs = fakeVfs({ fileError: 'NotAllowedError' });
    await expect(vfs.readFile('/locked')).rejects.toMatchObject({
      name: 'VfsError',
      code: 'EACCES',
    });
  });

  it('QuotaExceededError on writeFile → EDQUOT', async () => {
    const vfs = fakeVfs({ fileError: 'QuotaExceededError' });
    await expect(vfs.writeFile('/big', 'data')).rejects.toMatchObject({
      name: 'VfsError',
      code: 'EDQUOT',
    });
  });

  it('TypeMismatchError on getFileHandle → EISDIR (file context)', async () => {
    const vfs = fakeVfs({ fileError: 'TypeMismatchError' });
    await expect(vfs.readFile('/dirpath')).rejects.toMatchObject({
      name: 'VfsError',
      code: 'EISDIR',
    });
  });

  it('TypeMismatchError on getDirectoryHandle → ENOTDIR (dir context)', async () => {
    const vfs = fakeVfs({ dirError: 'TypeMismatchError' });
    await expect(vfs.readdir('/filepath')).rejects.toMatchObject({
      name: 'VfsError',
      code: 'ENOTDIR',
    });
  });

  it('unknown OPFS error → EIO with cause preserved', async () => {
    const vfs = fakeVfs({ fileError: 'GremlinError' });
    await expect(vfs.readFile('/x')).rejects.toMatchObject({
      name: 'VfsError',
      code: 'EIO',
    });
    const err = await vfs.readFile('/x').catch((e: unknown) => e);
    expect((err as VfsError).cause).toBeInstanceOf(Error);
    expect(((err as VfsError).cause as Error).name).toBe('GremlinError');
  });

  it('rm force suppresses only ENOENT from removeEntry', async () => {
    await expect(
      fakeVfs({ removeError: 'NotFoundError' }).rm('/missing', { force: true }),
    ).resolves.toBeUndefined();
    await expect(
      fakeVfs({ removeError: 'NotAllowedError' }).rm('/locked', { force: true }),
    ).rejects.toMatchObject({ code: 'EACCES' });
  });

  it('rm force does not suppress ENOTDIR while resolving the parent', async () => {
    const vfs = fakeVfs({ dirError: 'TypeMismatchError' });
    await expect(vfs.rm('/plain-file/child', { force: true })).rejects.toMatchObject({
      code: 'ENOTDIR',
    });
  });

  it('directory-walk failures name the requested target path', async () => {
    const vfs = fakeVfs({ dirError: 'TypeMismatchError' });
    await expect(vfs.readdir('/plain-file/child')).rejects.toMatchObject({
      code: 'ENOTDIR',
      path: '/plain-file/child',
    });
    await expect(vfs.stat('/plain-file/child')).rejects.toMatchObject({
      code: 'ENOTDIR',
      path: '/plain-file/child',
    });
    await expect(vfs.rm('/plain-file/child')).rejects.toMatchObject({
      code: 'ENOTDIR',
      path: '/plain-file/child',
    });
  });

  it('mkdir with a missing parent names the TARGET path, not the failing component', async () => {
    const vfs = fakeVfs({ dirError: 'NotFoundError' });
    await expect(vfs.mkdir('/no/such/deep')).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/no/such/deep',
    });
  });

  it('mkdir targeting an existing file is EEXIST; mkdir through a file remains ENOTDIR', async () => {
    const vfs = fakeVfs({ dirError: 'TypeMismatchError' });
    await expect(vfs.mkdir('/plain.txt')).rejects.toMatchObject({
      code: 'EEXIST',
      path: '/plain.txt',
    });
    await expect(vfs.mkdir('/plain.txt/sub')).rejects.toMatchObject({
      code: 'ENOTDIR',
      path: '/plain.txt/sub',
    });
  });

  it('writeFile rejects a missing parent instead of creating parent directories', async () => {
    const createdDirs: string[] = [];
    const writable = {
      write: () => Promise.resolve(),
      close: () => Promise.resolve(),
    };
    const fileHandle = {
      kind: 'file' as const,
      createWritable: () => Promise.resolve(writable),
    };
    const createdDir = {
      kind: 'directory' as const,
      getFileHandle: (_name: string, options?: { create?: boolean }) => {
        if (options?.create) {
          return Promise.resolve(fileHandle as unknown as FileSystemFileHandle);
        }
        return Promise.reject(new FakeDomException('NotFoundError'));
      },
      getDirectoryHandle: () => Promise.reject(new FakeDomException('NotFoundError')),
    };
    const root = {
      kind: 'directory' as const,
      getDirectoryHandle: (name: string, options?: { create?: boolean }) => {
        if (options?.create) {
          createdDirs.push(name);
          return Promise.resolve(createdDir as unknown as FileSystemDirectoryHandle);
        }
        return Promise.reject(new FakeDomException('NotFoundError'));
      },
      getFileHandle: () => Promise.reject(new FakeDomException('NotFoundError')),
    };
    const vfs = new OpfsVfs();
    (vfs as unknown as { root: unknown }).root = root;

    await expect(vfs.writeFile('/missing/file.txt', 'x')).rejects.toMatchObject({
      code: 'ENOENT',
      path: '/missing/file.txt',
    });
    expect(createdDirs).toEqual([]);
  });
});

// --- Item #4: readFile honours encoding -----------------------------------

interface FakeFileOpts {
  bytes: Uint8Array;
  size?: number;
  mtime?: number;
}

function fakeFile({ bytes, size, mtime }: FakeFileOpts): File {
  // Minimal `File` shape used by `OpfsVfs.readFile`: `arrayBuffer()` plus
  // `size` / `lastModified` (the latter two only matter for `stat`).
  return {
    arrayBuffer: () =>
      Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)),
    size: size ?? bytes.byteLength,
    lastModified: mtime ?? 0,
  } as unknown as File;
}

function fakeFileVfs(file: File): OpfsVfs {
  const handle = {
    kind: 'file' as const,
    getFile: () => Promise.resolve(file),
  };
  const root = {
    kind: 'directory' as const,
    getFileHandle: (_n: string, _o?: { create?: boolean }) =>
      Promise.resolve(handle as unknown as FileSystemFileHandle),
    getDirectoryHandle: (_n: string, _o?: { create?: boolean }) =>
      Promise.reject(new FakeDomException('NotFoundError')),
  };
  const vfs = new OpfsVfs();
  (vfs as unknown as { root: unknown }).root = root;
  return vfs;
}

describe('OpfsVfs.readFile encoding', () => {
  it('returns Uint8Array when no encoding given', async () => {
    const vfs = fakeFileVfs(fakeFile({ bytes: new Uint8Array([1, 2, 3]) }));
    const data = await vfs.readFile('/x');
    expect(data).toBeInstanceOf(Uint8Array);
    expect(Array.from(data)).toEqual([1, 2, 3]);
  });

  it('decodes utf8 string when encoding="utf8"', async () => {
    const enc = new TextEncoder().encode('héllo');
    const vfs = fakeFileVfs(fakeFile({ bytes: enc }));
    const text = await vfs.readFile('/x', 'utf8');
    expect(text).toBe('héllo');
  });

  it('decodes latin1 string when encoding="latin1"', async () => {
    // Latin-1: each byte maps directly to a code point.
    const bytes = new Uint8Array([0x68, 0xe9, 0x6c, 0x6c, 0x6f]); // h é l l o
    const vfs = fakeFileVfs(fakeFile({ bytes }));
    const text = await vfs.readFile('/x', 'latin1');
    expect(text).toBe('héllo');
  });
});
