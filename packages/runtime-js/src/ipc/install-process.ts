/**
 * Node-shape `process` shim installer for kernel-spawned Workers (ADR-0039).
 *
 * Sets `globalThis.process` to a minimal Node-style proxy derived from the
 * kernel's {@link KernelProcessSpec}: pid/ppid/argv/env/cwd/stdout/stderr/exit,
 * plus the ADR-0045 fork-IPC surface (`send`, `on('message')`, `disconnect`,
 * and the `'message'`/`'disconnect'` events).
 *
 * Registers itself as the kernel's pre-entry hook at module load — host
 * bundles wire it in by importing this BEFORE `@riftydev/kernel/worker-entry`:
 *
 * ```ts
 * import '@riftydev/runtime-js/install-process';
 * import '@riftydev/kernel/worker-entry';
 * ```
 *
 * The kernel runs the hook after publishing the `KernelProcessSpec` and before
 * the user entry, so `kind: 'source'` scripts see a shaped `globalThis.process`.
 *
 * Before ADR-0039 the kernel installed this shim itself; the audit flagged that
 * as a Node-API leak, so runtime-js now owns it.
 */

import { EventEmitter } from '@riftydev/io';
import { type IpcFrame, type KernelProcessSpec, setKernelPreEntryHook } from '@riftydev/kernel';
import type { WorkerSpawnSpec } from '@riftydev/kernel';
import { NODE_PROCESS_IDENTITY } from '../builtins/process-identity.ts';

/**
 * The `process` shim the installer attaches to globalThis.
 *
 * Narrow on purpose — matches the structural contract `@riftydev/runtime-wasi`'s
 * worker entry expects (pid/ppid/argv/env/cwd/stdout/stderr/exit), plus ADR-0045
 * fork-IPC additions (`send`/`disconnect` and `on`/`off` for
 * `'message'`/`'disconnect'`). The runtime-js REPL worker uses a richer
 * `RiftyProcess` (`./builtins/process.ts`); this shim is the smaller surface for
 * kernel-spawned child Workers.
 */
export interface NodeProcessShim extends EventEmitter {
  pid: number;
  ppid: number;
  argv: readonly string[];
  argv0: string;
  execPath: string;
  platform: string;
  arch: string;
  version: string;
  versions: Readonly<Record<string, string>>;
  title: string;
  env: Readonly<Record<string, string>>;
  cwd(): string;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
  stdin: EventEmitter & {
    isTTY: boolean;
    fd: number;
    setEncoding(encoding: string | null): void;
    resume(): void;
    pause(): void;
  };
  exit(code?: number): never;
  /**
   * Send a structured-cloned message to the parent (ADR-0045). Returns `false`
   * after `disconnect()` or once the parent tore down the channel, else `true`.
   */
  send(message: unknown): boolean;
  /**
   * Close the IPC channel from the worker side (ADR-0045). Idempotent. Posts an
   * `ipc:disconnect` frame, closes the local port, emits `'disconnect'`.
   */
  disconnect(): void;
}

const STDIO_ENCODER = new TextEncoder();

function encodeChunk(chunk: string | Uint8Array): Uint8Array {
  return typeof chunk === 'string' ? STDIO_ENCODER.encode(chunk) : chunk;
}

function makeStdioWriter(port: MessagePort): { write(chunk: string | Uint8Array): boolean } {
  return {
    write(chunk) {
      const bytes = encodeChunk(chunk);
      // Transfer the buffer only when we own it (TextEncoder output). A passed-in
      // Uint8Array may share its backing buffer with the caller, so copy instead.
      if (typeof chunk === 'string') {
        port.postMessage(bytes, [bytes.buffer]);
      } else {
        const copy = new Uint8Array(bytes);
        port.postMessage(copy, [copy.buffer]);
      }
      return true;
    },
  };
}

