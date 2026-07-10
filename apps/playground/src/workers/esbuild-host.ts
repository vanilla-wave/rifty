/**
 * Host-realm esbuild bridge (ADR-0192): the guest-visible `esbuild` package
 * (shadow-registry overlay shim) delegates the whole esbuild JS API to a real
 * `esbuild-wasm@0.28.0` instance initialized ONCE per worker realm and exposed
 * as `globalThis.__riftyEsbuild`. Guest and host share the realm, so vite's JS
 * plugins (config `externalize-deps`, optimizer `esbuildDepPlugin`) cross the
 * bridge untouched.
 *
 * Environment realities pinned by probes (2026-07-02, vite@7.3.6 + react@19):
 * - The gojs runtime (wasm_exec) reads the REALM's `globalThis.fs` when the
 *   service runs inline (`worker: false`) — the same contract that gives
 *   esbuild-wasm real fs on Node. In a nested worker (`worker: true`) no fs
 *   exists at all and vite's config bundling / dep optimizer die on
 *   `Cannot read directory: not implemented on js`, so the service MUST run
 *   inline with a Node-style fs facade over `syncMirror()`.
 * - The browser lib re-purposes `fs.read`/`fs.writeSync` fds 0/1/2 as its
 *   stdio service protocol; the facade routes those fds to the lib's
 *   overrides and every other fd to the VFS (fd-routing accessors below).
 * - In a browser env the Go side never writes build outputs: `build()` with
 *   `write: true` loud-throws and `context().rebuild()` silently skips the
 *   writes, returning `outputFiles`. The bridge therefore always runs the
 *   service with `write: false` and writes `outputFiles` to the VFS itself
 *   when the caller asked for writes — the same observable behavior as
 *   esbuild on Node (files on disk, `outputFiles` an own enumerable
 *   `undefined` key in the result).
 */
import { NotImplementedError } from '@riftydev/io';
import { type FsSync, VfsError, dirname, normalizePath, syncMirror } from '@riftydev/vfs';
import wasmUrl from 'esbuild-wasm/esbuild.wasm?url';
import * as esbuildWasm from 'esbuild-wasm/esm/browser.js';
import type {
  BuildContext,
  BuildOptions,
  BuildResult,
  OutputFile,
  Plugin,
  TransformOptions,
  TransformResult,
} from 'esbuild-wasm/esm/browser.js';

/** Structural slice of the esbuild-wasm browser lib the bridge consumes (DI seam for unit tests). */
export interface EsbuildWasmLib {
  readonly version: string;
  initialize(options: { readonly wasmURL: string; readonly worker: boolean }): Promise<void>;
  transform(input: string | Uint8Array, options?: TransformOptions): Promise<TransformResult>;
  build(options: BuildOptions): Promise<BuildResult>;
  context(options: BuildOptions): Promise<BuildContext>;
  formatMessages: typeof esbuildWasm.formatMessages;
  analyzeMetafile: typeof esbuildWasm.analyzeMetafile;
  stop(): Promise<void>;
}

/** The surface `globalThis.__riftyEsbuild` exposes to the guest esbuild shim. */
export interface RiftyEsbuildHost {
  readonly version: string;
  /** Eagerly bring the service up (guest `esbuild.initialize()` parity). */
  initialize(): Promise<void>;
  transform(input: string | Uint8Array, options?: TransformOptions): Promise<TransformResult>;
  build(options: BuildOptions): Promise<BuildResult>;
  context(options: BuildOptions): Promise<BuildContext>;
  formatMessages: typeof esbuildWasm.formatMessages;
  analyzeMetafile: typeof esbuildWasm.analyzeMetafile;
  stop(): Promise<void>;
}

declare global {
  // Installed by installEsbuildBridge() before the guest imports `esbuild`.
  // eslint-disable-next-line no-var
  var __riftyEsbuild: RiftyEsbuildHost | undefined;
}

type FsCallback = (err: (Error & { code?: string }) | null, value?: unknown) => void;

/**
 * wasm_exec-facing fs surface (the subset Go's `syscall/js` fs layer calls).
 * `read`/`writeSync` are accessor-backed: the esbuild browser lib ASSIGNS its
 * stdio protocol handlers onto them at service start.
 */
export interface WasmExecFsConstants {
  readonly O_RDONLY: number;
  readonly O_WRONLY: number;
  readonly O_RDWR: number;
  readonly O_CREAT: number;
  readonly O_EXCL: number;
  readonly O_TRUNC: number;
  readonly O_APPEND: number;
}

