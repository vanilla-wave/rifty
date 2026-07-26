/**
 * Inner script-execution helper for `child_process.spawn`. Split out of
 * `child_process.ts` to keep that file under the ADR-0024 line budget.
 *
 * Owns the actual `new Function(...)` eval, the `__process` proxy passed to
 * the script (argv/env/stdout/stderr/optional IPC), and the exit-code
 * translation that the kernel `ProcessManager` needs (ENOENT-127,
 * `process.exit(N)`) — see `child_process.ts` for the outer wrapper.
 */

import { Buffer, EventEmitter, NotImplementedError, Writable, loadBuiltin } from '@riftydev/io';
import type { ProcessHandle, ProcessIO } from '@riftydev/kernel';
import { nodeIpcChannel } from '../internal/node-ipc-channel.ts';
import { serializeNodeIpcMessage } from '../internal/node-ipc-serialization.ts';
import { syncMirror } from './fs-sync-mirror.ts';

export interface ExecScriptArgs {
  command: string;
  args: string[];
  opts: { cwd?: string; env?: Record<string, string>; __fork?: boolean };
  io: ProcessIO;
  ownHandle: ProcessHandle;
  inboundIpc: EventEmitter;
  stdoutPush: (chunk: unknown) => void;
  stderrPush: (chunk: unknown) => void;
  /** Bus shared with the outer ChildProcess wrapper so `__process.send`
   * can surface `'message'` events on it. */
  outboundMessages: EventEmitter;
  stdinPipe: SameRealmStdinPipe;
}

type Listener = (...args: unknown[]) => void;

/** Real in-realm pipe used only when a physical Worker route is unavailable. */
export class SameRealmStdinPipe {
  readonly writable: Writable;
  readonly #child = new EventEmitter();
  readonly #pending: unknown[] = [];
  #attached = false;
  #ended = false;
  #notify: () => void = () => {};

