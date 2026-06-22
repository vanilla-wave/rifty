/**
 * Worker protocol for the TS language service (ADR-0166). A
 * discriminated-union request/response frame set carried over the kernel
 * fork-IPC channel (page ⇄ serve-worker), modelled on
 * `apps/playground/src/glue/pty-protocol.ts`. Pure types/constants — NO side
 * effects, NO worker globals (this module is import-safe for types alone).
 *
 * Every request carries a correlation `id`; the matching response echoes it.
 * Diagnostics travel as the package's LSP {@link Diagnostic} (structured-clone
 * safe: plain objects/enums/strings/numbers only).
 *
 * One service instance per worker; the page sends `ts:init` once (project root)
 * before any query. Open/update/close/invalidate mutate the open-document
 * overlay; the three `get*Diagnostics` queries read it.
 */

import type {
  CompletionItem,
  CompletionList,
  Diagnostic,
  Hover,
  Location,
  Position,
} from '../lsp-types.ts';

/** Request frame discriminators. */
export type TsRequestType =
  | 'ts:init'
  | 'ts:open'
  | 'ts:update'
  | 'ts:close'
  | 'ts:invalidate'
  | 'ts:getSemanticDiagnostics'
  | 'ts:getSyntacticDiagnostics'
  | 'ts:getConfigFileDiagnostics'
  | 'ts:getQuickInfo'
  | 'ts:getDefinition'
  | 'ts:getTypeDefinition'
  | 'ts:getCompletions'
  | 'ts:getCompletionDetails';

interface BaseRequest {
  /** Correlation id echoed on the response. */
  readonly id: number;
}

/** One-shot service bootstrap: bind the engine to `projectRoot`. */
export interface TsInitRequest extends BaseRequest {
  readonly type: 'ts:init';
  /** POSIX-absolute project root; tsconfig is discovered from here. */
  readonly projectRoot: string;
}
/** Open an editor buffer for `path` with `text` (overlay wins over disk). */
export interface TsOpenRequest extends BaseRequest {
  readonly type: 'ts:open';
  readonly path: string;
  readonly text: string;
}
/** Replace the open buffer text for `path`. */
export interface TsUpdateRequest extends BaseRequest {
  readonly type: 'ts:update';
  readonly path: string;
  readonly text: string;
}
/** Close the buffer for `path` (revert to on-disk bytes). */
export interface TsCloseRequest extends BaseRequest {
  readonly type: 'ts:close';
  readonly path: string;
}
/** Signal an external VFS write so TS drops its cached copy of `path`. */
export interface TsInvalidateRequest extends BaseRequest {
  readonly type: 'ts:invalidate';
  readonly path: string;
}
/** Query semantic (type) diagnostics for `path`. */
export interface TsSemanticRequest extends BaseRequest {
  readonly type: 'ts:getSemanticDiagnostics';
  readonly path: string;
}
/** Query syntactic (parse) diagnostics for `path`. */
export interface TsSyntacticRequest extends BaseRequest {
  readonly type: 'ts:getSyntacticDiagnostics';
  readonly path: string;
}
/** Query config-file (tsconfig) diagnostics (no `path`). */
export interface TsConfigDiagnosticsRequest extends BaseRequest {
  readonly type: 'ts:getConfigFileDiagnostics';
}
/** Quick-info (hover) at `position` in `path`. */
export interface TsQuickInfoRequest extends BaseRequest {
  readonly type: 'ts:getQuickInfo';
  readonly path: string;
  readonly position: Position;
}
/** Go-to-definition at `position` in `path`. */
export interface TsDefinitionRequest extends BaseRequest {
  readonly type: 'ts:getDefinition';
  readonly path: string;
  readonly position: Position;
}
/** Go-to-type-definition at `position` in `path`. */
export interface TsTypeDefinitionRequest extends BaseRequest {
  readonly type: 'ts:getTypeDefinition';
  readonly path: string;
  readonly position: Position;
}
/** Completion candidates at `position` in `path`. */
export interface TsCompletionsRequest extends BaseRequest {
  readonly type: 'ts:getCompletions';
  readonly path: string;
  readonly position: Position;
}
/** Resolve one completion entry (`label`) at `position` in `path`. */
export interface TsCompletionDetailsRequest extends BaseRequest {
  readonly type: 'ts:getCompletionDetails';
  readonly path: string;
  readonly position: Position;
  readonly label: string;
}

export type TsRequest =
  | TsInitRequest
  | TsOpenRequest
  | TsUpdateRequest
  | TsCloseRequest
  | TsInvalidateRequest
  | TsSemanticRequest
  | TsSyntacticRequest
  | TsConfigDiagnosticsRequest
  | TsQuickInfoRequest
  | TsDefinitionRequest
  | TsTypeDefinitionRequest
  | TsCompletionsRequest
  | TsCompletionDetailsRequest;

/** Acknowledgement for a mutation/init request (no payload). */
export interface TsAckResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'ack';
}
/** Diagnostics payload for a `get*Diagnostics` query. */
export interface TsDiagnosticsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'diagnostics';
  readonly diagnostics: readonly Diagnostic[];
}
/** Hover payload for `ts:getQuickInfo` (`null` when nothing to hover). */
export interface TsHoverResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'hover';
  readonly hover: Hover | null;
}
/** Location payload for `ts:getDefinition` / `ts:getTypeDefinition`. */
export interface TsLocationsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'locations';
  readonly locations: readonly Location[];
}
/** Completion-list payload for `ts:getCompletions`. */
export interface TsCompletionsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'completions';
  readonly completions: CompletionList;
}
/** Resolved-entry payload for `ts:getCompletionDetails` (`null` if unknown). */
export interface TsCompletionItemResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'completionItem';
  readonly item: CompletionItem | null;
}
/** Failure response — a thrown error surfaced to the caller (never swallowed). */
export interface TsErrorResponse {
  readonly id: number;
  readonly ok: false;
  readonly kind: 'error';
  readonly error: { readonly name: string; readonly message: string };
}

export type TsResponse =
  | TsAckResponse
  | TsDiagnosticsResponse
  | TsHoverResponse
  | TsLocationsResponse
  | TsCompletionsResponse
  | TsCompletionItemResponse
  | TsErrorResponse;

/** kernel fork-IPC envelope discriminator (sits beside `rifty:vfs-write`/`rifty:pty`). */
export const TS_IPC_TYPE = 'rifty:ts-lsp' as const;

/** Page→worker request envelope. */
export interface TsRequestMessage {
  readonly type: typeof TS_IPC_TYPE;
  readonly request: TsRequest;
}
/** Worker→page response envelope. */
export interface TsResponseMessage {
  readonly type: typeof TS_IPC_TYPE;
  readonly response: TsResponse;
}

export function isTsRequestMessage(m: unknown): m is TsRequestMessage {
  return (
    !!m &&
    typeof m === 'object' &&
    (m as { type?: unknown }).type === TS_IPC_TYPE &&
    'request' in (m as object)
  );
}
export function isTsResponseMessage(m: unknown): m is TsResponseMessage {
  return (
    !!m &&
    typeof m === 'object' &&
    (m as { type?: unknown }).type === TS_IPC_TYPE &&
    'response' in (m as object)
  );
}