export interface WasmExecFs {
  readonly constants: WasmExecFsConstants;
  read(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: FsCallback,
  ): void;
  write(
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: FsCallback,
  ): void;
  writeSync(fd: number, buffer: Uint8Array): number;
  open(path: string, flags: number, mode: number, callback: FsCallback): void;
  close(fd: number, callback: FsCallback): void;
  fstat(fd: number, callback: FsCallback): void;
  stat(path: string, callback: FsCallback): void;
  lstat(path: string, callback: FsCallback): void;
  readdir(path: string, callback: FsCallback): void;
  mkdir(path: string, perm: number, callback: FsCallback): void;
  rmdir(path: string, callback: FsCallback): void;
  unlink(path: string, callback: FsCallback): void;
  rename(from: string, to: string, callback: FsCallback): void;
  truncate(path: string, length: number, callback: FsCallback): void;
  ftruncate(fd: number, length: number, callback: FsCallback): void;
  readlink(path: string, callback: FsCallback): void;
  link(path: string, link: string, callback: FsCallback): void;
  symlink(path: string, link: string, callback: FsCallback): void;
  chmod(path: string, mode: number, callback: FsCallback): void;
  fchmod(fd: number, mode: number, callback: FsCallback): void;
  chown(path: string, uid: number, gid: number, callback: FsCallback): void;
  fchown(fd: number, uid: number, gid: number, callback: FsCallback): void;
  lchown(path: string, uid: number, gid: number, callback: FsCallback): void;
  utimes(path: string, atime: number, mtime: number, callback: FsCallback): void;
  fsync(fd: number, callback: FsCallback): void;
}

// Linux O_* values — Go reads THESE constants from the object, so any
// self-consistent assignment works; Linux values match wasm_exec_node.
const O_CREAT = 0o100;
const O_EXCL = 0o200;
const O_TRUNC = 0o1000;
const O_APPEND = 0o2000;
const ACCMODE = 0o3;
const O_RDONLY = 0o0;
const O_WRONLY = 0o1;
const O_RDWR = 0o2;

// POSIX file-type mode bits (Go derives IsDir/IsRegular from these).
const S_IFREG = 0o100000;
const S_IFDIR = 0o40000;

