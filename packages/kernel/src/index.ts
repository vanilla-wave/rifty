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
