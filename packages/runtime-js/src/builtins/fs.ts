/**
 * Node-compatible `node:fs` (subset).
 *
 * Sync and async APIs both run against a single in-process tree exposed by
 * `syncMirror()`. Async methods just wrap the sync ones — for the in-memory
 * backend there's no cost, and the OPFS backend (M4+) replaces the mirror
 * with one backed by `FileSystemSyncAccessHandle` inside the Worker.
 *
 * Encoding semantics: callers that don't pass an encoding get a Uint8Array
 * (Buffer-tagged); passing `'utf8'` returns a string. Matches Node.
 */

import { isAbsolute, joinPath, normalizePath } from '@rifty/vfs';
import { Buffer, type Encoding } from './buffer.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import { getProcessCwd } from './process.ts';

/**
 * Resolve a user-facing fs path: bare/relative names are anchored at the
 * runtime's cwd (process.cwd(), default '/'), absolute paths go through
 * normalisation directly. The syncMirror always sees absolute paths.
 */
function resolvePath(p: string | URL | Buffer | Uint8Array): string {
  let str: string;
  if (typeof p === 'string') {
    str = p;
  } else if (p instanceof URL) {
    // Node's fs accepts file:// URLs; decode to a path.
    if (p.protocol !== 'file:') {
      throw Object.assign(new TypeError('Only file: URLs are supported'), {
        code: 'ERR_INVALID_URL_SCHEME',
      });
    }
    str = decodeURIComponent(p.pathname);
  } else if (p instanceof Uint8Array) {
    str = new TextDecoder().decode(p);
  } else {
    throw new TypeError('fs path must be string, Buffer, or URL');
  }
  if (isAbsolute(str)) return normalizePath(str);
  return normalizePath(joinPath(getProcessCwd(), str));
}

type Callback<T> = (err: NodeJS.ErrnoException | null, value?: T) => void;

interface ReadFileOptions {
  encoding?: Encoding | null;
  flag?: string;
}

interface WriteFileOptions extends ReadFileOptions {
  mode?: number;
}

interface MkdirOptions {
  recursive?: boolean;
  mode?: number;
}

interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

class Stats {
  size: number;
  mtimeMs: number;
  private readonly _isFile: boolean;
  private readonly _isDirectory: boolean;
  constructor(vs: { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number }) {
    this.size = vs.size ?? 0;
    this.mtimeMs = vs.mtime ?? 0;
    this._isFile = vs.isFile;
    this._isDirectory = vs.isDirectory;
  }
  isFile(): boolean {
    return this._isFile;
  }
  isDirectory(): boolean {
    return this._isDirectory;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
  get mtime(): Date {
    return new Date(this.mtimeMs);
  }
}

class Dirent {
  readonly name: string;
  private readonly _isFile: boolean;
  private readonly _isDirectory: boolean;
  constructor(d: { name: string; isFile: boolean; isDirectory: boolean }) {
    this.name = d.name;
    this._isFile = d.isFile;
    this._isDirectory = d.isDirectory;
  }
  isFile(): boolean {
    return this._isFile;
  }
  isDirectory(): boolean {
    return this._isDirectory;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}

function toEncodingOrNull(arg: ReadFileOptions | Encoding | null | undefined): Encoding | null {
  if (arg === undefined || arg === null) return null;
  if (typeof arg === 'string') return arg as Encoding;
  return arg.encoding ?? null;
}

function decodeResult(bytes: Uint8Array, encoding: Encoding | null): Uint8Array | string {
  if (!encoding) return Buffer.from(bytes);
  return (Buffer.from(bytes) as Uint8Array & { toString(e?: string): string }).toString(encoding);
}

function encodeData(data: Uint8Array | string, encoding: Encoding | null): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, encoding ?? 'utf8');
  return data;
}

// ─── sync API ─────────────────────────────────────────────────────────────

export function readFileSync(
  p: string,
  opts?: ReadFileOptions | Encoding | null,
): Uint8Array | string {
  const enc = toEncodingOrNull(opts);
  const bytes = syncMirror().readFileBytesSync(resolvePath(p));
  return decodeResult(bytes, enc);
}

