import { type FsSync, VfsError, dirname, isAbsolute, normalizePath } from '@riftydev/vfs';

export interface EsbuildFsError extends Error {
  readonly code: string;
}

export type EsbuildFsCallback = (error: EsbuildFsError | null, value?: unknown) => void;

export interface EsbuildCallbackStats {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
  readonly nlink: number;
  readonly uid: number;
  readonly gid: number;
  readonly rdev: number;
  readonly size: number;
  readonly blksize: number;
  readonly blocks: number;
  readonly atimeMs: number;
  readonly mtimeMs: number;
  readonly ctimeMs: number;
  isDirectory(): boolean;
  isFile(): boolean;
  isSymbolicLink(): false;
  isBlockDevice(): false;
  isCharacterDevice(): false;
  isFIFO(): false;
  isSocket(): false;
}

export interface EsbuildCallbackFs {
  readonly constants: {
    readonly O_RDONLY: number;
    readonly O_WRONLY: number;
    readonly O_RDWR: number;
    readonly O_CREAT: number;
    readonly O_EXCL: number;
    readonly O_TRUNC: number;
    readonly O_APPEND: number;
    readonly O_DIRECTORY: number;
  };
  read(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: EsbuildFsCallback,
  ): void;
  write(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: EsbuildFsCallback,
  ): void;
  writeSync(fd: number, buffer: Uint8Array): number;
  open(path: string, flags: number, mode: number, callback: EsbuildFsCallback): void;
  close(fd: number, callback: EsbuildFsCallback): void;
  fstat(fd: number, callback: EsbuildFsCallback): void;
  stat(path: string, callback: EsbuildFsCallback): void;
  lstat(path: string, callback: EsbuildFsCallback): void;
  readdir(path: string, callback: EsbuildFsCallback): void;
  mkdir(path: string, mode: number, callback: EsbuildFsCallback): void;
  rename(from: string, to: string, callback: EsbuildFsCallback): void;
  unlink(path: string, callback: EsbuildFsCallback): void;
  rmdir(path: string, callback: EsbuildFsCallback): void;
  truncate(path: string, length: number, callback: EsbuildFsCallback): void;
  ftruncate(fd: number, length: number, callback: EsbuildFsCallback): void;
  fsync(fd: number, callback: EsbuildFsCallback): void;
  readlink(path: string, callback: EsbuildFsCallback): void;
  link(path: string, target: string, callback: EsbuildFsCallback): void;
  symlink(path: string, target: string, callback: EsbuildFsCallback): void;
  chmod(path: string, mode: number, callback: EsbuildFsCallback): void;
  fchmod(fd: number, mode: number, callback: EsbuildFsCallback): void;
  chown(path: string, uid: number, gid: number, callback: EsbuildFsCallback): void;
  fchown(fd: number, uid: number, gid: number, callback: EsbuildFsCallback): void;
  lchown(path: string, uid: number, gid: number, callback: EsbuildFsCallback): void;
  utimes(path: string, atime: number, mtime: number, callback: EsbuildFsCallback): void;
}

export interface EsbuildTransformTempFs {
  readFile(
    path: string,
    callback: (error: EsbuildFsError | null, contents: string | null) => void,
  ): void;
  writeFile(contents: string | Uint8Array, callback: (path: string | null) => void): void;
}

export interface EsbuildRuntimeFs {
  readonly go: EsbuildCallbackFs;
  readonly transform: EsbuildTransformTempFs;
}

const O_RDONLY = 0o0;
const O_WRONLY = 0o1;
const O_RDWR = 0o2;
const ACCESS_MODE = 0o3;
const O_CREAT = 0o100;
const O_EXCL = 0o200;
const O_TRUNC = 0o1000;
const O_APPEND = 0o2000;
const O_DIRECTORY = 0o200000;
const S_IFREG = 0o100000;
const S_IFDIR = 0o40000;

