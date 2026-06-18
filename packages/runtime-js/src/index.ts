export { spawnRuntime } from './host.ts';
export type {
  EvalOptions,
  RuntimeController,
  RuntimeEvent,
  RuntimeFs,
  RuntimeOptions,
} from './host.ts';
export type {
  EvalRequest,
  EvalResult,
  FsReadEncoding,
  FsRequest,
  FsResult,
  HostMessage,
  SerializedRuntimeError,
  TelemetrySnapshot,
  WorkerMessage,
} from './protocol.ts';
// Telemetry DATA types only — the `diagnostic` event/message payload. The sink's
// mutation fns (recordX/snapshot/reset) stay internal.
export type { TelemetryEntry, TelemetryKind } from './telemetry/divergence-sink.ts';
export { registerBuiltin, isBuiltinSpecifier, listBuiltins } from './builtins/index.ts';
export type { BuiltinFactory } from './builtins/index.ts';
export { installRuntimeJsFsHandlers } from './ipc/fs-handlers.ts';
export { SyncRpcFsSync, installRemoteSyncFs } from './ipc/sync-rpc-fs.ts';
export type { SyncCall } from './ipc/sync-rpc-fs.ts';
export { FS_RPC_CHUNK } from './ipc/fs-rpc-protocol.ts';
export { installConsole, type ConsoleSink } from './repl/console.ts';
export { installEventLoopKeepalive } from './internal/event-loop-keepalive.ts';
