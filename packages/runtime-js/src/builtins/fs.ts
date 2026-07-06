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

import { NotImplementedError, bytesToString } from '@riftydev/io';
import { VfsError } from '@riftydev/vfs';
import { Buffer, type Encoding } from './buffer.ts';
import { fsError, withSyscall } from './fs-errors.ts';
import { type PathLike, pathToString, resolvePath } from './fs-path.ts';
import { syncMirror } from './fs-sync-mirror.ts';

type Callback<T> = (err: NodeJS.ErrnoException | null, value?: T) => void;
type OpenFlags = string | number;
type FdCallback = (err: NodeJS.ErrnoException | null, fd?: number) => void;
type VoidCallback = (err: NodeJS.ErrnoException | null) => void;
type ReadCallback = (
  err: NodeJS.ErrnoException | null,
  bytesRead?: number,
  buffer?: Uint8Array,
) => void;
type WriteCallback = (
  err: NodeJS.ErrnoException | null,
  bytesWritten?: number,
  data?: Uint8Array | string,
) => void;
type StatsCallback = (err: NodeJS.ErrnoException | null, stats?: Stats) => void;
type DirCallback = (err: NodeJS.ErrnoException | null, dir?: Dir) => void;

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

interface StatOptions {
  bigint?: boolean;
}

interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

interface CpOptions {
  recursive?: boolean;
  /** Called per entry with the src/dest paths AS PASSED (relative stays relative); falsy → skip. */
  filter?: (src: string, dest: string) => boolean;
  /** Overwrite an existing dest (Node default true); `false` skips it (or errors with errorOnExist). */
  force?: boolean;
  errorOnExist?: boolean;
  preserveTimestamps?: boolean;
  /** Follow symlinks — N/A under the no-symlink VFS (ADR-0050); loud-throws. */
  dereference?: boolean;
}

interface FdRecord {
  path: string;
  readable: boolean;
  writable: boolean;
  append: boolean;
  position: number;
}

interface ParsedOpenFlags {
  readable: boolean;
  writable: boolean;
  create: boolean;
  exclusive: boolean;
  truncate: boolean;
  append: boolean;
  directory: boolean;
}

interface FdReadOptions {
  offset?: number;
  length?: number;
  position?: number | null;
}

const fdTable = new Map<number, FdRecord>();
let nextFd = 3;

// fsError / withSyscall / FS_ERRNO live in fs-errors.ts (shared with
// fs-streams.ts); pathToString / resolvePath in fs-path.ts.

/**
 * Strict preflight probe for open-semantics entry points (openSync + flagged
 * read/write + access): only a true miss is `null`; ENOTDIR through a file
 * propagates (Node: `open 'plain.txt/deep'` → ENOTDIR). The non-throwing
 * `statSyncOrNull`/`existsSync` probes collapse that case to "missing" —
 * correct for the module resolver's candidate walk (ADR-0083), wrong here.
 */
