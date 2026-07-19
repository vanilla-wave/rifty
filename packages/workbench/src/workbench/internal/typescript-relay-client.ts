/**
 * Correlated TypeScript language-service client (ADR-0166 P1.9b).
 *
 * An id-correlated request/response client over the page↔owner↔LS relay.
 * The LS is an owner grandchild, so every page request and response crosses the
 * Workbench session-tools relay.
 *
 * Realm-wide monotonic ids prevent late frames from matching a replacement
 * client. Per-request timeouts and `dispose()` reject every affected call.
 * Inbound frames are filtered by `isTsResponseMessage` before correlation.
 */

import type {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  ClassificationFormat,
  ClassifiedSpan,
  CodeAction,
  CodeFixOptions,
  CombinedCodeFixOptions,
  CompletionDetailsOptions,
  CompletionItem,
  CompletionList,
  CompletionOptions,
  DefinitionLinks,
  Diagnostic,
  DocCommentTemplateOptions,
  DocumentHighlight,
  DocumentSymbol,
  EmitOutput,
  EncodedClassifications,
  FileRenameEditsOptions,
  FoldingRange,
  FormattingOptions,
  Hover,
  InlayHint,
  InlayHintOptions,
  LinkedEditingRanges,
  Location,
  MoveToRefactoringFileSuggestions,
  NavigationBarItem,
  OrganizeImportsOptions,
  PasteEditsOptions,
  Position,
  PrepareRenameResult,
  QuickInfoOptions,
  Range,
  RefactorEditOptions,
  RefactorOptions,
  ReferenceContext,
  RenameOptions,
  SelectionRange,
  SignatureHelp,
  SignatureHelpOptions,
  SymbolInformation,
  TextEdit,
  TextInsertion,
  TodoComment,
  TodoCommentDescriptor,
  WorkspaceEdit,
  WorkspaceSymbolOptions,
} from '@riftydev/ts-language-service/lsp-types';
import {
  TS_IPC_TYPE,
  type TsRequest,
  type TsResponse,
  isTsResponseMessage,
} from '@riftydev/ts-language-service/protocol';

// Old and new page clients can briefly share one relay; ids cannot restart per client.
let nextRequestId = 0;

function nextTsLspRequestId(): number {
  return ++nextRequestId;
}

/** Relay seam the client posts requests on / subscribes responses through. */
export interface TsLspRelay {
  /** Post a `rifty:ts-lsp` request envelope to the owner (relayed to the LS child). */
  sendTsLsp(message: unknown): void;
  /** Subscribe to relayed `rifty:ts-lsp` response envelopes; returns an unsubscribe. */
  onTsLsp(cb: (message: unknown) => void): () => void;
}

