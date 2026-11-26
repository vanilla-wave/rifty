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
import { invalidArgType, outOfRange } from '../internal/node-received.ts';
import { Buffer, type Encoding } from './buffer.ts';
import { at, getOptions, readTwice, validatedPath } from './fs-arguments.ts';
import { type AnyCallback, cbOf, deliver, optional } from './fs-callback.ts';
import { Dir } from './fs-dir.ts';
import { fsError, withSyscall } from './fs-errors.ts';
import { inTurn, ioTurn } from './fs-io-turn.ts';
import { type PathLike, pathToString, resolvePath } from './fs-path.ts';
import {
  type FdReadOptions,
  type ReadPosition,
  assertNonNegativeInteger,
  checkedSliceBounds,
  readPositionOf,
} from './fs-read-arguments.ts';
import { Dirent, type StatOptions, Stats } from './fs-stats.ts';
import { closeStdin, readStdin, readStdinSync, statStdin, writeStdio } from './fs-stdio.ts';
import { syncMirror } from './fs-sync-mirror.ts';
import { setTimes, utimesArgs } from './fs-times.ts';
import { link, linkSync, statfsSync, symlink, symlinkSync } from './loud-members.ts';
import { runNodeCallback } from './process-lifecycle-events.ts';
import { bytesOf, copyBytes, isAnyArrayBuffer, isView, jsViewBytes } from './view-bytes.ts';
const { Uint8Array } = globalThis; // as at load: a program replacing the global changes no write

type OpenFlags = string | number;
type Options = Record<string, unknown>;
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

/**
 * Write data as bytes: a string encoded; a view's memory as the engine's, `byteLength` long as Node's
 * lib/fs reads it (the caller copies a view the store keeps). (Shared)ArrayBuffer: Node's refusal.
 * Other object: its elements, copied; primitive: as given (Node refuses both: fs-write-data-argument-types).
 */
function encodeData(data: Uint8Array | string, encoding: Encoding | null): Uint8Array {
  if (typeof data === 'string') return Buffer.from(data, encoding ?? 'utf8');
  if (isView(data)) return bytesOf(data, 0, data.byteLength);
  if (isAnyArrayBuffer(data)) {
    const expected = 'of type string or an instance of Buffer, TypedArray, or DataView';
    throw invalidArgType('"data" argument', expected, data);
  }
  if (data === null || typeof data !== 'object') return data;
  const own = new Uint8Array((data as ArrayLike<number>).length >>> 0);
  own.set(data as ArrayLike<number>);
  return own;
}

/**
 * One Stats-shaping boundary for every stat surface (statSync/lstatSync/
 * fstatSync + the promises/callback twins). The BigIntStats gap fires HERE —
 * AFTER the underlying stat succeeded — so Node-visible errors keep their
 * priority over the rifty gap throw: `stat(missing, { bigint: true })` is
 * ENOENT and `fstat(badFd, …)` is EBADF in Node, never a bigint error
 * (gap throws only replace Node's SUCCESS path, not its error path).
 * TODO(backlog: runtime-js/fs-watchfile-bigint-stats)
 */