function fsError(code: string, path: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

function toFsError(err: unknown, path: string): Error & { code: string } {
  if (err instanceof VfsError) return Object.assign(new Error(err.message), { code: err.code });
  return Object.assign(new Error(`EIO: ${path}: ${String(err)}`), { code: 'EIO' });
}

interface OpenFile {
  readonly path: string;
  // Node fds carry a kind + access mode; reads/writes enforce them (EISDIR /
  // EBADF) instead of silently succeeding off the cached bytes.
  readonly kind: 'file' | 'dir';
  readonly accessMode: number;
  bytes: Uint8Array;
  pos: number;
  dirty: boolean;
}

/**
 * Node-style callback fs over the realm's sync mirror for the inline gojs
 * service. Callbacks are deferred to a microtask: Go parks the calling
 * goroutine and resumes on the callback — resuming synchronously would
 * re-enter the wasm while it is still on the JS stack (real Node fs callbacks
 * are async too).
 */
export function createWasmExecFs(mirror: () => FsSync): WasmExecFs {
  const fds = new Map<number, OpenFile>();
  let nextFd = 100; // 0-2 are the service's stdio channel
  const inos = new Map<string, number>();
  let nextIno = 1;
  // The esbuild browser lib assigns its stdio protocol handlers over
  // `fs.read` / `fs.writeSync`; captured here and routed by fd.
  let stdioRead: WasmExecFs['read'] | null = null;
  let stdioWriteSync: WasmExecFs['writeSync'] | null = null;

  const defer = (fn: () => void): void => queueMicrotask(fn);
  const ok = (callback: FsCallback, value?: unknown): void => defer(() => callback(null, value));
  const fail = (callback: FsCallback, err: Error & { code?: string }): void =>
    defer(() => callback(err));

  function inoOf(path: string): number {
    let ino = inos.get(path);
    if (ino === undefined) {
      ino = nextIno++;
      inos.set(path, ino);
    }
    return ino;
  }

  function statObject(path: string, stat: { isDirectory: boolean; size?: number; mtime?: number }) {
    const mtimeMs = stat.mtime ?? 0;
    const size = stat.isDirectory ? 0 : (stat.size ?? 0);
    const isDir = stat.isDirectory;
    return {
      dev: 1,
      ino: inoOf(path),
      mode: (isDir ? S_IFDIR : S_IFREG) | (isDir ? 0o755 : 0o644),
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
      // Node fs.Stats METHODS — Go's fs_js.go calls these on the object
      // (`jsSt.Call("isDirectory")`), fields alone panic the runtime.
      isDirectory: () => isDir,
      isFile: () => !isDir,
      isSymbolicLink: () => false,
      isBlockDevice: () => false,
      isCharacterDevice: () => false,
      isFIFO: () => false,
      isSocket: () => false,
    };
  }

  function statPath(path: string, callback: FsCallback): void {
    const np = normalizePath(path);
    const stat = mirror().statSyncOrNull(np);
    if (stat === null) {
      fail(callback, fsError('ENOENT', np));
      return;
    }
    ok(callback, statObject(np, stat));
  }

  function openFile(path: string, flags: number, callback: FsCallback): void {
    const np = normalizePath(path);
    const fs = mirror();
    const stat = fs.statSyncOrNull(np);
    const wantsWrite = (flags & ACCMODE) === O_WRONLY || (flags & ACCMODE) === O_RDWR;
    if (stat === null && (flags & O_CREAT) === 0) {
      fail(callback, fsError('ENOENT', np));
      return;
    }
    if (stat !== null && (flags & O_CREAT) !== 0 && (flags & O_EXCL) !== 0) {
      fail(callback, fsError('EEXIST', np));
      return;
    }
    if (stat?.isDirectory && wantsWrite) {
      fail(callback, fsError('EISDIR', np));
      return;
    }
    let bytes: Uint8Array;
    let dirty = false;
    if (stat === null || (flags & O_TRUNC) !== 0) {
      bytes = new Uint8Array(0);
      dirty = true; // creation / truncation must land even without a write
    } else if (stat.isDirectory) {
      bytes = new Uint8Array(0);
    } else {
      bytes = fs.readFileBytesSync(np);
    }
    const fd = nextFd++;
    fds.set(fd, {
      path: np,
      kind: stat?.isDirectory ? 'dir' : 'file',
      accessMode: flags & ACCMODE,
      bytes,
      pos: (flags & O_APPEND) !== 0 ? bytes.length : 0,
      dirty,
    });
    ok(callback, fd);
  }

  function trackedFile(fd: number, callback: FsCallback): OpenFile | null {
    const file = fds.get(fd);
    if (file === undefined) {
      fail(callback, fsError('EBADF', `fd ${fd}`));
      return null;
    }
    return file;
  }

  // Single precondition boundary: every read/write path resolves its fd through
  // these, so the Node errno (EISDIR / EBADF) is decided in ONE place, not
  // re-derived per op.
  function readableFile(fd: number, callback: FsCallback): OpenFile | null {
    const file = trackedFile(fd, callback);
    if (file === null) return null;
    if (file.kind === 'dir') {
      fail(callback, fsError('EISDIR', file.path));
      return null;
    }
    if (file.accessMode === O_WRONLY) {
      fail(callback, fsError('EBADF', `fd ${fd}`));
      return null;
    }
    return file;
  }
  function writableFile(fd: number, callback: FsCallback): OpenFile | null {
    const file = trackedFile(fd, callback);
    if (file === null) return null;
    if (file.accessMode === O_RDONLY) {
      fail(callback, fsError('EBADF', `fd ${fd}`));
      return null;
    }
    return file;
  }

  // Ownership/permission ops carry no VFS metadata to change, so they are a
  // Node-style no-op success — but ONLY after the same existence check Node
  // does first (else a missing path / bad fd silently "succeeds").
  function requirePath(path: string, callback: FsCallback): void {
    const np = normalizePath(path);
    try {
      if (mirror().statSyncOrNull(np) === null) {
        fail(callback, fsError('ENOENT', np));
        return;
      }
      ok(callback);
    } catch (err) {
      fail(callback, toFsError(err, np));
    }
  }
  function requireFd(fd: number, callback: FsCallback): void {
    if (trackedFile(fd, callback) === null) return;
    ok(callback);
  }

  return {
    constants: {
      O_RDONLY: 0,
      O_WRONLY,
      O_RDWR,
      O_CREAT,
      O_EXCL,
      O_TRUNC,
      O_APPEND,
    },

    // Accessors: the service protocol overrides land in stdioRead/stdioWriteSync;
    // file fds keep flowing to the VFS implementation.
    get read() {
      return (
        fd: number,
        buffer: Uint8Array,
        offset: number,
        length: number,
        position: number | null,
        callback: FsCallback,
      ): void => {
        if (fd === 0 && stdioRead) {
          stdioRead(fd, buffer, offset, length, position, callback);
          return;
        }
        const file = readableFile(fd, callback);
        if (file === null) return;
        const pos = position ?? file.pos;
        const n = Math.max(0, Math.min(length, file.bytes.length - pos));
        buffer.set(file.bytes.subarray(pos, pos + n), offset);
        if (position === null) file.pos = pos + n;
        ok(callback, n);
      };
    },
    set read(fn: WasmExecFs['read']) {
      stdioRead = fn;
    },
    get writeSync() {
      return (fd: number, buffer: Uint8Array): number => {
        if (fd === 1 || fd === 2) {
          if (stdioWriteSync) return stdioWriteSync(fd, buffer);
          // Pre-handshake Go runtime output (panics): keep it loud.
          console.error(new TextDecoder().decode(buffer));
          return buffer.length;
        }
        const file = fds.get(fd);
        if (file === undefined || file.kind === 'dir' || file.accessMode === O_RDONLY) {
          throw fsError('EBADF', `fd ${fd}`);
        }
        writeAt(file, buffer, file.pos);
        file.pos += buffer.length;
        return buffer.length;
      };
    },
    set writeSync(fn: WasmExecFs['writeSync']) {
      stdioWriteSync = fn;
    },
    write(fd, buffer, offset, length, position, callback): void {
      if (fd === 1 || fd === 2) {
        try {
          const chunk = buffer.subarray(offset, offset + length);
          const n = this.writeSync(fd, chunk);
          ok(callback, n);
        } catch (err) {
          fail(callback, toFsError(err, `fd ${fd}`));
        }
        return;
      }
      const file = writableFile(fd, callback);
      if (file === null) return;
      const chunk = buffer.subarray(offset, offset + length);
      const pos = position ?? file.pos;
      writeAt(file, chunk, pos);
      if (position === null) file.pos = pos + chunk.length;
      ok(callback, chunk.length);
    },

    open(path, flags, _mode, callback): void {
      try {
        openFile(path, flags, callback);
      } catch (err) {
        fail(callback, toFsError(err, path));
      }
    },
    close(fd, callback): void {
      const file = trackedFile(fd, callback);
      if (file === null) return;
      fds.delete(fd);
      try {
        flushDirty(file);
      } catch (err) {
        fail(callback, toFsError(err, file.path));
        return;
      }
      ok(callback);
    },
    fstat(fd, callback): void {
      const file = trackedFile(fd, callback);
      if (file === null) return;
      const stat = mirror().statSyncOrNull(file.path);
      ok(
        callback,
        stat === null
          ? statObject(file.path, { isDirectory: false, size: file.bytes.length })
          : statObject(file.path, { ...stat, size: file.dirty ? file.bytes.length : stat.size }),
      );
    },
    stat(path, callback): void {
      try {
        statPath(path, callback);
      } catch (err) {
        fail(callback, toFsError(err, path));
      }
    },
    // The VFS has no symlinks, so lstat === stat and readlink is EINVAL
    // ("not a symlink") — exactly what Node reports on a regular file.
    lstat(path, callback): void {
      try {
        statPath(path, callback);
      } catch (err) {
        fail(callback, toFsError(err, path));
      }
    },
    readdir(path, callback): void {
      const np = normalizePath(path);
      try {
        ok(
          callback,
          mirror()
            .readdirSync(np)
            .map((entry) => entry.name),
        );
      } catch (err) {
        fail(callback, toFsError(err, np));
      }
    },
    mkdir(path, _perm, callback): void {
      const np = normalizePath(path);
      try {
        if (mirror().existsSync(np)) {
          fail(callback, fsError('EEXIST', np));
          return;
        }
        mirror().mkdirSync(np, { recursive: false });
        ok(callback);
      } catch (err) {
        fail(callback, toFsError(err, np));
      }
    },
    rmdir(path, callback): void {
      const np = normalizePath(path);
      try {
        const stat = mirror().statSyncOrNull(np);
        if (stat === null) {
          fail(callback, fsError('ENOENT', np));
          return;
        }
        if (!stat.isDirectory) {
          fail(callback, fsError('ENOTDIR', np));
          return;
        }
        mirror().rmSync(np, { recursive: false });
        ok(callback);
      } catch (err) {
        fail(callback, toFsError(err, np));
      }
    },
    unlink(path, callback): void {
      const np = normalizePath(path);
      try {
        const stat = mirror().statSyncOrNull(np);
        if (stat === null) {
          fail(callback, fsError('ENOENT', np));
          return;
        }
        if (stat.isDirectory) {
          fail(callback, fsError('EISDIR', np));
          return;
        }
        mirror().rmSync(np, { force: false });
        ok(callback);
      } catch (err) {
        fail(callback, toFsError(err, np));
      }
    },
    rename(from, to, callback): void {
      try {
        mirror().renameSync(normalizePath(from), normalizePath(to));
        ok(callback);
      } catch (err) {
        fail(callback, toFsError(err, from));
      }
    },
    truncate(path, length, callback): void {
      const np = normalizePath(path);
      try {
        const bytes = mirror().readFileBytesSync(np);
        const next = new Uint8Array(length);
        next.set(bytes.subarray(0, Math.min(length, bytes.length)));
        mirror().writeFileSync(np, next);
        ok(callback);
      } catch (err) {
        fail(callback, toFsError(err, np));
      }
    },
    ftruncate(fd, length, callback): void {
      const file = writableFile(fd, callback);
      if (file === null) return;
      const next = new Uint8Array(length);
      next.set(file.bytes.subarray(0, Math.min(length, file.bytes.length)));
      file.bytes = next;
      file.dirty = true;
      ok(callback);
    },
    readlink(path, callback): void {
      fail(callback, fsError('EINVAL', normalizePath(path)));
    },
    link(path, _link, callback): void {
      fail(callback, fsError('ENOSYS', `link: rifty VFS has no hard links (${path})`));
    },
    symlink(path, _link, callback): void {
      fail(callback, fsError('ENOSYS', `symlink: rifty VFS has no symlinks (${path})`));
    },
    // The VFS carries no ownership/permission metadata — there is nothing to
    // change, so these are a no-op success on a VALID target, but Node still
    // errors on a missing path (ENOENT) / bad fd (EBADF), so validate first.
    chmod(path, _mode, callback): void {
      requirePath(path, callback);
    },
    fchmod(fd, _mode, callback): void {
      requireFd(fd, callback);
    },
    chown(path, _uid, _gid, callback): void {
      requirePath(path, callback);
    },
    fchown(fd, _uid, _gid, callback): void {
      requireFd(fd, callback);
    },
    lchown(path, _uid, _gid, callback): void {
      requirePath(path, callback);
    },
    utimes(path, atime, mtime, callback): void {
      const np = normalizePath(path);
      try {
        mirror().utimes(np, atime * 1000, mtime * 1000);
        ok(callback);
      } catch (err) {
        fail(callback, toFsError(err, np));
      }
    },
    // Honest fsync: dirty bytes reach the mirror NOW (crash-before-close must
    // not lose fsynced data) and a mirror failure is the caller's errno — a
    // no-op `ok` here was a durability lie (provenance-lie × fsync).
    fsync(fd, callback): void {
      const file = trackedFile(fd, callback);
      if (file === null) return;
      try {
        flushDirty(file);
      } catch (err) {
        fail(callback, toFsError(err, file.path));
        return;
      }
      ok(callback);
    },
  };

  /** One flush boundary for fsync + close; clears `dirty` only on success. */
  function flushDirty(file: OpenFile): void {
    if (!file.dirty) return;
    const fs = mirror();
    fs.mkdirSync(dirname(file.path), { recursive: true });
    fs.writeFileSync(file.path, file.bytes);
    file.dirty = false;
  }

  function writeAt(file: OpenFile, chunk: Uint8Array, pos: number): void {
    if (pos + chunk.length > file.bytes.length) {
      const grown = new Uint8Array(pos + chunk.length);
      grown.set(file.bytes);
      file.bytes = grown;
    }
    file.bytes.set(chunk, pos);
    file.dirty = true;
  }
}

/** Write the service's in-memory outputFiles to the VFS (native `write: true` parity). */
export function writeOutputFiles(fs: FsSync, files: readonly OutputFile[] | undefined): void {
  for (const file of files ?? []) {
    // No outfile/outdir → the browser service reports ONE entry with the
    // literal path '<stdout>'. Native esbuild (probed on 0.28.0) succeeds and
    // writes NOTHING in that shape — materializing '<stdout>' as a VFS file
    // would invent an artifact native never creates.
    if (file.path === '<stdout>') continue;
    const path = normalizePath(file.path);
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, file.contents);
  }
}

