/**
 * Protocol endpoint (ADR-0166): the PURE core that maps a worker protocol
 * request frame → response frame against a {@link TsLanguageService}. No worker
 * globals, no kernel side effects — `entry.ts` wires this to the real fork-IPC
 * port + sync-RPC `call`, while tests drive it directly over a fake `call`.
 *
 * Lifecycle: the first `ts:init` frame builds the service (async — the engine
 * awaits the std-lib load up front) bound to `projectRoot`; later frames mutate
 * the overlay (`open`/`update`/`close`/`invalidate`) or query diagnostics
 * (`getSemantic`/`getSyntactic`/`getConfigFile`). A query/mutation arriving
 * before `ts:init` is an ERROR frame, never a silent empty (Fidelity — no lying
 * happy path). Any thrown error is surfaced as a `TsErrorResponse`, never
 * swallowed.
 */

import type { FsSync } from '@riftydev/vfs';
import { createTsLanguageService } from '../service.ts';
import type { TsLanguageService } from '../service.ts';
import type { TsRequest, TsResponse } from './protocol.ts';

/** Deps for {@link createServiceEndpoint}. */
export interface ServiceEndpointDeps {
  /**
   * Build the engine's {@link FsSync} from the sync-RPC `call`. Production wires
   * `createRpcFsSync`; the seam lets tests inject a fake-`call`-backed FsSync.
   */
  buildFsSync(call: (method: string, payload: unknown) => unknown): FsSync;
  /** The in-Worker sync-call shim (`readKernelSyncApi().call`). */
  call(method: string, payload: unknown): unknown;
}

/** A protocol endpoint: one method, `dispatch(frame) → response frame`. */
export interface ServiceEndpoint {
  dispatch(request: TsRequest): Promise<TsResponse>;
}

function errResponse(id: number, err: unknown): TsResponse {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  return { id, ok: false, kind: 'error', error: { name, message } };
}

export function createServiceEndpoint(deps: ServiceEndpointDeps): ServiceEndpoint {
  let service: TsLanguageService | null = null;

  const requireService = (): TsLanguageService => {
    if (service === null) {
      throw new Error('ts language-service endpoint: received a request before ts:init');
    }
    return service;
  };

  const dispatch = async (request: TsRequest): Promise<TsResponse> => {
    const { id } = request;
    try {
      switch (request.type) {
        case 'ts:init': {
          // Idempotent re-init rebuilds the service against the new root (the
          // page owns one service per worker, but a project-root switch must not
          // wedge the worker).
          const fsSync = deps.buildFsSync(deps.call);
          service = await createTsLanguageService({ fsSync, projectRoot: request.projectRoot });
          return { id, ok: true, kind: 'ack' };
        }
        case 'ts:open':
          requireService().openDocument(request.path, request.text);
          return { id, ok: true, kind: 'ack' };
        case 'ts:update':
          requireService().updateDocument(request.path, request.text);
          return { id, ok: true, kind: 'ack' };
        case 'ts:close':
          requireService().closeDocument(request.path);
          return { id, ok: true, kind: 'ack' };
        case 'ts:invalidate':
          requireService().invalidate(request.path);
          return { id, ok: true, kind: 'ack' };
        case 'ts:getSemanticDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: requireService().getSemanticDiagnostics(request.path),
          };
        case 'ts:getSyntacticDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: requireService().getSyntacticDiagnostics(request.path),
          };
        case 'ts:getConfigFileDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: requireService().getConfigFileDiagnostics(),
          };
        case 'ts:getQuickInfo':
          return {
            id,
            ok: true,
            kind: 'hover',
            hover: requireService().getQuickInfo(request.path, request.position),
          };
        case 'ts:getDefinition':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: requireService().getDefinition(request.path, request.position),
          };
        case 'ts:getTypeDefinition':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: requireService().getTypeDefinition(request.path, request.position),
          };
        case 'ts:getCompletions':
          return {
            id,
            ok: true,
            kind: 'completions',
            completions: requireService().getCompletions(request.path, request.position),
          };
        case 'ts:getCompletionDetails':
          return {
            id,
            ok: true,
            kind: 'completionItem',
            item: requireService().getCompletionDetails(
              request.path,
              request.position,
              request.label,
            ),
          };
        case 'ts:getReferences':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: requireService().getReferences(
              request.path,
              request.position,
              request.context,
            ),
          };
        case 'ts:prepareRename':
          return {
            id,
            ok: true,
            kind: 'prepareRename',
            result: requireService().prepareRename(request.path, request.position),
          };
        case 'ts:getRenameEdits':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: requireService().getRenameEdits(request.path, request.position, request.newName),
          };
        case 'ts:getSignatureHelp':
          return {
            id,
            ok: true,
            kind: 'signatureHelp',
            signatureHelp: requireService().getSignatureHelp(request.path, request.position),
          };
        case 'ts:getCodeFixes':
          return {
            id,
            ok: true,
            kind: 'codeActions',
            codeActions: requireService().getCodeFixes(
              request.path,
              request.range,
              request.errorCodes,
            ),
          };
        case 'ts:organizeImports':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: requireService().organizeImports(request.path),
          };
        case 'ts:getFormattingEdits':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: requireService().getFormattingEdits(request.path, request.options),
          };
        case 'ts:getRangeFormattingEdits':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: requireService().getRangeFormattingEdits(
              request.path,
              request.range,
              request.options,
            ),
          };
        default: {
          // Exhaustive over TsRequest; a malformed-but-typed frame is a loud
          // error, never an undefined response (Fidelity).
          const bad = request as { type?: unknown };
          return errResponse(id, new Error(`unknown request type: ${String(bad.type)}`));
        }
      }
    } catch (err) {
      return errResponse(id, err);
    }
  };

  return { dispatch };
}
