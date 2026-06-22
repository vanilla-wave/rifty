/**
 * Protocol endpoint (ADR-0166): the PURE core that maps a worker protocol
 * request frame → response frame against a {@link TsLanguageService}. No worker
 * globals, no kernel side effects — `entry.ts` wires this to the real fork-IPC
 * port + sync-RPC `call`, while tests drive it directly over a fake `call`.
 *
 * Lifecycle: the first `ts:init` frame builds the service (async — the engine
 * awaits the std-lib load up front) bound to `projectRoot`; later frames mutate
 * the overlay (`open`/`update`/`close`/`invalidate`) or query diagnostics
 * (`getSemantic`/`getSyntactic`/`getConfigFile`).
 *
 * Init serialization (the fork-IPC pump dispatches every frame independently —
 * it does NOT await one before the next): a frame that arrives while `ts:init`
 * is still building the service QUEUES behind the in-flight build by awaiting
 * the shared `servicePromise`, then runs. The page never re-sends, so racing a
 * just-sent `open`/query against a slow cold init (the TS engine + the ~3 MB
 * std-lib over the owner relay) must wait, NOT fail. A frame arriving with NO
 * `ts:init` ever sent is still an ERROR frame (Fidelity — no lying happy path).
 * A failed init makes the failing frame AND every queued frame carry the REAL
 * cause (e.g. the owner-store error), never the misleading "before ts:init".
 * Any thrown error is surfaced as a `TsErrorResponse`, never swallowed.
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
  /**
   * Optional phase logger (worker stdout). The cold `ts:init` can be slow under
   * contention (a 2-core CI runner co-resident with the dev-server child); these
   * lines make a slow/wedged build observable end-to-end (worker → owner → page
   * console). Absent in unit tests.
   */
  log?: (message: string) => void;
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
  // The in-flight (or settled) service build. Set SYNCHRONOUSLY in the `ts:init`
  // branch so a frame the pump dispatches right after — while the build is still
  // awaiting the std-lib load — awaits THIS promise and runs in order, instead of
  // racing a null `service`. `null` until the first `ts:init`.
  let servicePromise: Promise<TsLanguageService> | null = null;

  // Resolve the service for a non-init frame: queue behind the in-flight build,
  // or REJECT with the real init error if the build failed (never a misleading
  // "before ts:init"). Only a frame with NO `ts:init` ever sent hits that throw.
  const awaitService = (): Promise<TsLanguageService> => {
    if (servicePromise === null) {
      return Promise.reject(
        new Error('ts language-service endpoint: received a request before ts:init'),
      );
    }
    return servicePromise;
  };

  const dispatch = async (request: TsRequest): Promise<TsResponse> => {
    const { id } = request;
    try {
      if (request.type === 'ts:init') {
        // Idempotent re-init rebuilds the service against the new root (the page
        // owns one service per worker, but a project-root switch must not wedge
        // the worker). Store the build promise BEFORE awaiting it so a racing
        // frame queues behind this exact build.
        const startedAt = deps.log ? Date.now() : 0;
        deps.log?.(`init: building service (root=${request.projectRoot})`);
        const built = createTsLanguageService({
          fsSync: deps.buildFsSync(deps.call),
          projectRoot: request.projectRoot,
          ...(deps.log ? { log: deps.log } : {}),
        });
        servicePromise = built;
        await built;
        deps.log?.(`init: service ready (+${Date.now() - startedAt}ms)`);
        return { id, ok: true, kind: 'ack' };
      }

      const service = await awaitService();
      switch (request.type) {
        case 'ts:open':
          service.openDocument(request.path, request.text);
          return { id, ok: true, kind: 'ack' };
        case 'ts:update':
          service.updateDocument(request.path, request.text);
          return { id, ok: true, kind: 'ack' };
        case 'ts:close':
          service.closeDocument(request.path);
          return { id, ok: true, kind: 'ack' };
        case 'ts:invalidate':
          service.invalidate(request.path);
          return { id, ok: true, kind: 'ack' };
        case 'ts:getSemanticDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: service.getSemanticDiagnostics(request.path),
          };
        case 'ts:getSyntacticDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: service.getSyntacticDiagnostics(request.path),
          };
        case 'ts:getConfigFileDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: service.getConfigFileDiagnostics(),
          };
        case 'ts:getQuickInfo':
          return {
            id,
            ok: true,
            kind: 'hover',
            hover: service.getQuickInfo(request.path, request.position),
          };
        case 'ts:getDefinition':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: service.getDefinition(request.path, request.position),
          };
        case 'ts:getTypeDefinition':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: service.getTypeDefinition(request.path, request.position),
          };
        case 'ts:getCompletions':
          return {
            id,
            ok: true,
            kind: 'completions',
            completions: service.getCompletions(request.path, request.position),
          };
        case 'ts:getCompletionDetails':
          return {
            id,
            ok: true,
            kind: 'completionItem',
            item: service.getCompletionDetails(request.path, request.position, request.label),
          };
        case 'ts:getReferences':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: service.getReferences(request.path, request.position, request.context),
          };
        case 'ts:prepareRename':
          return {
            id,
            ok: true,
            kind: 'prepareRename',
            result: service.prepareRename(request.path, request.position),
          };
        case 'ts:getRenameEdits':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: service.getRenameEdits(request.path, request.position, request.newName),
          };
        case 'ts:getSignatureHelp':
          return {
            id,
            ok: true,
            kind: 'signatureHelp',
            signatureHelp: service.getSignatureHelp(request.path, request.position),
          };
        case 'ts:getCodeFixes':
          return {
            id,
            ok: true,
            kind: 'codeActions',
            codeActions: service.getCodeFixes(request.path, request.range, request.errorCodes),
          };
        case 'ts:organizeImports':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: service.organizeImports(request.path),
          };
        case 'ts:getFormattingEdits':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: service.getFormattingEdits(request.path, request.options),
          };
        case 'ts:getRangeFormattingEdits':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: service.getRangeFormattingEdits(
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
