import { type FsSync, VfsError } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  type EsbuildCallbackFs,
  type EsbuildCallbackStats,
  type EsbuildFsCallback,
  createEsbuildCallbackFs,
} from './esbuild-runtime-fs.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function callbackValue<T>(invoke: (callback: EsbuildFsCallback) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    invoke((error, value) => {
      if (error !== null) reject(error);
      else resolve(value as T);
    });
  });
}

function callbackVoid(invoke: (callback: EsbuildFsCallback) => void): Promise<void> {
  return callbackValue<void>(invoke);
}

async function rejectedCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    return (error as { readonly code?: string }).code ?? 'missing-code';
  }
}

function open(go: EsbuildCallbackFs, path: string, flags: number): Promise<number> {
  return callbackValue((callback) => go.open(path, flags, 0o666, callback));
}

function read(
  go: EsbuildCallbackFs,
  fd: number,
  length: number,
  position: number | null,
): Promise<{ readonly count: number; readonly text: string }> {
  const buffer = new Uint8Array(length);
  return callbackValue<number>((callback) =>
    go.read(fd, buffer, 0, buffer.length, position, callback),
  ).then((count) => ({ count, text: decoder.decode(buffer.subarray(0, count)) }));
}

function write(
  go: EsbuildCallbackFs,
  fd: number,
  text: string,
  position: number | null,
): Promise<number> {
  const buffer = encoder.encode(text);
  return callbackValue((callback) => go.write(fd, buffer, 0, buffer.length, position, callback));
}

function fixture(): MemoryFsSync {
  const fs = new MemoryFsSync();
  fs.loadFixture({
    '/work/input.txt': 'abcdef',
    '/work/append.txt': 'base',
    '/work/plain.txt': 'plain',
  });
  return fs;
}