export function writeFileSync(
  p: string,
  data: Uint8Array | string,
  opts?: WriteFileOptions | Encoding | null,
): void {
  const enc = toEncodingOrNull(opts);
  syncMirror().writeFileSync(resolvePath(p), encodeData(data, enc));
}

export function appendFileSync(
  p: string,
  data: Uint8Array | string,
  opts?: WriteFileOptions | Encoding | null,
): void {
  const enc = toEncodingOrNull(opts);
  const np = resolvePath(p);
  const existing = syncMirror().existsSync(np)
    ? syncMirror().readFileBytesSync(np)
    : new Uint8Array();
  const next = encodeData(data, enc);
  const merged = new Uint8Array(existing.length + next.length);
  merged.set(existing, 0);
  merged.set(next, existing.length);
  syncMirror().writeFileSync(np, merged);
}

export function readdirSync(p: string, opts?: { withFileTypes?: boolean }): string[] | Dirent[] {
  const entries = syncMirror().readdirSync(resolvePath(p));
  if (opts?.withFileTypes) {
    return entries.map((name) => {
      const child = joinPath(p, name);
      const st = syncMirror().statSync(child);
      return new Dirent({ name, isFile: st.isFile, isDirectory: st.isDirectory });
    });
  }
  return [...entries];
}

export function mkdirSync(p: string, opts?: MkdirOptions): void {
  syncMirror().mkdirSync(resolvePath(p), { recursive: opts?.recursive ?? false });
}

export function statSync(p: string): Stats {
  return new Stats(syncMirror().statSync(resolvePath(p)));
}

export function existsSync(p: string): boolean {
  return syncMirror().existsSync(resolvePath(p));
}

export function unlinkSync(p: string): void {
  syncMirror().rmSync(resolvePath(p), {});
}

export function rmSync(p: string, opts?: RmOptions): void {
  syncMirror().rmSync(resolvePath(p), { recursive: opts?.recursive, force: opts?.force });
}

export function rmdirSync(p: string, opts?: { recursive?: boolean }): void {
  syncMirror().rmSync(resolvePath(p), { recursive: opts?.recursive });
}

export function renameSync(src: string, dst: string): void {
  const data = syncMirror().readFileBytesSync(resolvePath(src));
  syncMirror().writeFileSync(resolvePath(dst), data);
  syncMirror().rmSync(resolvePath(src), {});
}

// VFS has no symlinks: lstat == stat, readlink throws, realpath returns the
// path normalized. Vite + most tooling tolerate this — they only path-check.
export function lstatSync(p: string): Stats {
  return statSync(p);
}

export function readlinkSync(p: string): string {
  const np = resolvePath(p);
  if (!syncMirror().existsSync(np)) {
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT', path: p });
  }
  throw Object.assign(new Error(`EINVAL: ${p}`), { code: 'EINVAL', path: p });
}

function _realpathSyncImpl(p: string): string {
  const np = resolvePath(p);
  if (!syncMirror().existsSync(np)) {
    throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT', path: p });
  }
  return np;
}

// `realpathSync` doubles as a function with a `.native` alias — Node's
// `fs.realpathSync.native` is a separate (C++-backed) implementation; here
// they're the same.
export const realpathSync: ((p: string) => string) & { native: (p: string) => string } =
  Object.assign(_realpathSyncImpl, { native: _realpathSyncImpl });

export function copyFileSync(src: string, dst: string): void {
  const data = syncMirror().readFileBytesSync(resolvePath(src));
  syncMirror().writeFileSync(resolvePath(dst), data);
}

// ─── promise API (wraps sync — same backing store) ────────────────────────