export interface TsLanguageServiceClient {
  /** Bind the service to a project root (tsconfig discovered from here). Once per session. */
  init(projectRoot: string): Promise<void>;
  /** Open an editor buffer (overlay wins over disk). */
  open(path: string, text: string): Promise<void>;
  /** Replace the open buffer text. */
  update(path: string, text: string): Promise<void>;
  /** Close the buffer (revert to on-disk bytes). */
  close(path: string): Promise<void>;
  /** Drop the cached copy of `path` after an external VFS write. */
  invalidate(path: string): Promise<void>;
  /** Drop TS's semantic cache without rebuilding the worker/service. */
  cleanupSemanticCache(): Promise<void>;
  /** Type (semantic) diagnostics for `path`. */
  getSemanticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  /** Parse (syntactic) diagnostics for `path`. */
  getSyntacticDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  /** tsconfig (config-file) diagnostics. */
  getConfigFileDiagnostics(): Promise<readonly Diagnostic[]>;
  /** Quick-info (hover) at `position` (LSP 0-based) in `path`; `null` when nothing to hover. */
  getQuickInfo(path: string, position: Position, options?: QuickInfoOptions): Promise<Hover | null>;
  /** Go-to-definition sites for the symbol at `position` (LSP 0-based). */
  getDefinition(path: string, position: Position): Promise<readonly Location[]>;
  /** Go-to-type-definition sites for the TYPE of the symbol at `position` (LSP 0-based). */
  getTypeDefinition(path: string, position: Position): Promise<readonly Location[]>;
  /** Completion candidates at `position` (LSP 0-based). Details resolved lazily. */
  getCompletions(
    path: string,
    position: Position,
    options?: CompletionOptions,
  ): Promise<CompletionList>;
  /** Resolve one completion entry (`label`) at `position` (LSP 0-based) to detail + docs. */
  getCompletionDetails(
    path: string,
    position: Position,
    label: string,
    source?: string,
    data?: unknown,
    options?: CompletionDetailsOptions,
  ): Promise<CompletionItem | null>;
  /** Find-references for the symbol at `position` (LSP 0-based); `context` gates the declaration. */
  getReferences(
    path: string,
    position: Position,
    context: ReferenceContext,
  ): Promise<readonly Location[]>;
  /** Find-references without definition filtering, mirroring TS's flat helper. */
  getReferencesAtPosition(path: string, position: Position): Promise<readonly Location[]>;
  /** Prepare-rename probe at `position` (LSP 0-based); `null` when the element can't be renamed. */
  prepareRename(
    path: string,
    position: Position,
    options?: RenameOptions,
  ): Promise<PrepareRenameResult | null>;
  /** Rename edits for the symbol at `position` (LSP 0-based) → `newName` (empty `changes` if none). */
  getRenameEdits(
    path: string,
    position: Position,
    newName: string,
    options?: RenameOptions,
  ): Promise<WorkspaceEdit>;
  /** Signature help at `position` (LSP 0-based); `null` when not inside a call. */
  getSignatureHelp(
    path: string,
    position: Position,
    options?: SignatureHelpOptions,
  ): Promise<SignatureHelp | null>;
  getNameOrDottedNameSpan(path: string, range: Range): Promise<Range | null>;
  getBreakpointStatement(path: string, position: Position): Promise<Range | null>;
  /**
   * Quick-fixes for the diagnostics `errorCodes` intersecting `range` (LSP 0-based)
   * in `path`. tsc only returns a fix when the request span lies WITHIN the
   * diagnostic span, so a caller passes a diagnostic's own range + that
   * diagnostic's `code`s (empty `errorCodes` → no fixes).
   */
  getCodeFixes(
    path: string,
    range: Range,
    errorCodes: number[],
    options?: CodeFixOptions,
  ): Promise<readonly CodeAction[]>;
  /** Organize-imports for `path` → a `WorkspaceEdit` (empty `changes` if already organized). */
  organizeImports(path: string, options?: OrganizeImportsOptions): Promise<WorkspaceEdit>;
  /** Whole-document format edits for `path` with editor `options`. */
  getFormattingEdits(path: string, options: FormattingOptions): Promise<readonly TextEdit[]>;
  /** Range-format edits for `range` (LSP 0-based) in `path` with editor `options`. */
  getRangeFormattingEdits(
    path: string,
    range: Range,
    options: FormattingOptions,
  ): Promise<readonly TextEdit[]>;
  getSuggestionDiagnostics(path: string): Promise<readonly Diagnostic[]>;
  getCompilerOptionsDiagnostics(): Promise<readonly Diagnostic[]>;
  getImplementation(path: string, position: Position): Promise<readonly Location[]>;
  getDefinitionLinks(path: string, position: Position): Promise<DefinitionLinks>;
  getDocumentSymbols(path: string): Promise<readonly DocumentSymbol[]>;
  getNavigationBarItems(path: string): Promise<readonly NavigationBarItem[]>;
  getFoldingRanges(path: string): Promise<readonly FoldingRange[]>;
  getWorkspaceSymbols(
    search: string,
    options?: WorkspaceSymbolOptions,
  ): Promise<readonly SymbolInformation[]>;
  getInlayHints(
    path: string,
    range: Range,
    options?: InlayHintOptions,
  ): Promise<readonly InlayHint[]>;
  getDocumentHighlights(
    path: string,
    position: Position,
    filesToSearch: readonly string[],
  ): Promise<readonly DocumentHighlight[]>;
  getSemanticClassifications(
    path: string,
    range: Range,
    format?: ClassificationFormat,
  ): Promise<readonly ClassifiedSpan[]>;
  getSyntacticClassifications(
    path: string,
    range: Range,
    format?: ClassificationFormat,
  ): Promise<readonly ClassifiedSpan[]>;
  getEncodedSemanticClassifications(path: string, range: Range): Promise<EncodedClassifications>;
  getEncodedSyntacticClassifications(path: string, range: Range): Promise<EncodedClassifications>;
  prepareCallHierarchy(path: string, position: Position): Promise<readonly CallHierarchyItem[]>;
  getIncomingCalls(path: string, position: Position): Promise<readonly CallHierarchyIncomingCall[]>;
  getOutgoingCalls(path: string, position: Position): Promise<readonly CallHierarchyOutgoingCall[]>;
  getOnTypeFormattingEdits(
    path: string,
    position: Position,
    key: string,
    options: FormattingOptions,
  ): Promise<readonly TextEdit[]>;
  getBraceMatching(path: string, position: Position): Promise<readonly Range[]>;
  getIndentation(
    path: string,
    position: Position,
    options: FormattingOptions,
  ): Promise<number | null>;
  isValidBraceCompletion(path: string, position: Position, openingBrace: string): Promise<boolean>;
  getSpanOfEnclosingComment(
    path: string,
    position: Position,
    onlyMultiLine: boolean,
  ): Promise<Range | null>;
  toLineColumnOffset(path: string, offset: number): Promise<Position | null>;
  toggleLineComment(path: string, range: Range): Promise<readonly TextEdit[]>;
  toggleMultilineComment(path: string, range: Range): Promise<readonly TextEdit[]>;
  commentSelection(path: string, range: Range): Promise<readonly TextEdit[]>;
  uncommentSelection(path: string, range: Range): Promise<readonly TextEdit[]>;
  getRefactorActions(
    path: string,
    range: Range,
    options?: RefactorOptions,
  ): Promise<readonly CodeAction[]>;
  getRefactorEdits(
    path: string,
    range: Range,
    refactorName: string,
    actionName: string,
    interactiveArguments?: { readonly targetFile: string } | undefined,
    options?: RefactorEditOptions,
  ): Promise<WorkspaceEdit | null>;
  getMoveToRefactoringFileSuggestions(
    path: string,
    range: Range,
    options?: RefactorOptions,
  ): Promise<MoveToRefactoringFileSuggestions | null>;
  getCombinedCodeFix(
    path: string,
    fixId: unknown,
    options?: CombinedCodeFixOptions,
  ): Promise<WorkspaceEdit>;
  getFileRenameEdits(
    oldPath: string,
    newPath: string,
    options?: FileRenameEditsOptions,
  ): Promise<WorkspaceEdit>;
  getEmitOutput(
    path: string,
    options?: { readonly emitOnlyDtsFiles?: boolean; readonly forceDtsEmit?: boolean },
  ): Promise<EmitOutput>;
  getSupportedCodeFixes(path?: string): Promise<readonly string[]>;
  applyCodeActionCommand(commands: readonly unknown[]): Promise<never>;
  getProgram(): Promise<never>;
  getCompletionEntrySymbol(
    path: string,
    position: Position,
    name: string,
    source: string | undefined,
  ): Promise<never>;
  getSelectionRange(path: string, position: Position): Promise<SelectionRange | null>;
  getFileReferences(path: string): Promise<readonly Location[]>;
  getJsxClosingTag(path: string, position: Position): Promise<{ readonly newText: string } | null>;
  getLinkedEditingRange(path: string, position: Position): Promise<LinkedEditingRanges | null>;
  getDocCommentTemplate(
    path: string,
    position: Position,
    options?: DocCommentTemplateOptions,
  ): Promise<TextInsertion | null>;
  getTodoComments(
    path: string,
    descriptors: readonly TodoCommentDescriptor[],
  ): Promise<readonly TodoComment[]>;
  preparePasteEditsForFile(path: string, copiedRanges: readonly Range[]): Promise<boolean>;
  getPasteEdits(
    path: string,
    pastedText: readonly string[],
    pasteLocations: readonly Range[],
    copiedFrom: { readonly file: string; readonly ranges: readonly Range[] } | undefined,
    options?: PasteEditsOptions,
  ): Promise<WorkspaceEdit>;
  /** Dispose the worker-side TS LanguageService instance. */
  disposeLanguageService(): Promise<void>;
  /** Reject every in-flight request and detach the relay listener. Idempotent. */
  dispose(): void;
}

