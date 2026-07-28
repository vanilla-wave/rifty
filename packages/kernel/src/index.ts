export {
  DEFAULT_CWD,
  ProcessManager,
  decodeIpcFrame,
  formatProcessSnapshot,
  globalProcessManager,
  readRootProcessSnapshot,
} from './process-manager.ts';
export type {
  IpcFrame,
  ProcessHandle,
  ProcessHandleKind,
  ProcessIO,
  ProcessSnapshot,
  SameRealmProcessHandle,
  SpawnOptions,
  WorkerProcessHandle,
} from './process-manager.ts';
export {
  observeProcessTerminalOutcome,
  type ProcessTerminalEventSource,
  type ProcessTerminalOutcome,
} from './process-terminal-outcome.ts';

// ADR-0011 phase 1 — SAB sync-IPC primitives.
export {
  DEFAULT_PAYLOAD_CAPACITY,
  RingPayloadTooLargeError,
  RingTimeoutError,
  SAB_RING_HEADER_BYTES,
  SabRing,
  createSabRing,
} from './ipc/sab-ring.ts';
export type {
  CreateSabRingOptions,
  CreateSabRingResult,
  SabRingHeader,
} from './ipc/sab-ring.ts';
export { getIpcMode, isSabIpcSupported, type IpcModeOptions } from './ipc/capabilities.ts';
export type {
  WorkerEntryDescriptor,
  WorkerExitMessage,
  WorkerInitMessage,
  WorkerSpawnSpec,
  WorkerStdioPorts,
} from './worker-entry.ts';

// ADR-0039 — pre-entry hook (runtime-js installs the Node `process` global
// via this hook). The hook itself is registered by higher layers; the kernel
// just exposes the setter and calls it after publishing `KernelProcessSpec`.
export {
  type KernelPreEntryHook,
  type KernelDrainHook,
  getKernelPreEntryHook,
  setKernelPreEntryHook,
  getKernelDrainHook,
  setKernelDrainHook,
} from './worker-entry.ts';

// ADR-0011 phase 2 — kernel.spawnWorker allocator + host-side URL setter.
export {
  getKernelWorkerUrl,
  setKernelWorkerUrl,
  spawnKernelWorker,
} from './spawn-worker.ts';
export type {
  SpawnWorkerIdentity,
  SpawnWorkerResult,
  SpawnWorkerSpec,
} from './spawn-worker.ts';
export { clearKernelDispatcher, getKernelDispatcher } from './ipc/kernel-dispatcher.ts';

// ADR-0011 phase 3 — sync RPC framing, dispatcher, in-Worker client.
// ADR-0032 — protocol-version constant + typed mismatch error.
export {
  type SyncRpcRequest,
  type SyncRpcReply,
  encodeRequest,
  decodeReply,
  decodeRequest,
  encodeReply,
  encodeBinaryReply,
  FRAME_JSON,
  FRAME_BINARY,
  SYNC_RPC_PROTOCOL_VERSION,
  SyncRpcProtocolMismatchError,
} from './ipc/sync-rpc.ts';
export {
  SyncRpcDispatcher,
  type SyncRpcCallerContext,
  type SyncRpcDispatcherOptions,
  type SyncRpcHandler,
} from './ipc/sync-dispatch.ts';
export { SyncRpcClient, type SyncRpcClientOptions } from './ipc/sync-client.ts';
// ADR-0019/P1 follow-up — typed publish/read for the cross-realm globals
// the kernel installs inside a spawned Worker. Higher layers (runtime-js)
// MUST go through these helpers instead of reaching into `globalThis[...]`.
// ADR-0039 — `KernelProcessSpec` is the typed bootstrap descriptor the
// higher runtime layer reads to build its own `process` object.
export {
  KERNEL_ENTRY_BOOTSTRAP_KEY,
  KERNEL_PROCESS_SPEC_KEY,
  KERNEL_SYNC_CALL_KEY,
  type KernelEntryBootstrapEnvelope,
  type KernelEntryCapabilityPorts,
  type KernelProcessSpec,
  type KernelProcessStdioPorts,
  type KernelStdioOutputWriter,
  type KernelSyncApi,
  type KernelSyncCall,
  consumeKernelEntryCapabilityPorts,
  publishKernelEntryBootstrap,
  publishKernelProcessSpec,
  publishKernelSyncApi,
  readKernelEntryBootstrap,
  readKernelProcessSpec,
  readKernelSyncApi,
} from './shared-globals.ts';
