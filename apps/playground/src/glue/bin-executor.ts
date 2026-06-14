/**
 * Playground `BinExecutor` (ADR-0137, Opt-Y) — runs a shell-resolved
 * `node_modules/.bin/<name>` launcher shim as a Node entry in a kernel Worker.
 *
 * The shell layer resolves a bare command to its `.bin` shim path and hands it
 * here. We spawn the `kind:'url'` node-entry bootstrap (which runs
 * `runNodeEntry` in the worker): it reads the shim, pulls its launcher target,
 * and imports THAT through the runtime-js module loader — shebang stripped,
 * relative import resolved against the VFS. (The kernel's raw `kind:'source'`
 * path compiles via `new AsyncFunction`, which chokes on the shim's `#!` line
 * and never routes its `import()` to the loader — so it could not run a shim.)
 * stdout/stderr stream to the command context; Ctrl+C (`ctx.signal`) kills it.
 *
 * Spawn is injected so the host wires the real `globalProcessManager` while
 * unit tests drive a fake handle — the real Worker is an e2e-only boundary.
 */

import type { BinExecutor } from '@riftydev/shell';

/** Read-side of a worker stdio stream (subset of `@riftydev/io` `Readable`). */
export interface BinReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/** Worker handle surface the executor needs (subset of `WorkerProcessHandle`). */
export interface BinWorkerHandle {
  stdout(): BinReadable;
  stderr(): BinReadable;
  on(event: 'exit', listener: (code?: unknown) => void): unknown;
  kill(signal?: string): unknown;
}

/** Spawn request: the executor builds this; the host maps it to a Worker spec. */
export interface BinSpawnRequest {
  /** Absolute `.bin` shim path — the worker's entry (`argv[1]`, `RIFTY_BIN=1`). */
  readonly shimPath: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
}

export interface BinExecutorDeps {
  /** Spawns the node-entry worker for the shim and returns its handle. */
  readonly spawn: (req: BinSpawnRequest) => BinWorkerHandle;
}

const decoder = new TextDecoder();

function decodeChunk(chunk: unknown): string {
  if (chunk instanceof Uint8Array) return decoder.decode(chunk);
  if (chunk instanceof ArrayBuffer) return decoder.decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return decoder.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return typeof chunk === 'string' ? chunk : '';
}

/** Build a {@link BinExecutor} over an injected node-entry worker spawn. */
export function createBinExecutor(deps: BinExecutorDeps): BinExecutor {
  return (binPath, args, ctx) =>
    new Promise<number>((resolve) => {
      // The worker reads the shim via the VFS sync mirror (runNodeEntry); a shim
      // removed mid-flight surfaces there as a loud worker error (exit 1 +
      // stderr), never a silent 0.
      const handle = deps.spawn({
        shimPath: binPath,
        args,
        env: ctx.env,
        cwd: ctx.cwd,
      });

      // Stop surfacing output once the worker is aborted OR has exited: chunks
      // the kernel buffers between `kill` and teardown must not land in the
      // terminal AFTER the foreground run already resolved (shell exit 130).
      let outputClosed = false;
      handle.stdout().on('data', (chunk) => {
        if (outputClosed) return;
        const text = decodeChunk(chunk);
        if (text) ctx.stdout.write(text);
      });
      handle.stderr().on('data', (chunk) => {
        if (outputClosed) return;
        const text = decodeChunk(chunk);
        if (text) ctx.stderr.write(text);
      });

      // Ctrl+C: kill the worker AND mute its trailing output. The shell's abort
      // race already resolves the run at exit 130; the worker's own exit still
      // settles this promise (no leak), so abort does NOT resolve here.
      const signal = ctx.signal;
      const onAbort = (): void => {
        outputClosed = true;
        handle.kill('SIGTERM');
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
      }

      let settled = false;
      handle.on('exit', (code) => {
        if (settled) return;
        settled = true;
        outputClosed = true;
        signal?.removeEventListener('abort', onAbort);
        resolve(typeof code === 'number' ? code : 0);
      });
    });
}
