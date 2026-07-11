/**
 * Shared foreground child-process driver (backlog/playground/owner-child-foreground-shared-driver).
 *
 * The single place that owns the foreground machinery the owner's `node <file>`
 * executor and the `.bin` executor both need: ordered ctx.stdin→child stdin,
 * decoded stdout/stderr, SIGTERM on Ctrl-C, live resize, and settle-on-exit.
 * The exit listener is registered BEFORE a pre-abort kill because kill() may
 * emit `'exit'` synchronously. One driver prevents node/bin transport drift
 * (ADR-0155 §1, ADR-0230).
 *
 * A server child's child→owner messages (`rifty:node-listening`) are wired via
 * `onMessage`; a plain run-to-completion bin child omits it. NOT a fit for the
 * dev-server child (it resolves on a `rifty:dev-ready` MESSAGE, not exit, and
 * returns a handle, not a number) — that keeps its own driver.
 */
import type { CommandContext, StdinReader } from '@riftydev/shell';

/** Read-side of a worker stdio stream (subset of `@riftydev/io` `Readable`). */
export interface ForegroundReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/** Write-side subset of the kernel Worker's real `@riftydev/io` stdin stream. */
export interface ForegroundWritable {
  write(chunk: Uint8Array, callback: (error?: Error | null) => void): unknown;
  end(): unknown;
  once(event: 'finish' | 'error', listener: (...args: unknown[]) => void): unknown;
  removeListener(event: 'finish' | 'error', listener: (...args: unknown[]) => void): unknown;
}

/**
 * The foreground child surface the driver needs — a subset of
 * `WorkerProcessHandle`. `on('message')` is consulted only when `onMessage` is
 * passed (a server child); a run-to-completion bin child never sends messages.
 */
export interface ForegroundChildHandle {
  stdout(): ForegroundReadable;
  stderr(): ForegroundReadable;
  stdin(): ForegroundWritable;
  on(event: 'exit', listener: (code?: unknown) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  resize(cols: number, rows: number): unknown;
  kill(signal?: string): unknown;
}

export interface ForegroundChildOpts {
  /** Server-child hook: every child→owner `'message'` (e.g. `rifty:node-listening`). */
  readonly onMessage?: (message: unknown) => void;
  /** Run once on exit, BEFORE the promise resolves (e.g. preview-registry remove). */
  readonly onExit?: () => void;
}

const decoder = new TextDecoder();

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function writeChildStdin(destination: ForegroundWritable, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      destination.write(chunk, (error) => {
        if (error) reject(asError(error));
        else resolve();
      });
    } catch (error) {
      reject(asError(error));
    }
  });
}

function endChildStdin(destination: ForegroundWritable): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = (): void => {
      destination.removeListener('finish', onFinish);
      destination.removeListener('error', onError);
    };
    const onFinish = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(asError(error));
    };
    destination.once('finish', onFinish);
    destination.once('error', onError);
    try {
      destination.end();
    } catch (error) {
      onError(error);
    }
  });
}

type PumpStep<T> = { readonly kind: 'value'; readonly value: T } | { readonly kind: 'stopped' };

function untilStopped<T>(operation: Promise<T>, stopped: Promise<void>): Promise<PumpStep<T>> {
  return Promise.race([
    operation.then((value): PumpStep<T> => ({ kind: 'value', value })),
    stopped.then((): PumpStep<T> => ({ kind: 'stopped' })),
  ]);
}

async function pumpForegroundStdin(
  source: StdinReader,
  destination: ForegroundWritable,
  stopped: Promise<void>,
  isStopped: () => boolean,
): Promise<void> {
  while (!isStopped()) {
    const read = await untilStopped(
      Promise.resolve().then(() => source.read()),
      stopped,
    );
    if (read.kind === 'stopped' || isStopped()) return;
    if (read.value === null) {
      const ended = await untilStopped(endChildStdin(destination), stopped);
      if (ended.kind === 'stopped') return;
      return;
    }
    const written = await untilStopped(writeChildStdin(destination, read.value), stopped);
    if (written.kind === 'stopped') return;
  }
}

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
  return new Promise<number>((resolve, reject) => {
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
    if (opts.onMessage) handle.on('message', opts.onMessage);
    const unsubscribeResize = ctx.terminal?.subscribe(({ cols, rows }) => {
      handle.resize(cols, rows);
    });

    let stopInputResolve = (): void => {};
    let inputStopped = false;
    const inputStop = new Promise<void>((resolveStop) => {
      stopInputResolve = resolveStop;
    });
    const stopInput = (): void => {
      if (inputStopped) return;
      inputStopped = true;
      stopInputResolve();
    };

    const signal = ctx.signal;
    const onAbort = (): void => {
      outputClosed = true;
      stopInput();
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
      stopInput();
      signal?.removeEventListener('abort', onAbort);
      unsubscribeResize?.();
      try {
        opts.onExit?.();
        resolve(typeof code === 'number' ? code : 0);
      } catch (error) {
        reject(asError(error));
      }
    });

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    if (!settled && ctx.stdin) {
      let destination: ReturnType<ForegroundChildHandle['stdin']>;
      try {
        destination = handle.stdin();
      } catch (error) {
        inputFailed(asError(error));
        return;
      }
      void pumpForegroundStdin(ctx.stdin, destination, inputStop, () => inputStopped).catch(
        inputFailed,
      );
    }

    function inputFailed(error: unknown): void {
      if (settled) return;
      settled = true;
      outputClosed = true;
      stopInput();
      signal?.removeEventListener('abort', onAbort);
      unsubscribeResize?.();
      const errors = [asError(error)];
      try {
        handle.kill('SIGTERM');
      } catch (killError) {
        errors.push(asError(killError));
      }
      try {
        opts.onExit?.();
      } catch (cleanupError) {
        errors.push(asError(cleanupError));
      }
      reject(
        errors.length === 1
          ? errors[0]!
          : new AggregateError(errors, 'foreground child stdin pump failed'),
      );
    }
  });
}