function statStrictOrNull(np: string): { isFile: boolean; isDirectory: boolean } | null {
  try {
    return syncMirror().statSync(np);
  } catch (err) {
    if (err instanceof VfsError && err.code === 'ENOENT') return null;
    throw err;
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function checkedSliceBounds(buffer: Uint8Array, offset: number, length: number): void {
  assertNonNegativeInteger(offset, 'offset');
  assertNonNegativeInteger(length, 'length');
  if (offset + length > buffer.byteLength) {
    throw new RangeError('offset + length exceeds buffer length');
  }
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
  /**
   * Directory this entry lives in, echoing the path ARG passed to `readdir`
   * (relative stays relative); for `{ recursive: true }` it's the arg joined with
   * the subdirectory. Node v24 REMOVED the deprecated `path` alias, so it's
   * absent here too.
   */
  readonly parentPath: string;
  private readonly _isFile: boolean;
  private readonly _isDirectory: boolean;
  constructor(d: { name: string; isFile: boolean; isDirectory: boolean; parentPath: string }) {
    this.name = d.name;
    this.parentPath = d.parentPath;
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

class Dir implements AsyncIterable<Dirent> {
  readonly path: string;
  readonly #entries: Dirent[];
  #index = 0;
  #closed = false;

  constructor(path: string, entries: Dirent[]) {
    this.path = path;
    this.#entries = entries;
  }

  readSync(): Dirent | null {
    this.#assertOpen();
    const entry = this.#entries[this.#index];
    if (!entry) return null;
    this.#index += 1;
    return entry;
  }

  read(): Promise<Dirent | null>;
  read(cb: (err: NodeJS.ErrnoException | null, dirent?: Dirent | null) => void): void;
  read(cb?: (err: NodeJS.ErrnoException | null, dirent?: Dirent | null) => void) {
    if (cb) {
      Promise.resolve()
        .then(() => this.readSync())
        .then(
          (dirent) => cb(null, dirent),
          (err) => cb(err as NodeJS.ErrnoException),
        );
      return;
    }
    return Promise.resolve().then(() => this.readSync());
  }

  closeSync(): void {
    this.#assertOpen();
    this.#closed = true;
  }

  close(): Promise<void>;
  close(cb: (err: NodeJS.ErrnoException | null) => void): void;
  close(cb?: (err: NodeJS.ErrnoException | null) => void) {
    if (cb) {
      Promise.resolve()
        .then(() => this.closeSync())
        .then(
          () => cb(null),
          (err) => cb(err as NodeJS.ErrnoException),
        );
      return;
    }
    return Promise.resolve().then(() => this.closeSync());
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Dirent> {
    try {
      while (true) {
        const entry = this.readSync();
        if (entry === null) return;
        yield entry;
      }
    } finally {
      this.closeSync();
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw fsError('ERR_DIR_CLOSED', this.path, 'readdir');
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

function assertStatOptions(opts: StatOptions | undefined, feature: string): void {
  if (opts?.bigint === true) throw new NotImplementedError(feature);
}

function parseOpenFlags(flags: OpenFlags): ParsedOpenFlags {
  const numeric = typeof flags === 'number' ? flags : openFlagsFromString(flags);
  if (!Number.isInteger(numeric) || numeric < 0) throw fsError('EINVAL', undefined, 'open');

  // ADR-0153: classify flag bits. Behavioral flags rifty implements; inert flags are no-ops
  // on a regular VFS file (accepted, like Node); durability flags can't be honored (OPFS flush
  // is async/batched) → loud NotImplementedError at the syscall; anything else → EINVAL.
  const behavioral =
    constants.O_WRONLY |
    constants.O_RDWR |
    constants.O_CREAT |
    constants.O_EXCL |
    constants.O_TRUNC |
    constants.O_APPEND |
    constants.O_DIRECTORY;
  const inert =
    constants.O_NOCTTY |
    constants.O_NONBLOCK |
    constants.O_NOFOLLOW |
    constants.O_DIRECT |
    constants.O_NOATIME;
  const durability = constants.O_SYNC; // O_SYNC's bit pattern subsumes the O_DSYNC bit
  if ((numeric & ~(behavioral | inert | durability)) !== 0)
    throw fsError('EINVAL', undefined, 'open');
  if ((numeric & durability) !== 0) throw new NotImplementedError('fs.openSync.O_SYNC');

  const access = numeric & 3;
  if (access === 3) throw fsError('EINVAL', undefined, 'open');
  const writable = access === constants.O_WRONLY || access === constants.O_RDWR;
  const readable = access === constants.O_RDONLY || access === constants.O_RDWR;
  const truncate = (numeric & constants.O_TRUNC) !== 0;
  const append = (numeric & constants.O_APPEND) !== 0;
  if ((truncate || append) && !writable) throw fsError('EINVAL', undefined, 'open');

  return {
    readable,
    writable,
    create: (numeric & constants.O_CREAT) !== 0,
    exclusive: (numeric & constants.O_EXCL) !== 0,
    truncate,
    append,
    directory: (numeric & constants.O_DIRECTORY) !== 0,
  };
}

function openFlagsFromString(flags: string): number {
  switch (flags) {
    case 'r':
      return constants.O_RDONLY;
    case 'r+':
      return constants.O_RDWR;
    case 'w':
      return constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC;
    case 'wx':
    case 'xw':
      return constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
    case 'w+':
      return constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC;
    case 'wx+':
    case 'xw+':
      return constants.O_RDWR | constants.O_CREAT | constants.O_TRUNC | constants.O_EXCL;
    case 'a':
      return constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND;
    case 'ax':
    case 'xa':
      return constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_EXCL;
    case 'a+':
      return constants.O_RDWR | constants.O_CREAT | constants.O_APPEND;
    case 'ax+':
    case 'xa+':
      return constants.O_RDWR | constants.O_CREAT | constants.O_APPEND | constants.O_EXCL;
    case 'rs':
    case 'sr':
    case 'rs+':
    case 'sr+':
    case 'as':
    case 'sa':
    case 'as+':
    case 'sa+':
      throw new NotImplementedError('fs.openSync.O_SYNC');
    default:
      throw fsError('EINVAL', undefined, 'open');
  }
}

// Node attributes a bad-fd EBADF to the FAILING op's syscall ('read'/'write'/
// 'ftruncate'/'fstat'…), never a synthetic 'fd' (review 2026-07-05 handoff #3).
function getFd(fd: number, syscall: string): FdRecord {
  const record = fdTable.get(fd);
  if (!record) throw fsError('EBADF', undefined, syscall);
  return record;
}

/**
 * Node open(2) preflight shared by `openSync` and the flagged
 * `readFileSync`/`writeFileSync`/`appendFileSync` branches (review 2026-07-05
 * handoff #2: four hand-rolled copies drifted — flagged directory reads fell
 * through to a read-shaped EISDIR, appendFile raised EISDIR where Node's
 * O_EXCL existence check wins with EEXIST). Check order matches Node:
 * EEXIST (O_CREAT|O_EXCL) → ENOTDIR (O_DIRECTORY on non-dir) → EISDIR
 * (writable/truncating a directory) → ENOENT (miss without O_CREAT); applies
 * the create/truncate open side effects. All failures are open-shaped.
 */
function openPreflight(p: PathLike, parsed: ParsedOpenFlags): { existed: boolean } {
  const np = resolvePath(p);
  const ps = pathToString(p);
  const stat = withSyscall('open', p, () => statStrictOrNull(np));
  if (stat) {
    if (parsed.create && parsed.exclusive) throw fsError('EEXIST', ps, 'open');
    if (parsed.directory && !stat.isDirectory) throw fsError('ENOTDIR', ps, 'open');
    if (stat.isDirectory && (parsed.writable || parsed.truncate)) {
      throw fsError('EISDIR', ps, 'open');
    }
    if (parsed.truncate && stat.isFile) {
      withSyscall('open', p, () => syncMirror().writeFileSync(np, new Uint8Array()));
    }
  } else {
    if (!parsed.create || parsed.directory) throw fsError('ENOENT', ps, 'open');
    withSyscall('open', p, () => syncMirror().writeFileSync(np, new Uint8Array()));
  }
  return { existed: stat !== null };
}

function resizeFile(path: string, len: number): void {
  assertNonNegativeInteger(len, 'len');
  const current = syncMirror().readFileBytesSync(path);
  const next = new Uint8Array(len);
  next.set(current.subarray(0, Math.min(current.byteLength, len)));
  syncMirror().writeFileSync(path, next);
}

function writeBytesAt(record: FdRecord, bytes: Uint8Array, position: number | null): number {
  if (!record.writable) throw fsError('EBADF', undefined, 'write');
  const stat = withSyscall('write', record.path, () => syncMirror().statSync(record.path));
  if (stat.isDirectory) throw fsError('EISDIR', undefined, 'write');

  const existing = withSyscall('write', record.path, () =>
    syncMirror().readFileBytesSync(record.path),
  );
  const start = record.append ? existing.byteLength : (position ?? record.position);
  assertNonNegativeInteger(start, 'position');

  const next = new Uint8Array(Math.max(existing.byteLength, start + bytes.byteLength));
  next.set(existing);
  next.set(bytes, start);
  withSyscall('write', record.path, () => syncMirror().writeFileSync(record.path, next));
  if (position === null || record.append) record.position = start + bytes.byteLength;
  return bytes.byteLength;
}

function randomMkdtempSuffix(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(6);
  const webCrypto = globalThis.crypto;
  if (webCrypto?.getRandomValues) {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function flagOf(opts: ReadFileOptions | Encoding | null | undefined): string | undefined {
  return opts !== null && typeof opts === 'object' ? opts.flag : undefined;
}

export function readFileSync(
  p: string,
  opts?: ReadFileOptions | Encoding | null,
): Uint8Array | string {
  const enc = toEncodingOrNull(opts);
  const np = resolvePath(p);
  const ps = pathToString(p);
  const flag = flagOf(opts);
  // Honor the `flag` option through the shared open preflight (was: silently
  // ignored): 'a+'/'w+' create a missing file, 'wx'-family raises EEXIST, a
  // writable flag on a directory is EISDIR at OPEN (handoff #2), etc.
  if (flag !== undefined && flag !== 'r') {
    const parsed = parseOpenFlags(flag);
    openPreflight(p, parsed);
    if (!parsed.readable) throw fsError('EBADF', ps, 'read');
  }
  const bytes = withSyscall({ default: 'open', EISDIR: 'read' }, p, () =>
    syncMirror().readFileBytesSync(np),
  );
  return decodeResult(bytes, enc);
}

export function writeFileSync(
  p: string,
  data: Uint8Array | string,
  opts?: WriteFileOptions | Encoding | null,
): void {
  writeFileImpl(p, data, opts, 'w');
}

export function appendFileSync(
  p: string,
  data: Uint8Array | string,
  opts?: WriteFileOptions | Encoding | null,
): void {
  writeFileImpl(p, data, opts, 'a');
}

/**
 * Shared body of `writeFileSync`/`appendFileSync` — in Node they are the SAME
 * operation modulo the default flag ('w' vs 'a'), both honoring an explicit
 * `flag` through open semantics. One impl (review 2026-07-05 handoff #2: the
 * two hand-rolled flag branches drifted — writeFileSync `r+` truncated the
 * tail Node preserves). Flag semantics after {@link openPreflight}:
 * append → concat at EOF; truncate/created → plain write; 'r+' on an existing
 * file → write from offset 0 PRESERVING the tail beyond the data.
 */
function writeFileImpl(
  p: string,
  data: Uint8Array | string,
  opts: WriteFileOptions | Encoding | null | undefined,
  defaultFlag: 'w' | 'a',
): void {
  const enc = toEncodingOrNull(opts);
  const np = resolvePath(p);
  const ps = pathToString(p);
  const flag = flagOf(opts) ?? defaultFlag;
  const parsed = parseOpenFlags(flag);
  const next = encodeData(data, enc);
  // 'w'/'w+' fast path: plain overwrite, one mirror call (errors open-shaped).
  // Keep behavioral gates here in sync with openPreflight: numeric flags can
  // smuggle O_DIRECTORY alongside the w-family bits, and that must be checked
  // before any write happens.
  if (
    parsed.truncate &&
    parsed.create &&
    !parsed.exclusive &&
    !parsed.append &&
    !parsed.directory
  ) {
    withSyscall('open', p, () => syncMirror().writeFileSync(np, next));
    return;
  }
  const { existed } = openPreflight(p, parsed);
  if (!parsed.writable) throw fsError('EBADF', ps, 'write');
  if (parsed.append) {
    withSyscall('open', p, () => {
      const existing = existed ? syncMirror().readFileBytesSync(np) : new Uint8Array();
      const merged = new Uint8Array(existing.length + next.length);
      merged.set(existing, 0);
      merged.set(next, existing.length);
      syncMirror().writeFileSync(np, merged);
    });
    return;
  }
  if (parsed.truncate || !existed) {
    withSyscall('open', p, () => syncMirror().writeFileSync(np, next));
    return;
  }
  withSyscall('open', p, () => {
    const existing = syncMirror().readFileBytesSync(np);
    const merged = new Uint8Array(Math.max(existing.length, next.length));
    merged.set(existing, 0);
    merged.set(next, 0);
    syncMirror().writeFileSync(np, merged);
  });
}

export function readdirSync(
  p: string,
  opts?: { withFileTypes?: boolean; recursive?: boolean },
): string[] | Dirent[] {
  return withSyscall('scandir', p, () => readdirSyncImpl(p, opts));
}

function readdirSyncImpl(
  p: string,
  opts?: { withFileTypes?: boolean; recursive?: boolean },
): string[] | Dirent[] {
  const root = resolvePath(p);
  if (opts?.recursive) {
    // Breadth-first full-tree walk (Node-identical ordering): each directory's
    // sorted children, level by level. `names` collect the relative path from the
    // arg; `Dirent.parentPath` echoes the arg joined with the containing subdir.
    const names: string[] = [];
    const dirents: Dirent[] = [];
    const queue: Array<{ absDir: string; relPrefix: string; displayDir: string }> = [
      { absDir: root, relPrefix: '', displayDir: p },
    ];
    for (let i = 0; i < queue.length; i++) {
      const { absDir, relPrefix, displayDir } = queue[i] as {
        absDir: string;
        relPrefix: string;
        displayDir: string;
      };
      for (const d of syncMirror().readdirSync(absDir)) {
        const childRel = relPrefix ? `${relPrefix}/${d.name}` : d.name;
        if (opts.withFileTypes) {
          dirents.push(
            new Dirent({
              name: d.name,
              isFile: d.isFile,
              isDirectory: d.isDirectory,
              parentPath: displayDir,
            }),
          );
        } else {
          names.push(childRel);
        }
        if (d.isDirectory) {
          queue.push({
            absDir: `${absDir}/${d.name}`,
            relPrefix: childRel,
            displayDir: `${displayDir}/${d.name}`,
          });
        }
      }
    }
    return opts.withFileTypes ? dirents : names;
  }
  const entries = syncMirror().readdirSync(root);
  if (opts?.withFileTypes) {
    return entries.map(
      (d) =>
        new Dirent({ name: d.name, isFile: d.isFile, isDirectory: d.isDirectory, parentPath: p }),
    );
  }
  return entries.map((d) => d.name);
}

export function mkdirSync(p: string, opts?: MkdirOptions): void {
  withSyscall('mkdir', p, () =>
    syncMirror().mkdirSync(resolvePath(p), { recursive: opts?.recursive ?? false }),
  );
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
    return withSyscall('stat', p, () => new Stats(syncMirror().statSync(resolvePath(p))));
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (options?.throwIfNoEntry === false && (code === 'ENOENT' || code === 'ENOTDIR')) {
      return undefined;
    }
    throw err;
  }
}

export function existsSync(p: string): boolean {
  return syncMirror().existsSync(resolvePath(p));
}

// Remove-family kind gates (review 2026-07-05 handoff r3): the generic VFS
// rmSync removes any empty-or-file path, so each Node entry point enforces
// its own target-kind contract here — unlink never removes a directory,
// plain rm refuses one, rmdir refuses a file (the gate below).

export function unlinkSync(p: string): void {
  withSyscall('unlink', p, () => {
    const np = resolvePath(p);
    // Errno persona: Linux EISDIR (FS_ERRNO's Linux ABI + the WASI layer's
    // E_ISDIR choice); darwin Node reports EPERM — host-divergent, so the
    // guard is conformance-pinned, not parity-pinned.
    if (syncMirror().statSyncOrNull(np)?.isDirectory) throw new VfsError('EISDIR', np);
    syncMirror().rmSync(np, {});
  });
}

export function rmSync(p: string, opts?: RmOptions): void {
  const np = resolvePath(p);
  // Node's rm refuses ANY directory without `recursive` — ERR_FS_EISDIR, a
  // JS-layer SystemError (POSITIVE errno, message embeds the path AS PASSED).
  // `force` does not suppress it, and a non-empty dir is the SAME error, not
  // ENOTEMPTY (probed v24). Parity: fs/error-shape-errno-syscall.
  if (!opts?.recursive && syncMirror().statSyncOrNull(np)?.isDirectory) {
    const ps = pathToString(p);
    throw Object.assign(
      new Error(`Path is a directory: rm returned EISDIR (is a directory) ${ps}`),
      { name: 'SystemError', code: 'ERR_FS_EISDIR', errno: 21, syscall: 'rm', path: ps },
    );
  }
  // Node's rm stats the target before removing — a missing path (without
  // `force`) reports syscall 'lstat', not 'unlink'.
  try {
    withSyscall('lstat', p, () =>
      syncMirror().rmSync(np, { recursive: opts?.recursive, force: opts?.force }),
    );
  } catch (err) {
    if (opts?.recursive && opts?.force && (err as { code?: string } | null)?.code === 'ENOTDIR') {
      return;
    }
    throw err;
  }
}

export function rmdirSync(p: string, opts?: { recursive?: boolean }): void {
  withSyscall('rmdir', p, () => {
    const np = resolvePath(p);
    // Node parity: rmdir on a non-directory is ENOTDIR — the shared rmSync
    // backend happily unlinks files, which would silently DELETE them here.
    const st = syncMirror().statSyncOrNull(np);
    if (st && !st.isDirectory) throw new VfsError('ENOTDIR', np);
    syncMirror().rmSync(np, { recursive: opts?.recursive });
  });
}

export function renameSync(src: string, dst: string): void {
  // ADR-0090: native VFS rename — atomic-where-possible and mtime-preserving
  // (the prior read+write+rm restamped mtime and copied subtrees).
  withSyscall(
    'rename',
    src,
    () => syncMirror().renameSync(resolvePath(src), resolvePath(dst)),
    pathToString(dst),
  );
}

// VFS has no symlinks until M12, so `lstat` === `stat` and `realpath` is just
// the normalised absolute path. These are CORRECT for our fs model, not stubs:
// real packages hit them on the happy path (chokidar/Vite's watcher calls
// `fs.realpath`/`fs.lstat`; an earlier loud-throw aborted `vite createServer`).
// Ratified by ADR-0050 (reverses the prior `NotImplementedError`).
// TODO(M12): when a symlink layer lands, revisit `lstatSync`/`realpathSync`/
// `readlinkSync`/`Stats.isSymbolicLink()` together to resolve/inspect links.
export function lstatSync(p: string): Stats {
  return withSyscall('lstat', p, () => new Stats(syncMirror().statSync(resolvePath(p))));
}

export function readlinkSync(p: string): string {
  // No symlinks: a path either doesn't exist (ENOENT) or is not a link (EINVAL).
  const np = resolvePath(p);
  const ps = pathToString(p);
  withSyscall('readlink', p, () => syncMirror().statSync(np));
  throw fsError('EINVAL', ps, 'readlink');
}

function _realpathSyncImpl(p: string): string {
  const np = resolvePath(p);
  // Node absolutizes before the failing lstat, so the error path is the
  // RESOLVED one (unlike the as-passed rule everywhere else).
  withSyscall('lstat', np, () => syncMirror().statSync(np));
  return np;
}

// Node's `fs.realpathSync.native` is a separate (C++) impl; with no symlinks
// it's identical to ours.
export const realpathSync: ((p: string) => string) & { native: (p: string) => string } =
  Object.assign(_realpathSyncImpl, { native: _realpathSyncImpl });

export function copyFileSync(src: string, dst: string, mode = 0): void {
  const knownModes =
    constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE | constants.COPYFILE_FICLONE_FORCE;
  if (!Number.isInteger(mode) || mode < 0 || (mode & ~knownModes) !== 0) {
    throw fsError('EINVAL', undefined, 'copyfile');
  }
  // ADR-0153: FICLONE is best-effort — falls back to a plain copy (like Node on a non-reflink
  // fs); FICLONE_FORCE demands a reflink the VFS can't provide → loud gap at the syscall.
  if ((mode & constants.COPYFILE_FICLONE_FORCE) !== 0) {
    throw new NotImplementedError('fs.copyFileSync.COPYFILE_FICLONE_FORCE');
  }
  const srcAbs = resolvePath(src);
  const dstAbs = resolvePath(dst);
  // Source is opened before COPYFILE_EXCL checks the destination: a missing
  // source reports ENOENT/copyfile even when dst already exists.
  withSyscall('copyfile', src, () => syncMirror().statSync(srcAbs), dst);
  if ((mode & constants.COPYFILE_EXCL) !== 0 && existsSync(dst)) {
    throw fsError('EEXIST', src, 'copyfile', dst);
  }
  // ADR-0090: native VFS copy (single regular file; dst mtime=now). FICLONE degrades here.
  withSyscall('copyfile', src, () => syncMirror().copyFileSync(srcAbs, dstAbs), dst);
}

export function cpSync(src: string, dst: string, opts?: CpOptions): void {
  if (opts?.dereference) {
    // Node SUPPORTS dereference; rifty has no symlinks (ADR-0050) so there's
    // nothing to follow — loud gap, never a silent same-as-without.
    throw new NotImplementedError('fs.cpSync.dereference');
  }
  // Fast path (preserves ADR-0090 + the VFS cpSync guards) when no edge option
  // changes behaviour: a plain (possibly recursive) overwrite copy.
  const hasEdge =
    !!opts &&
    (opts.filter !== undefined ||
      opts.force === false ||
      !!opts.errorOnExist ||
      !!opts.preserveTimestamps);
  if (!hasEdge) {
    // TODO(backlog: runtime-js/fs-cp-type-mismatch-error-codes) — VFS cpSync surfaces
    // EISDIR/EEXIST for file→dir / dir→file overwrites; Node uses ERR_FS_CP_NON_DIR_TO_DIR
    // / ERR_FS_CP_DIR_TO_NON_DIR.
    const srcAbs = resolvePath(src);
    const dstAbs = resolvePath(dst);
    // Node's cp lstats the source first: a missing src reports `lstat` on src.
    withSyscall('lstat', src, () => syncMirror().statSync(srcAbs));
    withSyscall({ default: 'copyfile', ENOTDIR: 'lstat' }, dst, () =>
      syncMirror().cpSync(srcAbs, dstAbs, { recursive: opts?.recursive }),
    );
    return;
  }
  cpEntry(resolvePath(src), resolvePath(dst), src, dst, opts as CpOptions);
}

/** Recursive copy honoring the cp edge options, in the runtime-js layer over VFS sync primitives. */
function cpEntry(
  srcAbs: string,
  dstAbs: string,
  srcDisplay: string,
  dstDisplay: string,
  opts: CpOptions,
): void {
  if (opts.filter && !opts.filter(srcDisplay, dstDisplay)) return; // skip entry (+ subtree for a dir)
  const st = withSyscall('lstat', srcDisplay, () => syncMirror().statSync(srcAbs));
  if (st.isDirectory) {
    if (!opts.recursive) throw fsError('EISDIR', srcAbs, 'cp');
    withSyscall('lstat', dstDisplay, () => syncMirror().mkdirSync(dstAbs, { recursive: true }));
    for (const child of withSyscall('scandir', srcDisplay, () =>
      syncMirror().readdirSync(srcAbs),
    )) {
      cpEntry(
        `${srcAbs}/${child.name}`,
        `${dstAbs}/${child.name}`,
        `${srcDisplay}/${child.name}`,
        `${dstDisplay}/${child.name}`,
        opts,
      );
    }
    return;
  }
  if (syncMirror().existsSync(dstAbs) && opts.force === false) {
    if (opts.errorOnExist) {
      throw Object.assign(
        // Node's message: no `[CODE]:` prefix, the resolved path inside the parens AND a
        // trailing SystemError path suffix — `Target already exists: cp returned EEXIST
        // (<abs> already exists) <abs>`; the code lives on `.code`.
        new Error(`Target already exists: cp returned EEXIST (${dstAbs} already exists) ${dstAbs}`),
        { code: 'ERR_FS_CP_EEXIST', path: dstAbs },
      );
    }
    return; // force:false → skip an existing file
  }
  withSyscall({ default: 'copyfile', ENOTDIR: 'lstat' }, dstDisplay, () =>
    syncMirror().copyFileSync(srcAbs, dstAbs),
  );
  if (opts.preserveTimestamps) {
    const m = withSyscall('stat', srcDisplay, () => syncMirror().statSync(srcAbs)).mtime ?? 0;
    withSyscall('utime', dstDisplay, () => syncMirror().utimes(dstAbs, m, m));
  }
}

export function openSync(p: PathLike, flags: OpenFlags = 'r', _mode?: number): number {
  const parsed = parseOpenFlags(flags);
  openPreflight(p, parsed);
  const fd = nextFd++;
  fdTable.set(fd, {
    path: resolvePath(p),
    readable: parsed.readable,
    writable: parsed.writable,
    append: parsed.append,
    position: 0,
  });
  return fd;
}

export function closeSync(fd: number): void {
  if (!fdTable.delete(fd)) throw fsError('EBADF', undefined, 'close');
}

export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: number | null,
): number;
export function readSync(fd: number, buffer: Uint8Array, options?: FdReadOptions): number;
export function readSync(
  fd: number,
  buffer: Uint8Array,
  offsetOrOptions: number | FdReadOptions = 0,
  length?: number,
  position?: number | null,
): number {
  const record = getFd(fd, 'read');
  if (!record.readable) throw fsError('EBADF', undefined, 'read');
  if (!(buffer instanceof Uint8Array)) throw new TypeError('buffer must be a Uint8Array');

  const offset =
    typeof offsetOrOptions === 'number' ? offsetOrOptions : (offsetOrOptions.offset ?? 0);
  const count =
    typeof offsetOrOptions === 'number'
      ? (length ?? buffer.byteLength - offset)
      : (offsetOrOptions.length ?? buffer.byteLength - offset);
  const rawPos =
    typeof offsetOrOptions === 'number' ? (position ?? null) : (offsetOrOptions.position ?? null);
  // Node: position -1 (and null) means "read from the current fd position".
  const pos = rawPos === -1 ? null : rawPos;
  checkedSliceBounds(buffer, offset, count);
  if (pos !== null) assertNonNegativeInteger(pos, 'position');

  const stat = withSyscall('read', record.path, () => syncMirror().statSync(record.path));
  if (stat.isDirectory) throw fsError('EISDIR', undefined, 'read');
  const bytes = withSyscall('read', record.path, () => syncMirror().readFileBytesSync(record.path));
  const start = pos ?? record.position;
  const end = Math.min(bytes.byteLength, start + count);
  const read = Math.max(0, end - start);
  if (read > 0) buffer.set(bytes.subarray(start, end), offset);
  if (pos === null) record.position += read;
  return read;
}

export function writeSync(
  fd: number,
  buffer: Uint8Array,
  offset?: number,
  length?: number,
  position?: number | null,
): number;
export function writeSync(
  fd: number,
  str: string,
  position?: number | null,
  encoding?: Encoding,
): number;
export function writeSync(
  fd: number,
  data: Uint8Array | string,
  offsetOrPosition?: number | null,
  lengthOrEncoding?: number | Encoding,
  position?: number | null,
): number {
  const record = getFd(fd, 'write');
  if (typeof data === 'string') {
    const rawPos =
      typeof offsetOrPosition === 'number' || offsetOrPosition === null ? offsetOrPosition : null;
    const enc = typeof lengthOrEncoding === 'string' ? lengthOrEncoding : 'utf8';
    return writeBytesAt(record, Buffer.from(data, enc), rawPos === -1 ? null : rawPos);
  }
  if (!(data instanceof Uint8Array)) throw new TypeError('data must be a string or Uint8Array');
  const offset = offsetOrPosition ?? 0;
  const length = typeof lengthOrEncoding === 'number' ? lengthOrEncoding : data.byteLength - offset;
  // Node: position -1 (and null) means "write at the current fd position".
  const rawPos = position ?? null;
  const pos = rawPos === -1 ? null : rawPos;
  checkedSliceBounds(data, offset, length);
  return writeBytesAt(record, data.subarray(offset, offset + length), pos);
}

export function fstatSync(fd: number): Stats {
  const record = getFd(fd, 'fstat');
  return withSyscall('fstat', record.path, () => new Stats(syncMirror().statSync(record.path)));
}

export function ftruncateSync(fd: number, len = 0): void {
  const record = getFd(fd, 'ftruncate');
  // Node: ftruncate on a non-writable fd (read-only file OR directory) is
  // EINVAL, not EBADF (probed v24, review 2026-07-05 handoff #3).
  if (!record.writable) throw fsError('EINVAL', undefined, 'ftruncate');
  withSyscall('ftruncate', record.path, () => resizeFile(record.path, len));
}

export function truncateSync(p: PathLike, len = 0): void {
  withSyscall('open', p, () => resizeFile(resolvePath(p), len));
}

export function mkdtempSync(
  prefix: PathLike,
  _opts?: Encoding | { encoding?: Encoding | null },
): string {
  const prefixText = pathToString(prefix);
  for (let attempt = 0; attempt < 128; attempt++) {
    const candidate = `${prefixText}${randomMkdtempSuffix()}`;
    try {
      mkdirSync(resolvePath(candidate));
      return candidate;
    } catch (err) {
      if ((err as { code?: string }).code !== 'EEXIST') throw err;
    }
  }
  throw fsError('EEXIST', prefixText, 'mkdtemp');
}

export function opendirSync(
  p: PathLike,
  _opts?: { encoding?: Encoding; bufferSize?: number },
): Dir {
  const displayPath = pathToString(p);
  // 'opendir' is PATHLESS in Node's rendering — withSyscall omits the name.
  const entries = withSyscall(
    'opendir',
    p,
    () => readdirSyncImpl(p as string, { withFileTypes: true }) as Dirent[],
  );
  return new Dir(displayPath, entries.slice());
}

/**
 * `node:fs.utimesSync(path, atime, mtime)` — accepts numeric seconds (Node
 * semantics) or `Date`. The VFS sync surface stores ms, so we convert.
 * (ADR-0029)
 */
function toMs(t: number | string | Date): number {
  if (t instanceof Date) return t.getTime();
  // Node's `toUnixTimestamp`: a numeric string coerces, a finite number is seconds
  // since the epoch; anything else (NaN/Infinity/non-numeric string/null/…) is a loud
  // ERR_INVALID_ARG_TYPE — never a silent NaN handed to the VFS.
  const n = typeof t === 'string' ? Number(t) : t;
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    const e = new TypeError('The "time" argument must be of type number, string, or Date.');
    (e as { code?: string }).code = 'ERR_INVALID_ARG_TYPE';
    throw e;
  }
  return Math.floor(n * 1000);
}

export function utimesSync(p: string, atime: number | Date, mtime: number | Date): void {
  withSyscall('utime', p, () => syncMirror().utimes(resolvePath(p), toMs(atime), toMs(mtime)));
}

// `fs.lutimesSync` — under the no-symlink VFS model (ADR-0050) a path is never a
// link, so setting "the link's" times is exactly setting the file's (same
// precedent as `lstatSync === statSync`).
export function lutimesSync(p: string, atime: number | Date, mtime: number | Date): void {
  utimesSync(p, atime, mtime);
}

// `fs.futimesSync` — resolve the fd → path via the fd table and delegate to VFS
// utimes. `EBADF` (syscall `futime`, matching Node) on an unknown fd.
export function futimesSync(fd: number, atime: number | Date, mtime: number | Date): void {
  const record = getFd(fd, 'futime');
  withSyscall('futime', record.path, () =>
    syncMirror().utimes(record.path, toMs(atime), toMs(mtime)),
  );
}

export function futimes(
  fd: number,
  atime: number | Date,
  mtime: number | Date,
  cb: VoidCallback,
): void {
  Promise.resolve()
    .then(() => futimesSync(fd, atime, mtime))
    .then(
      () => cb(null),
      (e) => cb(e as NodeJS.ErrnoException),
    );
}

/**
 * `fs.openAsBlob(path[, options])` (v19.8) — read the VFS bytes into a resolved
 * `Blob` (default `type` is `''`). Eager read: observably identical to Node's
 * lazy read for an in-memory VFS within one program. `Blob` is a realm global.
 */
export async function openAsBlob(p: PathLike, options?: { type?: string }): Promise<Blob> {
  let bytes: Uint8Array;
  try {
    bytes = syncMirror().readFileBytesSync(resolvePath(p));
  } catch {
    // Node wraps an unopenable path (missing file / directory) as a generic
    // ERR_INVALID_ARG_VALUE, NOT the raw ENOENT — match that observable rejection.
    throw Object.assign(new Error('Unable to open file as blob'), {
      code: 'ERR_INVALID_ARG_VALUE',
    });
  }
  // Copy into a fresh ArrayBuffer-backed view: the VFS bytes may be SharedArrayBuffer-
  // backed (OPFS mode), which `Blob` cannot hold (Blob copies the bytes regardless).
  return new Blob([new Uint8Array(bytes)], { type: options?.type ?? '' });
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
  async readdir(
    p: string,
    opts?: { withFileTypes?: boolean; recursive?: boolean },
  ): Promise<string[] | Dirent[]> {
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
  async stat(p: string, opts?: StatOptions): Promise<Stats> {
    assertStatOptions(opts, 'fs.promises.stat.bigint');
    return statSync(p);
  },
  async lstat(p: string, opts?: StatOptions): Promise<Stats> {
    assertStatOptions(opts, 'fs.promises.lstat.bigint');
    return lstatSync(p);
  },
  async readlink(p: string): Promise<string> {
    return readlinkSync(p);
  },
  async realpath(p: string): Promise<string> {
    return realpathSync(p);
  },
  async access(p: string): Promise<void> {
    // Strict probe: access through a file is ENOTDIR (Node), never ENOENT.
    const st = withSyscall('access', p, () => statStrictOrNull(resolvePath(p)));
    if (st === null) throw fsError('ENOENT', pathToString(p), 'access');
  },
  async copyFile(src: string, dst: string, mode = 0): Promise<void> {
    copyFileSync(src, dst, mode);
  },
  async rename(src: string, dst: string): Promise<void> {
    renameSync(src, dst);
  },
  async cp(src: string, dst: string, opts?: CpOptions): Promise<void> {
    cpSync(src, dst, opts);
  },
  async truncate(p: PathLike, len = 0): Promise<void> {
    truncateSync(p, len);
  },
  async mkdtemp(
    prefix: PathLike,
    opts?: Encoding | { encoding?: Encoding | null },
  ): Promise<string> {
    return mkdtempSync(prefix, opts);
  },
  async opendir(p: PathLike, opts?: { encoding?: Encoding; bufferSize?: number }): Promise<Dir> {
    return opendirSync(p, opts);
  },
  async utimes(p: string, atime: number | Date, mtime: number | Date): Promise<void> {
    utimesSync(p, atime, mtime);
  },
  async lutimes(p: string, atime: number | Date, mtime: number | Date): Promise<void> {
    lutimesSync(p, atime, mtime);
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

export function open(
  p: PathLike,
  flagsOrCb?: OpenFlags | FdCallback,
  modeOrCb?: number | FdCallback,
  cb?: FdCallback,
): void {
  const flags = typeof flagsOrCb === 'function' || flagsOrCb === undefined ? 'r' : flagsOrCb;
  const cbFinal = (
    typeof flagsOrCb === 'function' ? flagsOrCb : typeof modeOrCb === 'function' ? modeOrCb : cb
  ) as FdCallback;
  const mode = typeof modeOrCb === 'number' ? modeOrCb : undefined;
  Promise.resolve()
    .then(() => openSync(p, flags, mode))
    .then(
      (fd) => cbFinal(null, fd),
      (e) => cbFinal(e as NodeJS.ErrnoException),
    );
}

export function close(fd: number, cb: VoidCallback): void {
  Promise.resolve()
    .then(() => closeSync(fd))
    .then(
      () => cb(null),
      (e) => cb(e as NodeJS.ErrnoException),
    );
}

export function read(
  fd: number,
  bufferOrOptsOrCb: Uint8Array | (FdReadOptions & { buffer?: Uint8Array }) | ReadCallback,
  offsetOrOptions?: number | FdReadOptions | ReadCallback,
  lengthOrCb?: number | ReadCallback,
  positionOrCb?: number | null | ReadCallback,
  cb?: ReadCallback,
): void {
  // Node also accepts read(fd, cb) and read(fd, options, cb) — the buffer
  // defaults to a fresh 16 KiB allocation (fs.read docs).
  if (!(bufferOrOptsOrCb instanceof Uint8Array)) {
    const opts = typeof bufferOrOptsOrCb === 'object' ? bufferOrOptsOrCb : {};
    const cbShort = (
      typeof bufferOrOptsOrCb === 'function' ? bufferOrOptsOrCb : offsetOrOptions
    ) as ReadCallback;
    const buf = opts.buffer ?? Buffer.alloc(16384);
    read(
      fd,
      buf,
      {
        offset: opts.offset ?? 0,
        length: opts.length ?? buf.byteLength,
        position: opts.position ?? null,
      },
      cbShort,
    );
    return;
  }
  const buffer = bufferOrOptsOrCb;
  if (offsetOrOptions === undefined) throw new TypeError('callback is required');
  const options =
    typeof offsetOrOptions === 'object'
      ? offsetOrOptions
      : {
          offset: typeof offsetOrOptions === 'number' ? offsetOrOptions : 0,
          length: typeof lengthOrCb === 'number' ? lengthOrCb : buffer.byteLength,
          position: typeof positionOrCb === 'number' || positionOrCb === null ? positionOrCb : null,
        };
  const cbFinal = (
    typeof offsetOrOptions === 'function'
      ? offsetOrOptions
      : typeof lengthOrCb === 'function'
        ? lengthOrCb
        : typeof positionOrCb === 'function'
          ? positionOrCb
          : cb
  ) as ReadCallback;
  Promise.resolve()
    .then(() => readSync(fd, buffer, options))
    .then(
      (bytesRead) => cbFinal(null, bytesRead, buffer),
      (e) => cbFinal(e as NodeJS.ErrnoException),
    );
}

export function write(
  fd: number,
  data: Uint8Array | string,
  offsetOrPositionOrCb?: number | null | WriteCallback,
  lengthOrEncodingOrCb?: number | Encoding | WriteCallback,
  positionOrCb?: number | null | WriteCallback,
  cb?: WriteCallback,
): void {
  const cbFinal = (
    typeof offsetOrPositionOrCb === 'function'
      ? offsetOrPositionOrCb
      : typeof lengthOrEncodingOrCb === 'function'
        ? lengthOrEncodingOrCb
        : typeof positionOrCb === 'function'
          ? positionOrCb
          : cb
  ) as WriteCallback;
  Promise.resolve()
    .then(() => {
      if (typeof data === 'string') {
        const position =
          typeof offsetOrPositionOrCb === 'number' || offsetOrPositionOrCb === null
            ? offsetOrPositionOrCb
            : null;
        const encoding = typeof lengthOrEncodingOrCb === 'string' ? lengthOrEncodingOrCb : 'utf8';
        return writeSync(fd, data, position, encoding);
      }
      const offset = typeof offsetOrPositionOrCb === 'number' ? offsetOrPositionOrCb : 0;
      const length = typeof lengthOrEncodingOrCb === 'number' ? lengthOrEncodingOrCb : undefined;
      const position =
        typeof positionOrCb === 'number' || positionOrCb === null ? positionOrCb : null;
      return writeSync(fd, data, offset, length, position);
    })
    .then(
      (bytesWritten) => cbFinal(null, bytesWritten, data),
      (e) => cbFinal(e as NodeJS.ErrnoException),
    );
}

export function fstat(fd: number, cb: StatsCallback): void {
  Promise.resolve()
    .then(() => fstatSync(fd))
    .then(
      (stats) => cb(null, stats),
      (e) => cb(e as NodeJS.ErrnoException),
    );
}

export function ftruncate(fd: number, lenOrCb?: number | VoidCallback, cb?: VoidCallback): void {
  const len = typeof lenOrCb === 'number' ? lenOrCb : 0;
  const cbFinal = (typeof lenOrCb === 'function' ? lenOrCb : cb) as VoidCallback;
  Promise.resolve()
    .then(() => ftruncateSync(fd, len))
    .then(
      () => cbFinal(null),
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
  optsOrCb: { withFileTypes?: boolean; recursive?: boolean } | Callback<string[] | Dirent[]>,
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

export function stat(p: string, cb: Callback<Stats>): void;
export function stat(p: string, opts: StatOptions, cb: Callback<Stats>): void;
export function stat(
  p: string,
  optsOrCb: StatOptions | Callback<Stats>,
  cb?: Callback<Stats>,
): void {
  const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) as Callback<Stats>;
  promises.stat(p, opts).then(
    (v) => cbFinal(null, v),
    (e) => cbFinal(e as NodeJS.ErrnoException),
  );
}

export function unlink(p: string, cb: Callback<void>): void {
  promises.unlink(p).then(
    () => cb(null),
    (e) => cb(e as NodeJS.ErrnoException),
  );
}

export function lstat(p: string, cb: Callback<Stats>): void;
export function lstat(p: string, opts: StatOptions, cb: Callback<Stats>): void;
export function lstat(
  p: string,
  optsOrCb: StatOptions | Callback<Stats>,
  cb?: Callback<Stats>,
): void {
  const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) as Callback<Stats>;
  promises.lstat(p, opts).then(
    (v) => cbFinal(null, v),
    (e) => cbFinal(e as NodeJS.ErrnoException),
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
  const mode = typeof modeOrCb === 'number' ? modeOrCb : 0;
  const cbFinal = (typeof modeOrCb === 'function' ? modeOrCb : cb) as Callback<void>;
  promises.copyFile(src, dst, mode).then(
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

export function truncate(p: PathLike, lenOrCb?: number | VoidCallback, cb?: VoidCallback): void {
  const len = typeof lenOrCb === 'number' ? lenOrCb : 0;
  const cbFinal = (typeof lenOrCb === 'function' ? lenOrCb : cb) as VoidCallback;
  Promise.resolve()
    .then(() => truncateSync(p, len))
    .then(
      () => cbFinal(null),
      (e) => cbFinal(e as NodeJS.ErrnoException),
    );
}

export function mkdtemp(
  prefix: PathLike,
  optsOrCb?: Encoding | { encoding?: Encoding | null } | Callback<string>,
  cb?: Callback<string>,
): void {
  const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) as Callback<string>;
  Promise.resolve()
    .then(() => mkdtempSync(prefix, opts))
    .then(
      (dir) => cbFinal(null, dir),
      (e) => cbFinal(e as NodeJS.ErrnoException),
    );
}

export function opendir(
  p: PathLike,
  optsOrCb?: { encoding?: Encoding; bufferSize?: number } | DirCallback,
  cb?: DirCallback,
): void {
  const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
  const cbFinal = (typeof optsOrCb === 'function' ? optsOrCb : cb) as DirCallback;
  Promise.resolve()
    .then(() => opendirSync(p, opts))
    .then(
      (dir) => cbFinal(null, dir),
      (e) => cbFinal(e as NodeJS.ErrnoException),
    );
}

// ADR-0153: faithful Node Linux-ABI fs constants (real numeric values; gap lives at the
// syscall boundary in `parseOpenFlags`/`copyFileSync`, not on a constant read). Linux-ABI
// to match the Linux-pinned `os.constants` — excludes macOS-only `O_SYMLINK`. O_* values
// mirror asm-generic/fcntl.h; mode bits / UV_* are POSIX/libuv (cross-platform). Verified
// against the Node oracle by the constants parity case (CI-Linux for the divergent O_*).
export const constants = {
  F_OK: 0,
  R_OK: 4,
  W_OK: 2,
  X_OK: 1,
  O_RDONLY: 0,
  O_WRONLY: 1,
  O_RDWR: 2,
  O_CREAT: 64,
  O_EXCL: 128,
  O_NOCTTY: 256,
  O_TRUNC: 512,
  O_APPEND: 1024,
  O_NONBLOCK: 2048,
  O_DSYNC: 4096,
  O_DIRECT: 16384,
  O_DIRECTORY: 65536,
  O_NOFOLLOW: 131072,
  O_NOATIME: 262144,
  O_SYNC: 1052672,
  S_IFMT: 61440,
  S_IFREG: 32768,
  S_IFDIR: 16384,
  S_IFCHR: 8192,
  S_IFBLK: 24576,
  S_IFIFO: 4096,
  S_IFLNK: 40960,
  S_IFSOCK: 49152,
  S_IRWXU: 448,
  S_IRUSR: 256,
  S_IWUSR: 128,
  S_IXUSR: 64,
  S_IRWXG: 56,
  S_IRGRP: 32,
  S_IWGRP: 16,
  S_IXGRP: 8,
  S_IRWXO: 7,
  S_IROTH: 4,
  S_IWOTH: 2,
  S_IXOTH: 1,
  COPYFILE_EXCL: 1,
  COPYFILE_FICLONE: 2,
  COPYFILE_FICLONE_FORCE: 4,
  UV_FS_O_FILEMAP: 0,
  UV_FS_SYMLINK_DIR: 1,
  UV_FS_SYMLINK_JUNCTION: 2,
  UV_FS_COPYFILE_EXCL: 1,
  UV_FS_COPYFILE_FICLONE: 2,
  UV_FS_COPYFILE_FICLONE_FORCE: 4,
  UV_DIRENT_UNKNOWN: 0,
  UV_DIRENT_FILE: 1,
  UV_DIRENT_DIR: 2,
  UV_DIRENT_LINK: 3,
  UV_DIRENT_FIFO: 4,
  UV_DIRENT_SOCKET: 5,
  UV_DIRENT_CHAR: 6,
  UV_DIRENT_BLOCK: 7,
} as const;

export { Stats, Dirent, Dir };
export { createReadStream, createWriteStream } from './fs-streams.ts';
export { watch, watchFile, unwatchFile, FSWatcher } from './fs-watch.ts';
import {
  FileReadStream,
  FileWriteStream,
  createReadStream,
  createWriteStream,
} from './fs-streams.ts';
import { FSWatcher, unwatchFile, watch, watchFile } from './fs-watch.ts';

const fs = {
  promises,
  open,
  close,
  read,
  write,
  fstat,
  ftruncate,
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
  truncate,
  mkdtemp,
  opendir,
  openSync,
  closeSync,
  readSync,
  writeSync,
  fstatSync,
  ftruncateSync,
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
  cpSync,
  truncateSync,
  mkdtempSync,
  opendirSync,
  utimesSync,
  lutimesSync,
  futimesSync,
  futimes,
  openAsBlob,
  lstatSync,
  readlinkSync,
  realpathSync,
  constants,
  Stats,
  Dirent,
  Dir,
  createReadStream,
  createWriteStream,
  // Node-named stream classes: `destroy`/`send` probe `stream instanceof
  // fs.ReadStream` on cleanup — an absent class makes that probe throw.
  ReadStream: FileReadStream,
  WriteStream: FileWriteStream,
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