  constructor() {
    this.writable = new Writable({
      write: (chunk, _encoding, callback) => {
        if (this.#attached) this.#child.emit('data', chunk);
        else this.#pending.push(chunk);
        callback();
      },
      final: (callback) => {
        this.#ended = true;
        this.#flush();
        callback();
        this.#notify();
      },
    });
  }

  attach(notify: () => void): EventEmitter {
    this.#attached = true;
    this.#notify = notify;
    return this.#child;
  }

  flush(): void {
    this.#flush();
  }

  isActive(): boolean {
    return (
      !this.#ended &&
      (this.#child.listenerCount('data') > 0 || this.#child.listenerCount('end') > 0)
    );
  }

  #flush(): void {
    if (!this.#attached) return;
    for (const chunk of this.#pending.splice(0)) this.#child.emit('data', chunk);
    if (this.#ended) this.#child.emit('end');
  }
}

const hostSetTimeout = globalThis.setTimeout.bind(globalThis);
const hostClearTimeout = globalThis.clearTimeout.bind(globalThis);
const hostSetInterval = globalThis.setInterval.bind(globalThis);
const hostClearInterval = globalThis.clearInterval.bind(globalThis);

/**
 * Run a child script through `new Function`. Mutates `ownHandle.exitCode`
 * directly for non-zero exits (so the kernel preserves them) and emits
 * `'exit'` / `'close'` on the handle itself.
 */
export async function execScript(a: ExecScriptArgs): Promise<void> {
  let streamsClosed = false;
  const writeStdout = (chunk: string): void => {
    a.io.write('stdout', chunk);
  };
  const writeStderr = (chunk: string): void => {
    a.io.write('stderr', chunk);
  };
  const closeStreams = (): void => {
    if (streamsClosed) return;
    streamsClosed = true;
    a.stdoutPush(null);
    a.stderrPush(null);
  };
  let finished = false;
  const finish = (exitCode: number): void => {
    if (finished || a.ownHandle.exitCode !== null || a.ownHandle.signalCode !== null) return;
    finished = true;
    a.ownHandle.exitCode = exitCode;
    closeStreams();
    a.ownHandle.emit('exit', exitCode, null);
    a.ownHandle.emit('close', exitCode, null);
  };

  if (a.command !== 'node') {
    closeStreams();
    finish(127);
    return;
  }
  const scriptPath = a.args[0];
  if (!scriptPath) {
    writeStderr('node: missing script\n');
    closeStreams();
    finish(1);
    return;
  }

  try {
    const source = syncMirror().readFileBytesSync(scriptPath);
    const code = Buffer.from(source).toString();
    let wakeLifecycle = (): void => {};
    const lifecycleWake = (): void => wakeLifecycle();
    const stdin = a.stdinPipe.attach(lifecycleWake);
    const processEvents = new EventEmitter();
    const timeouts = new Set<ReturnType<typeof hostSetTimeout>>();
    const intervals = new Set<ReturnType<typeof hostSetInterval>>();
    let ipcActive = false;
    let aborted = a.io.signal.aborted;
    let childProcess!: {
      argv: string[];
      env: Record<string, string>;
      pid: number;
      ppid: number;
      stdin: EventEmitter;
      stdout: { write(c: string): void };
      stderr: { write(c: string): void };
      cwd(): string;
      send?: (msg: unknown, ...unsupported: unknown[]) => boolean;
      disconnect?: () => void;
      connected?: boolean;
      channel?: ReturnType<typeof nodeIpcChannel> | null;
      on(event: string, cb: Listener): unknown;
      once(event: string, cb: Listener): unknown;
      kill(pid: number, signal?: string): boolean;
      exit(code?: number): never;
    };
    const withChildProcess = <T>(run: () => T): T => {
      const realm = globalThis as { process?: unknown };
      const previous = realm.process;
      realm.process = childProcess;
      try {
        return run();
      } finally {
        realm.process = previous;
      }
    };
    const cleanupTimers = (): void => {
      for (const handle of timeouts) hostClearTimeout(handle);
      for (const handle of intervals) hostClearInterval(handle);
      timeouts.clear();
      intervals.clear();
    };
    const localSetTimeout = (callback: Listener, delay?: number, ...args: unknown[]) => {
      const handle = hostSetTimeout(() => {
        timeouts.delete(handle);
        try {
          withChildProcess(() => callback(...args));
        } finally {
          lifecycleWake();
        }
      }, delay);
      timeouts.add(handle);
      lifecycleWake();
      return handle;
    };
    const localClearTimeout = (handle: ReturnType<typeof hostSetTimeout>): void => {
      hostClearTimeout(handle);
      timeouts.delete(handle);
      lifecycleWake();
    };
    const localSetInterval = (callback: Listener, delay?: number, ...args: unknown[]) => {
      const handle = hostSetInterval(() => withChildProcess(() => callback(...args)), delay);
      intervals.add(handle);
      lifecycleWake();
      return handle;
    };
    const localClearInterval = (handle: ReturnType<typeof hostSetInterval>): void => {
      hostClearInterval(handle);
      intervals.delete(handle);
      lifecycleWake();
    };
    const invokeGuest = (listener: Listener, ...args: unknown[]): void => {
      try {
        withChildProcess(() => listener(...args));
      } catch (error) {
        if (
          typeof error !== 'object' ||
          error === null ||
          (error as { code?: unknown }).code !== 'RIFTY_PROCESS_EXIT'
        ) {
          throw error;
        }
      }
    };
    const onChildMessage = (message: unknown): void => {
      invokeGuest(() => processEvents.emit('message', message));
    };
    const onSignal = (signal: unknown): void => {
      invokeGuest(() => {
        if (!processEvents.emit(String(signal))) a.ownHandle.kill(String(signal));
      });
    };
    a.inboundIpc.on('childMessage', onChildMessage);
    a.inboundIpc.on('signal', onSignal);
    a.io.signal.addEventListener(
      'abort',
      () => {
        aborted = true;
        cleanupTimers();
        closeStreams();
        lifecycleWake();
      },
      { once: true },
    );
    childProcess = {
      argv: ['rifty', scriptPath, ...a.args.slice(1)],
      env: a.opts.env ?? {},
      pid: a.ownHandle.pid,
      ppid: a.ownHandle.ppid,
      stdin,
      stdout: { write: writeStdout },
      stderr: { write: writeStderr },
      cwd: () => a.opts.cwd ?? '/',
      on(event, cb) {
        processEvents.on(event, cb);
        if (event === 'message') ipcActive = true;
        lifecycleWake();
        return childProcess;
      },
      once(event, cb) {
        const wrapped: Listener = (...args) => {
          processEvents.removeListener(event, wrapped);
          cb(...args);
          if (event === 'message' && processEvents.listenerCount('message') === 0) {
            ipcActive = false;
          }
          lifecycleWake();
        };
        processEvents.on(event, wrapped);
        if (event === 'message') ipcActive = true;
        lifecycleWake();
        return childProcess;
      },
      kill(pid, signal = 'SIGTERM') {
        if (pid !== a.ownHandle.pid || signal !== 'SIGUSR2') {
          throw new NotImplementedError(
            'process.kill',
            'same-realm child supports only process.kill(process.pid, "SIGUSR2")',
          );
        }
        closeStreams();
        return a.ownHandle.kill(signal);
      },
      exit(exitCode = 0) {
        finish(exitCode);
        cleanupTimers();
        throw Object.assign(new Error('__process.exit'), { code: 'RIFTY_PROCESS_EXIT' });
      },
    };
    if (a.opts.__fork) {
      childProcess.connected = true;
      childProcess.channel = nodeIpcChannel('process');
      childProcess.send = (msg, ...unsupported) => {
        if (unsupported.length > 0) throw new NotImplementedError('process.send.arguments');
        const serialized = serializeNodeIpcMessage(msg);
        queueMicrotask(() => a.outboundMessages.emit('message', serialized));
        return true;
      };
      childProcess.disconnect = () => {
        if (!childProcess.connected) return;
        childProcess.connected = false;
        childProcess.channel = null;
        ipcActive = false;
        lifecycleWake();
      };
    }
    const fn = new Function(
      '__stdout_write',
      '__stderr_write',
      '__process',
      'process',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'require',
      `${code}\n//# sourceURL=${scriptPath}`,
    ) as (...args: unknown[]) => unknown;
    const result = withChildProcess(() =>
      fn(
        writeStdout,
        writeStderr,
        childProcess,
        childProcess,
        localSetTimeout,
        localClearTimeout,
        localSetInterval,
        localClearInterval,
        (specifier: unknown) => {
          if (typeof specifier !== 'string') {
            throw new TypeError('require specifier must be a string');
          }
          const builtin = loadBuiltin(specifier);
          if (builtin !== null) return builtin;
          throw new NotImplementedError(
            'child_process.same-realm.require',
            `same-realm child cannot require non-builtin ${specifier}`,
          );
        },
      ),
    );
    a.stdinPipe.flush();
    await Promise.resolve(result);
    while (
      !finished &&
      !aborted &&
      (timeouts.size > 0 || intervals.size > 0 || a.stdinPipe.isActive() || ipcActive)
    ) {
      await new Promise<void>((resolve) => {
        wakeLifecycle = resolve;
      });
      wakeLifecycle = () => {};
    }
    cleanupTimers();
    a.inboundIpc.off('childMessage', onChildMessage);
    a.inboundIpc.off('signal', onSignal);
    closeStreams();
  } catch (err) {
    const isProcessExit =
      err && typeof err === 'object' && (err as { code?: string }).code === 'RIFTY_PROCESS_EXIT';
    if (isProcessExit) return;
    writeStderr(err instanceof Error ? `${err.stack ?? err.message}\n` : String(err));
    closeStreams();
    finish(1);
  }
}