function makeStdinReader(port: MessagePort): NodeProcessShim['stdin'] {
  const stdin = new EventEmitter() as NodeProcessShim['stdin'];
  let encoding: string | null = null;
  const pending: Array<string | Uint8Array> = [];
  let decoder = new TextDecoder();
  const normalize = (data: unknown): string | Uint8Array | null => {
    if (typeof data === 'string') return data;
    if (!(data instanceof Uint8Array)) return null;
    if (encoding && /^utf-?8$/iu.test(encoding)) {
      const text = decoder.decode(data, { stream: true });
      return text.length === 0 ? null : text;
    }
    return data;
  };
  const flush = (): void => {
    if (stdin.listenerCount('data') === 0) return;
    while (pending.length > 0) {
      const chunk = pending.shift();
      if (chunk !== undefined) stdin.emit('data', chunk);
    }
  };

  Object.assign(stdin, {
    isTTY: false,
    fd: 0,
    setEncoding(next: string | null) {
      encoding = next;
      decoder = new TextDecoder();
    },
    resume() {
      flush();
    },
    pause() {},
  });
  stdin.on('newListener', (event) => {
    if (event === 'data') queueMicrotask(flush);
  });
  stdin.on('end', () => {
    if (!encoding || !/^utf-?8$/iu.test(encoding)) return;
    const tail = decoder.decode();
    if (tail.length === 0) return;
    if (stdin.listenerCount('data') === 0) {
      pending.push(tail);
      return;
    }
    stdin.emit('data', tail);
  });
  port.onmessage = (ev: MessageEvent): void => {
    const chunk = normalize(ev.data);
    if (chunk == null) return;
    if (stdin.listenerCount('data') === 0) {
      pending.push(chunk);
      return;
    }
    stdin.emit('data', chunk);
  };
  port.start();
  return stdin;
}

/**
 * Concrete `NodeProcessShim` subclass of {@link EventEmitter}. Owns the
 * fork-IPC port lifecycle (ADR-0045).
 *
 * Kept as a class so `instanceof EventEmitter` checks (e.g. user code doing
 * `process instanceof require('events')`) keep working.
 */
class WorkerNodeProcessShim extends EventEmitter implements NodeProcessShim {
  readonly pid: number;
  readonly ppid: number;
  readonly argv: readonly string[];
  readonly argv0 = NODE_PROCESS_IDENTITY.argv0;
  readonly execPath = NODE_PROCESS_IDENTITY.execPath;
  readonly platform = NODE_PROCESS_IDENTITY.platform;
  readonly arch = NODE_PROCESS_IDENTITY.arch;
  readonly version = NODE_PROCESS_IDENTITY.version;
  // Shallow copy so per-process mutation (e.g. process.versions.x = …) works
  // without throwing and doesn't leak across processes (ADR-0150 P6a).
  readonly versions = { ...NODE_PROCESS_IDENTITY.versions };
  readonly title = NODE_PROCESS_IDENTITY.title;
  readonly env: Readonly<Record<string, string>>;
  readonly stdout: { write(chunk: string | Uint8Array): boolean };
  readonly stderr: { write(chunk: string | Uint8Array): boolean };
  readonly stdin: NodeProcessShim['stdin'];
  readonly #cwd: string;
  readonly #ipcPort: MessagePort;
  #ipcDisconnected = false;
  /**
   * Frames received before any `'message'` listener attaches (ADR-0045). The
   * worker entry may register its handler only after a slow async module load
   * (the shell-owner's heavy bootstrap, ADR-0146), yet the parent posts as soon
   * as the channel opens; without this buffer an `emit('message')` with no
   * listeners drops the frame silently. Flushed in order on the first listener —
   * mirrors {@link makeStdinReader}'s `pending` buffer.
   */
  readonly #ipcBacklog: unknown[] = [];

