export { spawnRuntime, spawnToolchainRuntime } from './host.ts';
export { SANDBOX_TOOLCHAIN_PROTOCOL } from './protocol.ts';
export type {
  EvalOptions,
  RuntimeController,
  RuntimeEvent,
  RuntimeFs,
  RuntimeOptions,
  RuntimeToolchain,
  ToolchainRuntimeController,
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
  ToolchainInstallRequest,
  ToolchainRequest,
  ToolchainResult,
  ToolchainRunBinRequest,
  WorkerMessage,
} from './protocol.ts';
// Telemetry DATA types only — the `diagnostic` event/message payload. The sink's
// mutation fns (recordX/snapshot/reset) stay internal.
export type { TelemetryEntry, TelemetryKind } from './telemetry/divergence-sink.ts';
export { registerBuiltin, isBuiltinSpecifier, listBuiltins } from './builtins/index.ts';
export type { BuiltinFactory } from './builtins/index.ts';
// Single source of truth for `process.version`/`release` identity (owner + spawned child).
// Exposed so the host (e.g. the playground's `node -v`) reports the SAME version
// the child's `process.version` does, never a drifting hardcode.
export { NODE_PROCESS_IDENTITY } from './builtins/process-identity.ts';
export { installRuntimeJsFsHandlers } from './ipc/fs-handlers.ts';
export { SyncRpcFsSync, installRemoteSyncFs } from './ipc/sync-rpc-fs.ts';
export type { SyncBinaryCall, SyncCall } from './ipc/sync-rpc-fs.ts';
export {
  publishRuntimeEsbuild,
  readRuntimeEsbuild,
  type RuntimeEsbuildCjsOuter,
} from './internal/worker-globals.ts';
export { FS_RPC_CHUNK } from './ipc/fs-rpc-protocol.ts';
export { installConsole, type ConsoleSink } from './repl/console.ts';
export {
  awaitDrain,
  initializeEventLoopKeepalive,
  installEventLoopKeepalive,
  releaseNodeEvalDrainOwnership,
  trackKeepalivePromise,
} from './internal/event-loop-keepalive.ts';
export { installFetchKeepalive } from './builtins/fetch-keepalive.ts';