function shapeStats(
  vs: { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number },
  options: StatOptions | undefined,
  feature: string,
): Stats {
  if (options?.bigint === true) throw new NotImplementedError(feature);
  return new Stats(vs);
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
 * EINVAL (O_CREAT|O_DIRECTORY, before any target inspection) →
 * EEXIST (O_CREAT|O_EXCL) → ENOTDIR (O_DIRECTORY on non-dir) → EISDIR
 * (writable/truncating a directory) → ENOENT (miss without O_CREAT); applies
 * the create/truncate open side effects. All failures are open-shaped.
 */
function openPreflight(p: PathLike, parsed: ParsedOpenFlags): { existed: boolean } {
  const np = resolvePath(p);
  const ps = pathToString(p);
  // O_CREAT|O_DIRECTORY is an invalid COMBINATION: EINVAL before any target
  // inspection — existing file, existing dir and missing target all EINVAL
  // (node v24, linux AND darwin; parity: fs/open-flag-target-matrix).
  if (parsed.create && parsed.directory) throw fsError('EINVAL', ps, 'open');
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
  p: string | number,
  opts?: ReadFileOptions | Encoding | null,
): Uint8Array | string {
  const enc = toEncodingOrNull(opts);
  if (typeof p === 'number') {
    const chunks: Uint8Array[] = [];
    for (;;) {
      const buffer = Buffer.alloc(16 * 1024);
      const count = readSync(p, buffer, 0, buffer.length, null);
      if (count === 0) break;
      chunks.push(buffer.subarray(0, count));
    }
    return decodeResult(Buffer.concat(chunks), enc);
  }
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
  // A store may keep what it is given (`MemoryFsSync`), never a guest's memory: one copy of a
  // view; merged writes build their own bytes. A truncating write copies before open's side
  // effects, so a refused copy leaves no file.
  const copy = () => (isView(data) ? copyBytes(next) : next);
  const own = parsed.truncate && !parsed.append ? copy() : undefined;
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
    withSyscall('open', p, () => syncMirror().writeFileSync(np, own ?? copy()));
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
    withSyscall('open', p, () => syncMirror().writeFileSync(np, own ?? copy()));
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
function statImpl(
  p: string,
  options: { throwIfNoEntry?: boolean; bigint?: boolean } | undefined,
  feature: string,
): Stats | undefined {
  try {
    const vs = withSyscall('stat', p, () => syncMirror().statSync(resolvePath(p)));
    return shapeStats(vs, options, feature);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (options?.throwIfNoEntry === false && (code === 'ENOENT' || code === 'ENOTDIR')) {
      return undefined;
    }
    throw err;
  }
}

export function statSync(p: string): Stats;
export function statSync(
  p: string,
  options: { throwIfNoEntry: false; bigint?: boolean },
): Stats | undefined;
export function statSync(
  p: string,
  options?: { throwIfNoEntry?: boolean; bigint?: boolean },
): Stats | undefined {
  return statImpl(p, options, 'fs.statSync.bigint');
}

export function existsSync(p: string): boolean {
  let np: string;
  try {
    np = resolvePath(p);
  } catch {
    return false; // Node: an invalid path (a NUL, a non-path) does not exist
  }
  return syncMirror().existsSync(np);
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

/** Node's `validateRmOptions` type checks (at the call for `fs.rm`). */
function rmOptionsOf(opts: unknown): void {
  if (opts === undefined) return;
  if (typeof opts !== 'object' || opts === null || Array.isArray(opts))
    throw invalidArgType('"options" argument', 'of type object', opts);
  for (const key of ['recursive', 'force'] as const) {
    const value = (opts as RmOptions)[key];
    if (value !== undefined && typeof value !== 'boolean')
      throw invalidArgType(`"options.${key}" property`, 'of type boolean', value);
  }
}

export function rmSync(p: string, opts?: RmOptions): void {
  rmOptionsOf(opts);
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
function lstatImpl(p: string, options: StatOptions | undefined, feature: string): Stats {
  const vs = withSyscall('lstat', p, () => syncMirror().statSync(resolvePath(p)));
  return shapeStats(vs, options, feature);
}

export function lstatSync(p: string, options?: StatOptions): Stats {
  return lstatImpl(p, options, 'fs.lstatSync.bigint');
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
  if (fd === 0) {
    closeStdin();
    return;
  }
  if (!fdTable.delete(fd)) throw fsError('EBADF', undefined, 'close');
}

export function readSync(
  fd: number,
  buffer: Uint8Array,
  offset: number,
  length: number,
  position: ReadPosition,
): number;
export function readSync(fd: number, buffer: Uint8Array, options?: FdReadOptions): number;
export function readSync(
  fd: number,
  buffer: Uint8Array,
  offsetOrOptions: number | FdReadOptions = 0,
  length?: number,
  position?: ReadPosition,
): number {
  if (!(buffer instanceof Uint8Array)) throw new TypeError('buffer must be a Uint8Array');
  const offset =
    typeof offsetOrOptions === 'number' ? offsetOrOptions : (offsetOrOptions.offset ?? 0);
  const count =
    typeof offsetOrOptions === 'number'
      ? (length ?? buffer.byteLength - offset)
      : (offsetOrOptions.length ?? buffer.byteLength - offset);
  const rawPos =
    typeof offsetOrOptions === 'number' ? (position ?? null) : (offsetOrOptions.position ?? null);
  // Node's order: offset, position, then a zero length returns 0 before the fd
  // is touched (a write-only, closed or directory fd included), then bounds.
  assertNonNegativeInteger(offset, 'offset');
  assertNonNegativeInteger(count, 'length');
  const pos = readPositionOf(rawPos, count);
  if (count === 0) return 0;
  const record = fd === 0 ? null : getFd(fd, 'read');
  if (record && !record.readable) throw fsError('EBADF', undefined, 'read');
  checkedSliceBounds(buffer, offset, count);

  if (record === null) return readStdinSync(buffer, offset, count, pos);
  const start = pos ?? record.position;
  // One positional store call (ADR-0576); EISDIR comes from the store.
  const bytes = withSyscall('read', record.path, () =>
    syncMirror().readFileRangeSync(record.path, start, count),
  );
  buffer.set(bytes, offset);
  if (pos === null) record.position += bytes.byteLength;
  return bytes.byteLength;
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
  const record = fd === 1 || fd === 2 ? null : getFd(fd, 'write');
  if (typeof data === 'string') {
    const rawPos =
      typeof offsetOrPosition === 'number' || offsetOrPosition === null ? offsetOrPosition : null;
    const enc = typeof lengthOrEncoding === 'string' ? lengthOrEncoding : 'utf8';
    const bytes = Buffer.from(data, enc);
    return record === null
      ? writeStdio(fd, bytes, rawPos === -1 ? null : rawPos)
      : writeBytesAt(record, bytes, rawPos === -1 ? null : rawPos);
  }
  if (!isView(data)) throw new TypeError('data must be a string or Uint8Array');
  const offset = offsetOrPosition ?? 0;
  const length = typeof lengthOrEncoding === 'number' ? lengthOrEncoding : data.byteLength - offset;
  // Node: position -1 (and null) means "write at the current fd position".
  const rawPos = position ?? null;
  const pos = rawPos === -1 ? null : rawPos;
  checkedSliceBounds(data, offset, length);
  const bytes = bytesOf(data, offset, length);
  return record === null ? writeStdio(fd, bytes, pos) : writeBytesAt(record, bytes, pos);
}

export function fstatSync(fd: number, options?: StatOptions): Stats {
  if (fd === 0) return statStdin(options);
  // EBADF first — Node reports the bad fd before any bigint shaping.
  const record = getFd(fd, 'fstat');
  const vs = withSyscall('fstat', record.path, () => syncMirror().statSync(record.path));
  return shapeStats(vs, options, 'fs.fstatSync.bigint');
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

// 'opendir' is PATHLESS in Node's rendering — withSyscall omits the name.
const dirEntries = (p: PathLike): Dirent[] =>
  withSyscall(
    'opendir',
    p,
    () => readdirSyncImpl(p as string, { withFileTypes: true }) as Dirent[],
  );

/** Node's `Dir` constructor: `{ bufferSize: 32, ...options }`, a positive uint32. */
function dirBufferSize(options: unknown): number {
  const { bufferSize } = { bufferSize: 32, ...getOptions(options, { encoding: 'utf8' }) };
  if (typeof bufferSize !== 'number')
    throw invalidArgType('"options.bufferSize" property', 'of type number', bufferSize);
  if (!Number.isInteger(bufferSize))
    throw outOfRange('options.bufferSize', 'an integer', bufferSize);
  if (bufferSize < 1 || bufferSize > 4_294_967_295)
    throw outOfRange('options.bufferSize', '>= 1 && <= 4294967295', bufferSize);
  return bufferSize;
}

export function opendirSync(p: PathLike, opts?: { encoding?: Encoding; bufferSize?: number }): Dir {
  const o = getOptions(opts, { encoding: 'utf8' });
  const entries = dirEntries(p);
  return new Dir(pathToString(p), entries, dirBufferSize(o));
}

export function utimesSync(p: string, atime: number | Date, mtime: number | Date): void {
  const times = utimesArgs(atime, mtime);
  withSyscall('utime', p, () => setTimes(resolvePath(p), times));
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
  const times = utimesArgs(atime, mtime);
  withSyscall('futime', record.path, () => setTimes(record.path, times));
}

export function futimes(fd: number, atime: unknown, mtime: unknown, cb: unknown) {
  const times = utimesArgs(atime as number, mtime as number);
  const done = cbOf(cb);
  deliver(
    done,
    ioTurn(() =>
      withSyscall('futime', getFd(fd, 'futime').path, () =>
        setTimes(getFd(fd, 'futime').path, times),
      ),
    ),
    true,
  );
}

/**
 * `fs.openAsBlob(path[, options])` (v19.8) — read the VFS bytes into a resolved
 * `Blob` (default `type` is `''`). Eager read: not Node's lazy file-backed Blob (a later change of the
 * file leaves it readable; Node: `NotReadableError`) — backlog runtime-js/fs-open-as-blob-eager-read.
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
  // `globalThis.`: an unbound `Blob` makes esbuild rename the isolate guest's `class Blob` (ADR-0578).
  return new globalThis.Blob([new Uint8Array(bytes)], { type: options?.type ?? '' });
}

/** A promise form: Node's synchronous part (a throw rejects) at the call, its operation in its turn. */
function promised<A extends unknown[], R>(parse: (...args: A) => () => R) {
  return (...args: A): Promise<R> => {
    let operation: () => R;
    try {
      operation = parse(...args);
    } catch (error) {
      return Promise.reject(error);
    }
    return ioTurn(operation);
  };
}

/** Each async API's operation over its call-time record (`fs-arguments.ts`). */
const op = {
  readFile: (r: ReturnType<typeof at.readFile>) => () =>
    readFileSync(r.path as string, { flag: r.flag, encoding: r.encoding() as Encoding }),
  writeFile: (r: ReturnType<typeof at.writeFile>) => () => {
    const bytes = r.promise && isView(r.bytes) ? jsViewBytes(r.bytes) : r.bytes;
    writeFileSync(r.path as string, bytes, { flag: r.flag, mode: r.mode });
    r.late();
  },
  readdir: (r: ReturnType<typeof at.readdir>) => () => readdirSync(r.path, r),
  mkdir: (r: ReturnType<typeof at.mkdir>) => () => {
    mkdirSync(r.path, r);
  },
  rm: (r: ReturnType<typeof at.rm>) => () => rmSync(r.path, r),
  rmdir: (r: ReturnType<typeof at.rmdir>) => () => rmdirSync(r.path, r),
  stat: (r: ReturnType<typeof at.stat>) => (): Stats => {
    const stats = r.lstat
      ? lstatImpl(r.path, r, r.feature)
      : (statImpl(r.path, r, r.feature) as Stats);
    r.late();
    return stats;
  },
  realpath: (r: ReturnType<typeof at.realpath>) => () => r.encode(realpathSync(r.path)),
  cp: (r: ReturnType<typeof at.cp>) => () => cpSync(r.src, r.dest, r.options as CpOptions),
  utimes: (r: ReturnType<typeof at.utimes>) => () =>
    withSyscall('utime', r.path, () => setTimes(resolvePath(r.path), r.times)),
};

export const promises = {
  readFile: promised((path: unknown, options?: unknown) =>
    op.readFile(at.readFile(path, options, true)),
  ),
  writeFile: promised((path: unknown, data: unknown, options?: unknown) =>
    op.writeFile(at.writeFile(path, data, options, true)),
  ),
  appendFile: promised((path: unknown, data: unknown, options?: unknown) =>
    op.writeFile(at.appendFile(path, data, options, true)),
  ),
  readdir: promised((path: unknown, options?: unknown) =>
    op.readdir(at.readdir(path, options, true)),
  ),
  mkdir: promised((path: unknown, options?: unknown) => op.mkdir(at.mkdir(path, options, true))),
  rm: promised((path: unknown, options?: unknown) => op.rm(at.rm(path, options))),
  rmdir: promised((path: unknown, options?: unknown) => op.rmdir(at.rmdir(path, options, true))),
  unlink: promised((path: unknown) =>
    (
      (p) => () =>
        unlinkSync(p)
    )(validatedPath(path)),
  ),
  stat: promised((path: unknown, options?: unknown) =>
    op.stat(at.stat(path, options, true, false)),
  ),
  lstat: promised((path: unknown, options?: unknown) =>
    op.stat(at.stat(path, options, true, true)),
  ),
  async symlink(...args: unknown[]): Promise<never> {
    return symlink(...args);
  },
  async link(...args: unknown[]): Promise<never> {
    return link(...args);
  },
  readlink: promised((path: unknown, options?: unknown) =>
    (
      (r) => () =>
        readlinkSync(r)
    )(at.encodingOnly(path, options, 'oldPath')),
  ),
  realpath: promised((path: unknown, options?: unknown) =>
    op.realpath(at.realpath(path, options, true)),
  ),
  access: promised((path: unknown, _mode?: unknown) =>
    ((p) => () => {
      // Strict probe: access through a file is ENOTDIR (Node), never ENOENT.
      const st = withSyscall('access', p, () => statStrictOrNull(resolvePath(p)));
      if (st === null) throw fsError('ENOENT', pathToString(p), 'access');
    })(validatedPath(path)),
  ),
  copyFile: promised((src: unknown, dest: unknown, mode?: unknown) =>
    (
      (s, d) => () =>
        copyFileSync(s, d, (mode ?? 0) as number)
    )(validatedPath(src, 'src'), validatedPath(dest, 'dest')),
  ),
  rename: promised((from: unknown, to: unknown) =>
    (
      (s, d) => () =>
        renameSync(s, d)
    )(validatedPath(from, 'oldPath'), validatedPath(to, 'newPath')),
  ),
  cp: promised((src: unknown, dest: unknown, options?: unknown) =>
    op.cp(at.cp(src, dest, options)),
  ),
  truncate: promised((path: unknown, len?: unknown) =>
    (
      (p) => () =>
        truncateSync(p, (len ?? 0) as number)
    )(validatedPath(path)),
  ),
  mkdtemp: promised((prefix: unknown, options?: unknown) =>
    (
      (r) => () =>
        mkdtempSync(r)
    )(at.encodingOnly(prefix, options, 'prefix')),
  ),
  opendir: promised((path: unknown, options?: unknown) => {
    const p = validatedPath(path);
    const o = getOptions(options, { encoding: 'utf8' });
    // Node builds the Dir once the open settles: its options are read then.
    return () => new Dir(p, dirEntries(p), dirBufferSize(o));
  }),
  utimes: promised((path: unknown, atime: unknown, mtime: unknown) =>
    op.utimes(at.utimes(path, atime, mtime)),
  ),
  lutimes: promised((path: unknown, atime: unknown, mtime: unknown) =>
    op.utimes(at.utimes(path, atime, mtime)),
  ),
  constants,
};

export function readFile(p: unknown, options: unknown, cb?: unknown): void {
  const done = cbOf(cb || options);
  deliver(done, ioTurn(op.readFile(at.readFile(p, options, false))));
}

export function open(p: PathLike, ...rest: unknown[]): void {
  // Node's open: the callback is the last argument.
  const done = cbOf(rest[rest.length - 1]);
  const [flags, mode] = rest.slice(0, -1);
  deliver(done, inTurn(openSync)(p, (flags ?? 'r') as OpenFlags, mode as number | undefined));
}

export function close(fd: number, cb?: unknown): void {
  // Node's `close(fd)` takes a default callback.
  deliver(cb === undefined ? () => {} : cbOf(cb), inTurn(closeSync)(fd), true);
}

/** Node's `fs.read` argument forms; the position and lengths are fixed at the call. */
export function read(
  fd: number,
  buffer: Uint8Array,
  offset: number | FdReadOptions | ReadCallback,
  length?: number | ReadCallback,
  position?: ReadPosition | ReadCallback,
  cb?: ReadCallback,
): void;
export function read(fd: number, ...args: unknown[]): void;
export function read(fd: number, ...args: unknown[]): void {
  let [buffer, offset, length, position, callback] = args;
  if (args.length <= 3) {
    let params = null as (FdReadOptions & { buffer?: Uint8Array }) | null;
    if (args.length === 3) {
      callback = length;
      params = offset as FdReadOptions;
    } else if (args.length === 2) {
      if (!(buffer instanceof Uint8Array)) {
        params = buffer as typeof params;
        buffer = params?.buffer ?? Buffer.alloc(16384);
      }
      callback = offset;
    } else {
      callback = buffer;
      buffer = Buffer.alloc(16384);
    }
    const view = buffer as Uint8Array;
    ({ offset = 0, length = view.byteLength - (offset as number), position = null } = params ?? {});
  }
  const view = buffer as Uint8Array;
  const done = cbOf(callback) as ReadCallback;
  const options = {
    offset: typeof offset === 'number' ? offset : 0,
    length: typeof length === 'number' ? length : view.byteLength,
    position: (position ?? null) as ReadPosition,
  };
  // Node validates the position synchronously, before any callback (stdin too).
  readPositionOf(options.position, options.length);
  if (fd === 0) {
    try {
      readStdin(view, options, done);
    } catch (error) {
      queueMicrotask(() => runNodeCallback(done, error as NodeJS.ErrnoException));
    }
    return;
  }
  ioTurn(() => readSync(fd, view, options)).then(
    (bytesRead) => runNodeCallback(done, null, bytesRead, view),
    (e) => runNodeCallback(done, e as NodeJS.ErrnoException),
  );
}

/** Node's `fs.write` argument forms; offset, length, position and encoding are the call's. */
export function write(
  fd: number,
  data: Uint8Array | string,
  offset?: number | null | WriteCallback,
  length?: number | Encoding | WriteCallback,
  position?: number | null | WriteCallback,
  cb?: WriteCallback,
): void;
export function write(fd: number, data: Uint8Array | string, ...args: unknown[]): void;
export function write(fd: number, data: Uint8Array | string, ...args: unknown[]): void {
  let [offset, length, position, callback] = args;
  let run: () => number;
  if (typeof data !== 'string') {
    callback = callback || position || length || offset;
    if (typeof offset === 'object' && offset !== null)
      ({
        offset = 0,
        length = data.byteLength - (offset as unknown as number),
        position = null,
      } = offset as FdReadOptions);
    const at = typeof offset === 'number' ? offset : 0;
    const len = typeof length === 'number' ? length : data.byteLength - at;
    const pos = typeof position === 'number' ? position : null;
    run = () => writeSync(fd, data, at, len, pos);
  } else {
    if (typeof position !== 'function') {
      if (typeof offset === 'function') [position, offset] = [offset, null];
      else position = length;
      length = 'utf8';
    }
    callback = position;
    const pos = typeof offset === 'number' ? offset : null;
    const encoding = (typeof length === 'string' ? length : 'utf8') as Encoding;
    run = () => writeSync(fd, data, pos, encoding);
  }
  const done = cbOf(callback) as WriteCallback;
  ioTurn(run).then(
    (bytesWritten) => runNodeCallback(done, null, bytesWritten, data),
    (e) => runNodeCallback(done, e as NodeJS.ErrnoException),
  );
}

export function fstat(fd: number, options: unknown, cb?: unknown): void {
  const [o, done] =
    typeof options === 'function' ? [{}, options] : [(options ?? {}) as Options, cb];
  const bigint = readTwice(o as Options, 'bigint');
  cbOf(done);
  deliver(
    done as AnyCallback,
    ioTurn(() => {
      const stats = fstatSync(fd);
      if (bigint) throw new NotImplementedError('fs.fstat.bigint');
      return stats;
    }),
  );
}

export function ftruncate(fd: number, lenOrCb?: unknown, cb?: unknown): void {
  const [len, done] = optional(lenOrCb, cb);
  deliver(done, inTurn(ftruncateSync)(fd, typeof len === 'number' ? len : 0), true);
}

export function writeFile(p: unknown, data: unknown, options: unknown, cb?: unknown) {
  const done = cbOf(cb || options);
  deliver(done, ioTurn(op.writeFile(at.writeFile(p, data, options, false))), true);
}

export function appendFile(p: unknown, data: unknown, options: unknown, cb?: unknown) {
  const done = cbOf(cb || options);
  deliver(done, ioTurn(op.writeFile(at.appendFile(p, data, options, false))), true);
}

export function rm(p: unknown, options: unknown, cb?: unknown): void {
  // Node's rm checks its path and options at the call, not its callback.
  const [o, done] = typeof options === 'function' ? [undefined, options] : [options, cb];
  deliver(done as AnyCallback, ioTurn(op.rm(at.rm(p, o))), true);
}

export function readdir(p: unknown, options: unknown, cb?: unknown): void {
  const done = cbOf(typeof options === 'function' ? options : cb);
  deliver(done, ioTurn(op.readdir(at.readdir(p, options, false))));
}

export function mkdir(p: unknown, options: unknown, cb?: unknown): void {
  const operation = op.mkdir(
    at.mkdir(p, typeof options === 'function' ? undefined : options, false),
  );
  deliver(cbOf(typeof options === 'function' ? options : cb), ioTurn(operation), true);
}

export function stat(p: unknown, options: unknown, cb?: unknown): void {
  const [o, done] = typeof options === 'function' ? [{}, options] : [options, cb];
  cbOf(done);
  deliver(done as AnyCallback, ioTurn(op.stat(at.stat(p, o, false, false))));
}

export function lstat(p: unknown, options: unknown, cb?: unknown): void {
  const [o, done] = typeof options === 'function' ? [{}, options] : [options, cb];
  cbOf(done);
  deliver(done as AnyCallback, ioTurn(op.stat(at.stat(p, o, false, true))));
}

export function unlink(p: unknown, cb: unknown): void {
  const done = cbOf(cb);
  const path = validatedPath(p);
  deliver(
    done,
    ioTurn(() => unlinkSync(path)),
    true,
  );
}

const _realpath = (p: unknown, options: unknown, cb?: unknown): void => {
  const done = cbOf(typeof options === 'function' ? options : cb);
  deliver(done, ioTurn(op.realpath(at.realpath(p, options, false))));
};
// `fs.realpath.native` mirrors `realpathSync.native` — chokidar/promisify reach
// for the callback form; some code reads `.native`.
// Its binding takes `encoding` at the call (Node's `realpath.native`).
const realpathNative = (p: unknown, options: unknown, cb?: unknown): void => {
  const done = cbOf(typeof options === 'function' ? options : cb);
  deliver(done, ioTurn(op.realpath(at.realpath(p, options, true))));
};
export const realpath: typeof _realpath & { native: typeof _realpath } = Object.assign(_realpath, {
  native: realpathNative,
});

export function readlink(p: unknown, options: unknown, cb?: unknown): void {
  const done = cbOf(typeof options === 'function' ? options : cb);
  deliver(
    done,
    ioTurn(
      (
        (r) => () =>
          readlinkSync(r)
      )(at.encodingOnly(p, options)),
    ),
  );
}

export function access(p: unknown, mode: unknown, cb?: unknown): void {
  const path = validatedPath(p);
  const done = cbOf(typeof mode === 'function' ? mode : cb);
  deliver(done, promises.access(path), true);
}

export function copyFile(src: unknown, dst: unknown, mode: unknown, cb?: unknown): void {
  const [m, done] = typeof mode === 'function' ? [0, mode] : [mode, cb];
  const s = validatedPath(src, 'src');
  const d = validatedPath(dst, 'dest');
  deliver(
    cbOf(done),
    ioTurn(() => copyFileSync(s, d, (m ?? 0) as number)),
    true,
  );
}

export function rename(src: unknown, dst: unknown, cb: unknown): void {
  const done = cbOf(cb);
  deliver(done, promises.rename(src, dst), true);
}

export function truncate(p: unknown, lenOrCb?: unknown, cb?: unknown): void {
  const [len, done] = typeof lenOrCb === 'function' ? [0, lenOrCb] : [lenOrCb ?? 0, cb];
  cbOf(done);
  const path = validatedPath(p);
  deliver(
    done as AnyCallback,
    ioTurn(() => truncateSync(path, len as number)),
    true,
  );
}

export function mkdtemp(prefix: unknown, options?: unknown, cb?: unknown): void {
  const done = cbOf(typeof options === 'function' ? options : cb);
  deliver(
    done,
    ioTurn(
      (
        (r) => () =>
          mkdtempSync(r)
      )(at.encodingOnly(prefix, options, 'prefix')),
    ),
  );
}

export function opendir(p: unknown, options?: unknown, cb?: unknown): void {
  const done = cbOf(typeof options === 'function' ? options : cb, 'callback');
  const path = validatedPath(p);
  const o = getOptions(options, { encoding: 'utf8' });
  // Node builds the Dir in the open's completion: an invalid `bufferSize` throws there, uncaught.
  const callback = done as unknown as (err: unknown, dir?: Dir) => void;
  ioTurn(() => dirEntries(path)).then(
    (entries) => {
      let dir: Dir;
      try {
        dir = new Dir(path, entries, dirBufferSize(o));
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
        return;
      }
      runNodeCallback(callback, null, dir);
    },
    (e) => runNodeCallback(callback, e),
  );
}

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

// Node's arities (`Function.length`): rest and optional parameters here count otherwise.
for (const [target, lengths] of [
  [
    { stat, lstat, fstat, ftruncate, open, close, read, write, symlink },
    [1, 1, 1, 1, 4, 1, 6, 6, 4],
  ],
  [
    promises,
    {
      readFile: 2,
      writeFile: 3,
      appendFile: 3,
      readdir: 2,
      mkdir: 2,
      rm: 2,
      rmdir: 2,
      unlink: 1,
      stat: 1,
      lstat: 1,
      readlink: 2,
      realpath: 2,
      access: 1,
      copyFile: 3,
      rename: 2,
      cp: 3,
      truncate: 1,
      mkdtemp: 2,
      opendir: 3,
      utimes: 3,
      lutimes: 3,
      symlink: 3,
    },
  ],
] as const) {
  const entries = Array.isArray(lengths)
    ? Object.keys(target).map(
        (name, index) => [name, (lengths as readonly number[])[index]] as const,
      )
    : Object.entries(lengths);
  for (const [name, length] of entries)
    Object.defineProperty((target as Record<string, unknown>)[name], 'length', { value: length });
}

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
  appendFile,
  rm,
  readdir,
  mkdir,
  stat,
  unlink,
  lstat,
  realpath,
  readlink,
  symlink,
  link,
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
  statfsSync,
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
  symlinkSync,
  linkSync,
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