describe('createEsbuildCallbackFs', () => {
  it('resolves relative paths from cwd, reserves fds 0-2, and defers file callbacks', async () => {
    const fs = fixture();
    const { go } = createEsbuildCallbackFs(fs, '/work');
    let callerStack = true;
    const statPromise = new Promise<void>((resolve, reject) => {
      go.stat('./input.txt', (error, value) => {
        try {
          expect(callerStack).toBe(false);
          expect(error).toBeNull();
          expect((value as EsbuildCallbackStats).size).toBe(6);
          resolve();
        } catch (assertion) {
          reject(assertion);
        }
      });
    });
    callerStack = false;
    await statPromise;

    const first = await open(go, 'input.txt', go.constants.O_RDONLY);
    const second = await open(go, '/work/plain.txt', go.constants.O_RDONLY);
    expect(first).toBe(3);
    expect(second).toBe(4);
    expect(
      await rejectedCode(
        callbackValue((callback) => go.read(0, new Uint8Array(1), 0, 1, null, callback)),
      ),
    ).toBe('ENOSYS');
  });

  it('lets upstream override protocol fds without taking file-fd reads and writes', async () => {
    const fs = fixture();
    const { go } = createEsbuildCallbackFs(fs, '/work');
    go.read = (_fd, buffer, offset, _length, _position, callback): void => {
      buffer[offset] = 7;
      callback(null, 1);
    };
    go.writeSync = (fd, buffer): number => {
      expect(fd).toBe(1);
      expect(decoder.decode(buffer)).toBe('protocol');
      return buffer.length;
    };

    const protocolBuffer = new Uint8Array(1);
    expect(
      await callbackValue<number>((callback) => go.read(0, protocolBuffer, 0, 1, null, callback)),
    ).toBe(1);
    expect(protocolBuffer[0]).toBe(7);
    expect(go.writeSync(1, encoder.encode('protocol'))).toBe(8);

    const fd = await open(go, 'input.txt', go.constants.O_RDWR);
    expect(await read(go, fd, 2, null)).toEqual({ count: 2, text: 'ab' });
    expect(go.writeSync(fd, encoder.encode('Z'))).toBe(1);
    await callbackVoid((callback) => go.close(fd, callback));
    expect(decoder.decode(fs.readFileBytesSync('/work/input.txt'))).toBe('abZdef');
  });

  it('preserves sequential offsets while positional IO stays independent', async () => {
    const fs = fixture();
    const { go } = createEsbuildCallbackFs(fs, '/work');
    const fd = await open(go, 'input.txt', go.constants.O_RDWR);

    expect(await read(go, fd, 2, null)).toEqual({ count: 2, text: 'ab' });
    expect(await read(go, fd, 2, 4)).toEqual({ count: 2, text: 'ef' });
    expect(await write(go, fd, 'XY', 0)).toBe(2);
    expect(await read(go, fd, 2, null)).toEqual({ count: 2, text: 'cd' });
    expect(await write(go, fd, '!', null)).toBe(1);

    expect(decoder.decode(fs.readFileBytesSync('/work/input.txt'))).toBe('abcdef');
    await callbackVoid((callback) => go.fsync(fd, callback));
    expect(decoder.decode(fs.readFileBytesSync('/work/input.txt'))).toBe('XYcd!f');
    await callbackVoid((callback) => go.close(fd, callback));
  });

  it('honors create/exclusive/append/truncate flags', async () => {
    const fs = fixture();
    const { go } = createEsbuildCallbackFs(fs, '/work');
    const createFlags = go.constants.O_WRONLY | go.constants.O_CREAT | go.constants.O_EXCL;
    const created = await open(go, 'created.txt', createFlags);
    expect(created).toBeGreaterThanOrEqual(3);
    expect(fs.readFileBytesSync('/work/created.txt')).toHaveLength(0);
    await write(go, created, 'new', null);
    await callbackVoid((callback) => go.close(created, callback));
    expect(decoder.decode(fs.readFileBytesSync('/work/created.txt'))).toBe('new');
    expect(await rejectedCode(open(go, 'created.txt', createFlags))).toBe('EEXIST');

    const appended = await open(go, 'append.txt', go.constants.O_WRONLY | go.constants.O_APPEND);
    await write(go, appended, '!', 0);
    await callbackVoid((callback) => go.close(appended, callback));
    expect(decoder.decode(fs.readFileBytesSync('/work/append.txt'))).toBe('base!');

    const truncated = await open(go, 'plain.txt', go.constants.O_WRONLY | go.constants.O_TRUNC);
    expect(fs.readFileBytesSync('/work/plain.txt')).toHaveLength(0);
    await callbackVoid((callback) => go.close(truncated, callback));
  });

  it('runs directory, stat, rename, truncate, and removal operations over cwd', async () => {
    const fs = fixture();
    const { go } = createEsbuildCallbackFs(fs, '/work');
    await callbackVoid((callback) => go.mkdir('out', 0o755, callback));
    await callbackVoid((callback) => go.rename('plain.txt', 'out/moved.txt', callback));
    const names = await callbackValue<readonly string[]>((callback) => go.readdir('out', callback));
    expect(names).toEqual(['moved.txt']);

    const stat = await callbackValue<EsbuildCallbackStats>((callback) =>
      go.stat('out/moved.txt', callback),
    );
    const lstat = await callbackValue<EsbuildCallbackStats>((callback) =>
      go.lstat('out/moved.txt', callback),
    );
    expect(stat.isFile()).toBe(true);
    expect(stat.isDirectory()).toBe(false);
    expect(lstat.isSymbolicLink()).toBe(false);

    await callbackVoid((callback) => go.truncate('out/moved.txt', 3, callback));
    const fd = await open(go, 'out/moved.txt', go.constants.O_RDWR);
    await callbackVoid((callback) => go.ftruncate(fd, 5, callback));
    const fstat = await callbackValue<EsbuildCallbackStats>((callback) => go.fstat(fd, callback));
    expect(fstat.size).toBe(5);
    await callbackVoid((callback) => go.close(fd, callback));
    expect(fs.readFileBytesSync('/work/out/moved.txt')).toEqual(
      new Uint8Array([112, 108, 97, 0, 0]),
    );

    await callbackVoid((callback) => go.unlink('out/moved.txt', callback));
    await callbackVoid((callback) => go.rmdir('out', callback));
    expect(fs.existsSync('/work/out')).toBe(false);
  });

  it('returns Node-style errno for bad descriptors, access modes, kinds, and ranges', async () => {
    const fs = fixture();
    fs.mkdirSync('/work/dir', { recursive: false });
    const { go } = createEsbuildCallbackFs(fs, '/work');
    expect(await rejectedCode(open(go, 'missing.txt', go.constants.O_RDONLY))).toBe('ENOENT');

    const directory = await open(go, 'dir', go.constants.O_RDONLY | go.constants.O_DIRECTORY);
    expect(await rejectedCode(read(go, directory, 1, null))).toBe('EISDIR');
    const writeOnly = await open(go, 'plain.txt', go.constants.O_WRONLY);
    expect(await rejectedCode(read(go, writeOnly, 1, null))).toBe('EBADF');
    const readOnly = await open(go, 'input.txt', go.constants.O_RDONLY);
    expect(await rejectedCode(write(go, readOnly, 'x', null))).toBe('EBADF');
    expect(
      await rejectedCode(
        callbackValue((callback) => go.read(readOnly, new Uint8Array(1), 1, 1, null, callback)),
      ),
    ).toBe('EINVAL');
    expect(await rejectedCode(callbackVoid((callback) => go.close(99, callback)))).toBe('EBADF');
    expect(await rejectedCode(callbackVoid((callback) => go.unlink('dir', callback)))).toBe(
      'EISDIR',
    );
    expect(await rejectedCode(callbackVoid((callback) => go.rmdir('plain.txt', callback)))).toBe(
      'ENOTDIR',
    );
  });

  it('loud-fails unsupported metadata and link operations', async () => {
    const fs = fixture();
    const { go } = createEsbuildCallbackFs(fs, '/work');
    const fd = await open(go, 'plain.txt', go.constants.O_RDONLY);
    expect(
      await rejectedCode(callbackVoid((callback) => go.chmod('plain.txt', 0o600, callback))),
    ).toBe('ENOSYS');
    expect(await rejectedCode(callbackVoid((callback) => go.fchmod(fd, 0o600, callback)))).toBe(
      'ENOSYS',
    );
    expect(
      await rejectedCode(callbackVoid((callback) => go.link('plain.txt', 'hard.txt', callback))),
    ).toBe('ENOSYS');
    expect(
      await rejectedCode(callbackVoid((callback) => go.symlink('plain.txt', 'sym.txt', callback))),
    ).toBe('ENOSYS');
    expect(
      await rejectedCode(callbackValue((callback) => go.readlink('plain.txt', callback))),
    ).toBe('EINVAL');
    expect(
      await rejectedCode(callbackValue((callback) => go.readlink('missing.txt', callback))),
    ).toBe('ENOENT');
  });

  it('keeps a dirty fd retryable when fsync or close reports the backing errno', async () => {
    class FailingMemoryFsSync extends MemoryFsSync implements FsSync {
      failWrites = false;

      override writeFileSync(path: string, data: Uint8Array): void {
        if (this.failWrites) throw new VfsError('EIO', path);
        super.writeFileSync(path, data);
      }
    }

    const fs = new FailingMemoryFsSync();
    fs.loadFixture({ '/work/file.txt': 'old' });
    const { go } = createEsbuildCallbackFs(fs, '/work');
    const fd = await open(go, 'file.txt', go.constants.O_RDWR);
    await write(go, fd, 'new', 0);
    fs.failWrites = true;
    expect(await rejectedCode(callbackVoid((callback) => go.fsync(fd, callback)))).toBe('EIO');
    expect(decoder.decode(fs.readFileBytesSync('/work/file.txt'))).toBe('old');
    expect(await rejectedCode(callbackVoid((callback) => go.close(fd, callback)))).toBe('EIO');
    fs.failWrites = false;
    await callbackVoid((callback) => go.close(fd, callback));
    expect(decoder.decode(fs.readFileBytesSync('/work/file.txt'))).toBe('new');
  });

  it('provides one deferred transform temp-file contract and removes files after reads', async () => {
    const fs = fixture();
    const { transform } = createEsbuildCallbackFs(fs, '/work');
    let callerStack = true;
    const firstPath = await new Promise<string | null>((resolve) => {
      transform.writeFile('large input', (path) => {
        expect(callerStack).toBe(false);
        resolve(path);
      });
      callerStack = false;
    });
    expect(firstPath).toBe('/work/.rifty/esbuild-transform-1.tmp');
    expect(fs.existsSync(firstPath ?? '')).toBe(true);
    const contents = await new Promise<string | null>((resolve, reject) => {
      transform.readFile(firstPath ?? '', (error, value) => {
        if (error !== null) reject(error);
        else resolve(value);
      });
    });
    expect(contents).toBe('large input');
    expect(fs.existsSync(firstPath ?? '')).toBe(false);

    const secondPath = await new Promise<string | null>((resolve) =>
      transform.writeFile(encoder.encode('bytes'), resolve),
    );
    expect(secondPath).toBe('/work/.rifty/esbuild-transform-2.tmp');
  });
});

describe('createEsbuildCallbackFs cwd contract', () => {
  it('rejects a relative cwd instead of silently rooting it', () => {
    expect(() => createEsbuildCallbackFs(fixture(), 'work')).toThrow(
      'esbuild callback fs cwd must be absolute: work',
    );
  });
});
