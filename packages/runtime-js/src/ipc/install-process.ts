/**
 * Node-shape `process` shim installer for kernel-spawned Workers (ADR-0039).
 *
 * Used inside a kernel-spawned Worker realm to set `globalThis.process` to
 * a minimal Node-style proxy derived from the kernel's
 * {@link KernelProcessSpec}. The proxy answers `process.pid`,
 * `process.ppid`, `process.argv`, `process.env`, `process.cwd()`,
 * `process.stdout.write`, `process.stderr.write`, `process.exit(N)` and
 * — since ADR-0045 — `process.send(msg)`, `process.on('message', …)`,
 * `process.disconnect()`, plus the `'message'` / `'disconnect'` events
 * that fork-style consumers expect.
 *
 * The installer registers itself as the kernel's pre-entry hook at module
 * load — host bundles can wire it in by importing this module from their
 * kernel-worker chunk BEFORE `@riftydev/kernel/worker-entry`:
 *
 * ```ts
 * import '@riftydev/runtime-js/install-process';
 * import '@riftydev/kernel/worker-entry';
 * ```
 *
 * The kernel's bootstrap calls the hook immediately after publishing the
 * `KernelProcessSpec` and immediately before running the user entry, so
 * `kind: 'source'` user scripts see a fully-shaped `globalThis.process`.
 *
 * Before ADR-0039 the kernel itself installed this shim — the audit
 * flagged it as a Node-API leak; the runtime-js side now owns it.
 */

import { EventEmitter } from '@riftydev/io';
import { type IpcFrame, type KernelProcessSpec, setKernelPreEntryHook } from '@riftydev/kernel';
import type { WorkerSpawnSpec } from '@riftydev/kernel';

/**
 * Internal: the `process` shim the installer attaches to globalThis.
 *
 * Narrow on purpose — matches the structural contract that
 * `@riftydev/runtime-wasi`'s worker entry expects when reading
 * `globalThis.process` (pid/ppid/argv/env/cwd/stdout/stderr/exit), with
 * ADR-0045 fork-IPC additions layered on top: `send` / `disconnect` and
 * EventEmitter-style `on` / `off` for `'message'` and `'disconnect'`.
 * The runtime-js REPL worker uses a richer `RiftyProcess` class from
 * `./builtins/process.ts`; this shim is intentionally the smaller surface
 * used inside kernel-spawned child Workers.
 */
export interface NodeProcessShim extends EventEmitter {
  pid: number;
  ppid: number;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd(): string;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
  exit(code?: number): never;
  /**
   * Send a structured-cloned message to the parent (ADR-0045). Returns
   * `false` after `disconnect()` or once the channel has been torn down
   * by the parent; `true` when the message is posted.
   */
  send(message: unknown): boolean;
  /**
   * Close the IPC channel from the worker side (ADR-0045). Idempotent.
   * Posts an `ipc:disconnect` frame to the parent, closes the local
   * port, and emits `'disconnect'` on the shim.
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
      // Transfer the buffer when we own it (i.e. created by TextEncoder).
      // Pre-existing Uint8Arrays may share their backing buffer with the
      // caller, so transferring is unsafe — copy in that case.
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

/**
 * Concrete `NodeProcessShim` subclass of {@link EventEmitter}. Owns the
 * fork-IPC port lifecycle (ADR-0045) — wires `'message'` / `'disconnect'`
 * events off the kernel-supplied `MessagePort` and surfaces them on the
 * shim itself.
 *
 * The class is internal — callers see the {@link NodeProcessShim}
 * interface returned by {@link installNodeProcessShim}. Kept as a class
 * so `instanceof EventEmitter` checks (e.g. in user code that does
 * `process instanceof require('events')`) keep working.
 */
class WorkerNodeProcessShim extends EventEmitter implements NodeProcessShim {
  readonly pid: number;
  readonly ppid: number;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly stdout: { write(chunk: string | Uint8Array): boolean };
  readonly stderr: { write(chunk: string | Uint8Array): boolean };
  readonly #cwd: string;
  readonly #ipcPort: MessagePort;
  #ipcDisconnected = false;

  constructor(spec: KernelProcessSpec) {
    super();
    this.pid = spec.pid;
    this.ppid = spec.ppid;
    this.argv = spec.argv;
    this.env = spec.env;
    this.#cwd = spec.cwd;
    this.stdout = makeStdioWriter(spec.stdio.stdout);
    this.stderr = makeStdioWriter(spec.stdio.stderr);
    this.#ipcPort = spec.stdio.ipc;

    // Wire the IPC port: dispatch `'message'` for `ipc:message` frames and
    // tear down on `ipc:disconnect`. The browser auto-starts a port only
    // when `addEventListener('message', …)` is used; with `onmessage = …`
    // we have to call `start()` explicitly.
    this.#ipcPort.onmessage = (ev: MessageEvent): void => {
      const frame = ev.data as IpcFrame | undefined;
      if (!frame || typeof frame !== 'object' || typeof frame.kind !== 'string') return;
      if (frame.kind === 'ipc:message') {
        this.emit('message', frame.payload);
      } else if (frame.kind === 'ipc:disconnect') {
        this.#tearDownIpc();
      }
    };
    this.#ipcPort.start();
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
 * Build a Node-shape `process` proxy from `spec` and install it on
 * `globalThis` as a non-enumerable, configurable value. Idempotent —
 * re-installing overwrites the previous value.
 *
 * The `exit(N)` method throws an Error tagged with
 * `code === 'RIFTY_PROCESS_EXIT'` and a numeric `exitCode`. The kernel's
 * worker bootstrap detects this exact shape and maps it to the worker's
 * exit code (see `@riftydev/kernel/src/worker-entry.ts`).
 */
export function installNodeProcessShim(spec: KernelProcessSpec): NodeProcessShim {
  const shim: NodeProcessShim = new WorkerNodeProcessShim(spec);
  // Non-enumerable so user code can still create its own `process` shadow
  // if it wants — but `globalThis.process` is what most Node-compatible
  // code reaches for.
  Object.defineProperty(globalThis, 'process', {
    value: shim,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  return shim;
}

/**
 * Adapter: the kernel's pre-entry hook signature takes the full
 * {@link WorkerSpawnSpec}, but the installer only needs the
 * runtime-agnostic subset that lives on {@link KernelProcessSpec}.
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

// Module-load side effect: register the installer as the kernel's
// pre-entry hook. Host chunks that import this module BEFORE
// `@riftydev/kernel/worker-entry` get the wiring "for free" — the kernel's
// init handler calls the hook before running the user entry.
setKernelPreEntryHook(preEntryInstaller);
