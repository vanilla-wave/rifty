/**
 * Typed bridge for the cross-realm globals the kernel installs inside a
 * spawned Worker. Two pieces of state leak across module boundaries
 * (kernel worker bootstrap → runtime-js / runtime-wasi builtins, same realm):
 *
 *   1. {@link KernelSyncApi} — a thin `call(method, payload)` shim backed by
 *      a {@link SyncRpcClient}. Higher layers (e.g. `child_process.execSync`)
 *      use it to delegate sync syscalls to the parent without re-implementing
 *      the SAB framing.
 *   2. {@link KernelProcessSpec} (ADR-0039) — typed snapshot of the
 *      kernel-owned identity the higher runtime layer needs to build its own
 *      `process`. The kernel never installs a Node-shaped `globalThis.process`;
 *      that Node-API knowledge lives in `@riftydev/runtime-js`.
 *
 * Values live on `globalThis` under string keys (cross-bundle sharing — no
 * module identity to rely on across the Worker boundary). The `publish*` /
 * `read*` helpers are the only sanctioned API; reaching into `globalThis[...]`
 * directly is untyped and leaks `any`.
 */

/** Type of the in-Worker sync call shim. Narrow so callers stay `any`-free. */
export type KernelSyncCall = (method: string, payload: unknown) => unknown;

/**
 * Public surface of the sync-RPC API installed inside the spawned Worker.
 * Only verb today is `call`; future expansions can grow this without changing
 * the read/publish ABI.
 */
export interface KernelSyncApi {
  /** Send a sync request to the parent dispatcher and return its reply. */
  call: KernelSyncCall;
}

/**
 * Worker port shape the kernel hands to the higher layer. Identical to
 * {@link WorkerStdioPorts} in `./worker-entry.ts`; redeclared here to keep
 * `shared-globals.ts` import-free of the worker bootstrap module. `ipc` is one
 * physical channel with separate structured-clone control and capability-gated
 * runtime-IPC lanes (ADR-0217).
 */
export interface KernelProcessStdioPorts {
  readonly stdout: MessagePort;
  readonly stderr: MessagePort;
  readonly stdin: MessagePort;
  readonly ipc: MessagePort;
}

export interface WorkerProcessCapabilities {
  /** Whether the parent has a real data/EOF source connected to stdin. */
  readonly stdin: 'forwarded' | 'unavailable';
  /** Whether the higher runtime may expose the runtime-IPC lane. */
  readonly runtimeIpc: boolean;
}

export const DEFAULT_WORKER_PROCESS_CAPABILITIES: WorkerProcessCapabilities = {
  stdin: 'unavailable',
  runtimeIpc: false,
};

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
  readonly capabilities: WorkerProcessCapabilities;
  readonly stdio: KernelProcessStdioPorts;
}

/**
 * Internal hook keys. Exported only so conformance tests can assert the
 * publish path; production code goes through {@link publishKernelSyncApi} /
 * {@link readKernelSyncApi} etc.
 */
export const KERNEL_SYNC_CALL_KEY = '__riftyKernelSyncCall' as const;
export const KERNEL_PROCESS_SPEC_KEY = '__riftyProcessSpec__' as const;

interface GlobalWithKernelHooks {
  [KERNEL_SYNC_CALL_KEY]?: KernelSyncCall;
  [KERNEL_PROCESS_SPEC_KEY]?: KernelProcessSpec;
}

function asGlobal(): GlobalWithKernelHooks {
  return globalThis as unknown as GlobalWithKernelHooks;
}

/**
 * Install the sync-call shim on this realm's globalThis as a non-enumerable
 * value. Idempotent — re-publishing overwrites (configurable: true).
 *
 * Stores the raw `call` function under the key for historical compatibility
 * (older runtime-js builds expected the bare function); {@link readKernelSyncApi}
 * re-wraps it into {@link KernelSyncApi} so future expansions stay additive.
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
 * Read the sync-call API published in this realm; `null` when the kernel
 * bootstrap hasn't run. The returned `call` is the canonical entry point —
 * higher layers MUST use it, not `globalThis[KERNEL_SYNC_CALL_KEY]`.
 */
export function readKernelSyncApi(): KernelSyncApi | null {
  const fn = asGlobal()[KERNEL_SYNC_CALL_KEY];
  if (fn === undefined) return null;
  return { call: fn };
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
