export { DEFAULT_CWD, ProcessManager, globalProcessManager } from './process-manager.ts';
export type {
  ProcessHandle,
  ProcessHandleKind,
  ProcessIO,
  SameRealmProcessHandle,
  SpawnOptions,
  WorkerProcessHandle,
} from './process-manager.ts';

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
export { getIpcMode, isSabIpcSupported } from './ipc/capabilities.ts';
export type {
  WorkerEntryDescriptor,
  WorkerExitMessage,
  WorkerInitMessage,
  WorkerSpawnSpec,
  WorkerStdioPorts,
} from './worker-entry.ts';

// ADR-0011 phase 2 — kernel.spawnWorker allocator + host-side URL setter.
export { getKernelWorkerUrl, setKernelWorkerUrl } from './spawn-worker.ts';
export type { SpawnWorkerSpec } from './spawn-worker.ts';
export { setExecSyncScriptResolver } from './ipc/script-resolver.ts';

// ADR-0011 phase 3 — sync RPC framing, dispatcher, in-Worker client.
// ADR-0032 — protocol-version constant + typed mismatch error.
export {
  type SyncRpcRequest,
  type SyncRpcReply,
  encodeRequest,
  decodeReply,
  decodeRequest,
  encodeReply,
  SYNC_RPC_PROTOCOL_VERSION,
  SyncRpcProtocolMismatchError,
} from './ipc/sync-rpc.ts';
export {
  SyncRpcDispatcher,
  type SyncRpcDispatcherOptions,
  type SyncRpcHandler,
} from './ipc/sync-dispatch.ts';
export { SyncRpcClient, type SyncRpcClientOptions } from './ipc/sync-client.ts';
// ADR-0019/P1 follow-up — typed publish/read for the cross-realm globals
// the kernel installs inside a spawned Worker. Higher layers (runtime-js)
// MUST go through these helpers instead of reaching into `globalThis[...]`.
export {
  KERNEL_SAB_RING_KEY,
  KERNEL_SYNC_CALL_KEY,
  type KernelSabRing,
  type KernelSyncApi,
  type KernelSyncCall,
  publishKernelSabRing,
  publishKernelSyncApi,
  readKernelSabRing,
  readKernelSyncApi,
} from './shared-globals.ts';
export {
  registerDefaultHandlers,
  type DefaultHandlerOptions,
  type ScriptResolver,
  type RecursiveWorkerRunner,
  type ExecSyncPayload,
} from './ipc/default-handlers.ts';
