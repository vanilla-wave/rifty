/**
 * Typed bridge for the cross-realm globals the kernel installs inside a
 * spawned Worker.
 *
 * Three pieces of state need to leak across module boundaries (kernel worker
 * bootstrap → runtime-js / runtime-wasi builtins inside the same realm):
 *
 *   1. The {@link KernelSabRing} (review §1 P1) — the SAB ring used by
 *      runtime-js sync syscalls to talk to the parent dispatcher.
 *   2. The {@link KernelSyncApi} — a thin `call(method, payload)` shim
 *      backed by a {@link SyncRpcClient}. Higher layers (e.g.
 *      `child_process.execSync`) reach for this to delegate sync syscalls
 *      to the parent without re-implementing the SAB framing.
 *   3. The {@link KernelProcessSpec} (ADR-0039) — a typed snapshot of the
 *      kernel-owned identity (pid/ppid/argv/env/cwd/stdio) the higher
 *      runtime layer needs to build its own `process` object. The kernel
 *      itself never installs a Node-shaped `globalThis.process`; that
 *      Node-API knowledge lives in `@rifty/runtime-js`.
 *
 * All values still live on `globalThis` under string keys (cross-bundle
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
 * Stdio port shape the kernel hands to the higher layer. Identical to the
 * {@link WorkerStdioPorts} type in `./worker-entry.ts`; redeclared here to
 * keep `shared-globals.ts` import-free of the worker bootstrap module.
 */
export interface KernelProcessStdioPorts {
  readonly stdout: MessagePort;
  readonly stderr: MessagePort;
  readonly stdin: MessagePort;
}

/**
 * Typed snapshot of the kernel-owned identity for a spawned process
 * (ADR-0039). The kernel publishes one of these on each Worker boot; the
 * higher runtime layer reads it and constructs its own `process` object
 * (Node-shaped in `@rifty/runtime-js`, WASI-shaped in `@rifty/runtime-wasi`).
 *
 * Field semantics mirror {@link WorkerSpawnSpec}: `argv` / `env` / `cwd` are
 * the kernel's snapshot at spawn time (ADR-0019 — `cwd` is owned by the
 * `ProcessRecord`); `stdio` ports are the child-side `MessagePort`s the
 * higher layer pipes its `process.stdout` / `process.stderr` into.
 */
export interface KernelProcessSpec {
  readonly pid: number;
  readonly ppid: number;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly stdio: KernelProcessStdioPorts;
}

/**
 * Internal hook keys. Implementation detail — exported only so the
 * conformance tests can assert the publish path. Production code goes
 * through {@link publishKernelSyncApi} / {@link readKernelSyncApi} etc.
 */
export const KERNEL_SAB_RING_KEY = '__riftyKernelSyncRing__' as const;
export const KERNEL_SYNC_CALL_KEY = '__riftyKernelSyncCall' as const;
export const KERNEL_PROCESS_SPEC_KEY = '__riftyProcessSpec__' as const;

interface GlobalWithKernelHooks {
  [KERNEL_SAB_RING_KEY]?: KernelSabRing;
  [KERNEL_SYNC_CALL_KEY]?: KernelSyncCall;
  [KERNEL_PROCESS_SPEC_KEY]?: KernelProcessSpec;
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

/**
 * Install the per-process {@link KernelProcessSpec} on this realm's
 * globalThis as a non-enumerable value (ADR-0039). The kernel worker
 * bootstrap calls this exactly once per spawn, right after attaching
 * the SAB ring and immediately before invoking the optional pre-entry
 * hook (the runtime-js installer that builds the Node `process` object).
 *
 * Idempotent — re-publishing on the same realm overwrites the previous
 * value (configurable: true).
 */
export function publishKernelProcessSpec(spec: KernelProcessSpec): void {
  Object.defineProperty(globalThis, KERNEL_PROCESS_SPEC_KEY, {
    value: spec,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

/**
 * Read the {@link KernelProcessSpec} previously published in this realm
 * (ADR-0039). Returns `null` when the kernel bootstrap hasn't run yet —
 * e.g. on the main realm, in a worker that was created outside
 * `kernel.spawnWorker`, or before the `'init'` message has arrived.
 *
 * Consumers: `@rifty/runtime-js`'s `installNodeProcessShim` (Node-shape
 * `process` global) and `@rifty/runtime-wasi`'s worker entry (minimal
 * WASI-shaped `process` proxy).
 */
export function readKernelProcessSpec(): KernelProcessSpec | null {
  return asGlobal()[KERNEL_PROCESS_SPEC_KEY] ?? null;
}
