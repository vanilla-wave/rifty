/**
 * WASI preview1 shim. Implements enough syscalls to run esbuild.wasm-class
 * binaries: args, env, fd_read/write on stdin/stdout/stderr, fd file ops via
 * the host VFS, basic clock + random, proc_exit.
 *
 * Convention: any unimplemented call returns `__WASI_ENOSYS` (52). We never
 * silently return success.
 */

import { joinPath, normalizePath, syncMirror } from '@rifty/vfs';

// preview1 errno subset
const E_SUCCESS = 0;
const E_BADF = 8;
const E_NOENT = 44;
const E_NOSYS = 52;

// preview1 filetype subset
const FILETYPE_UNKNOWN = 0;
const _FILETYPE_BLOCK_DEVICE = 1;
const _FILETYPE_CHARACTER_DEVICE = 2;
const FILETYPE_DIRECTORY = 3;
const FILETYPE_REGULAR_FILE = 4;

interface WasiOptions {
  args?: string[];
  env?: Record<string, string>;
  preopens?: Record<string, string>;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  stdin?: () => Uint8Array | null;
}

interface FileDescriptor {
  type: 'stdin' | 'stdout' | 'stderr' | 'file' | 'dir';
  /** VFS path (for files/dirs). */
  path?: string;
  /** File contents (for files), kept in memory for the lifetime of the fd. */
  data?: Uint8Array;
  cursor?: number;
  isPreopen?: boolean;
  preopenName?: string;
}

export class Wasi {
  readonly imports: WebAssembly.Imports;
  private memory: WebAssembly.Memory | null = null;
  private readonly args: string[];
  private readonly env: Record<string, string>;
  private readonly preopens: Record<string, string>;
  private readonly fds: Map<number, FileDescriptor> = new Map();
  private nextFd = 3;
  private exited = false;
  private exitCode = 0;
  private readonly stdoutBuffer: string[] = [];
  private readonly stderrBuffer: string[] = [];
  private readonly onStdout: (chunk: string) => void;
  private readonly onStderr: (chunk: string) => void;

  constructor(opts: WasiOptions = {}) {
    this.args = opts.args ?? ['rifty-wasi'];
    this.env = opts.env ?? {};
    this.preopens = opts.preopens ?? {};
    this.onStdout = opts.stdout ?? ((c) => this.stdoutBuffer.push(c));
    this.onStderr = opts.stderr ?? ((c) => this.stderrBuffer.push(c));

    this.fds.set(0, { type: 'stdin' });
    this.fds.set(1, { type: 'stdout' });
    this.fds.set(2, { type: 'stderr' });
    let fd = 3;
    for (const guestPath of Object.keys(this.preopens)) {
      this.fds.set(fd, {
        type: 'dir',
        path: this.preopens[guestPath],
        isPreopen: true,
        preopenName: guestPath,
      });
      fd++;
    }
    this.nextFd = fd;

    this.imports = { wasi_snapshot_preview1: this.makeImports() };
  }

  /** Convenience: instantiate and call `_start`. Returns the exit code. */
  start(instance: WebAssembly.Instance): number {
    this.memory = instance.exports.memory as WebAssembly.Memory;
    const start = instance.exports._start as (() => void) | undefined;
    if (!start) throw new Error('WASI module has no _start export');
    try {
      start();
    } catch (err) {
      if (!this.exited) throw err;
    }
    return this.exitCode;
  }

  collectedStdout(): string {
    return this.stdoutBuffer.join('');
  }
  collectedStderr(): string {
    return this.stderrBuffer.join('');
  }

  private memView(): DataView {
    if (!this.memory) throw new Error('WASI: memory not set');
    return new DataView(this.memory.buffer);
  }
  private memBytes(): Uint8Array {
    if (!this.memory) throw new Error('WASI: memory not set');
    return new Uint8Array(this.memory.buffer);
  }

