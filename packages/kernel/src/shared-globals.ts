/**
 * Typed bridge for the cross-realm globals the kernel installs inside a
 * spawned Worker.
 *
 * Two pieces of state need to leak across module boundaries (kernel worker
 * bootstrap → runtime-js builtins inside the same realm):
 *
 *   1. The {@link KernelSabRing} (review §1 P1) — the SAB ring used by
 *      runtime-js sync syscalls to talk to the parent dispatcher.
 *   2. The {@link KernelSyncApi} — a thin `call(method, payload)` shim
 *      backed by a {@link SyncRpcClient}. Higher layers (e.g.
 *      `child_process.execSync`) reach for this to delegate sync syscalls
 *      to the parent without re-implementing the SAB framing.
 *
 * Both values still live on `globalThis` under string keys (cross-bundle
 * sharing, no module identity to rely on across the Worker boundary), but
 * the `publish*` / `read*` helpers here are the only sanctioned API.
 * Callers never reach into `globalThis[...]` directly — that read was
 * untyped and let `any` leak through.
 */

/** Type of the in-Worker sync call shim. Narrow so callers stay `any`-free. */
export type KernelSyncCall = (method: string, payload: unknown) => unknown;

/**
 * Public surface of the sync-RPC API installed inside the spawned Worker.
 * Today the only verb is `call`; future expansions (e.g. a typed dispose
 * hook) can grow this interface without changing the read/publish ABI.
 */
export interface KernelSyncApi {
  /** Send a sync request to the parent dispatcher and return its reply. */
  call: KernelSyncCall;
}

/**
 * Public surface of the kernel-side SAB ring as exposed inside the Worker.
 * `unknown` here intentionally — `@rifty/kernel/ipc/sab-ring` owns the
 * concrete class but we want this module dependency-free so it can be
 * imported from runtime-js without circular references.
 *
 * Callers that need the structural ring methods cast through the concrete
 * `SabRing` import from `@rifty/kernel`.
 */
export interface KernelSabRing {
  readonly payloadCapacity: number;
  readonly expectedVersion: number;
}

/**
 * Internal hook keys. Implementation detail — exported only so the
 * conformance tests can assert the publish path. Production code goes
 * through {@link publishKernelSyncApi} / {@link readKernelSyncApi} etc.
 */
export const KERNEL_SAB_RING_KEY = '__riftyKernelSyncRing__' as const;
export const KERNEL_SYNC_CALL_KEY = '__riftyKernelSyncCall' as const;

interface GlobalWithKernelHooks {
  [KERNEL_SAB_RING_KEY]?: KernelSabRing;
  [KERNEL_SYNC_CALL_KEY]?: KernelSyncCall;
}

function asGlobal(): GlobalWithKernelHooks {
  return globalThis as unknown as GlobalWithKernelHooks;
}

/**
 * Install the SAB ring on this realm's globalThis as a non-enumerable
 * value. Idempotent — re-publishing on the same realm overwrites the
 * previous value (configurable: true).
 */
export function publishKernelSabRing(ring: KernelSabRing): void {
  Object.defineProperty(globalThis, KERNEL_SAB_RING_KEY, {
    value: ring,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Read the SAB ring previously published in this realm. Returns `null`
 * when the kernel bootstrap hasn't run (e.g. the main realm or a Worker
 * created outside `kernel.spawnWorker`).
 */
export function readKernelSabRing(): KernelSabRing | null {
  return asGlobal()[KERNEL_SAB_RING_KEY] ?? null;
}

/**
 * Install the sync-call shim on this realm's globalThis as a
 * non-enumerable value. Idempotent — see {@link publishKernelSabRing}.
 *
 * The published shape today stores the `call` function under the key for
 * historical compatibility (older runtime-js builds expected the raw
 * function). The {@link readKernelSyncApi} accessor wraps the function
 * back into the {@link KernelSyncApi} shape so future expansions stay
 * additive.
 */
export function publishKernelSyncApi(api: KernelSyncApi): void {
  Object.defineProperty(globalThis, KERNEL_SYNC_CALL_KEY, {
    value: api.call,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Read the sync-call API previously published in this realm. Returns
 * `null` when the kernel bootstrap hasn't run. The returned object's
 * `call` field is the canonical entry point — higher layers MUST go
 * through it instead of reaching for `globalThis[KERNEL_SYNC_CALL_KEY]`.
 */
export function readKernelSyncApi(): KernelSyncApi | null {
  const fn = asGlobal()[KERNEL_SYNC_CALL_KEY];
  if (fn === undefined) return null;
  return { call: fn };
}
