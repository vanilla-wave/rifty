/**
 * Node-shape `process` shim installer for kernel-spawned Workers (ADR-0039).
 *
 * Used inside a kernel-spawned Worker realm to set `globalThis.process` to
 * a minimal Node-style proxy derived from the kernel's
 * {@link KernelProcessSpec}. The proxy answers `process.pid`,
 * `process.ppid`, `process.argv`, `process.env`, `process.cwd()`,
 * `process.stdout.write`, `process.stderr.write`, and `process.exit(N)`.
 *
 * The installer registers itself as the kernel's pre-entry hook at module
 * load — host bundles can wire it in by importing this module from their
 * kernel-worker chunk BEFORE `@rifty/kernel/worker-entry`:
 *
 * ```ts
 * import '@rifty/runtime-js/install-process';
 * import '@rifty/kernel/worker-entry';
 * ```
 *
 * The kernel's bootstrap calls the hook immediately after publishing the
 * `KernelProcessSpec` and immediately before running the user entry, so
 * `kind: 'source'` user scripts see a fully-shaped `globalThis.process`.
 *
 * Before ADR-0039 the kernel itself installed this shim — the audit
 * flagged it as a Node-API leak; the runtime-js side now owns it.
 */

import { type KernelProcessSpec, setKernelPreEntryHook } from '@rifty/kernel';
import type { WorkerSpawnSpec } from '@rifty/kernel';

/**
 * Internal: the `process` shim the installer attaches to globalThis.
 *
 * Narrow on purpose — matches the structural contract that
 * `@rifty/runtime-wasi`'s worker entry expects when reading `globalThis.process`
 * (pid/ppid/argv/env/cwd/stdout/stderr/exit). The runtime-js REPL worker
 * uses a richer `RiftyProcess` class from `./builtins/process.ts`; this
 * shim is intentionally the smaller surface used inside kernel-spawned
 * child Workers.
 */
export interface NodeProcessShim {
  pid: number;
  ppid: number;
  argv: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd(): string;
  stdout: { write(chunk: string | Uint8Array): boolean };
  stderr: { write(chunk: string | Uint8Array): boolean };
  exit(code?: number): never;
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
 * Build a Node-shape `process` proxy from `spec` and install it on
 * `globalThis` as a non-enumerable, configurable value. Idempotent —
 * re-installing overwrites the previous value.
 *
 * The `exit(N)` method throws an Error tagged with
 * `code === 'RIFTY_PROCESS_EXIT'` and a numeric `exitCode`. The kernel's
 * worker bootstrap detects this exact shape and maps it to the worker's
 * exit code (see `@rifty/kernel/src/worker-entry.ts`).
 */
export function installNodeProcessShim(spec: KernelProcessSpec): NodeProcessShim {
  const shim: NodeProcessShim = {
    pid: spec.pid,
    ppid: spec.ppid,
    argv: spec.argv,
    env: spec.env,
    cwd: () => spec.cwd,
    stdout: makeStdioWriter(spec.stdio.stdout),
    stderr: makeStdioWriter(spec.stdio.stderr),
    exit: (code = 0): never => {
      throw Object.assign(new Error(`process.exit(${code})`), {
        code: 'RIFTY_PROCESS_EXIT',
        exitCode: code,
      });
    },
  };
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
// `@rifty/kernel/worker-entry` get the wiring "for free" — the kernel's
// init handler calls the hook before running the user entry.
setKernelPreEntryHook(preEntryInstaller);