interface OpenFile {
  readonly path: string;
  readonly kind: 'file' | 'directory';
  readonly accessMode: number;
  readonly append: boolean;
  bytes: Uint8Array;
  position: number;
  dirty: boolean;
}

function fsError(code: string, target: string): EsbuildFsError {
  return Object.assign(new Error(`${code}: ${target}`), { code });
}

function errorCode(error: unknown): string | null {
  if (error instanceof VfsError) return error.code;
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { readonly code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function toFsError(error: unknown, target: string): EsbuildFsError {
  const code = errorCode(error);
  if (code !== null) {
    const message = error instanceof Error ? error.message : `${code}: ${target}`;
    return Object.assign(new Error(message), { code });
  }
  const detail = error instanceof Error ? error.message : String(error);
  return fsError('EIO', `${target}: ${detail}`);
}

function validRange(buffer: Uint8Array, offset: number, length: number): boolean {
  return (
    Number.isInteger(offset) &&
    Number.isInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset + length <= buffer.length
  );
}

function validPosition(position: number | null): boolean {
  return position === null || (Number.isInteger(position) && position >= 0);
}

function validLength(length: number): boolean {
  return Number.isInteger(length) && length >= 0;
}

export function createEsbuildCallbackFs(fs: FsSync, cwd: string): EsbuildRuntimeFs {
  if (!isAbsolute(cwd)) throw new TypeError(`esbuild callback fs cwd must be absolute: ${cwd}`);
  const root = normalizePath(cwd);
  const files = new Map<number, OpenFile>();
  const inodes = new Map<string, number>();
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let nextFd = 3;
  let nextInode = 1;
  let nextTempFile = 1;
  let protocolRead: EsbuildCallbackFs['read'] | null = null;
  let protocolWriteSync: EsbuildCallbackFs['writeSync'] | null = null;

  const resolvePath = (path: string): string =>
    normalizePath(isAbsolute(path) ? path : `${root}/${path}`);
  const defer = (operation: () => void): void => queueMicrotask(operation);
  const succeed = (callback: EsbuildFsCallback, value?: unknown): void =>
    defer(() => callback(null, value));
  const fail = (callback: EsbuildFsCallback, error: EsbuildFsError): void =>
    defer(() => callback(error));

  function inode(path: string): number {
    let value = inodes.get(path);
    if (value === undefined) {
      value = nextInode;
      nextInode += 1;
      inodes.set(path, value);
    }
    return value;
  }

  function stats(
    path: string,
    stat: { readonly isDirectory: boolean; readonly size?: number; readonly mtime?: number },
  ): EsbuildCallbackStats {
    const directory = stat.isDirectory;
    const size = directory ? 0 : (stat.size ?? 0);
    const mtimeMs = stat.mtime ?? 0;
    return {
      dev: 1,
      ino: inode(path),
      mode: (directory ? S_IFDIR : S_IFREG) | (directory ? 0o755 : 0o644),
      nlink: 1,
      uid: 0,
      gid: 0,
      rdev: 0,
      size,
      blksize: 4096,
      blocks: Math.ceil(size / 512),
      atimeMs: mtimeMs,
      mtimeMs,
      ctimeMs: mtimeMs,
      isDirectory: () => directory,
      isFile: () => !directory,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  function tracked(fd: number, callback: EsbuildFsCallback): OpenFile | null {
    const file = files.get(fd);
    if (file === undefined) {
      fail(callback, fsError('EBADF', `fd ${fd}`));
      return null;
    }
    return file;
  }

  function readable(fd: number, callback: EsbuildFsCallback): OpenFile | null {
    const file = tracked(fd, callback);
    if (file === null) return null;
    if (file.kind === 'directory') {
      fail(callback, fsError('EISDIR', file.path));
      return null;
    }
    if (file.accessMode === O_WRONLY) {
      fail(callback, fsError('EBADF', `fd ${fd}`));
      return null;
    }
    return file;
  }

  function writable(fd: number, callback: EsbuildFsCallback): OpenFile | null {
    const file = tracked(fd, callback);
    if (file === null) return null;
    if (file.kind === 'directory') {
      fail(callback, fsError('EISDIR', file.path));
      return null;
    }
    if (file.accessMode === O_RDONLY) {
      fail(callback, fsError('EBADF', `fd ${fd}`));
      return null;
    }
    return file;
  }

  function writeAt(file: OpenFile, chunk: Uint8Array, position: number): void {
    if (position + chunk.length > file.bytes.length) {
      const grown = new Uint8Array(position + chunk.length);
      grown.set(file.bytes);
      file.bytes = grown;
    }
    file.bytes.set(chunk, position);
    file.dirty = true;
  }

  function flush(file: OpenFile): void {
    if (!file.dirty || file.kind === 'directory') return;
    fs.writeFileSync(file.path, file.bytes);
    file.dirty = false;
  }

  function unsupported(callback: EsbuildFsCallback, operation: string): void {
    fail(callback, fsError('ENOSYS', operation));
  }

  const go: EsbuildCallbackFs = {
    constants: {
      O_RDONLY,
      O_WRONLY,
      O_RDWR,
      O_CREAT,
      O_EXCL,
      O_TRUNC,
      O_APPEND,
      O_DIRECTORY,
    },
    get read() {
      return (fd, buffer, offset, length, position, callback): void => {
        if (fd >= 0 && fd <= 2) {
          if (fd === 0 && protocolRead !== null) {
            protocolRead(fd, buffer, offset, length, position, callback);
          } else {
            unsupported(callback, `protocol fd ${fd} read`);
          }
          return;
        }
        if (!validRange(buffer, offset, length) || !validPosition(position)) {
          fail(callback, fsError('EINVAL', `fd ${fd} read range`));
          return;
        }
        const file = readable(fd, callback);
        if (file === null) return;
        const at = position ?? file.position;
        const count = Math.max(0, Math.min(length, file.bytes.length - at));
        buffer.set(file.bytes.subarray(at, at + count), offset);
        if (position === null) file.position = at + count;
        succeed(callback, count);
      };
    },
    set read(read: EsbuildCallbackFs['read']) {
      protocolRead = read;
    },
    get writeSync() {
      return (fd, buffer): number => {
        if (fd >= 0 && fd <= 2) {
          if ((fd === 1 || fd === 2) && protocolWriteSync !== null) {
            return protocolWriteSync(fd, buffer);
          }
          throw fsError('ENOSYS', `protocol fd ${fd} writeSync`);
        }
        const file = files.get(fd);
        if (file === undefined) throw fsError('EBADF', `fd ${fd}`);
        if (file.kind === 'directory') throw fsError('EISDIR', file.path);
        if (file.accessMode === O_RDONLY) throw fsError('EBADF', `fd ${fd}`);
        const at = file.append ? file.bytes.length : file.position;
        writeAt(file, buffer, at);
        file.position = at + buffer.length;
        return buffer.length;
      };
    },
    set writeSync(writeSync: EsbuildCallbackFs['writeSync']) {
      protocolWriteSync = writeSync;
    },
    write(fd, buffer, offset, length, position, callback): void {
      if (fd >= 0 && fd <= 2) {
        if ((fd === 1 || fd === 2) && protocolWriteSync !== null) {
          try {
            succeed(callback, protocolWriteSync(fd, buffer.subarray(offset, offset + length)));
          } catch (error) {
            fail(callback, toFsError(error, `protocol fd ${fd} write`));
          }
        } else {
          unsupported(callback, `protocol fd ${fd} write`);
        }
        return;
      }
      if (!validRange(buffer, offset, length) || !validPosition(position)) {
        fail(callback, fsError('EINVAL', `fd ${fd} write range`));
        return;
      }
      const file = writable(fd, callback);
      if (file === null) return;
      const chunk = buffer.subarray(offset, offset + length);
      const at = file.append ? file.bytes.length : (position ?? file.position);
      writeAt(file, chunk, at);
      if (position === null || file.append) file.position = at + chunk.length;
      succeed(callback, chunk.length);
    },
    open(path, flags, _mode, callback): void {
      const target = resolvePath(path);
      try {
        const accessMode = flags & ACCESS_MODE;
        if (accessMode !== O_RDONLY && accessMode !== O_WRONLY && accessMode !== O_RDWR) {
          fail(callback, fsError('EINVAL', `${target}: access mode ${accessMode}`));
          return;
        }
        const wantsWrite = accessMode !== O_RDONLY;
        if ((flags & O_TRUNC) !== 0 && !wantsWrite) {
          fail(callback, fsError('EINVAL', `${target}: O_TRUNC requires write access`));
          return;
        }
        let stat = fs.statSyncOrNull(target);
        if (stat === null) {
          if ((flags & O_CREAT) === 0) {
            fail(callback, fsError('ENOENT', target));
            return;
          }
          const parent = fs.statSyncOrNull(dirname(target));
          if (parent === null) {
            fail(callback, fsError('ENOENT', dirname(target)));
            return;
          }
          if (!parent.isDirectory) {
            fail(callback, fsError('ENOTDIR', dirname(target)));
            return;
          }
          fs.writeFileSync(target, new Uint8Array(0));
          stat = fs.statSync(target);
        } else if ((flags & O_CREAT) !== 0 && (flags & O_EXCL) !== 0) {
          fail(callback, fsError('EEXIST', target));
          return;
        }
        if ((flags & O_DIRECTORY) !== 0 && !stat.isDirectory) {
          fail(callback, fsError('ENOTDIR', target));
          return;
        }
        if (stat.isDirectory && (wantsWrite || (flags & O_TRUNC) !== 0)) {
          fail(callback, fsError('EISDIR', target));
          return;
        }
        if ((flags & O_TRUNC) !== 0) {
          fs.writeFileSync(target, new Uint8Array(0));
          stat = fs.statSync(target);
        }
        const bytes = stat.isDirectory ? new Uint8Array(0) : fs.readFileBytesSync(target).slice();
        const fd = nextFd;
        nextFd += 1;
        files.set(fd, {
          path: target,
          kind: stat.isDirectory ? 'directory' : 'file',
          accessMode,
          append: wantsWrite && (flags & O_APPEND) !== 0,
          bytes,
          position: 0,
          dirty: false,
        });
        succeed(callback, fd);
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    close(fd, callback): void {
      const file = tracked(fd, callback);
      if (file === null) return;
      try {
        flush(file);
        files.delete(fd);
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, file.path));
      }
    },
    fstat(fd, callback): void {
      const file = tracked(fd, callback);
      if (file === null) return;
      try {
        const current = fs.statSyncOrNull(file.path);
        const base = current ?? {
          isDirectory: file.kind === 'directory',
          size: file.bytes.length,
        };
        succeed(
          callback,
          stats(file.path, {
            ...base,
            size: file.kind === 'directory' ? 0 : file.bytes.length,
          }),
        );
      } catch (error) {
        fail(callback, toFsError(error, file.path));
      }
    },
    stat(path, callback): void {
      const target = resolvePath(path);
      try {
        const stat = fs.statSyncOrNull(target);
        if (stat === null) fail(callback, fsError('ENOENT', target));
        else succeed(callback, stats(target, stat));
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    lstat(path, callback): void {
      go.stat(path, callback);
    },
    readdir(path, callback): void {
      const target = resolvePath(path);
      try {
        succeed(
          callback,
          fs.readdirSync(target).map((entry) => entry.name),
        );
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    mkdir(path, _mode, callback): void {
      const target = resolvePath(path);
      try {
        fs.mkdirSync(target, { recursive: false });
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    rename(from, to, callback): void {
      const source = resolvePath(from);
      const target = resolvePath(to);
      try {
        fs.renameSync(source, target);
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, source));
      }
    },
    unlink(path, callback): void {
      const target = resolvePath(path);
      try {
        const stat = fs.statSyncOrNull(target);
        if (stat === null) {
          fail(callback, fsError('ENOENT', target));
          return;
        }
        if (stat.isDirectory) {
          fail(callback, fsError('EISDIR', target));
          return;
        }
        fs.rmSync(target, { force: false });
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    rmdir(path, callback): void {
      const target = resolvePath(path);
      try {
        const stat = fs.statSyncOrNull(target);
        if (stat === null) {
          fail(callback, fsError('ENOENT', target));
          return;
        }
        if (!stat.isDirectory) {
          fail(callback, fsError('ENOTDIR', target));
          return;
        }
        fs.rmSync(target, { recursive: false });
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    truncate(path, length, callback): void {
      const target = resolvePath(path);
      if (!validLength(length)) {
        fail(callback, fsError('EINVAL', `${target}: length ${length}`));
        return;
      }
      try {
        const current = fs.readFileBytesSync(target);
        const resized = new Uint8Array(length);
        resized.set(current.subarray(0, Math.min(length, current.length)));
        fs.writeFileSync(target, resized);
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    ftruncate(fd, length, callback): void {
      if (!validLength(length)) {
        fail(callback, fsError('EINVAL', `fd ${fd}: length ${length}`));
        return;
      }
      const file = writable(fd, callback);
      if (file === null) return;
      const resized = new Uint8Array(length);
      resized.set(file.bytes.subarray(0, Math.min(length, file.bytes.length)));
      file.bytes = resized;
      file.dirty = true;
      succeed(callback);
    },
    fsync(fd, callback): void {
      const file = tracked(fd, callback);
      if (file === null) return;
      try {
        flush(file);
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, file.path));
      }
    },
    readlink(path, callback): void {
      const target = resolvePath(path);
      try {
        if (fs.statSyncOrNull(target) === null) fail(callback, fsError('ENOENT', target));
        else fail(callback, fsError('EINVAL', target));
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
    link(path, _target, callback): void {
      unsupported(callback, `link ${resolvePath(path)}`);
    },
    symlink(path, _target, callback): void {
      unsupported(callback, `symlink ${resolvePath(path)}`);
    },
    chmod(path, _mode, callback): void {
      unsupported(callback, `chmod ${resolvePath(path)}`);
    },
    fchmod(fd, _mode, callback): void {
      if (tracked(fd, callback) === null) return;
      unsupported(callback, `fchmod fd ${fd}`);
    },
    chown(path, _uid, _gid, callback): void {
      unsupported(callback, `chown ${resolvePath(path)}`);
    },
    fchown(fd, _uid, _gid, callback): void {
      if (tracked(fd, callback) === null) return;
      unsupported(callback, `fchown fd ${fd}`);
    },
    lchown(path, _uid, _gid, callback): void {
      unsupported(callback, `lchown ${resolvePath(path)}`);
    },
    utimes(path, atime, mtime, callback): void {
      const target = resolvePath(path);
      try {
        fs.utimes(target, atime * 1000, mtime * 1000);
        succeed(callback);
      } catch (error) {
        fail(callback, toFsError(error, target));
      }
    },
  };

  const transform: EsbuildTransformTempFs = {
    readFile(path, callback): void {
      const target = resolvePath(path);
      defer(() => {
        try {
          const contents = decoder.decode(fs.readFileBytesSync(target));
          try {
            fs.rmSync(target, { force: false });
          } catch {
            // Native esbuild temp reads return contents even if cleanup loses a race.
          }
          callback(null, contents);
        } catch (error) {
          callback(toFsError(error, target), null);
        }
      });
    },
    writeFile(contents, callback): void {
      const target = resolvePath(`.rifty/esbuild-transform-${nextTempFile}.tmp`);
      nextTempFile += 1;
      defer(() => {
        try {
          fs.mkdirSync(dirname(target), { recursive: true });
          fs.writeFileSync(
            target,
            typeof contents === 'string' ? encoder.encode(contents) : contents,
          );
          callback(target);
        } catch {
          callback(null);
        }
      });
    },
  };

  return { go, transform };
}