/**
 * Default `absWorkingDir` to the GUEST program's cwd. Real esbuild resolves
 * relative outdir/outfile/entryPoints against the service's working directory
 * (probed on 0.28.0); the browser service's internal cwd is '/', so without
 * this a `vite build` running in /scratch would drop its dist under the VFS
 * root. A caller-provided absWorkingDir always wins.
 */
function withGuestWorkingDir<T extends { absWorkingDir?: string }>(options: T): T {
  if (options.absWorkingDir !== undefined) return options;
  const cwd = (globalThis.process as { cwd?: () => string } | undefined)?.cwd?.();
  if (!cwd) return options;
  return { ...options, absWorkingDir: cwd };
}

/**
 * Native write-effective result shape (probed real esbuild 0.28.0,
 * 2026-07-10): `outputFiles` stays an OWN ENUMERABLE key with value
 * `undefined` — `'outputFiles' in result` is TRUE natively. Deleting the key
 * or spread-dropping it was caller/plugin-observable (provenance-lie). ONE
 * chokepoint for the writer plugin and the pluginless post-pass
 * (sibling-drift kill: two masks for one semantic drifted).
 */
function markOutputFilesWritten(result: BuildResult): BuildResult {
  result.outputFiles = undefined;
  return result;
}

/**
 * `PluginBuild.esbuild` surface: a guest-module-shaped view over the HOST
 * bridge (probed real esbuild 0.28.0, 2026-07-10 — module key set below, NOT
 * identical to `require('esbuild')`). The raw esbuild-wasm lib must never
 * leak here: it bypasses write normalization, swaps the guest *Sync
 * NotImplemented throws for browser-lib Errors, and lets one plugin stop()
 * the SHARED realm-wide service. Keys + thrower/stop semantics stay in
 * LOCKSTEP with the guest shim (tools/shadow-registry SHIM_ESBUILD_BODY
 * `api`); pinned by esbuild-host.test.ts.
 */
