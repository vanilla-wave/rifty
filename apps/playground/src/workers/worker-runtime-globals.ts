// apps/playground/src/workers/worker-runtime-globals.ts
/**
 * Fork-IPC handle accessor for worker realms (ADR-0157).
 *
 * Under ADR-0157 the kernel pre-entry seam installs ONE spec-seeded rich
 * `process` (correct stdout/stderr/env + ADR-0211 fork-IPC `send`/`on`) before
 * any bootstrap runs — there is no longer a `globalThis.process` swap to undo.
 * So this no longer installs anything: inbound `onMessage` uses the seeded
 * `globalThis.process`, while outbound internal control bypasses public
 * process.send JSON and posts raw frames through the published kernel spec.
 *
 * Name kept (callers: real-vite-bootstrap, dev-server-child-bootstrap) — the
 * swap-then-re-patch dance it used to perform is gone.
 */

import { type IpcFrame, readKernelProcessSpec } from '@riftydev/kernel';
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';

export interface ProcStdio {
  stdout?: { write?: unknown };
  stderr?: { write?: unknown };
  env?: Record<string, string | undefined>;
  on?(event: 'message', handler: (message: unknown) => void): unknown;
  send?(message: unknown): unknown;
}

export interface KernelIpc {
  onMessage?(handler: (message: unknown) => void): void;
  /** Raw fork-IPC send back to the page (ADR-0211); absent without a kernel channel. */
  send?(message: unknown): void;
}

/**
 * Pin THIS bundle's `Buffer` onto `globalThis.Buffer` so a package that reads the
 * GLOBAL `Buffer` (e.g. `etag`'s `Buffer.isBuffer`) sees the SAME class the module
 * loader's `require('buffer')` builds chunks with.
 *
 * WHY per-bundle. A `kind:'url'` child entry (dev-server-child-bootstrap,
 * node-entry-bootstrap, real-vite-bootstrap) is `import()`ed INTO the kernel worker
 * realm AFTER the kernel pre-entry hook (kernel-worker-entry.ts → `installNodeRuntime`)
 * already set `globalThis.Buffer` from the kernel-worker-entry BUNDLE's `@riftydev/io`
 * copy. In a production build every `?worker&url` entry is self-contained, so this
 * child bundle carries its OWN `@riftydev/io` copy — a DIFFERENT `Buffer` class. So:
 *
 *   express (this bundle) builds the response chunk with `require('buffer')` = copy B,
 *   etag reads `globalThis.Buffer` = pre-entry copy A → `A.isBuffer(B)` is false →
 *   `TypeError: argument entity must be string, Buffer, or fs.Stats` (res.json/send).
 *
 * Overriding the global with this bundle's `Buffer` realigns the two. Mirrors what
 * `runtime-js/worker-entry.ts` and `install-process.ts`'s `installNodeRuntime` already
 * do for their realms. DEV is unaffected: the dynamic import shares the realm's single
 * served ESM module instance, so there is only ever one `Buffer` class there.
 *
 * (Same root as the "chunk-graph leak" the owner works around for `process.env`.)
 *
 * TODO(backlog: toolchain-build/worker-bundle-shared-runtime-dedup) — per-realm
 * reinstall is whack-a-mole; the root fix is one shared `@riftydev/io` chunk.
 */
export function installBundleLocalBuffer(): void {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}

export function installRuntimeGlobals(): KernelIpc {
  const proc = globalThis.process as unknown as ProcStdio | undefined;
  const rawIpc = readKernelProcessSpec()?.stdio.ipc;
  const onMessage =
    typeof proc?.on === 'function'
      ? (handler: (message: unknown) => void) => {
          proc.on?.('message', handler);
        }
      : undefined;
  // Internal lifecycle frames may carry Uint8Array. Bypass public
  // process.send's Node-default JSON codec while retaining the same raw kernel
  // MessagePort transport (ADR-0211).
  const send =
    rawIpc !== undefined
      ? (message: unknown) => {
          rawIpc.postMessage({ kind: 'ipc:message', payload: message } satisfies IpcFrame);
        }
      : undefined;
  return { onMessage, send };
}