interface Pending {
  resolve(response: TsResponse): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Build the client. `timeoutMs` arms a per-request reject (default 60s). The
 * ceiling is dominated by the COLD path: the LS endpoint serializes every frame
 * behind the first `ts:init`, which builds the whole `ts.LanguageService` +
 * fetches the ~3 MB lib.d.ts and parses tsconfig over fs.* sync-RPC — slow on a
 * constrained CI runner co-resident with the dev-server child, plus the
 * page→owner→LS relay hop. So an `open`/diagnostics frame sent right after init
 * may legitimately wait tens of seconds for the build; 15s rejected it
 * prematurely (the page never re-sends → no diagnostics). Warm requests resolve
 * in <1s, so this ceiling only bites a genuinely dropped frame — which then
 * rejects loud (Fidelity: eventual, never a silent hang).
 */
export function createTsLanguageServiceClient(
  relay: TsLspRelay,
  opts: { readonly timeoutMs?: number } = {},
): TsLanguageServiceClient {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const pending = new Map<number, Pending>();
  let torn = false;

  const unsubscribe = relay.onTsLsp((message: unknown) => {
    if (!isTsResponseMessage(message)) return;
    const { response } = message;
    const waiter = pending.get(response.id);
    if (!waiter) return; // unknown/late frame, or another client instance's
    pending.delete(response.id);
    clearTimeout(waiter.timer);
    waiter.resolve(response);
  });

  function request(build: (id: number) => TsRequest): Promise<TsResponse> {
    if (torn) return Promise.reject(new Error('ts-lsp client disposed'));
    const id = nextTsLspRequestId();
    return new Promise<TsResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`ts-lsp request ${id} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      relay.sendTsLsp({ type: TS_IPC_TYPE, request: build(id) });
    });
  }

  /** A mutation/init request: resolves on `ack`, rejects on a service error. */
  async function ack(build: (id: number) => TsRequest): Promise<void> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    // ok:true here is always kind:'ack' for mutation/init requests.
  }

  /** A diagnostics query: resolves the diagnostics array, rejects on a service error. */
  async function diagnostics(build: (id: number) => TsRequest): Promise<readonly Diagnostic[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'diagnostics') {
      throw new Error(`ts-lsp: expected diagnostics response, got kind=${response.kind}`);
    }
    return response.diagnostics;
  }

  /** A hover query: resolves the `Hover|null` payload, rejects on a service error. */
  async function hover(build: (id: number) => TsRequest): Promise<Hover | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'hover') {
      throw new Error(`ts-lsp: expected hover response, got kind=${response.kind}`);
    }
    return response.hover;
  }

  /** A definition/type-definition query: resolves the `Location[]`, rejects on a service error. */
  async function locations(build: (id: number) => TsRequest): Promise<readonly Location[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'locations') {
      throw new Error(`ts-lsp: expected locations response, got kind=${response.kind}`);
    }
    return response.locations;
  }

  /** A completion-list query: resolves the `CompletionList`, rejects on a service error. */
  async function completions(build: (id: number) => TsRequest): Promise<CompletionList> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'completions') {
      throw new Error(`ts-lsp: expected completions response, got kind=${response.kind}`);
    }
    return response.completions;
  }

  /** A completion-resolve query: resolves the `CompletionItem|null`, rejects on a service error. */
  async function completionItem(build: (id: number) => TsRequest): Promise<CompletionItem | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'completionItem') {
      throw new Error(`ts-lsp: expected completionItem response, got kind=${response.kind}`);
    }
    return response.item;
  }

  /** A prepare-rename query: resolves the `PrepareRenameResult|null`, rejects on a service error. */
  async function prepareRenameResult(
    build: (id: number) => TsRequest,
  ): Promise<PrepareRenameResult | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'prepareRename') {
      throw new Error(`ts-lsp: expected prepareRename response, got kind=${response.kind}`);
    }
    return response.result;
  }

  async function workspaceEditOrNull(
    build: (id: number) => TsRequest,
  ): Promise<WorkspaceEdit | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'workspaceEdit') {
      throw new Error(`ts-lsp: expected workspaceEdit response, got kind=${response.kind}`);
    }
    return response.edit;
  }

  /** A workspace-edit query: resolves the `WorkspaceEdit`, rejects on a service error. */
  async function workspaceEdit(build: (id: number) => TsRequest): Promise<WorkspaceEdit> {
    const edit = await workspaceEditOrNull(build);
    if (edit === null) throw new Error('ts-lsp: expected workspaceEdit response, got null edit');
    return edit;
  }

  /** A signature-help query: resolves the `SignatureHelp|null`, rejects on a service error. */
  async function signatureHelp(build: (id: number) => TsRequest): Promise<SignatureHelp | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'signatureHelp') {
      throw new Error(`ts-lsp: expected signatureHelp response, got kind=${response.kind}`);
    }
    return response.signatureHelp;
  }

  /** A code-fixes query: resolves the `CodeAction[]`, rejects on a service error. */
  async function codeActions(build: (id: number) => TsRequest): Promise<readonly CodeAction[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'codeActions') {
      throw new Error(`ts-lsp: expected codeActions response, got kind=${response.kind}`);
    }
    return response.codeActions;
  }

  /** A formatting query: resolves the `TextEdit[]`, rejects on a service error. */
  async function textEdits(build: (id: number) => TsRequest): Promise<readonly TextEdit[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'textEdits') {
      throw new Error(`ts-lsp: expected textEdits response, got kind=${response.kind}`);
    }
    return response.textEdits;
  }

  async function lspRange(build: (id: number) => TsRequest): Promise<Range | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'range') {
      throw new Error(`ts-lsp: expected range response, got kind=${response.kind}`);
    }
    return response.range;
  }

  async function lspRanges(build: (id: number) => TsRequest): Promise<readonly Range[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'ranges') {
      throw new Error(`ts-lsp: expected ranges response, got kind=${response.kind}`);
    }
    return response.ranges;
  }

  async function definitionLinks(build: (id: number) => TsRequest): Promise<DefinitionLinks> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'definitionLinks') {
      throw new Error(`ts-lsp: expected definitionLinks response, got kind=${response.kind}`);
    }
    return response.definitionLinks;
  }

  async function documentSymbols(
    build: (id: number) => TsRequest,
  ): Promise<readonly DocumentSymbol[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'documentSymbols') {
      throw new Error(`ts-lsp: expected documentSymbols response, got kind=${response.kind}`);
    }
    return response.documentSymbols;
  }

  async function navigationBarItems(
    build: (id: number) => TsRequest,
  ): Promise<readonly NavigationBarItem[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'navigationBarItems') {
      throw new Error(`ts-lsp: expected navigationBarItems response, got kind=${response.kind}`);
    }
    return response.navigationBarItems;
  }

  async function foldingRanges(build: (id: number) => TsRequest): Promise<readonly FoldingRange[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'foldingRanges') {
      throw new Error(`ts-lsp: expected foldingRanges response, got kind=${response.kind}`);
    }
    return response.foldingRanges;
  }

  async function workspaceSymbols(
    build: (id: number) => TsRequest,
  ): Promise<readonly SymbolInformation[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'workspaceSymbols') {
      throw new Error(`ts-lsp: expected workspaceSymbols response, got kind=${response.kind}`);
    }
    return response.workspaceSymbols;
  }

  async function inlayHints(build: (id: number) => TsRequest): Promise<readonly InlayHint[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'inlayHints') {
      throw new Error(`ts-lsp: expected inlayHints response, got kind=${response.kind}`);
    }
    return response.inlayHints;
  }

  async function documentHighlights(
    build: (id: number) => TsRequest,
  ): Promise<readonly DocumentHighlight[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'documentHighlights') {
      throw new Error(`ts-lsp: expected documentHighlights response, got kind=${response.kind}`);
    }
    return response.documentHighlights;
  }

  async function classifications(
    build: (id: number) => TsRequest,
  ): Promise<EncodedClassifications> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'classifications') {
      throw new Error(`ts-lsp: expected classifications response, got kind=${response.kind}`);
    }
    return response.classifications;
  }

  async function classifiedSpans(
    build: (id: number) => TsRequest,
  ): Promise<readonly ClassifiedSpan[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'classifiedSpans') {
      throw new Error(`ts-lsp: expected classifiedSpans response, got kind=${response.kind}`);
    }
    return response.spans;
  }

  async function callHierarchyItems(
    build: (id: number) => TsRequest,
  ): Promise<readonly CallHierarchyItem[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'callHierarchyItems') {
      throw new Error(`ts-lsp: expected callHierarchyItems response, got kind=${response.kind}`);
    }
    return response.items;
  }

  async function incomingCalls(
    build: (id: number) => TsRequest,
  ): Promise<readonly CallHierarchyIncomingCall[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'incomingCalls') {
      throw new Error(`ts-lsp: expected incomingCalls response, got kind=${response.kind}`);
    }
    return response.calls;
  }

  async function outgoingCalls(
    build: (id: number) => TsRequest,
  ): Promise<readonly CallHierarchyOutgoingCall[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'outgoingCalls') {
      throw new Error(`ts-lsp: expected outgoingCalls response, got kind=${response.kind}`);
    }
    return response.calls;
  }

  async function indentation(build: (id: number) => TsRequest): Promise<number | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'indentation') {
      throw new Error(`ts-lsp: expected indentation response, got kind=${response.kind}`);
    }
    return response.indentation;
  }

  async function booleanResult(build: (id: number) => TsRequest): Promise<boolean> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'boolean') {
      throw new Error(`ts-lsp: expected boolean response, got kind=${response.kind}`);
    }
    return response.value;
  }

  async function positionResult(build: (id: number) => TsRequest): Promise<Position | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'position') {
      throw new Error(`ts-lsp: expected position response, got kind=${response.kind}`);
    }
    return response.position;
  }

  async function moveToRefactoringFileSuggestions(
    build: (id: number) => TsRequest,
  ): Promise<MoveToRefactoringFileSuggestions | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'moveToRefactoringFileSuggestions') {
      throw new Error(
        `ts-lsp: expected moveToRefactoringFileSuggestions response, got kind=${response.kind}`,
      );
    }
    return response.suggestions;
  }

  async function emitOutput(build: (id: number) => TsRequest): Promise<EmitOutput> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'emitOutput') {
      throw new Error(`ts-lsp: expected emitOutput response, got kind=${response.kind}`);
    }
    return response.emitOutput;
  }

  async function supportedCodeFixes(build: (id: number) => TsRequest): Promise<readonly string[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'supportedCodeFixes') {
      throw new Error(`ts-lsp: expected supportedCodeFixes response, got kind=${response.kind}`);
    }
    return response.codeFixes;
  }

  async function selectionRange(build: (id: number) => TsRequest): Promise<SelectionRange | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'selectionRange') {
      throw new Error(`ts-lsp: expected selectionRange response, got kind=${response.kind}`);
    }
    return response.selectionRange;
  }

  async function jsxClosingTag(
    build: (id: number) => TsRequest,
  ): Promise<{ readonly newText: string } | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'jsxClosingTag') {
      throw new Error(`ts-lsp: expected jsxClosingTag response, got kind=${response.kind}`);
    }
    return response.tag;
  }

  async function linkedEditingRange(
    build: (id: number) => TsRequest,
  ): Promise<LinkedEditingRanges | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'linkedEditingRange') {
      throw new Error(`ts-lsp: expected linkedEditingRange response, got kind=${response.kind}`);
    }
    return response.linkedEditingRange;
  }

  async function textInsertion(build: (id: number) => TsRequest): Promise<TextInsertion | null> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'textInsertion') {
      throw new Error(`ts-lsp: expected textInsertion response, got kind=${response.kind}`);
    }
    return response.insertion;
  }

  async function todoComments(build: (id: number) => TsRequest): Promise<readonly TodoComment[]> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'todoComments') {
      throw new Error(`ts-lsp: expected todoComments response, got kind=${response.kind}`);
    }
    return response.todoComments;
  }

  async function preparePasteEdits(build: (id: number) => TsRequest): Promise<boolean> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    if (response.kind !== 'preparePasteEdits') {
      throw new Error(`ts-lsp: expected preparePasteEdits response, got kind=${response.kind}`);
    }
    return response.supported;
  }

  async function expectedCeiling(
    build: (id: number) => TsRequest,
    feature: string,
  ): Promise<never> {
    const response = await request(build);
    if (response.ok === false) throw errorFrom(response.error);
    throw new Error(`ts-lsp: ${feature} unexpectedly succeeded`);
  }

  return {
    init: (projectRoot) => ack((id) => ({ id, type: 'ts:init', projectRoot })),
    open: (path, text) => ack((id) => ({ id, type: 'ts:open', path, text })),
    update: (path, text) => ack((id) => ({ id, type: 'ts:update', path, text })),
    close: (path) => ack((id) => ({ id, type: 'ts:close', path })),
    invalidate: (path) => ack((id) => ({ id, type: 'ts:invalidate', path })),
    cleanupSemanticCache: () => ack((id) => ({ id, type: 'ts:cleanupSemanticCache' })),
    getSemanticDiagnostics: (path) =>
      diagnostics((id) => ({ id, type: 'ts:getSemanticDiagnostics', path })),
    getSyntacticDiagnostics: (path) =>
      diagnostics((id) => ({ id, type: 'ts:getSyntacticDiagnostics', path })),
    getConfigFileDiagnostics: () =>
      diagnostics((id) => ({ id, type: 'ts:getConfigFileDiagnostics' })),
    getQuickInfo: (path, position, options) =>
      hover((id) => ({
        id,
        type: 'ts:getQuickInfo',
        path,
        position,
        ...(options !== undefined ? { options } : {}),
      })),
    getDefinition: (path, position) =>
      locations((id) => ({ id, type: 'ts:getDefinition', path, position })),
    getTypeDefinition: (path, position) =>
      locations((id) => ({ id, type: 'ts:getTypeDefinition', path, position })),
    getCompletions: (path, position, options) =>
      completions((id) => ({
        id,
        type: 'ts:getCompletions',
        path,
        position,
        ...(options !== undefined ? { options } : {}),
      })),
    getCompletionDetails: (path, position, label, source, data, options) =>
      completionItem((id) => ({
        id,
        type: 'ts:getCompletionDetails',
        path,
        position,
        label,
        ...(source !== undefined ? { source } : {}),
        ...(data !== undefined ? { data } : {}),
        ...(options !== undefined ? { options } : {}),
      })),
    getReferences: (path, position, context) =>
      locations((id) => ({ id, type: 'ts:getReferences', path, position, context })),
    getReferencesAtPosition: (path, position) =>
      locations((id) => ({ id, type: 'ts:getReferencesAtPosition', path, position })),
    prepareRename: (path, position, options) =>
      prepareRenameResult((id) => ({
        id,
        type: 'ts:prepareRename',
        path,
        position,
        ...(options !== undefined ? { options } : {}),
      })),
    getRenameEdits: (path, position, newName, options) =>
      workspaceEdit((id) => ({
        id,
        type: 'ts:getRenameEdits',
        path,
        position,
        newName,
        ...(options !== undefined ? { options } : {}),
      })),
    getSignatureHelp: (path, position, options) =>
      signatureHelp((id) => ({
        id,
        type: 'ts:getSignatureHelp',
        path,
        position,
        ...(options !== undefined ? { options } : {}),
      })),
    getNameOrDottedNameSpan: (path, range) =>
      lspRange((id) => ({ id, type: 'ts:getNameOrDottedNameSpan', path, range })),
    getBreakpointStatement: (path, position) =>
      lspRange((id) => ({ id, type: 'ts:getBreakpointStatement', path, position })),
    getCodeFixes: (path, range, errorCodes, options) =>
      codeActions((id) => ({
        id,
        type: 'ts:getCodeFixes',
        path,
        range,
        errorCodes,
        ...(options !== undefined ? { options } : {}),
      })),
    organizeImports: (path, options) =>
      workspaceEdit((id) => ({
        id,
        type: 'ts:organizeImports',
        path,
        ...(options !== undefined ? { options } : {}),
      })),
    getFormattingEdits: (path, options) =>
      textEdits((id) => ({ id, type: 'ts:getFormattingEdits', path, options })),
    getRangeFormattingEdits: (path, range, options) =>
      textEdits((id) => ({ id, type: 'ts:getRangeFormattingEdits', path, range, options })),
    getSuggestionDiagnostics: (path) =>
      diagnostics((id) => ({ id, type: 'ts:getSuggestionDiagnostics', path })),
    getCompilerOptionsDiagnostics: () =>
      diagnostics((id) => ({ id, type: 'ts:getCompilerOptionsDiagnostics' })),
    getImplementation: (path, position) =>
      locations((id) => ({ id, type: 'ts:getImplementation', path, position })),
    getDefinitionLinks: (path, position) =>
      definitionLinks((id) => ({ id, type: 'ts:getDefinitionLinks', path, position })),
    getDocumentSymbols: (path) =>
      documentSymbols((id) => ({ id, type: 'ts:getDocumentSymbols', path })),
    getNavigationBarItems: (path) =>
      navigationBarItems((id) => ({ id, type: 'ts:getNavigationBarItems', path })),
    getFoldingRanges: (path) => foldingRanges((id) => ({ id, type: 'ts:getFoldingRanges', path })),
    getWorkspaceSymbols: (search, options) =>
      workspaceSymbols((id) => ({
        id,
        type: 'ts:getWorkspaceSymbols',
        search,
        ...(options !== undefined ? { options } : {}),
      })),
    getInlayHints: (path, range, options) =>
      inlayHints((id) => ({
        id,
        type: 'ts:getInlayHints',
        path,
        range,
        ...(options !== undefined ? { options } : {}),
      })),
    getDocumentHighlights: (path, position, filesToSearch) =>
      documentHighlights((id) => ({
        id,
        type: 'ts:getDocumentHighlights',
        path,
        position,
        filesToSearch,
      })),
    getSemanticClassifications: (path, range, format) =>
      classifiedSpans((id) => ({
        id,
        type: 'ts:getSemanticClassifications',
        path,
        range,
        ...(format !== undefined ? { format } : {}),
      })),
    getSyntacticClassifications: (path, range, format) =>
      classifiedSpans((id) => ({
        id,
        type: 'ts:getSyntacticClassifications',
        path,
        range,
        ...(format !== undefined ? { format } : {}),
      })),
    getEncodedSemanticClassifications: (path, range) =>
      classifications((id) => ({ id, type: 'ts:getEncodedSemanticClassifications', path, range })),
    getEncodedSyntacticClassifications: (path, range) =>
      classifications((id) => ({
        id,
        type: 'ts:getEncodedSyntacticClassifications',
        path,
        range,
      })),
    prepareCallHierarchy: (path, position) =>
      callHierarchyItems((id) => ({ id, type: 'ts:prepareCallHierarchy', path, position })),
    getIncomingCalls: (path, position) =>
      incomingCalls((id) => ({ id, type: 'ts:getIncomingCalls', path, position })),
    getOutgoingCalls: (path, position) =>
      outgoingCalls((id) => ({ id, type: 'ts:getOutgoingCalls', path, position })),
    getOnTypeFormattingEdits: (path, position, key, options) =>
      textEdits((id) => ({
        id,
        type: 'ts:getOnTypeFormattingEdits',
        path,
        position,
        key,
        options,
      })),
    getBraceMatching: (path, position) =>
      lspRanges((id) => ({ id, type: 'ts:getBraceMatching', path, position })),
    getIndentation: (path, position, options) =>
      indentation((id) => ({ id, type: 'ts:getIndentation', path, position, options })),
    isValidBraceCompletion: (path, position, openingBrace) =>
      booleanResult((id) => ({
        id,
        type: 'ts:isValidBraceCompletion',
        path,
        position,
        openingBrace,
      })),
    getSpanOfEnclosingComment: (path, position, onlyMultiLine) =>
      lspRange((id) => ({
        id,
        type: 'ts:getSpanOfEnclosingComment',
        path,
        position,
        onlyMultiLine,
      })),
    toLineColumnOffset: (path, offset) =>
      positionResult((id) => ({ id, type: 'ts:toLineColumnOffset', path, offset })),
    toggleLineComment: (path, range) =>
      textEdits((id) => ({ id, type: 'ts:toggleLineComment', path, range })),
    toggleMultilineComment: (path, range) =>
      textEdits((id) => ({ id, type: 'ts:toggleMultilineComment', path, range })),
    commentSelection: (path, range) =>
      textEdits((id) => ({ id, type: 'ts:commentSelection', path, range })),
    uncommentSelection: (path, range) =>
      textEdits((id) => ({ id, type: 'ts:uncommentSelection', path, range })),
    getRefactorActions: (path, range, options) =>
      codeActions((id) => ({
        id,
        type: 'ts:getRefactorActions',
        path,
        range,
        ...(options !== undefined ? { options } : {}),
      })),
    getRefactorEdits: (path, range, refactorName, actionName, interactiveArguments, options) =>
      workspaceEditOrNull((id) => ({
        id,
        type: 'ts:getRefactorEdits',
        path,
        range,
        refactorName,
        actionName,
        interactiveArguments,
        ...(options !== undefined ? { options } : {}),
      })),
    getMoveToRefactoringFileSuggestions: (path, range, options) =>
      moveToRefactoringFileSuggestions((id) => ({
        id,
        type: 'ts:getMoveToRefactoringFileSuggestions',
        path,
        range,
        ...(options !== undefined ? { options } : {}),
      })),
    getCombinedCodeFix: (path, fixId, options) =>
      workspaceEdit((id) => ({
        id,
        type: 'ts:getCombinedCodeFix',
        path,
        fixId,
        ...(options !== undefined ? { options } : {}),
      })),
    getFileRenameEdits: (oldPath, newPath, options) =>
      workspaceEdit((id) => ({
        id,
        type: 'ts:getFileRenameEdits',
        oldPath,
        newPath,
        ...(options !== undefined ? { options } : {}),
      })),
    getEmitOutput: (path, options) =>
      emitOutput((id) => ({
        id,
        type: 'ts:getEmitOutput',
        path,
        ...(options?.emitOnlyDtsFiles !== undefined
          ? { emitOnlyDtsFiles: options.emitOnlyDtsFiles }
          : {}),
        ...(options?.forceDtsEmit !== undefined ? { forceDtsEmit: options.forceDtsEmit } : {}),
      })),
    getSupportedCodeFixes: (path) =>
      supportedCodeFixes((id) => ({
        id,
        type: 'ts:getSupportedCodeFixes',
        ...(path !== undefined ? { path } : {}),
      })),
    applyCodeActionCommand: async (commands) => {
      const response = await request((id) => ({
        id,
        type: 'ts:applyCodeActionCommand',
        commands,
      }));
      if (response.ok === false) throw errorFrom(response.error);
      throw new Error('ts-lsp: applyCodeActionCommand unexpectedly succeeded');
    },
    getProgram: () => expectedCeiling((id) => ({ id, type: 'ts:getProgram' }), 'getProgram'),
    getCompletionEntrySymbol: (path, position, name, source) =>
      expectedCeiling(
        (id) => ({
          id,
          type: 'ts:getCompletionEntrySymbol',
          path,
          position,
          name,
          ...(source !== undefined ? { source } : {}),
        }),
        'getCompletionEntrySymbol',
      ),
    getSelectionRange: (path, position) =>
      selectionRange((id) => ({ id, type: 'ts:getSelectionRange', path, position })),
    getFileReferences: (path) => locations((id) => ({ id, type: 'ts:getFileReferences', path })),
    getJsxClosingTag: (path, position) =>
      jsxClosingTag((id) => ({ id, type: 'ts:getJsxClosingTag', path, position })),
    getLinkedEditingRange: (path, position) =>
      linkedEditingRange((id) => ({ id, type: 'ts:getLinkedEditingRange', path, position })),
    getDocCommentTemplate: (path, position, options) =>
      textInsertion((id) => ({
        id,
        type: 'ts:getDocCommentTemplate',
        path,
        position,
        ...(options !== undefined ? { options } : {}),
      })),
    getTodoComments: (path, descriptors) =>
      todoComments((id) => ({ id, type: 'ts:getTodoComments', path, descriptors })),
    preparePasteEditsForFile: (path, copiedRanges) =>
      preparePasteEdits((id) => ({
        id,
        type: 'ts:preparePasteEditsForFile',
        path,
        copiedRanges,
      })),
    getPasteEdits: (path, pastedText, pasteLocations, copiedFrom, options) =>
      workspaceEdit((id) => ({
        id,
        type: 'ts:getPasteEdits',
        path,
        pastedText,
        pasteLocations,
        ...(copiedFrom !== undefined ? { copiedFrom } : {}),
        ...(options !== undefined ? { options } : {}),
      })),
    disposeLanguageService: () => ack((id) => ({ id, type: 'ts:dispose' })),
    dispose() {
      if (torn) return;
      torn = true;
      unsubscribe();
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('ts-lsp client disposed'));
      }
      pending.clear();
    },
  };
}

function errorFrom(error: {
  readonly name: string;
  readonly message: string;
  readonly feature?: string;
}): Error {
  const err = new Error(error.message);
  err.name = error.name;
  if (error.feature !== undefined) {
    (err as Error & { feature?: string }).feature = error.feature;
  }
  return err;
}
