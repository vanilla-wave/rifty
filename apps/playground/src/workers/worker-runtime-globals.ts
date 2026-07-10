// apps/playground/src/workers/worker-runtime-globals.ts
/**
 * Internal control-channel accessor for worker realms (ADR-0217).
 *
 * Under ADR-0157 the kernel pre-entry seam installs ONE spec-seeded rich
 * `process` before
 * any bootstrap runs — there is no longer a `globalThis.process` swap to undo.
 * This no longer installs anything: both directions use the kernel control lane,
 * never public runtime IPC or its Node JSON codec.
 *
 * Name kept (callers: real-vite-bootstrap, dev-server-child-bootstrap) — the
 * swap-then-re-patch dance it used to perform is gone.
 */

import { readWorkerControlChannel } from '@riftydev/kernel';
import { Buffer } from '@riftydev/runtime-js/builtins/buffer';

export interface KernelIpc {
  onMessage?(handler: (message: unknown) => void): void;
  /** Structured-clone control send; absent without a kernel channel. */
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
  const control = readWorkerControlChannel();
  const onMessage = control
    ? (handler: (message: unknown) => void) => {
        control.onMessage(handler);
      }
    : undefined;
  const send = control ? (message: unknown) => control.send(message) : undefined;
  return { onMessage, send };
}
