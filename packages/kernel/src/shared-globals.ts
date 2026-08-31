/**
 * Typed bridge for the cross-realm globals the kernel installs inside a
 * spawned Worker. Two pieces of state leak across module boundaries
 * (kernel worker bootstrap → runtime-js / runtime-wasi builtins, same realm):
 *
 *   1. {@link KernelSyncApi} — JSON and binary call shims backed by one
 *      `SyncRpcClient`. Higher layers delegate sync syscalls without owning
 *      SAB framing.
 *   2. {@link KernelProcessSpec} (ADR-0039) — typed snapshot of the
 *      kernel-owned identity the higher runtime layer needs to build its own
 *      `process`. The kernel never installs a Node-shaped `globalThis.process`;
 *      that Node-API knowledge lives in `@riftydev/runtime-js`.
 *
 *   3. {@link KernelEntryBootstrapEnvelope} — optional runtime-agnostic data
 *      attached to one URL entry. The worker bootstrap publishes it before
 *      the pre-entry hook; higher runtimes select their own protocol and
 *      decode the opaque payload.
 * Values live on `globalThis` under string keys (cross-bundle sharing — no
 * module identity to rely on across the Worker boundary). The helpers below
 * are the only sanctioned interface; reaching into `globalThis[...]` directly
 * is untyped and leaks `any`.
 */

/** Type of the in-Worker sync call shim. Narrow so callers stay `any`-free. */
export type KernelSyncCall = (method: string, payload: unknown) => unknown;

/** Binary application payload call on the same SyncRpc ring. */
export type KernelSyncBinaryCall = (method: string, payload: Uint8Array) => unknown;

/**
 * Public surface of the sync-RPC API installed inside the spawned Worker.
 * Both operations are required and publish transactionally (ADR-0366).
 */
export interface KernelSyncApi {
  /** Send a sync request to the parent dispatcher and return its reply. */
  call: KernelSyncCall;
  /** Send a binary sync request to the parent dispatcher and return its reply. */
  callBinary: KernelSyncBinaryCall;
}

/**
 * Stdio + IPC port shape the kernel hands to the higher layer. Identical to
 * {@link WorkerStdioPorts} in `./worker-entry.ts`; redeclared here to keep
 * `shared-globals.ts` import-free of the worker bootstrap module. `ipc`
 * (ADR-0045) carries the fork-mode IPC channel — runtime-js's
 * `installNodeProcessShim` wraps it to expose Node-style `process.send` /
 * `process.on('message', …)` / `process.disconnect()`.
 */
export interface KernelStdioOutputWriter {
  write(bytes: Uint8Array): void;
}

export interface KernelProcessStdioPorts {
  readonly stdout: KernelStdioOutputWriter;
  readonly stderr: KernelStdioOutputWriter;
  readonly stdin: MessagePort;
  readonly ipc: MessagePort;
}

/**
 * Typed snapshot of the kernel-owned identity for a spawned process
 * (ADR-0039). Published on each Worker boot; the higher runtime layer reads it
 * and constructs its own `process` (Node-shaped in `@riftydev/runtime-js`,
 * WASI-shaped in `@riftydev/runtime-wasi`).
 *
 * Field semantics mirror {@link WorkerSpawnSpec}: `argv` / `env` / `cwd` are
 * the spawn-time snapshot (ADR-0019 — `cwd` owned by the `ProcessRecord`);
 * `stdio` ports are the child-side `MessagePort`s the higher layer pipes its
 * `process.stdout` / `process.stderr` into.
 */
export interface KernelProcessSpec {
  readonly pid: number;
  readonly ppid: number;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly stdio: KernelProcessStdioPorts;
}

/** Runtime-agnostic metadata attached to one URL worker entry. */
export interface KernelEntryBootstrapEnvelope {
  /** Higher-layer protocol discriminator; kernel does not interpret it. */
  readonly protocol: string;
  /** Structured-cloneable higher-layer data; kernel keeps it opaque. */
  readonly payload: unknown;
}

/** Existing hook keys exported for cross-package compatibility/tests. */
export const KERNEL_SYNC_CALL_KEY = '__riftyKernelSyncCall' as const;
export const KERNEL_SYNC_BINARY_CALL_KEY = '__riftyKernelSyncBinaryCall' as const;
export const KERNEL_PROCESS_SPEC_KEY = '__riftyProcessSpec__' as const;
export const KERNEL_ENTRY_BOOTSTRAP_KEY = '__riftyKernelEntryBootstrap__' as const;
interface GlobalWithKernelHooks {
  [KERNEL_SYNC_CALL_KEY]?: KernelSyncCall;
  [KERNEL_SYNC_BINARY_CALL_KEY]?: KernelSyncBinaryCall;
  [KERNEL_PROCESS_SPEC_KEY]?: KernelProcessSpec;
  [KERNEL_ENTRY_BOOTSTRAP_KEY]?: KernelEntryBootstrapEnvelope | null;
}

