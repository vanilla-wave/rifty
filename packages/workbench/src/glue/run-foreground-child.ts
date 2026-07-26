/**
 * Shared foreground child-process driver (ADR-0225/0230).
 *
 * The single place that owns the foreground machinery the owner's `node <file>`
 * executor and the `.bin` executor both need: bounded ordered stdin + EOF,
 * stdout/stderr, SIGTERM, live resize, and settle-on-exit. The exit listener is
 * registered before pre-abort kill because kill may emit exit synchronously.
 *
 * A server child's child→owner messages (`rifty:node-listening`) are wired via
 * `onMessage`; a plain run-to-completion bin child omits it. NOT a fit for the
 * dev-server child (it resolves on a `rifty:dev-ready` MESSAGE, not exit, and
 * returns a handle, not a number) — that keeps its own driver.
 */
import {
  type CommandContext,
  type ProcessExit,
  ShellCommandLifecycleError,
  type StdinReader,
} from '@riftydev/shell';
import { bindChildTerminalResize } from './child-terminal.ts';
import { processExitFromChildEvent } from './process-exit.ts';

/** Read-side of a worker stdio stream (subset of `@riftydev/io` `Readable`). */
export interface ForegroundReadable {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

/** Write-side subset of the kernel Worker's real stdin stream. */
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
  on(event: 'exit', listener: (code?: unknown, signal?: unknown) => void): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  onListeningControl?: (listener: (control: ForegroundListeningControl) => void) => unknown;
  resize(cols: number, rows: number): unknown;
  kill(signal?: string): unknown;
}

export interface ForegroundListeningControl {
  readonly ports: number[];
  readonly previewScope?: string;
}

export interface ForegroundChildOpts {
  /** Optional guest JSON IPC hook; never used for runtime lifecycle control. */
  readonly onMessage?: (message: unknown) => void;
  /** Private runtime listening/port-removal control; never a guest `'message'`. */
  readonly onListening?: (control: ForegroundListeningControl) => void;
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
      await untilStopped(endChildStdin(destination), stopped);
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
 * kill it on `ctx.signal` abort, and resolve with its exact exit. The worker's
 * own exit (natural or post-kill) settles the promise — abort never resolves
 * here, so a Ctrl-C race that exits 130 still flows through one exit path.
 */
export function runForegroundChild(
  handle: ForegroundChildHandle,
  ctx: CommandContext,
  opts: ForegroundChildOpts = {},
): Promise<ProcessExit> {
  return new Promise<ProcessExit>((resolve, reject) => {
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
    if (opts.onListening) {
      if (handle.onListeningControl === undefined) {
        throw new Error('foreground child lacks private listening control');
      }
      handle.onListeningControl(opts.onListening);
    }

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

    let unsubscribeResize: (() => void) | undefined;
    const stopResize = (): void => {
      const unsubscribe = unsubscribeResize;
      unsubscribeResize = undefined;
      unsubscribe?.();
    };

    const signal = ctx.signal;
    const lifecycleErrors: Error[] = [];
    let promiseSettled = false;
    const resolveOnce = (exit: ProcessExit): void => {
      if (promiseSettled) return;
      promiseSettled = true;
      resolve(exit);
    };
    const rejectLifecycleOnce = (): void => {
      if (promiseSettled) return;
      promiseSettled = true;
      if (lifecycleErrors.length === 1) reject(lifecycleErrors[0]);
      else reject(new AggregateError(lifecycleErrors, 'foreground child lifecycle failed'));
    };
    let exited = false;
    let aborted = signal?.aborted === true;
    let controlFailed = false;
    let killSent = false;
    const failWithoutExit = (error: unknown): void => {
      lifecycleErrors.push(asError(error));
      outputClosed = true;
      stopInput();
      signal?.removeEventListener('abort', onAbort);
      try {
        stopResize();
      } catch (cleanupError) {
        lifecycleErrors.push(asError(cleanupError));
      }
      rejectLifecycleOnce();
    };
    const peerEvents = handle as unknown as {
      on(event: 'peererror', listener: (error: unknown) => void): unknown;
    };
    peerEvents.on('peererror', (error) => {
      if (exited || promiseSettled) return;
      const cause = asError(error);
      lifecycleErrors.push(new ShellCommandLifecycleError(cause.message, { cause }));
      outputClosed = true;
      stopInput();
      signal?.removeEventListener('abort', onAbort);
      try {
        stopResize();
      } catch (cleanupError) {
        lifecycleErrors.push(asError(cleanupError));
      }
      try {
        opts.onExit?.();
      } catch (cleanupError) {
        lifecycleErrors.push(asError(cleanupError));
      }
      rejectLifecycleOnce();
    });
    const requestKill = (): void => {
      if (killSent || exited) return;
      killSent = true;
      try {
        if (handle.kill('SIGTERM') === false && !exited) {
          failWithoutExit(new Error('foreground child closed without an exit event'));
        }
      } catch (error) {
        failWithoutExit(error);
      }
    };
    const onAbort = (): void => {
      aborted = true;
      outputClosed = true;
      stopInput();
      try {
        stopResize();
      } catch (error) {
        lifecycleErrors.push(asError(error));
      }
      requestKill();
    };

    // Register the exit listener BEFORE acting on an already-aborted signal:
    // `kill()` emits `'exit'` synchronously, so a pre-aborted run would otherwise
    // lose the event → the promise never resolves (+ `onExit` never fires).
    handle.on('exit', (code, exitSignal) => {
      if (exited) return;
      exited = true;
      outputClosed = true;
      stopInput();
      signal?.removeEventListener('abort', onAbort);
      try {
        stopResize();
      } catch (error) {
        lifecycleErrors.push(asError(error));
      }
      try {
        opts.onExit?.();
      } catch (error) {
        lifecycleErrors.push(asError(error));
      }
      let exit: ProcessExit | undefined;
      try {
        exit = processExitFromChildEvent(code, exitSignal);
      } catch (error) {
        lifecycleErrors.push(asError(error));
      }
      if (lifecycleErrors.length === 0 && exit) resolveOnce(exit);
      else rejectLifecycleOnce();
    });

    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    unsubscribeResize = bindChildTerminalResize(
      handle,
      ctx,
      () => !exited && !aborted && !controlFailed,
      inputFailed,
    );

    if (!exited && !aborted && !controlFailed && ctx.stdin) {
      let destination: ForegroundWritable;
      try {
        destination = handle.stdin();
      } catch (error) {
        inputFailed(error);
        return;
      }
      void pumpForegroundStdin(ctx.stdin, destination, inputStop, () => inputStopped).catch(
        inputFailed,
      );
    }

    function inputFailed(error: unknown): void {
      if (exited || controlFailed) return;
      controlFailed = true;
      outputClosed = true;
      stopInput();
      lifecycleErrors.push(asError(error));
      requestKill();
    }
  });
}
