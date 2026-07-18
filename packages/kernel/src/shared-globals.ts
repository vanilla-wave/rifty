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
 *   3. {@link KernelEntryBootstrapEnvelope} — optional runtime-agnostic data
 *      attached to one URL entry. The worker bootstrap publishes it before
 *      the pre-entry hook; higher runtimes select their own protocol and
 *      decode the opaque payload.
 *   4. {@link KernelEntryCapabilityPorts} — an entry-scoped frozen map of
 *      opaque MessagePort capabilities, transported separately from process
 *      identity and higher-runtime bootstrap metadata (ADR-0266).
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
 * Stdio + IPC port shape the kernel hands to the higher layer. Identical to
 * {@link WorkerStdioPorts} in `./worker-entry.ts`; redeclared here to keep
 * `shared-globals.ts` import-free of the worker bootstrap module. `ipc`
 * (ADR-0045) carries the fork-mode IPC channel — runtime-js's
 * `installNodeProcessShim` wraps it to expose Node-style `process.send` /
 * `process.on('message', …)` / `process.disconnect()`.
 */
export interface KernelProcessStdioPorts {
  readonly stdout: MessagePort;
  readonly stderr: MessagePort;
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

/** Opaque named MessagePort capabilities attached to one URL worker entry. */
export type KernelEntryCapabilityPorts = Readonly<Record<string, MessagePort>>;

/**
 * Internal hook keys. Exported only so conformance tests can assert the
 * publish path; production code goes through {@link publishKernelSyncApi} /
 * {@link readKernelSyncApi} etc.
 */
export const KERNEL_SYNC_CALL_KEY = '__riftyKernelSyncCall' as const;
export const KERNEL_PROCESS_SPEC_KEY = '__riftyProcessSpec__' as const;
export const KERNEL_ENTRY_BOOTSTRAP_KEY = '__riftyKernelEntryBootstrap__' as const;
export const KERNEL_ENTRY_CAPABILITY_PORTS_KEY = '__riftyKernelEntryCapabilityPorts__' as const;

const EMPTY_KERNEL_ENTRY_CAPABILITY_PORTS = Object.freeze(
  Object.create(null) as Record<string, MessagePort>,
) as KernelEntryCapabilityPorts;

interface GlobalWithKernelHooks {
  [KERNEL_SYNC_CALL_KEY]?: KernelSyncCall;
  [KERNEL_PROCESS_SPEC_KEY]?: KernelProcessSpec;
  [KERNEL_ENTRY_BOOTSTRAP_KEY]?: KernelEntryBootstrapEnvelope | null;
  [KERNEL_ENTRY_CAPABILITY_PORTS_KEY]?: KernelEntryCapabilityPorts;
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

function capabilityKeyLabel(key: PropertyKey | '<root>'): string {
  if (key === '<root>') return key;
  if (typeof key === 'symbol') return String(key);
  if (typeof key === 'number') return String(key);
  if (key.length === 0) return "''";
  return `'${key}'`;
}

function capabilityTypeError(key: PropertyKey | '<root>', detail: string): TypeError {
  return new TypeError(
    `WorkerEntryDescriptor.capabilityPorts ${capabilityKeyLabel(key)} ${detail}`,
  );
}

/**
 * Validate and snapshot an adopted capability record without invoking getters.
 * The returned value is a frozen null-prototype record, so later caller
 * mutation cannot change the entry transferred to the worker.
 */
export function snapshotKernelEntryCapabilityPorts(value: unknown): KernelEntryCapabilityPorts {
  if (typeof value !== 'object' || value === null) {
    throw capabilityTypeError('<root>', 'must be a plain or null-prototype record');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw capabilityTypeError('<root>', 'must be a plain or null-prototype record');
  }

  const snapshot = Object.create(null) as Record<string, MessagePort>;
  const seen = new Set<MessagePort>();
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      throw capabilityTypeError(key, 'changed during validation');
    }
    if (!('value' in descriptor)) {
      throw capabilityTypeError(key, 'must be a data property; accessors are forbidden');
    }
    if (typeof key === 'symbol') {
      if (descriptor.enumerable) {
        throw capabilityTypeError(key, 'must not be an enumerable symbol');
      }
      continue;
    }
    if (!descriptor.enumerable) continue;
    if (key.length === 0) {
      throw capabilityTypeError(key, 'must be a non-empty exact string');
    }
    const port = descriptor.value;
    if (typeof MessagePort === 'undefined' || !(port instanceof MessagePort)) {
      throw capabilityTypeError(key, 'must be a MessagePort');
    }
    if (seen.has(port)) {
      throw capabilityTypeError(key, 'duplicates a MessagePort already used by another name');
    }
    seen.add(port);
    snapshot[key] = port;
  }
  return Object.freeze(snapshot);
}

/**
 * Publish this URL entry's capability snapshot. Absence publishes the shared
 * frozen empty value, clearing stale state in reused test hosts.
 */
export function publishKernelEntryCapabilityPorts(
  ports: KernelEntryCapabilityPorts | null | undefined,
): void {
  const snapshot =
    ports === null || ports === undefined
      ? EMPTY_KERNEL_ENTRY_CAPABILITY_PORTS
      : snapshotKernelEntryCapabilityPorts(ports);
  Object.defineProperty(globalThis, KERNEL_ENTRY_CAPABILITY_PORTS_KEY, {
    value: snapshot,
    writable: false,
    configurable: true,
    enumerable: false,
  });
}

/** Read this entry's capabilities; absence is a frozen empty null-prototype map. */
export function readKernelEntryCapabilityPorts(): KernelEntryCapabilityPorts {
  return asGlobal()[KERNEL_ENTRY_CAPABILITY_PORTS_KEY] ?? EMPTY_KERNEL_ENTRY_CAPABILITY_PORTS;
}
