/**
 * Node-compatible `node:fs` (subset).
 *
 * Sync and async APIs share one in-process tree via `syncMirror()`; async wraps
 * sync. OPFS backend (M4+) swaps the mirror for a `FileSystemSyncAccessHandle`
 * one inside the Worker.
 *
 * Encoding: no encoding → Uint8Array (Buffer-tagged); `'utf8'` → string. Matches
 * Node.
 */

import { bytesToString } from '@riftydev/io';
import { isAbsolute, joinPath, normalizePath } from '@riftydev/vfs';
import { Buffer, type Encoding } from './buffer.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import { getProcessCwd } from './process.ts';

/**
 * Resolve a user-facing fs path: relative names anchor at the runtime's cwd
 * (process.cwd(), default '/'); absolute paths are normalised directly. The
 * syncMirror always sees absolute paths.
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
  // No encoding: return an owned, mutable Buffer copy (Node binary-read
  // contract). With encoding: decode zero-copy via io's shared codec (ADR-0082)
  // instead of an intermediate Buffer.from copy.
  if (!encoding) return Buffer.from(bytes);
  return bytesToString(bytes, encoding);
}

function encodeData(data: Uint8Array | string, encoding: Encoding | null): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, encoding ?? 'utf8');
  return data;
}

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
    return entries.map(
      (d) => new Dirent({ name: d.name, isFile: d.isFile, isDirectory: d.isDirectory }),
    );
  }
  return entries.map((d) => d.name);
}

export function mkdirSync(p: string, opts?: MkdirOptions): void {
  syncMirror().mkdirSync(resolvePath(p), { recursive: opts?.recursive ?? false });
}

/**
 * `fs.statSync(path[, options])`.
 *
 * Honours Node v24 `throwIfNoEntry`: `false` returns `undefined` for a missing
 * path instead of throwing `ENOENT`. Real packages probe with this idiom
 * (opencode's `Filesystem.stat` does `statSync(p, { throwIfNoEntry: false }) ??
 * undefined`; its shell-tool resolution walls on a thrown ENOENT). Overloaded so
 * 1-arg callers keep the `Stats` return; only the `{ throwIfNoEntry: false }`
 * form widens to `Stats | undefined`. Other errors (and a miss without the opt)
 * throw.
 */
export function statSync(p: string): Stats;
export function statSync(p: string, options: { throwIfNoEntry: false }): Stats | undefined;
export function statSync(p: string, options?: { throwIfNoEntry?: boolean }): Stats | undefined {
  try {
    return new Stats(syncMirror().statSync(resolvePath(p)));
  } catch (err) {
    if (options?.throwIfNoEntry === false && (err as { code?: string } | null)?.code === 'ENOENT') {
      return undefined;
    }
    throw err;
  }
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

// VFS has no symlinks until M12, so `lstat` === `stat` and `realpath` is just
// the normalised absolute path. These are CORRECT for our fs model, not stubs:
// real packages hit them on the happy path (chokidar/Vite's watcher calls
// `fs.realpath`/`fs.lstat`; an earlier loud-throw aborted `vite createServer`).
// Ratified by ADR-0050 (reverses the prior `NotImplementedError`).
// TODO(M12): when a symlink layer lands, revisit `lstatSync`/`realpathSync`/
// `readlinkSync`/`Stats.isSymbolicLink()` together to resolve/inspect links.
export function lstatSync(p: string): Stats {
  return statSync(p);
}

export function readlinkSync(p: string): string {
  // No symlinks: a path either doesn't exist (ENOENT) or is not a link (EINVAL).
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

// Node's `fs.realpathSync.native` is a separate (C++) impl; with no symlinks
// it's identical to ours.
export const realpathSync: ((p: string) => string) & { native: (p: string) => string } =
  Object.assign(_realpathSyncImpl, { native: _realpathSyncImpl });

export function copyFileSync(src: string, dst: string): void {
  const data = syncMirror().readFileBytesSync(resolvePath(src));
  syncMirror().writeFileSync(resolvePath(dst), data);
}

/**
 * `node:fs.utimesSync(path, atime, mtime)` — accepts numeric seconds (Node
 * semantics) or `Date`. The VFS sync surface stores ms, so we convert.
 * (ADR-0029)
 */
function toMs(t: number | Date): number {
  if (t instanceof Date) return t.getTime();
  // Node treats numeric args as seconds since the epoch.
  return Math.floor(t * 1000);
}

export function utimesSync(p: string, atime: number | Date, mtime: number | Date): void {
  syncMirror().utimes(resolvePath(p), toMs(atime), toMs(mtime));
}

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
  async utimes(p: string, atime: number | Date, mtime: number | Date): Promise<void> {
    utimesSync(p, atime, mtime);
  },
};

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

export function readdir(
  p: string,
  optsOrCb: { withFileTypes?: boolean } | Callback<string[] | Dirent[]>,
  cb?: Callback<string[] | Dirent[]>,
): void {
  const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) as Callback<string[] | Dirent[]>;
  promises.readdir(p, opts).then(
    (v) => cbFinal(null, v),
    (e) => cbFinal(e as NodeJS.ErrnoException),
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

export function lstat(p: string, cb: Callback<Stats>): void {
  promises.lstat(p).then(
    (v) => cb(null, v),
    (e) => cb(e as NodeJS.ErrnoException),
  );
}

const _realpath = (p: string, cb: Callback<string>): void => {
  promises.realpath(p).then(
    (v) => cb(null, v),
    (e) => cb(e as NodeJS.ErrnoException),
  );
};
// `fs.realpath.native` mirrors `realpathSync.native` — chokidar/promisify reach
// for the callback form; some code reads `.native`.
export const realpath: typeof _realpath & { native: typeof _realpath } = Object.assign(_realpath, {
  native: _realpath,
});

export function readlink(p: string, cb: Callback<string>): void {
  promises.readlink(p).then(
    (v) => cb(null, v),
    (e) => cb(e as NodeJS.ErrnoException),
  );
}

export function access(p: string, modeOrCb: number | Callback<void>, cb?: Callback<void>): void {
  const cbFinal = (typeof modeOrCb === 'function' ? modeOrCb : cb) as Callback<void>;
  promises.access(p).then(
    () => cbFinal(null),
    (e) => cbFinal(e as NodeJS.ErrnoException),
  );
}

export function copyFile(
  src: string,
  dst: string,
  modeOrCb: number | Callback<void>,
  cb?: Callback<void>,
): void {
  const cbFinal = (typeof modeOrCb === 'function' ? modeOrCb : cb) as Callback<void>;
  promises.copyFile(src, dst).then(
    () => cbFinal(null),
    (e) => cbFinal(e as NodeJS.ErrnoException),
  );
}

export function rename(src: string, dst: string, cb: Callback<void>): void {
  promises.rename(src, dst).then(
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
  lstat,
  realpath,
  readlink,
  access,
  copyFile,
  rename,
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
  utimesSync,
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
