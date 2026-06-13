/**
 * Playground `BinExecutor` (ADR-0137) — runs a shell-resolved
 * `node_modules/.bin/<name>` launcher shim as a Node entry in a kernel Worker.
 *
 * The shell layer resolves a bare command to its `.bin` shim path and hands it
 * here. The shim is the linker's launcher format (`#!/usr/bin/env node` +
 * `import('../<pkg>/<bin>')`); we read its bytes and spawn a `kind: 'source'`
 * worker whose `sourceUrl` is the shim's path, so the worker's module loader
 * resolves the shim's relative import from the shim's location (same mechanism
 * runtime-js `execSync` uses for `node <script>`). stdout/stderr stream to the
 * command context; Ctrl+C (`ctx.signal`) kills the worker.
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
export interface BinSpawnSpec {
  /** Shim source text (becomes the `kind: 'source'` entry's `code`). */
  readonly code: string;
  /** Shim path — the entry's `sourceUrl`, anchoring relative-import resolution. */
  readonly sourceUrl: string;
  readonly argv: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
}

export interface BinExecutorDeps {
  /** Shim bytes from the host VFS, or `null` when absent (raced removal). */
  readonly readShim: (binPath: string) => Uint8Array | null;
  /** Spawns the Node entry and returns its handle. */
  readonly spawn: (spec: BinSpawnSpec) => BinWorkerHandle;
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

/** Build a {@link BinExecutor} over an injected spawn + shim reader. */
export function createBinExecutor(deps: BinExecutorDeps): BinExecutor {
  return (binPath, args, ctx) =>
    new Promise<number>((resolve) => {
      const bytes = deps.readShim(binPath);
      if (bytes === null) {
        // The shell resolved this shim a moment ago; a null here means it was
        // removed mid-flight. Surface it (exit 126), never a silent 0.
        ctx.stderr.write(`${binPath}: cannot execute: shim disappeared\n`);
        resolve(126);
        return;
      }

      const handle = deps.spawn({
        code: decoder.decode(bytes),
        sourceUrl: binPath,
        argv: ['rifty', binPath, ...args],
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
