export { DEFAULT_CWD, ProcessManager, globalProcessManager } from './process-manager.ts';
export type { ProcessHandle, ProcessIO, SpawnOptions } from './process-manager.ts';

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
export {
  type SyncRpcRequest,
  type SyncRpcReply,
  encodeRequest,
  decodeReply,
  decodeRequest,
  encodeReply,
} from './ipc/sync-rpc.ts';
export {
  SyncRpcDispatcher,
  type SyncRpcDispatcherOptions,
  type SyncRpcHandler,
} from './ipc/sync-dispatch.ts';
export { SyncRpcClient, type SyncRpcClientOptions } from './ipc/sync-client.ts';
export { KERNEL_SYNC_CALL_KEY, type KernelSyncCall } from './worker-entry.ts';
export {
  registerDefaultHandlers,
  type DefaultHandlerOptions,
  type ScriptResolver,
  type RecursiveWorkerRunner,
  type ExecSyncPayload,
} from './ipc/default-handlers.ts';
