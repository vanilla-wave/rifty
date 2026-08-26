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

import type { KernelSyncApi } from '@riftydev/kernel';
import type { SyncBinaryCall, SyncCall } from '@riftydev/runtime-js';
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
  buildFsSync(call: SyncCall, callBinary: SyncBinaryCall): FsSync;
  /** Complete in-Worker sync API published by the kernel bootstrap. */
  syncApi: KernelSyncApi;
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
  const feature =
    typeof err === 'object' &&
    err !== null &&
    typeof (err as { readonly feature?: unknown }).feature === 'string'
      ? (err as { readonly feature: string }).feature
      : undefined;
  return {
    id,
    ok: false,
    kind: 'error',
    error: { name, message, ...(feature !== undefined ? { feature } : {}) },
  };
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
        const built = (async () =>
          createTsLanguageService({
            fsSync: deps.buildFsSync(deps.syncApi.call, deps.syncApi.callBinary),
            projectRoot: request.projectRoot,
            ...(deps.log ? { log: deps.log } : {}),
          }))();
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
        case 'ts:cleanupSemanticCache':
          service.cleanupSemanticCache();
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
            hover: service.getQuickInfo(request.path, request.position, request.options),
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
            completions: service.getCompletions(request.path, request.position, request.options),
          };
        case 'ts:getCompletionDetails':
          return {
            id,
            ok: true,
            kind: 'completionItem',
            item: service.getCompletionDetails(
              request.path,
              request.position,
              request.label,
              request.source,
              request.data,
              request.options,
            ),
          };
        case 'ts:getReferences':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: service.getReferences(request.path, request.position, request.context),
          };
        case 'ts:getReferencesAtPosition':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: service.getReferencesAtPosition(request.path, request.position),
          };
        case 'ts:prepareRename':
          return {
            id,
            ok: true,
            kind: 'prepareRename',
            result: service.prepareRename(request.path, request.position, request.options),
          };
        case 'ts:getRenameEdits':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: service.getRenameEdits(
              request.path,
              request.position,
              request.newName,
              request.options,
            ),
          };
        case 'ts:getSignatureHelp':
          return {
            id,
            ok: true,
            kind: 'signatureHelp',
            signatureHelp: service.getSignatureHelp(
              request.path,
              request.position,
              request.options,
            ),
          };
        case 'ts:getNameOrDottedNameSpan':
          return {
            id,
            ok: true,
            kind: 'range',
            range: service.getNameOrDottedNameSpan(request.path, request.range),
          };
        case 'ts:getBreakpointStatement':
          return {
            id,
            ok: true,
            kind: 'range',
            range: service.getBreakpointStatement(request.path, request.position),
          };
        case 'ts:getCodeFixes':
          return {
            id,
            ok: true,
            kind: 'codeActions',
            codeActions: service.getCodeFixes(
              request.path,
              request.range,
              request.errorCodes,
              request.options,
            ),
          };
        case 'ts:organizeImports':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: service.organizeImports(request.path, request.options),
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
        case 'ts:getSuggestionDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: service.getSuggestionDiagnostics(request.path),
          };
        case 'ts:getCompilerOptionsDiagnostics':
          return {
            id,
            ok: true,
            kind: 'diagnostics',
            diagnostics: service.getCompilerOptionsDiagnostics(),
          };
        case 'ts:getImplementation':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: service.getImplementation(request.path, request.position),
          };
        case 'ts:getDefinitionLinks':
          return {
            id,
            ok: true,
            kind: 'definitionLinks',
            definitionLinks: service.getDefinitionLinks(request.path, request.position),
          };
        case 'ts:getDocumentSymbols':
          return {
            id,
            ok: true,
            kind: 'documentSymbols',
            documentSymbols: service.getDocumentSymbols(request.path),
          };
        case 'ts:getNavigationBarItems':
          return {
            id,
            ok: true,
            kind: 'navigationBarItems',
            navigationBarItems: service.getNavigationBarItems(request.path),
          };
        case 'ts:getFoldingRanges':
          return {
            id,
            ok: true,
            kind: 'foldingRanges',
            foldingRanges: service.getFoldingRanges(request.path),
          };
        case 'ts:getWorkspaceSymbols':
          return {
            id,
            ok: true,
            kind: 'workspaceSymbols',
            workspaceSymbols: service.getWorkspaceSymbols(request.search, request.options),
          };
        case 'ts:getInlayHints':
          return {
            id,
            ok: true,
            kind: 'inlayHints',
            inlayHints: service.getInlayHints(request.path, request.range, request.options),
          };
        case 'ts:getDocumentHighlights':
          return {
            id,
            ok: true,
            kind: 'documentHighlights',
            documentHighlights: service.getDocumentHighlights(
              request.path,
              request.position,
              request.filesToSearch,
            ),
          };
        case 'ts:getSemanticClassifications':
          return {
            id,
            ok: true,
            kind: 'classifiedSpans',
            spans: service.getSemanticClassifications(request.path, request.range, request.format),
          };
        case 'ts:getSyntacticClassifications':
          return {
            id,
            ok: true,
            kind: 'classifiedSpans',
            spans: service.getSyntacticClassifications(request.path, request.range, request.format),
          };
        case 'ts:getEncodedSemanticClassifications':
          return {
            id,
            ok: true,
            kind: 'classifications',
            classifications: service.getEncodedSemanticClassifications(request.path, request.range),
          };
        case 'ts:getEncodedSyntacticClassifications':
          return {
            id,
            ok: true,
            kind: 'classifications',
            classifications: service.getEncodedSyntacticClassifications(
              request.path,
              request.range,
            ),
          };
        case 'ts:prepareCallHierarchy':
          return {
            id,
            ok: true,
            kind: 'callHierarchyItems',
            items: service.prepareCallHierarchy(request.path, request.position),
          };
        case 'ts:getIncomingCalls':
          return {
            id,
            ok: true,
            kind: 'incomingCalls',
            calls: service.getIncomingCalls(request.path, request.position),
          };
        case 'ts:getOutgoingCalls':
          return {
            id,
            ok: true,
            kind: 'outgoingCalls',
            calls: service.getOutgoingCalls(request.path, request.position),
          };
        case 'ts:getOnTypeFormattingEdits':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: service.getOnTypeFormattingEdits(
              request.path,
              request.position,
              request.key,
              request.options,
            ),
          };
        case 'ts:getBraceMatching':
          return {
            id,
            ok: true,
            kind: 'ranges',
            ranges: service.getBraceMatching(request.path, request.position),
          };
        case 'ts:getIndentation':
          return {
            id,
            ok: true,
            kind: 'indentation',
            indentation: service.getIndentation(request.path, request.position, request.options),
          };
        case 'ts:isValidBraceCompletion':
          return {
            id,
            ok: true,
            kind: 'boolean',
            value: service.isValidBraceCompletion(
              request.path,
              request.position,
              request.openingBrace,
            ),
          };
        case 'ts:getSpanOfEnclosingComment':
          return {
            id,
            ok: true,
            kind: 'range',
            range: service.getSpanOfEnclosingComment(
              request.path,
              request.position,
              request.onlyMultiLine,
            ),
          };
        case 'ts:toLineColumnOffset':
          return {
            id,
            ok: true,
            kind: 'position',
            position: service.toLineColumnOffset(request.path, request.offset),
          };
        case 'ts:toggleLineComment':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: service.toggleLineComment(request.path, request.range),
          };
        case 'ts:toggleMultilineComment':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: service.toggleMultilineComment(request.path, request.range),
          };
        case 'ts:commentSelection':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: service.commentSelection(request.path, request.range),
          };
        case 'ts:uncommentSelection':
          return {
            id,
            ok: true,
            kind: 'textEdits',
            textEdits: service.uncommentSelection(request.path, request.range),
          };
        case 'ts:getRefactorActions':
          return {
            id,
            ok: true,
            kind: 'codeActions',
            codeActions: service.getRefactorActions(request.path, request.range, request.options),
          };
        case 'ts:getRefactorEdits': {
          const edit = service.getRefactorEdits(
            request.path,
            request.range,
            request.refactorName,
            request.actionName,
            request.interactiveArguments,
            request.options,
          );
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit,
          };
        }
        case 'ts:getMoveToRefactoringFileSuggestions':
          return {
            id,
            ok: true,
            kind: 'moveToRefactoringFileSuggestions',
            suggestions: service.getMoveToRefactoringFileSuggestions(
              request.path,
              request.range,
              request.options,
            ),
          };
        case 'ts:getCombinedCodeFix':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: service.getCombinedCodeFix(request.path, request.fixId, request.options),
          };
        case 'ts:getFileRenameEdits':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: service.getFileRenameEdits(request.oldPath, request.newPath, request.options),
          };
        case 'ts:getEmitOutput':
          return {
            id,
            ok: true,
            kind: 'emitOutput',
            emitOutput: service.getEmitOutput(request.path, {
              ...(request.emitOnlyDtsFiles !== undefined
                ? { emitOnlyDtsFiles: request.emitOnlyDtsFiles }
                : {}),
              ...(request.forceDtsEmit !== undefined ? { forceDtsEmit: request.forceDtsEmit } : {}),
            }),
          };
        case 'ts:getSupportedCodeFixes':
          return {
            id,
            ok: true,
            kind: 'supportedCodeFixes',
            codeFixes: service.getSupportedCodeFixes(request.path),
          };
        case 'ts:applyCodeActionCommand':
          await service.applyCodeActionCommand(request.commands);
          return { id, ok: true, kind: 'ack' };
        case 'ts:getProgram':
          service.getProgram();
          return { id, ok: true, kind: 'ack' };
        case 'ts:getCompletionEntrySymbol':
          service.getCompletionEntrySymbol(
            request.path,
            request.position,
            request.name,
            request.source,
          );
          return { id, ok: true, kind: 'ack' };
        case 'ts:getSelectionRange':
          return {
            id,
            ok: true,
            kind: 'selectionRange',
            selectionRange: service.getSelectionRange(request.path, request.position),
          };
        case 'ts:getFileReferences':
          return {
            id,
            ok: true,
            kind: 'locations',
            locations: service.getFileReferences(request.path),
          };
        case 'ts:getJsxClosingTag':
          return {
            id,
            ok: true,
            kind: 'jsxClosingTag',
            tag: service.getJsxClosingTag(request.path, request.position),
          };
        case 'ts:getLinkedEditingRange':
          return {
            id,
            ok: true,
            kind: 'linkedEditingRange',
            linkedEditingRange: service.getLinkedEditingRange(request.path, request.position),
          };
        case 'ts:getDocCommentTemplate':
          return {
            id,
            ok: true,
            kind: 'textInsertion',
            insertion: service.getDocCommentTemplate(
              request.path,
              request.position,
              request.options,
            ),
          };
        case 'ts:getTodoComments':
          return {
            id,
            ok: true,
            kind: 'todoComments',
            todoComments: service.getTodoComments(request.path, request.descriptors),
          };
        case 'ts:preparePasteEditsForFile':
          return {
            id,
            ok: true,
            kind: 'preparePasteEdits',
            supported: service.preparePasteEditsForFile(request.path, request.copiedRanges),
          };
        case 'ts:getPasteEdits':
          return {
            id,
            ok: true,
            kind: 'workspaceEdit',
            edit: service.getPasteEdits(
              request.path,
              request.pastedText,
              request.pasteLocations,
              request.copiedFrom,
              request.options,
            ),
          };
        case 'ts:dispose':
          service.dispose();
          return { id, ok: true, kind: 'ack' };
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