export const promises = {
  async readFile(
    p: string,
    opts?: ReadFileOptions | Encoding | null,
  ): Promise<Uint8Array | string> {
    return readFileSync(p, opts);
  },
  async writeFile(
    p: string,
    data: Uint8Array | string,
    opts?: WriteFileOptions | Encoding | null,
  ): Promise<void> {
    writeFileSync(p, data, opts);
  },
  async appendFile(
    p: string,
    data: Uint8Array | string,
    opts?: WriteFileOptions | Encoding | null,
  ): Promise<void> {
    appendFileSync(p, data, opts);
  },
  async readdir(p: string, opts?: { withFileTypes?: boolean }): Promise<string[] | Dirent[]> {
    return readdirSync(p, opts);
  },
  async mkdir(p: string, opts?: MkdirOptions): Promise<void> {
    mkdirSync(p, opts);
  },
  async rm(p: string, opts?: RmOptions): Promise<void> {
    rmSync(p, opts);
  },
  async rmdir(p: string, opts?: { recursive?: boolean }): Promise<void> {
    rmdirSync(p, opts);
  },
  async unlink(p: string): Promise<void> {
    unlinkSync(p);
  },
  async stat(p: string): Promise<Stats> {
    return statSync(p);
  },
  async lstat(p: string): Promise<Stats> {
    return lstatSync(p);
  },
  async readlink(p: string): Promise<string> {
    return readlinkSync(p);
  },
  async realpath(p: string): Promise<string> {
    return realpathSync(p);
  },
  async access(p: string): Promise<void> {
    if (!existsSync(p)) {
      throw Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT', path: p });
    }
  },
  async copyFile(src: string, dst: string): Promise<void> {
    copyFileSync(src, dst);
  },
  async rename(src: string, dst: string): Promise<void> {
    renameSync(src, dst);
  },
};

// ─── callback API (wraps the promise API) ─────────────────────────────────

export function readFile(
  p: string,
  opts: ReadFileOptions | Encoding | null | Callback<Uint8Array | string>,
  cb?: Callback<Uint8Array | string>,
): void {
  const optsFinal = typeof opts === 'function' ? null : opts;
  const cbFinal = (typeof opts === 'function' ? opts : cb) as Callback<Uint8Array | string>;
  promises.readFile(p, optsFinal).then(
    (v) => cbFinal(null, v),
    (e) => cbFinal(e as NodeJS.ErrnoException),
  );
}

export function writeFile(
  p: string,
  data: Uint8Array | string,
  opts: WriteFileOptions | Encoding | null | Callback<void>,
  cb?: Callback<void>,
): void {
  const optsFinal = typeof opts === 'function' ? null : opts;
  const cbFinal = (typeof opts === 'function' ? opts : cb) as Callback<void>;
  promises.writeFile(p, data, optsFinal).then(
    () => cbFinal(null),
    (e) => cbFinal(e as NodeJS.ErrnoException),
  );
}

export function readdir(p: string, cb: Callback<string[]>): void {
  promises.readdir(p).then(
    (v) => cb(null, v as string[]),
    (e) => cb(e as NodeJS.ErrnoException),
  );
}

export function mkdir(
  p: string,
  optsOrCb: MkdirOptions | Callback<void>,
  cb?: Callback<void>,
): void {
  const opts = typeof optsOrCb === 'function' ? {} : optsOrCb;
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) as Callback<void>;
  promises.mkdir(p, opts).then(
    () => cbFinal(null),
    (e) => cbFinal(e as NodeJS.ErrnoException),
  );
}

export function stat(p: string, cb: Callback<Stats>): void {
  promises.stat(p).then(
    (v) => cb(null, v),
    (e) => cb(e as NodeJS.ErrnoException),
  );
}

export function unlink(p: string, cb: Callback<void>): void {
  promises.unlink(p).then(
    () => cb(null),
    (e) => cb(e as NodeJS.ErrnoException),
  );
}

export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
};

export { Stats, Dirent };
export { createReadStream, createWriteStream } from './fs-streams.ts';
export { watch, watchFile, unwatchFile, FSWatcher } from './fs-watch.ts';
import { FSWatcher, unwatchFile, watch, watchFile } from './fs-watch.ts';

const fs = {
  promises,
  readFile,
  writeFile,
  readdir,
  mkdir,
  stat,
  unlink,
  readFileSync,
  writeFileSync,
  appendFileSync,
  readdirSync,
  mkdirSync,
  statSync,
  existsSync,
  unlinkSync,
  rmSync,
  rmdirSync,
  renameSync,
  copyFileSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  constants,
  Stats,
  Dirent,
  watch,
  watchFile,
  unwatchFile,
  FSWatcher,
};
export default fs;

// eslint-disable-next-line @typescript-eslint/no-namespace
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ErrnoException extends Error {
      code?: string;
      errno?: number;
      path?: string;
      syscall?: string;
    }
  }
}
