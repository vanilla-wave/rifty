/**
 * Public surface of `@riftydev/ts-language-service`: a real `ts.LanguageService`
 * driven over the rifty VFS, exposing diagnostics as LSP shapes (ADR-0166).
 *
 * Internal modules (host, overlay, tsconfig, lib-dts, position, vfs-ts-host)
 * are NOT exported — only the service factory and the LSP wire types.
 */

export { createTsLanguageService } from './service.ts';
export type { CreateTsLanguageServiceDeps, TsLanguageService } from './service.ts';
export { DiagnosticSeverity } from './lsp-types.ts';
export type { Diagnostic, Position, Range } from './lsp-types.ts';

// Worker hosting (ADR-0166): the page editor + the M12 agent reach ONE shared
// service instance running in a kernel `serve` worker that reads the
// authoritative VFS over the fs.* sync-RPC seam. The Node-proven units (RPC
// FsSync adapter + protocol + endpoint) are public; the side-effectful boot is
// referenced separately (the `./worker/entry` subpath / by URL).
export { createRpcFsSync } from './worker/host-fs-rpc.ts';
export type { SyncCall } from './worker/host-fs-rpc.ts';
export { createServiceEndpoint } from './worker/service-endpoint.ts';
export type { ServiceEndpoint, ServiceEndpointDeps } from './worker/service-endpoint.ts';
export {
  TS_IPC_TYPE,
  isTsRequestMessage,
  isTsResponseMessage,
} from './worker/protocol.ts';
export type {
  TsRequest,
  TsRequestType,
  TsRequestMessage,
  TsResponse,
  TsResponseMessage,
  TsInitRequest,
  TsOpenRequest,
  TsUpdateRequest,
  TsCloseRequest,
  TsInvalidateRequest,
  TsSemanticRequest,
  TsSyntacticRequest,
  TsConfigDiagnosticsRequest,
  TsAckResponse,
  TsDiagnosticsResponse,
  TsErrorResponse,
} from './worker/protocol.ts';
