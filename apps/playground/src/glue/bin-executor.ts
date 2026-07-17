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

import type { BinExecutor, CommandContext } from '@riftydev/shell';
import { type ForegroundWritable, runForegroundChild } from './run-foreground-child.ts';

/** Read-side of a worker stdio stream (subset of `@riftydev/io` `Readable`). */
export interface BinReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/**
 * Worker handle surface the executor needs (subset of `WorkerProcessHandle`).
 * `on('message')` is part of the shared `ForegroundChildHandle` contract (the
 * real handle has it); a bin child never sends messages, so the driver never
 * subscribes — it is declared only to satisfy the shared type.
 */
export interface BinWorkerHandle {
  stdout(): BinReadable;
  stderr(): BinReadable;
  stdin(): ForegroundWritable;
  on(event: 'exit', listener: (code?: unknown, signal?: unknown) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  send?(message: unknown): unknown;
  resize(cols: number, rows: number): unknown;
  kill(signal?: string): unknown;
}

/** Spawn request: the executor builds this; the host maps it to a Worker spec. */
export interface BinSpawnRequest {
  /** Absolute `.bin` shim path — `argv[1]`; launch metadata marks it as a bin. */
  readonly shimPath: string;
  readonly args: readonly string[];
  readonly env: Record<string, string>;
  readonly cwd: string;
  readonly isTTY: boolean;
  readonly cols?: number;
  readonly rows?: number;
  /** Host-minted preview correlation; never part of guest `process.env`. */
  readonly previewScope?: string;
  /** Host-only physical root behind the child process's public `/` namespace. */
  readonly remoteFsRoot?: string;
}

export interface BinExecutorDeps {
  /** Enrich host-only launch metadata before lifecycle hooks and spawn. */
  readonly prepareRequest?: (req: BinSpawnRequest, ctx: CommandContext) => BinSpawnRequest;
  /** Spawns the node-entry worker for the shim and returns its handle. */
  readonly spawn: (req: BinSpawnRequest) => BinWorkerHandle;
  /** Optional lifecycle hook for owners that mirror server-capable bins into UI state. */
  readonly onStart?: (req: BinSpawnRequest, ctx: CommandContext) => void;
  /** Optional child handle hook for owners that need to send control messages. */
  readonly onSpawn?: (req: BinSpawnRequest, handle: BinWorkerHandle, ctx: CommandContext) => void;
  /** Optional child→owner IPC hook (e.g. listened ports from server-capable bins). */
  readonly onMessage?: (req: BinSpawnRequest, message: unknown, ctx: CommandContext) => void;
  /** Optional exit hook (runs before the executor promise resolves). */
  readonly onExit?: (req: BinSpawnRequest, ctx: CommandContext) => void;
}

/** Build a {@link BinExecutor} over an injected node-entry worker spawn. */
export function createBinExecutor(deps: BinExecutorDeps): BinExecutor {
  // `async` so a synchronous `spawn` throw (a host-boundary failure) surfaces as
  // a rejected promise to the shell, not a sync throw. The spawn + the shared
  // driver's listener registration both run before the first suspension, so a
  // caller racing stdout/exit right after the call still sees them wired.
  return async (binPath, args, ctx) => {
    // The worker reads the shim via the VFS sync mirror (runNodeEntry); a shim
    // removed mid-flight surfaces there as a loud worker error (exit 1 + stderr),
    // never a silent 0. Foreground machinery (decode + stream + Ctrl+C kill/mute
    // + settle-on-exit, incl. the exit-before-pre-abort ordering) is shared with
    // the owner `node <file>` executor via run-foreground-child. Server-capable
    // bins can also surface child IPC through the optional hooks.
    const baseRequest: BinSpawnRequest = {
      shimPath: binPath,
      args,
      env: ctx.env,
      cwd: ctx.cwd,
      isTTY: ctx.isTTY === true,
      cols: ctx.cols,
      rows: ctx.rows,
    };
    const req = deps.prepareRequest?.(baseRequest, ctx) ?? baseRequest;
    deps.onStart?.(req, ctx);
    const handle = deps.spawn(req);
    deps.onSpawn?.(req, handle, ctx);
    return runForegroundChild(handle, ctx, {
      onMessage: deps.onMessage ? (message) => deps.onMessage?.(req, message, ctx) : undefined,
      onExit: deps.onExit ? () => deps.onExit?.(req, ctx) : undefined,
    });
  };
}
