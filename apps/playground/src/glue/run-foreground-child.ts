/**
 * Shared foreground child-process driver (backlog/playground/owner-child-foreground-shared-driver).
 *
 * The single place that owns the foreground machinery the owner's `node <file>`
 * executor and the `.bin` executor both need: decode + stream stdout/stderr to
 * the command context (muting trailing output once aborted/exited), SIGTERM on
 * Ctrl-C, and settle-on-exit — with the exit listener registered BEFORE the
 * pre-abort kill (kill() emits `'exit'` synchronously, so a pre-aborted run
 * would otherwise lose the event and hang). Extracting it stops the node/bin
 * drivers drifting (ADR-0155 §1 recorded the duplication) and gives the bin
 * executor the pre-abort ordering its inline copy lacked.
 *
 * A server child's child→owner control frames (`rifty:node-listening`) are wired via
 * `onMessage`; a plain run-to-completion bin child omits it. NOT a fit for the
 * dev-server child (it resolves on a `rifty:dev-ready` MESSAGE, not exit, and
 * returns a handle, not a number) — that keeps its own driver.
 */
import type { CommandContext } from '@riftydev/shell';

/** Read-side of a worker stdio stream (subset of `@riftydev/io` `Readable`). */
export interface ForegroundReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/**
 * The foreground child surface the driver needs — a subset of
 * `WorkerProcessHandle`. `on('control')` is consulted only when `onMessage` is
 * passed (a server child); a run-to-completion bin child sends no control.
 */
export interface ForegroundChildHandle {
  stdout(): ForegroundReadable;
  stderr(): ForegroundReadable;
  on(event: 'exit', listener: (code?: unknown) => void): unknown;
  on(event: 'control', listener: (message: unknown) => void): unknown;
  kill(signal?: string): unknown;
}

export interface ForegroundChildOpts {
  /** Server-child hook: every child→owner control frame (e.g. `rifty:node-listening`). */
  readonly onMessage?: (message: unknown) => void;
  /** Run once on exit, BEFORE the promise resolves (e.g. preview-registry remove). */
  readonly onExit?: () => void;
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

/**
 * Drive a foreground child to completion: stream its stdout/stderr to `ctx`,
 * kill it on `ctx.signal` abort, and resolve with its exit code. The worker's
 * own exit (natural or post-kill) settles the promise — abort never resolves
 * here, so a Ctrl-C race that exits 130 still flows through one exit path.
 */
export function runForegroundChild(
  handle: ForegroundChildHandle,
  ctx: CommandContext,
  opts: ForegroundChildOpts = {},
): Promise<number> {
  return new Promise<number>((resolve) => {
    // Stop surfacing output once the run is aborted OR has exited: chunks the
    // kernel buffers between `kill` and teardown must not land in the terminal
    // AFTER the foreground run already resolved (shell exit 130).
    let outputClosed = false;
    const stream = (chunk: unknown, w: { write(s: string): void }): void => {
      if (outputClosed) return;
      const text = decodeChunk(chunk);
      if (text) w.write(text);
    };
    handle.stdout().on('data', (c) => stream(c, ctx.stdout));
    handle.stderr().on('data', (c) => stream(c, ctx.stderr));
    if (opts.onMessage) handle.on('control', opts.onMessage);

    const signal = ctx.signal;
    const onAbort = (): void => {
      outputClosed = true;
      handle.kill('SIGTERM');
    };

    // Register the exit listener BEFORE acting on an already-aborted signal:
    // `kill()` emits `'exit'` synchronously, so a pre-aborted run would otherwise
    // lose the event → the promise never resolves (+ `onExit` never fires).
    let settled = false;
    handle.on('exit', (code) => {
      if (settled) return;
      settled = true;
      outputClosed = true;
      signal?.removeEventListener('abort', onAbort);
      opts.onExit?.();
      resolve(typeof code === 'number' ? code : 0);
    });

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}