  constructor(spec: KernelProcessSpec) {
    super();
    this.pid = spec.pid;
    this.ppid = spec.ppid;
    this.argv = spec.argv;
    this.env = spec.env;
    this.#cwd = spec.cwd;
    this.stdout = makeStdioWriter(spec.stdio.stdout);
    this.stderr = makeStdioWriter(spec.stdio.stderr);
    this.stdin = makeStdinReader(spec.stdio.stdin);
    this.#ipcPort = spec.stdio.ipc;

    // Browsers auto-start a port only with `addEventListener('message')`; using
    // `onmessage = …` requires an explicit `start()` (called below).
    this.#ipcPort.onmessage = (ev: MessageEvent): void => {
      const frame = ev.data as IpcFrame | undefined;
      if (!frame || typeof frame !== 'object' || typeof frame.kind !== 'string') return;
      if (frame.kind === 'ipc:message') {
        if (this.listenerCount('message') === 0) {
          this.#ipcBacklog.push(frame.payload);
        } else {
          this.emit('message', frame.payload);
        }
      } else if (frame.kind === 'ipc:disconnect') {
        this.#tearDownIpc();
      }
    };
    this.#ipcPort.start();

    // Flush any frames buffered before the first listener (see #ipcBacklog).
    // `newListener` fires BEFORE the listener is added, so defer to a microtask
    // so the flush reaches it (mirrors makeStdinReader's queueMicrotask).
    this.on('newListener', (event) => {
      if (event !== 'message' || this.#ipcBacklog.length === 0) return;
      queueMicrotask(() => {
        for (const payload of this.#ipcBacklog.splice(0)) this.emit('message', payload);
      });
    });
  }

  cwd(): string {
    return this.#cwd;
  }

  exit(code = 0): never {
    throw Object.assign(new Error(`process.exit(${code})`), {
      code: 'RIFTY_PROCESS_EXIT',
      exitCode: code,
    });
  }

  send(message: unknown): boolean {
    if (this.#ipcDisconnected) return false;
    try {
      const frame: IpcFrame = { kind: 'ipc:message', payload: message };
      this.#ipcPort.postMessage(frame);
      return true;
    } catch {
      // Port may have been detached by the parent — treat as disconnect.
      this.#tearDownIpc();
      return false;
    }
  }

  disconnect(): void {
    if (this.#ipcDisconnected) return;
    try {
      const frame: IpcFrame = { kind: 'ipc:disconnect' };
      this.#ipcPort.postMessage(frame);
    } catch {
      /* peer may have closed already */
    }
    this.#tearDownIpc();
  }

  #tearDownIpc(): void {
    if (this.#ipcDisconnected) return;
    this.#ipcDisconnected = true;
    try {
      this.#ipcPort.close();
    } catch {
      /* peer may have closed */
    }
    this.emit('disconnect');
  }
}

/**
 * Build a Node-shape `process` proxy from `spec` and install it on `globalThis`
 * as a non-enumerable, configurable value. Idempotent — re-installing overwrites.
 *
 * `exit(N)` throws an Error tagged `code === 'RIFTY_PROCESS_EXIT'` with a numeric
 * `exitCode`; the kernel's worker bootstrap detects this shape and maps it to the
 * worker's exit code (see `@riftydev/kernel/src/worker-entry.ts`).
 */
export function installNodeProcessShim(spec: KernelProcessSpec): NodeProcessShim {
  const shim: NodeProcessShim = new WorkerNodeProcessShim(spec);
  // Non-enumerable so user code can still shadow `process` if it wants.
  Object.defineProperty(globalThis, 'process', {
    value: shim,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return shim;
}

/**
 * Adapter: the pre-entry hook receives the full {@link WorkerSpawnSpec}, but the
 * installer only needs the {@link KernelProcessSpec} subset.
 */
function preEntryInstaller(spec: WorkerSpawnSpec): void {
  installNodeProcessShim({
    pid: spec.pid,
    ppid: spec.ppid,
    argv: spec.argv,
    env: spec.env,
    cwd: spec.cwd,
    stdio: spec.stdio,
  });
}

// Module-load side effect: register the installer as the kernel's pre-entry
// hook, so importing this BEFORE `@riftydev/kernel/worker-entry` wires it up.
setKernelPreEntryHook(preEntryInstaller);
