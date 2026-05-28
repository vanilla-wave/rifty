/**
 * WASI preview1 shim entry point. Owns the mutable runtime state (fd table,
 * exit flags, stdout/stderr buffers) and stitches together the syscall family
 * factories from {@link ./syscalls/}.
 *
 * Convention: any unimplemented call returns `__WASI_ENOSYS` (52). We never
 * silently return success.
 */

import { fdSyscalls } from './syscalls/fd.ts';
import { pathSyscalls } from './syscalls/path.ts';
import { procSyscalls } from './syscalls/proc.ts';
import { type FileDescriptor, type WasiCtx, WasiExit } from './syscalls/shared.ts';

export { WasiExit };

interface WasiOptions {
  args?: string[];
  env?: Record<string, string>;
  preopens?: Record<string, string>;
  /**
   * Guest path of the preopen that serves as the relative-path resolution
   * default — the "current working directory" from the guest's point of view.
   *
   * WASI preview1 has no `getcwd`/`chdir`; a guest derives its cwd from the
   * preopen table. Real consumers (esbuild's Go/WASIp1 runtime, ADR-0049)
   * treat **fd 3** (the first preopen) as cwd and resolve relative argv paths
   * against it. Passing `cwd` makes that choice explicit instead of depending
   * on `Object.keys(preopens)` iteration order: the named preopen is allocated
   * fd 3 regardless of its position in the `preopens` record. When omitted, the
   * first key in insertion order keeps fd 3 (backward-compatible).
   *
   * Resolves Q-2026-05-27-003 (Option A). See ADR-0049.
   */
  cwd?: string;
  stdout?: (chunk: string) => void;
  stderr?: (chunk: string) => void;
  stdin?: () => Uint8Array | null;
}

export class Wasi {
  readonly imports: WebAssembly.Imports;
  private memory: WebAssembly.Memory | null = null;
  private readonly fds: Map<number, FileDescriptor> = new Map();
  private readonly nextFd = { value: 3 };
  private readonly exited = { value: false };
  private readonly exitCode = { value: 0 };
  private readonly stdoutBuffer: string[] = [];
  private readonly stderrBuffer: string[] = [];

  constructor(opts: WasiOptions = {}) {
    const args = opts.args ?? ['rifty-wasi'];
    const env = opts.env ?? {};
    const preopens = opts.preopens ?? {};
    const onStdout = opts.stdout ?? ((c: string) => this.stdoutBuffer.push(c));
    const onStderr = opts.stderr ?? ((c: string) => this.stderrBuffer.push(c));
    const onStdin = opts.stdin ?? (() => null);

    this.fds.set(0, { type: 'stdin' });
    this.fds.set(1, { type: 'stdout' });
    this.fds.set(2, { type: 'stderr' });
    // Preopen fd allocation order. WASI preview1 has no `getcwd`, so a guest
    // takes its cwd from fd 3 (the first preopen). The `cwd` option (Option A,
    // ADR-0049) hoists the named preopen to fd 3 so the cwd choice is explicit
    // and not at the mercy of object key iteration order. Other preopens keep
    // their relative order behind it.
    const keys = Object.keys(preopens);
    if (opts.cwd !== undefined) {
      if (!(opts.cwd in preopens)) {
        throw new Error(`WASI: cwd '${opts.cwd}' is not one of the preopens`);
      }
      keys.sort((a, b) => (a === opts.cwd ? -1 : b === opts.cwd ? 1 : 0));
    }
    let fd = 3;
    for (const guestPath of keys) {
      this.fds.set(fd, {
        type: 'dir',
        path: preopens[guestPath],
        isPreopen: true,
        preopenName: guestPath,
      });
      fd++;
    }
    this.nextFd.value = fd;

    const ctx: WasiCtx = {
      args,
      env,
      fds: this.fds,
      // fd 3 is the cwd preopen — the first preopen, or the one named by
      // `opts.cwd` (which the sort above hoists to fd 3). `AT_FDCWD` resolves
      // here. When there are no preopens, this still points at fd 3 (absent);
      // a guest that issues `AT_FDCWD`-relative calls without a preopen gets
      // `E_BADF`, which is the honest signal.
      cwdFd: 3,
      nextFd: this.nextFd,
      exited: this.exited,
      exitCode: this.exitCode,
      onStdout,
      onStderr,
      onStdin,
      view: () => this.memView(),
      bytes: () => this.memBytes(),
    };

    this.imports = {
      wasi_snapshot_preview1: {
        ...fdSyscalls(ctx),
        ...pathSyscalls(ctx),
        ...procSyscalls(ctx),
      },
    };
  }

  /** Convenience: instantiate and call `_start`. Returns the exit code. */
  start(instance: WebAssembly.Instance): number {
    this.memory = instance.exports.memory as WebAssembly.Memory;
    const start = instance.exports._start as (() => void) | undefined;
    if (!start) throw new Error('WASI module has no _start export');
    try {
      start();
    } catch (err) {
      if (!this.exited.value) throw err;
    }
    return this.exitCode.value;
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
