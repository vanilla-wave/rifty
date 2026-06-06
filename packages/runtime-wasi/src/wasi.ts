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
   * Guest path of the preopen used as the guest's cwd (relative-path default).
   *
   * WASI preview1 has no `getcwd`/`chdir`; a guest derives cwd from the preopen
   * table. Consumers (esbuild's Go/WASIp1 runtime) treat fd 3 (first preopen) as
   * cwd. Passing `cwd` allocates the named preopen fd 3 explicitly rather than
   * depending on `Object.keys` order; omitting it keeps insertion-order first.
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
    // `cwd` option hoists the named preopen to fd 3 (the guest's cwd); ADR-0049.
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
      // `AT_FDCWD` resolves to fd 3. With no preopens it points at an absent
      // fd, so an `AT_FDCWD`-relative call gets `E_BADF` — the honest signal.
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