  private makeImports(): WebAssembly.ModuleImports {
    const enc = new TextEncoder();
    const dec = new TextDecoder('utf-8');

    return {
      args_get: (argv: number, argvBuf: number) => {
        const view = this.memView();
        const bytes = this.memBytes();
        let off = argvBuf;
        for (let i = 0; i < this.args.length; i++) {
          view.setUint32(argv + i * 4, off, true);
          const b = enc.encode(`${this.args[i] ?? ''}\0`);
          bytes.set(b, off);
          off += b.length;
        }
        return E_SUCCESS;
      },
      args_sizes_get: (countOut: number, sizeOut: number) => {
        const view = this.memView();
        view.setUint32(countOut, this.args.length, true);
        let size = 0;
        for (const a of this.args) size += enc.encode(`${a}\0`).length;
        view.setUint32(sizeOut, size, true);
        return E_SUCCESS;
      },
      environ_get: (envPtr: number, envBuf: number) => {
        const view = this.memView();
        const bytes = this.memBytes();
        let off = envBuf;
        let idx = 0;
        for (const k of Object.keys(this.env)) {
          view.setUint32(envPtr + idx * 4, off, true);
          const b = enc.encode(`${k}=${this.env[k]}\0`);
          bytes.set(b, off);
          off += b.length;
          idx++;
        }
        return E_SUCCESS;
      },
      environ_sizes_get: (countOut: number, sizeOut: number) => {
        const view = this.memView();
        const keys = Object.keys(this.env);
        view.setUint32(countOut, keys.length, true);
        let size = 0;
        for (const k of keys) size += enc.encode(`${k}=${this.env[k]}\0`).length;
        view.setUint32(sizeOut, size, true);
        return E_SUCCESS;
      },
      fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => {
        const fdEntry = this.fds.get(fd);
        if (!fdEntry) return E_BADF;
        const view = this.memView();
        const bytes = this.memBytes();
        let written = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          const slice = bytes.subarray(ptr, ptr + len);
          if (fdEntry.type === 'stdout') this.onStdout(dec.decode(slice));
          else if (fdEntry.type === 'stderr') this.onStderr(dec.decode(slice));
          else if (fdEntry.type === 'file') {
            const cur = fdEntry.cursor ?? 0;
            const existing = fdEntry.data ?? new Uint8Array(0);
            const needed = cur + slice.length;
            const next = needed > existing.length ? new Uint8Array(needed) : existing;
            if (next !== existing) next.set(existing, 0);
            next.set(slice, cur);
            fdEntry.data = next;
            fdEntry.cursor = needed;
            if (fdEntry.path) syncMirror().writeFileSync(fdEntry.path, next);
          }
          written += slice.length;
        }
        view.setUint32(nwritten, written, true);
        return E_SUCCESS;
      },
      fd_read: (fd: number, iovs: number, iovsLen: number, nread: number) => {
        const fdEntry = this.fds.get(fd);
        if (!fdEntry || fdEntry.type !== 'file') {
          // stdin: nothing
          this.memView().setUint32(nread, 0, true);
          return E_SUCCESS;
        }
        const view = this.memView();
        const bytes = this.memBytes();
        let readTotal = 0;
        let cursor = fdEntry.cursor ?? 0;
        const data = fdEntry.data ?? new Uint8Array(0);
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          const remaining = data.length - cursor;
          if (remaining <= 0) break;
          const take = Math.min(len, remaining);
          bytes.set(data.subarray(cursor, cursor + take), ptr);
          cursor += take;
          readTotal += take;
        }
        fdEntry.cursor = cursor;
        view.setUint32(nread, readTotal, true);
        return E_SUCCESS;
      },
      fd_close: (fd: number) => {
        if (!this.fds.has(fd)) return E_BADF;
        if (fd <= 2) return E_SUCCESS;
        this.fds.delete(fd);
        return E_SUCCESS;
      },
      fd_seek: (fd: number, offset: bigint, whence: number, newOffset: number) => {
        const fdEntry = this.fds.get(fd);
        if (!fdEntry || fdEntry.type !== 'file') return E_BADF;
        const cur = fdEntry.cursor ?? 0;
        const size = (fdEntry.data ?? new Uint8Array(0)).length;
        let next: number;
        if (whence === 0) next = Number(offset);
        else if (whence === 1) next = cur + Number(offset);
        else next = size + Number(offset);
        fdEntry.cursor = next;
        this.memView().setBigUint64(newOffset, BigInt(next), true);
        return E_SUCCESS;
      },
      fd_fdstat_get: (fd: number, _outPtr: number) => {
        return this.fds.has(fd) ? E_SUCCESS : E_BADF;
      },
      fd_prestat_get: (fd: number, outPtr: number) => {
        const entry = this.fds.get(fd);
        if (!entry || !entry.isPreopen || !entry.preopenName) return E_BADF;
        const view = this.memView();
        view.setUint8(outPtr, 0); // PREOPEN_TYPE_DIR
        view.setUint32(outPtr + 4, enc.encode(entry.preopenName).length, true);
        return E_SUCCESS;
      },
      fd_prestat_dir_name: (fd: number, ptr: number, len: number) => {
        const entry = this.fds.get(fd);
        if (!entry || !entry.preopenName) return E_BADF;
        const name = enc.encode(entry.preopenName);
        if (name.length > len) return 28; // ENAMETOOLONG
        this.memBytes().set(name, ptr);
        return E_SUCCESS;
      },
      path_open: (
        fd: number,
        _dirflags: number,
        pathPtr: number,
        pathLen: number,
        _oflags: number,
        _fsRightsBase: bigint,
        _fsRightsInheriting: bigint,
        _fdflags: number,
        outFd: number,
      ) => {
        const base = this.fds.get(fd);
        if (!base || base.type !== 'dir' || !base.path) return E_BADF;
        const relative = dec.decode(this.memBytes().subarray(pathPtr, pathPtr + pathLen));
        const fullPath = normalizePath(joinPath(base.path, relative));
        let data: Uint8Array = new Uint8Array(0);
        try {
          data = syncMirror().readFileBytesSync(fullPath) as Uint8Array;
        } catch {
          // create-mode: create empty
        }
        const newFd = this.nextFd++;
        this.fds.set(newFd, { type: 'file', path: fullPath, data, cursor: 0 });
        this.memView().setUint32(outFd, newFd, true);
        return E_SUCCESS;
      },
      path_filestat_get: (
        fd: number,
        _flags: number,
        pathPtr: number,
        pathLen: number,
        outBuf: number,
      ) => {
        const base = this.fds.get(fd);
        if (!base || base.type !== 'dir' || !base.path) return E_BADF;
        const relative = dec.decode(this.memBytes().subarray(pathPtr, pathPtr + pathLen));
        const fullPath = normalizePath(joinPath(base.path, relative));
        try {
          const st = syncMirror().statSync(fullPath);
          const view = this.memView();
          view.setBigUint64(outBuf, 0n, true);
          view.setBigUint64(outBuf + 8, 0n, true);
          view.setUint8(
            outBuf + 16,
            st.isDirectory
              ? FILETYPE_DIRECTORY
              : st.isFile
                ? FILETYPE_REGULAR_FILE
                : FILETYPE_UNKNOWN,
          );
          view.setBigUint64(outBuf + 24, BigInt(st.size ?? 0), true);
          return E_SUCCESS;
        } catch {
          return E_NOENT;
        }
      },
      path_create_directory: (fd: number, pathPtr: number, pathLen: number) => {
        const base = this.fds.get(fd);
        if (!base || base.type !== 'dir' || !base.path) return E_BADF;
        const relative = dec.decode(this.memBytes().subarray(pathPtr, pathPtr + pathLen));
        const fullPath = normalizePath(joinPath(base.path, relative));
        try {
          syncMirror().mkdirSync(fullPath, { recursive: true });
          return E_SUCCESS;
        } catch {
          return E_NOENT;
        }
      },
      proc_exit: (code: number) => {
        this.exited = true;
        this.exitCode = code;
        throw new WasiExit(code);
      },
      clock_time_get: (_id: number, _precision: bigint, outPtr: number) => {
        const ns = BigInt(Math.floor(performance.now() * 1e6));
        this.memView().setBigUint64(outPtr, ns, true);
        return E_SUCCESS;
      },
      random_get: (ptr: number, len: number) => {
        const bytes = this.memBytes().subarray(ptr, ptr + len);
        crypto.getRandomValues(bytes);
        return E_SUCCESS;
      },
      poll_oneoff: () => E_NOSYS,
      sched_yield: () => E_SUCCESS,
    };
  }
}

class WasiExit extends Error {
  readonly exitCode: number;
  constructor(code: number) {
    super(`WASI proc_exit(${code})`);
    this.name = 'WasiExit';
    this.exitCode = code;
  }
}

/** Convenience: compile bytes, instantiate with the WASI shim, run `_start`. */
export async function runWasi(
  wasm: BufferSource,
  opts: WasiOptions = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const wasi = new Wasi(opts);
  const { instance } = await WebAssembly.instantiate(wasm, wasi.imports);
  let exitCode = 0;
  try {
    exitCode = wasi.start(instance);
  } catch (err) {
    if (err instanceof WasiExit) exitCode = err.exitCode;
    else throw err;
  }
  return { exitCode, stdout: wasi.collectedStdout(), stderr: wasi.collectedStderr() };
}

export { WasiExit };