function asGlobal(): GlobalWithKernelHooks {
  return globalThis as unknown as GlobalWithKernelHooks;
}

/**
 * Install both sync-call shims as one publication transaction. Idempotent —
 * re-publishing overwrites configurable non-enumerable values.
 */
export function publishKernelSyncApi(api: KernelSyncApi): void {
  if (typeof api.call !== 'function' || typeof api.callBinary !== 'function') {
    throw new TypeError('publishKernelSyncApi: JSON and binary calls are required');
  }
  const callBefore = Object.getOwnPropertyDescriptor(globalThis, KERNEL_SYNC_CALL_KEY);
  const binaryBefore = Object.getOwnPropertyDescriptor(globalThis, KERNEL_SYNC_BINARY_CALL_KEY);
  let callPublished = false;
  try {
    defineSyncCall(KERNEL_SYNC_CALL_KEY, api.call);
    callPublished = true;
    defineSyncCall(KERNEL_SYNC_BINARY_CALL_KEY, api.callBinary);
  } catch (err) {
    if (callPublished) restoreProperty(KERNEL_SYNC_CALL_KEY, callBefore);
    restoreProperty(KERNEL_SYNC_BINARY_CALL_KEY, binaryBefore);
    throw err;
  }
}

/**
 * Read the sync-call API published in this realm; `null` when the kernel
 * bootstrap hasn't run. The returned `call` is the canonical entry point —
 * higher layers MUST use it, not `globalThis[KERNEL_SYNC_CALL_KEY]`.
 */
export function readKernelSyncApi(): KernelSyncApi | null {
  const call = asGlobal()[KERNEL_SYNC_CALL_KEY];
  const callBinary = asGlobal()[KERNEL_SYNC_BINARY_CALL_KEY];
  if (call === undefined && callBinary === undefined) return null;
  if (call === undefined) {
    throw new TypeError('readKernelSyncApi: partial publication (JSON call missing)');
  }
  if (callBinary === undefined) {
    throw new TypeError('readKernelSyncApi: partial publication (binary call missing)');
  }
  if (typeof call !== 'function' || typeof callBinary !== 'function') {
    throw new TypeError('readKernelSyncApi: published JSON and binary calls must be functions');
  }
  return { call, callBinary };
}

function defineSyncCall(
  key: typeof KERNEL_SYNC_CALL_KEY | typeof KERNEL_SYNC_BINARY_CALL_KEY,
  value: KernelSyncCall | KernelSyncBinaryCall,
): void {
  Object.defineProperty(globalThis, key, {
    value,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

function restoreProperty(key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor === undefined) {
    Reflect.deleteProperty(globalThis, key);
    return;
  }
  Object.defineProperty(globalThis, key, descriptor);
}

/**
 * Install the per-process {@link KernelProcessSpec} on this realm's globalThis
 * as a non-enumerable value (ADR-0039). The worker bootstrap calls this once
 * per spawn, after attaching the SAB ring and before the optional pre-entry
 * hook (the runtime-js installer that builds the Node `process`). Idempotent —
 * re-publishing overwrites (configurable: true).
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
 * Read the {@link KernelProcessSpec} published in this realm (ADR-0039);
 * `null` when the bootstrap hasn't run — e.g. on the main realm, a worker
 * created outside `kernel.spawnWorker`, or before the `'init'` message.
 *
 * Consumers: runtime-js's `installNodeProcessShim` (Node-shape `process`) and
 * runtime-wasi's worker entry (minimal WASI-shaped `process` proxy).
 */
export function readKernelProcessSpec(): KernelProcessSpec | null {
  return asGlobal()[KERNEL_PROCESS_SPEC_KEY] ?? null;
}

/**
 * Publish the bootstrap envelope for this realm's URL entry. `null` records
 * that the entry carries no envelope and clears any prior test-host value.
 * The property is non-enumerable so it does not leak into ordinary global
 * discovery; the higher runtime reads it through {@link readKernelEntryBootstrap}.
 */
export function publishKernelEntryBootstrap(bootstrap: KernelEntryBootstrapEnvelope | null): void {
  Object.defineProperty(globalThis, KERNEL_ENTRY_BOOTSTRAP_KEY, {
    value: bootstrap,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

/** Read this entry's bootstrap envelope; `null` when absent or unpublished. */
export function readKernelEntryBootstrap(): KernelEntryBootstrapEnvelope | null {
  return asGlobal()[KERNEL_ENTRY_BOOTSTRAP_KEY] ?? null;
}
