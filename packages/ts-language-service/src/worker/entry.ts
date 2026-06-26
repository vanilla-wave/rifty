/// <reference lib="webworker" />

/**
 * THIN, side-effectful boot for the TS language-service `serve` worker
 * (ADR-0166, ADR-0150, ADR-0045). The kernel spawns this as a `kind:'url'`,
 * `serve:true` worker; the playground (next task) imports it via
 * `new URL('./entry.ts', import.meta.url)` and proves it by e2e (worker
 * globals / `spawnKernelWorker` are browser-only, so this module carries NO
 * unit-testable logic — all of that lives in `host-fs-rpc.ts` + `service-
 * endpoint.ts`, both Node-proven).
 *
 * What it wires (and ONLY this):
 *   1. The RPC `FsSync` from the published in-Worker sync-call shim
 *      (`readKernelSyncApi().call`) — reads the authoritative VFS in the store
 *      owner over the existing `fs.*` sync-RPC seam (NOT a parallel channel).
 *   2. The pure {@link createServiceEndpoint}.
 *   3. The page-facing fork-IPC channel (ADR-0045): `globalThis.process.on(
 *      'message', …)` for inbound {@link TsRequest} envelopes, `process.send(…)`
 *      for {@link TsResponse} envelopes. This is the same `send`/`on` primitive
 *      the playground's KernelIpc wraps — read off the spec-seeded `process` the
 *      kernel pre-entry hook installed (ADR-0157), so no kernel-internal swap.
 *
 * By the time this evaluates, the kernel worker-entry has published the
 * sync-call shim and the pre-entry hook installed `globalThis.process`. The
 * service is built lazily on the first `ts:init` frame (the endpoint owns that),
 * so a `projectRoot` the page only knows at runtime is honoured.
 *
 * Worker-side logging goes through `process.stdout` — a worker `console` is NOT
 * captured in this project. Top-level is guarded: importing this module for its
 * exported types spawns NOTHING; the boot runs only in a kernel-spawned Worker
 * realm with the sync API present (or when a host calls
 * {@link bootTsLanguageServiceWorker} explicitly).
 */

import { readKernelSyncApi } from '@riftydev/kernel';
import { createRpcFsSync } from './host-fs-rpc.ts';
import { TS_IPC_TYPE, type TsResponseMessage, isTsRequestMessage } from './protocol.ts';
import { createServiceEndpoint } from './service-endpoint.ts';

/** Minimal fork-IPC surface read off the kernel-installed `globalThis.process`. */
interface ForkIpcProcess {
  readonly stdout?: { write?: (chunk: string) => void };
  on?(event: 'message', handler: (message: unknown) => void): unknown;
  send?(message: unknown): unknown;
}

let booted = false;

function getForkIpcProcess(): ForkIpcProcess | undefined {
  return (globalThis as unknown as { process?: ForkIpcProcess }).process;
}

/** Worker-side log line — routed through `process.stdout` (console is not captured). */
function log(proc: ForkIpcProcess | undefined, line: string): void {
  proc?.stdout?.write?.(`[ts-lsp] ${line}\n`);
}

/**
 * Wire the endpoint to the fork-IPC channel and return a disposer-free boot
 * result. Exported so a host (or a future integration harness) can boot
 * explicitly; the bottom-of-module auto-boot calls it in a real Worker realm.
 *
 * Throws if no kernel sync API is published (a hard misconfiguration — this
 * worker can only serve over the owner's VFS, never a stub) or if the
 * fork-IPC `process` surface is absent.
 */
export function bootTsLanguageServiceWorker(): void {
  if (booted) return;
  const syncApi = readKernelSyncApi();
  if (syncApi === null) {
    throw new Error(
      'ts-lsp worker: no kernel sync call published — cannot reach the owner store over fs.* RPC',
    );
  }
  const proc = getForkIpcProcess();
  if (typeof proc?.on !== 'function' || typeof proc.send !== 'function') {
    throw new Error('ts-lsp worker: fork-IPC channel (process.send/on) unavailable');
  }
  booted = true;

  const endpoint = createServiceEndpoint({
    buildFsSync: createRpcFsSync,
    call: syncApi.call,
    // Route cold-`ts:init` phase timings to stdout (owner → page console). The
    // first build is slow under contention (a 2-core CI runner co-resident with
    // the dev-server child); these make a slow/wedged boot observable end-to-end.
    log: (message) => log(proc, message),
  });

  const send = (message: TsResponseMessage): void => {
    proc.send?.(message);
  };

  proc.on('message', (message: unknown) => {
    if (!isTsRequestMessage(message)) return;
    const { request } = message;
    // Each request is independently dispatched and answered; errors come back as
    // TsErrorResponse from the endpoint (never swallowed). A rejection here would
    // be a programmer error (dispatch is total) — surface it on stdout, loud.
    endpoint.dispatch(request).then(
      (response) => send({ type: TS_IPC_TYPE, response }),
      (err: unknown) =>
        log(proc, `dispatch crashed: ${err instanceof Error ? err.stack : String(err)}`),
    );
  });

  log(proc, 'ready');
}

/**
 * Auto-boot ONLY in a real kernel-spawned Worker realm (DedicatedWorkerGlobal-
 * Scope: has `postMessage`, lacks `window`) AND once the sync API is published.
 * Guarding both keeps a type-only import inert (worker-entry side-effect trap):
 * importing this file in Node/the page realm spawns nothing.
 */
const g = globalThis as unknown as { postMessage?: unknown; window?: unknown };
const isWorkerRealm = typeof g.postMessage === 'function' && typeof g.window === 'undefined';
if (isWorkerRealm && readKernelSyncApi() !== null) {
  bootTsLanguageServiceWorker();
}