interface PluginEsbuildView {
  readonly version: string;
  initialize(options?: object): Promise<void>;
  transform: RiftyEsbuildHost['transform'];
  transformSync(input?: unknown, options?: unknown): never;
  build: RiftyEsbuildHost['build'];
  buildSync(options?: unknown): never;
  context: RiftyEsbuildHost['context'];
  analyzeMetafile: RiftyEsbuildHost['analyzeMetafile'];
  analyzeMetafileSync(metafile?: unknown, options?: unknown): never;
  formatMessages: RiftyEsbuildHost['formatMessages'];
  formatMessagesSync(messages?: unknown, options?: unknown): never;
  stop(): Promise<void>;
  readonly default: PluginEsbuildView;
}

const NO_SYNC_API = 'esbuild-wasm exposes no synchronous API in a browser realm';

function createPluginEsbuildView(host: RiftyEsbuildHost): PluginEsbuildView {
  const view: PluginEsbuildView = {
    version: host.version,
    initialize: (options?: object) => {
      // The host bridge owns the wasm service config — an option-bearing call
      // would be silently ignored, so it loud-throws instead.
      if (options !== undefined && Object.keys(options).length > 0) {
        throw new NotImplementedError(
          'esbuild.PluginBuild.esbuild.initialize(options)',
          'the rifty host bridge owns the esbuild-wasm service configuration',
        );
      }
      return host.initialize();
    },
    transform: (input, options) => host.transform(input, options),
    transformSync: () => {
      throw new NotImplementedError('esbuild.transformSync', NO_SYNC_API);
    },
    build: (options) => host.build(options),
    buildSync: () => {
      throw new NotImplementedError('esbuild.buildSync', NO_SYNC_API);
    },
    context: (options) => host.context(options),
    analyzeMetafile: (metafile, options) => host.analyzeMetafile(metafile, options),
    analyzeMetafileSync: () => {
      throw new NotImplementedError('esbuild.analyzeMetafileSync', NO_SYNC_API);
    },
    formatMessages: (messages, options) => host.formatMessages(messages, options),
    formatMessagesSync: () => {
      throw new NotImplementedError('esbuild.formatMessagesSync', NO_SYNC_API);
    },
    // Guest shim stop() parity: one consumer's stop() must never kill the
    // SHARED realm-wide service (observable Node behavior: next call respawns).
    stop: () => Promise.resolve(),
    // Real module surface carries a CJS-interop `default` (getter, like the
    // compiled lib's __export).
    get default(): PluginEsbuildView {
      return view;
    },
  };
  return view;
}

interface NormalizedWriteBuild {
  readonly options: BuildOptions;
  /** LIVE effective write — a plugin setup() may have flipped `initialOptions.write`. */
  effectiveWrite(): boolean;
}

/**
 * Plugin-visible write normalization: the service runs `write:false`, but user
 * plugins must see the NATIVE surface — `initialOptions.write` as the caller
 * passed it (reads masked, mutations flow through AND are honored: the writer
 * plugin re-reads the requested write LIVE in `onEnd`), `PluginBuild.esbuild`
 * as the module-shaped bridge view (never the raw wasm lib), files already on
 * the VFS when their `onEnd` runs (a rifty writer plugin registered FIRST
 * writes + marks `outputFiles: undefined` on the shared result object, the
 * native shape). Without this the rewrite was plugin-observable
 * (provenance-lie at the plugin boundary, ADR-0192). Pluginless builds skip
 * the machinery — the post-build pass is unobservable. Probed on real esbuild
 * 0.28.0 (2026-07-10): onEnd hooks run in registration order, initialOptions
 * IS the live options object, setup() write flips are honored in BOTH
 * directions, result mutations propagate to later hooks and the resolved
 * value.
 */
function normalizedWriteBuildOptions(
  opts: BuildOptions,
  mirror: () => FsSync,
  pluginEsbuild: PluginEsbuildView,
): NormalizedWriteBuild {
  const plugins = opts.plugins ?? [];
  const requestedWrite = { present: 'write' in opts, value: opts.write };
  const effectiveWrite = (): boolean => requestedWrite.value !== false;
  const normalized: BuildOptions = { ...opts, write: false };
  if (plugins.length === 0) return { options: normalized, effectiveWrite };
  const optionsMask = new Proxy(normalized as Record<string | symbol, unknown>, {
    // 'plugins' reads back the USER's array — natively a plugin never sees the
    // injected writer or the masked wrappers.
    get: (t, p, r) =>
      p === 'write' ? requestedWrite.value : p === 'plugins' ? plugins : Reflect.get(t, p, r),
    has: (t, p) => (p === 'write' ? requestedWrite.present : Reflect.has(t, p)),
    set: (t, p, v, r) => {
      if (p === 'write') {
        requestedWrite.present = true;
        requestedWrite.value = v as boolean;
        return true;
      }
      return Reflect.set(t, p, v, r);
    },
    deleteProperty: (t, p) => {
      if (p === 'write') {
        requestedWrite.present = false;
        requestedWrite.value = undefined;
        return true;
      }
      return Reflect.deleteProperty(t, p);
    },
    ownKeys: (t) => {
      const keys = Reflect.ownKeys(t);
      return requestedWrite.present ? keys : keys.filter((k) => k !== 'write');
    },
    getOwnPropertyDescriptor: (t, p) => {
      if (p === 'write') {
        return requestedWrite.present
          ? { configurable: true, enumerable: true, writable: true, value: requestedWrite.value }
          : undefined;
      }
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  }) as BuildOptions;
  const writer: Plugin = {
    name: 'rifty-write-normalizer',
    setup(build) {
      // Registered FIRST → this onEnd runs before every user onEnd: outputs
      // are on the VFS and outputFiles marked written (own enumerable
      // `undefined`, native shape) by the time user hooks observe.
      build.onEnd((result) => {
        // requestedWrite is read LIVE: real esbuild honors a plugin setup()
        // flip of initialOptions.write in BOTH directions (probed 0.28.0 —
        // true→false keeps the outputFiles array + touches no disk;
        // false→true writes disk + marks outputFiles undefined).
        if (!effectiveWrite()) return;
        writeOutputFiles(mirror(), result.outputFiles);
        markOutputFilesWritten(result);
      });
    },
  };
  const masked = plugins.map(
    (p): Plugin => ({
      name: p.name,
      setup: (build) =>
        p.setup(
          new Proxy(build, {
            get: (t, prop, r) =>
              prop === 'initialOptions'
                ? optionsMask
                : prop === 'esbuild'
                  ? pluginEsbuild
                  : Reflect.get(t, prop, r),
          }),
        ),
    }),
  );
  // Mutate IN PLACE: plugin setup mutations of initialOptions (via the mask)
  // must land on the object the service receives, not a stale copy.
  normalized.plugins = [writer, ...masked];
  return { options: normalized, effectiveWrite };
}

export function createEsbuildHost(deps: {
  readonly lib: EsbuildWasmLib;
  readonly wasmUrl: string;
  readonly mirror: () => FsSync;
}): RiftyEsbuildHost {
  const { lib, mirror } = deps;
  let initPromise: Promise<void> | null = null;

  function ensureInitialized(): Promise<void> {
    if (initPromise === null) {
      // wasm_exec snapshots the realm globals at service start — the fs facade
      // must exist BEFORE initialize. Installed once per realm, lazily, so
      // presets that never touch esbuild never pay for it (13.5 MB wasm).
      // TODO(backlog: perf/esbuild-wasm-build-path-latency): the cold init
      // costs ~30 s on the vite build e2e — cache/hand-off the compiled Module.
      globalThis.fs ??= createWasmExecFs(mirror);
      initPromise = lib.initialize({ wasmURL: deps.wasmUrl, worker: false }).catch((err) => {
        initPromise = null; // the lib resets itself on a failed initialize; allow retry
        throw err;
      });
    }
    return initPromise;
  }

  const host: RiftyEsbuildHost = {
    version: lib.version,
    initialize: () => ensureInitialized(),
    async transform(input, options) {
      await ensureInitialized();
      return lib.transform(input, options);
    },
    async build(options) {
      await ensureInitialized();
      const opts = withGuestWorkingDir(options);
      const hasPlugins = (opts.plugins?.length ?? 0) > 0;
      // ALL plugin builds run the normalized path — even caller write:false:
      // the plugin mask (initialOptions/esbuild) must cover them too, and the
      // writer plugin's LIVE read decides the effective write (a setup() flip
      // in either direction is honored, real-esbuild parity).
      if (!hasPlugins && opts.write === false) return lib.build(opts);
      const norm = normalizedWriteBuildOptions(opts, mirror, pluginEsbuild);
      const result = await lib.build(norm.options);
      if (hasPlugins) return result; // the writer plugin already wrote + marked
      writeOutputFiles(mirror(), result.outputFiles);
      return markOutputFilesWritten(result);
    },
    async context(options) {
      await ensureInitialized();
      const opts = withGuestWorkingDir(options);
      const hasPlugins = (opts.plugins?.length ?? 0) > 0;
      if (!hasPlugins && opts.write === false) return lib.context(opts);
      const norm = normalizedWriteBuildOptions(opts, mirror, pluginEsbuild);
      const ctx = await lib.context(norm.options);
      return {
        rebuild: async () => {
          const result = await ctx.rebuild();
          if (hasPlugins) return result; // per-rebuild writer plugin handled it
          writeOutputFiles(mirror(), result.outputFiles);
          return markOutputFilesWritten(result);
        },
        watch: async (watchOptions) => {
          // Effective write read LIVE (plugin setup() may have flipped it):
          // write:false watching loses nothing — the service writes nothing
          // and the writer plugin skips — so it delegates.
          if (!norm.effectiveWrite()) return ctx.watch(watchOptions);
          // TODO(backlog: playground/esbuild-context-watch-write-normalization)
          throw new NotImplementedError(
            'esbuild.context.watch.write',
            'esbuild-wasm browser contexts run with write:false; watched rebuild output writes are not normalized yet',
          );
        },
        serve: (options) => ctx.serve(options),
        cancel: () => ctx.cancel(),
        dispose: () => ctx.dispose(),
      };
    },
    async formatMessages(messages, options) {
      await ensureInitialized();
      return lib.formatMessages(messages, options);
    },
    async analyzeMetafile(metafile, options) {
      await ensureInitialized();
      return lib.analyzeMetafile(metafile, options);
    },
    async stop() {
      if (initPromise === null) return; // never started — nothing to stop
      await initPromise;
      await lib.stop();
      initPromise = null; // next API call re-initializes (Node service-restart parity)
    },
  };
  const pluginEsbuild = createPluginEsbuildView(host);
  return host;
}

declare global {
  // wasm_exec (gojs) fs contract — only the inline esbuild service reads it.
  // eslint-disable-next-line no-var
  var fs: WasmExecFs | undefined;
}

/**
 * Install the host esbuild bridge for this realm (idempotent). Wired wherever
 * the shadow-registry esbuild shim is overlaid: prepareViteCli (vite CLI
 * child), bootDevServer (dev-server child), bootBuild/bootPreview (build
 * child). Initialization stays lazy — installing costs nothing.
 */
export function installEsbuildBridge(): void {
  globalThis.__riftyEsbuild ??= createEsbuildHost({
    lib: esbuildWasm,
    wasmUrl,
    mirror: () => syncMirror(),
  });
}
