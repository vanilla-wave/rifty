/**
 * Worker protocol for the TS language service (ADR-0166). A
 * discriminated-union request/response frame set carried over kernel control
 * (page ⇄ serve-worker), modelled on
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
  TextEdit,
  TextInsertion,
  TodoComment,
  TodoCommentDescriptor,
  WorkspaceEdit,
  WorkspaceSymbolOptions,
} from '../lsp-types.ts';

/** Request frame discriminators. */
export type TsRequestType =
  | 'ts:init'
  | 'ts:open'
  | 'ts:update'
  | 'ts:close'
  | 'ts:invalidate'
  | 'ts:cleanupSemanticCache'
  | 'ts:getSemanticDiagnostics'
  | 'ts:getSyntacticDiagnostics'
  | 'ts:getConfigFileDiagnostics'
  | 'ts:getQuickInfo'
  | 'ts:getDefinition'
  | 'ts:getTypeDefinition'
  | 'ts:getCompletions'
  | 'ts:getCompletionDetails'
  | 'ts:getReferences'
  | 'ts:getReferencesAtPosition'
  | 'ts:prepareRename'
  | 'ts:getRenameEdits'
  | 'ts:getSignatureHelp'
  | 'ts:getNameOrDottedNameSpan'
  | 'ts:getBreakpointStatement'
  | 'ts:getCodeFixes'
  | 'ts:organizeImports'
  | 'ts:getFormattingEdits'
  | 'ts:getRangeFormattingEdits'
  | 'ts:getSuggestionDiagnostics'
  | 'ts:getCompilerOptionsDiagnostics'
  | 'ts:getImplementation'
  | 'ts:getDefinitionLinks'
  | 'ts:getDocumentSymbols'
  | 'ts:getNavigationBarItems'
  | 'ts:getFoldingRanges'
  | 'ts:getWorkspaceSymbols'
  | 'ts:getInlayHints'
  | 'ts:getDocumentHighlights'
  | 'ts:getSemanticClassifications'
  | 'ts:getSyntacticClassifications'
  | 'ts:getEncodedSemanticClassifications'
  | 'ts:getEncodedSyntacticClassifications'
  | 'ts:prepareCallHierarchy'
  | 'ts:getIncomingCalls'
  | 'ts:getOutgoingCalls'
  | 'ts:getOnTypeFormattingEdits'
  | 'ts:getBraceMatching'
  | 'ts:getIndentation'
  | 'ts:isValidBraceCompletion'
  | 'ts:getSpanOfEnclosingComment'
  | 'ts:toLineColumnOffset'
  | 'ts:toggleLineComment'
  | 'ts:toggleMultilineComment'
  | 'ts:commentSelection'
  | 'ts:uncommentSelection'
  | 'ts:getRefactorActions'
  | 'ts:getRefactorEdits'
  | 'ts:getMoveToRefactoringFileSuggestions'
  | 'ts:getCombinedCodeFix'
  | 'ts:getFileRenameEdits'
  | 'ts:getEmitOutput'
  | 'ts:getSupportedCodeFixes'
  | 'ts:applyCodeActionCommand'
  | 'ts:getProgram'
  | 'ts:getCompletionEntrySymbol'
  | 'ts:getSelectionRange'
  | 'ts:getFileReferences'
  | 'ts:getJsxClosingTag'
  | 'ts:getLinkedEditingRange'
  | 'ts:getDocCommentTemplate'
  | 'ts:getTodoComments'
  | 'ts:preparePasteEditsForFile'
  | 'ts:getPasteEdits'
  | 'ts:dispose';

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
export interface TsCleanupSemanticCacheRequest extends BaseRequest {
  readonly type: 'ts:cleanupSemanticCache';
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
  readonly options?: QuickInfoOptions;
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
  readonly options?: CompletionOptions;
}
/** Resolve one completion entry (`label`) at `position` in `path`. */
export interface TsCompletionDetailsRequest extends BaseRequest {
  readonly type: 'ts:getCompletionDetails';
  readonly path: string;
  readonly position: Position;
  readonly label: string;
  readonly source?: string;
  readonly data?: unknown;
  readonly options?: CompletionDetailsOptions;
}
/** Find-references at `position` in `path` (honors `context.includeDeclaration`). */
export interface TsReferencesRequest extends BaseRequest {
  readonly type: 'ts:getReferences';
  readonly path: string;
  readonly position: Position;
  readonly context: ReferenceContext;
}
export interface TsReferencesAtPositionRequest extends BaseRequest {
  readonly type: 'ts:getReferencesAtPosition';
  readonly path: string;
  readonly position: Position;
}
/** Prepare-rename probe at `position` in `path`. */
export interface TsPrepareRenameRequest extends BaseRequest {
  readonly type: 'ts:prepareRename';
  readonly path: string;
  readonly position: Position;
  readonly options?: RenameOptions;
}
/** Compute rename edits for the symbol at `position` in `path` → `newName`. */
export interface TsRenameEditsRequest extends BaseRequest {
  readonly type: 'ts:getRenameEdits';
  readonly path: string;
  readonly position: Position;
  readonly newName: string;
  readonly options?: RenameOptions;
}
/** Signature help at `position` in `path`. */
export interface TsSignatureHelpRequest extends BaseRequest {
  readonly type: 'ts:getSignatureHelp';
  readonly path: string;
  readonly position: Position;
  readonly options?: SignatureHelpOptions;
}
export interface TsNameOrDottedNameSpanRequest extends BaseRequest {
  readonly type: 'ts:getNameOrDottedNameSpan';
  readonly path: string;
  readonly range: Range;
}
export interface TsBreakpointStatementRequest extends BaseRequest {
  readonly type: 'ts:getBreakpointStatement';
  readonly path: string;
  readonly position: Position;
}
/** Quick-fixes intersecting `range` in `path` for the diagnostics `errorCodes`. */
export interface TsCodeFixesRequest extends BaseRequest {
  readonly type: 'ts:getCodeFixes';
  readonly path: string;
  readonly range: Range;
  readonly errorCodes: number[];
  readonly options?: CodeFixOptions;
}
/** Organize-imports for `path`. */
export interface TsOrganizeImportsRequest extends BaseRequest {
  readonly type: 'ts:organizeImports';
  readonly path: string;
  readonly options?: OrganizeImportsOptions;
}
/** Whole-document format for `path` with editor `options`. */
export interface TsFormattingEditsRequest extends BaseRequest {
  readonly type: 'ts:getFormattingEdits';
  readonly path: string;
  readonly options: FormattingOptions;
}
/** Range format for `[start,end)` `range` in `path` with editor `options`. */
export interface TsRangeFormattingEditsRequest extends BaseRequest {
  readonly type: 'ts:getRangeFormattingEdits';
  readonly path: string;
  readonly range: Range;
  readonly options: FormattingOptions;
}
export interface TsSuggestionDiagnosticsRequest extends BaseRequest {
  readonly type: 'ts:getSuggestionDiagnostics';
  readonly path: string;
}
export interface TsCompilerOptionsDiagnosticsRequest extends BaseRequest {
  readonly type: 'ts:getCompilerOptionsDiagnostics';
}
export interface TsImplementationRequest extends BaseRequest {
  readonly type: 'ts:getImplementation';
  readonly path: string;
  readonly position: Position;
}
export interface TsDefinitionLinksRequest extends BaseRequest {
  readonly type: 'ts:getDefinitionLinks';
  readonly path: string;
  readonly position: Position;
}
export interface TsDocumentSymbolsRequest extends BaseRequest {
  readonly type: 'ts:getDocumentSymbols';
  readonly path: string;
}
export interface TsNavigationBarItemsRequest extends BaseRequest {
  readonly type: 'ts:getNavigationBarItems';
  readonly path: string;
}
export interface TsFoldingRangesRequest extends BaseRequest {
  readonly type: 'ts:getFoldingRanges';
  readonly path: string;
}
export interface TsWorkspaceSymbolsRequest extends BaseRequest {
  readonly type: 'ts:getWorkspaceSymbols';
  readonly search: string;
  readonly options?: WorkspaceSymbolOptions;
}
export interface TsInlayHintsRequest extends BaseRequest {
  readonly type: 'ts:getInlayHints';
  readonly path: string;
  readonly range: Range;
  readonly options?: InlayHintOptions;
}
export interface TsDocumentHighlightsRequest extends BaseRequest {
  readonly type: 'ts:getDocumentHighlights';
  readonly path: string;
  readonly position: Position;
  readonly filesToSearch: readonly string[];
}
export interface TsClassificationsRequest extends BaseRequest {
  readonly type: 'ts:getSemanticClassifications' | 'ts:getSyntacticClassifications';
  readonly path: string;
  readonly range: Range;
  readonly format?: ClassificationFormat;
}
export interface TsEncodedClassificationsRequest extends BaseRequest {
  readonly type: 'ts:getEncodedSemanticClassifications' | 'ts:getEncodedSyntacticClassifications';
  readonly path: string;
  readonly range: Range;
}
export interface TsCallHierarchyRequest extends BaseRequest {
  readonly type: 'ts:prepareCallHierarchy' | 'ts:getIncomingCalls' | 'ts:getOutgoingCalls';
  readonly path: string;
  readonly position: Position;
}
export interface TsOnTypeFormattingEditsRequest extends BaseRequest {
  readonly type: 'ts:getOnTypeFormattingEdits';
  readonly path: string;
  readonly position: Position;
  readonly key: string;
  readonly options: FormattingOptions;
}
export interface TsBraceMatchingRequest extends BaseRequest {
  readonly type: 'ts:getBraceMatching';
  readonly path: string;
  readonly position: Position;
}
export interface TsIndentationRequest extends BaseRequest {
  readonly type: 'ts:getIndentation';
  readonly path: string;
  readonly position: Position;
  readonly options: FormattingOptions;
}
export interface TsValidBraceCompletionRequest extends BaseRequest {
  readonly type: 'ts:isValidBraceCompletion';
  readonly path: string;
  readonly position: Position;
  readonly openingBrace: string;
}
export interface TsSpanOfEnclosingCommentRequest extends BaseRequest {
  readonly type: 'ts:getSpanOfEnclosingComment';
  readonly path: string;
  readonly position: Position;
  readonly onlyMultiLine: boolean;
}
export interface TsLineColumnOffsetRequest extends BaseRequest {
  readonly type: 'ts:toLineColumnOffset';
  readonly path: string;
  readonly offset: number;
}
export interface TsCommentEditsRequest extends BaseRequest {
  readonly type:
    | 'ts:toggleLineComment'
    | 'ts:toggleMultilineComment'
    | 'ts:commentSelection'
    | 'ts:uncommentSelection';
  readonly path: string;
  readonly range: Range;
}
export interface TsRefactorActionsRequest extends BaseRequest {
  readonly type: 'ts:getRefactorActions';
  readonly path: string;
  readonly range: Range;
  readonly options?: RefactorOptions;
}
export interface TsRefactorEditsRequest extends BaseRequest {
  readonly type: 'ts:getRefactorEdits';
  readonly path: string;
  readonly range: Range;
  readonly refactorName: string;
  readonly actionName: string;
  readonly interactiveArguments?: { readonly targetFile: string } | undefined;
  readonly options?: RefactorEditOptions;
}
export interface TsMoveToRefactoringFileSuggestionsRequest extends BaseRequest {
  readonly type: 'ts:getMoveToRefactoringFileSuggestions';
  readonly path: string;
  readonly range: Range;
  readonly options?: RefactorOptions;
}
export interface TsCombinedCodeFixRequest extends BaseRequest {
  readonly type: 'ts:getCombinedCodeFix';
  readonly path: string;
  readonly fixId: unknown;
  readonly options?: CombinedCodeFixOptions;
}
export interface TsFileRenameEditsRequest extends BaseRequest {
  readonly type: 'ts:getFileRenameEdits';
  readonly oldPath: string;
  readonly newPath: string;
  readonly options?: FileRenameEditsOptions;
}
export interface TsEmitOutputRequest extends BaseRequest {
  readonly type: 'ts:getEmitOutput';
  readonly path: string;
  readonly emitOnlyDtsFiles?: boolean;
  readonly forceDtsEmit?: boolean;
}
export interface TsSupportedCodeFixesRequest extends BaseRequest {
  readonly type: 'ts:getSupportedCodeFixes';
  readonly path?: string;
}
export interface TsApplyCodeActionCommandRequest extends BaseRequest {
  readonly type: 'ts:applyCodeActionCommand';
  readonly commands: readonly unknown[];
}
export interface TsGetProgramRequest extends BaseRequest {
  readonly type: 'ts:getProgram';
}
export interface TsCompletionEntrySymbolRequest extends BaseRequest {
  readonly type: 'ts:getCompletionEntrySymbol';
  readonly path: string;
  readonly position: Position;
  readonly name: string;
  readonly source?: string;
}
export interface TsSelectionRangeRequest extends BaseRequest {
  readonly type: 'ts:getSelectionRange';
  readonly path: string;
  readonly position: Position;
}
export interface TsFileReferencesRequest extends BaseRequest {
  readonly type: 'ts:getFileReferences';
  readonly path: string;
}
export interface TsJsxClosingTagRequest extends BaseRequest {
  readonly type: 'ts:getJsxClosingTag';
  readonly path: string;
  readonly position: Position;
}
export interface TsLinkedEditingRangeRequest extends BaseRequest {
  readonly type: 'ts:getLinkedEditingRange';
  readonly path: string;
  readonly position: Position;
}
export interface TsDocCommentTemplateRequest extends BaseRequest {
  readonly type: 'ts:getDocCommentTemplate';
  readonly path: string;
  readonly position: Position;
  readonly options?: DocCommentTemplateOptions;
}
export interface TsTodoCommentsRequest extends BaseRequest {
  readonly type: 'ts:getTodoComments';
  readonly path: string;
  readonly descriptors: readonly TodoCommentDescriptor[];
}
export interface TsPreparePasteEditsRequest extends BaseRequest {
  readonly type: 'ts:preparePasteEditsForFile';
  readonly path: string;
  readonly copiedRanges: readonly Range[];
}
export interface TsPasteEditsRequest extends BaseRequest {
  readonly type: 'ts:getPasteEdits';
  readonly path: string;
  readonly pastedText: readonly string[];
  readonly pasteLocations: readonly Range[];
  readonly copiedFrom?:
    | {
        readonly file: string;
        readonly ranges: readonly Range[];
      }
    | undefined;
  readonly options?: PasteEditsOptions;
}
export interface TsDisposeRequest extends BaseRequest {
  readonly type: 'ts:dispose';
}

export type TsRequest =
  | TsInitRequest
  | TsOpenRequest
  | TsUpdateRequest
  | TsCloseRequest
  | TsInvalidateRequest
  | TsCleanupSemanticCacheRequest
  | TsSemanticRequest
  | TsSyntacticRequest
  | TsConfigDiagnosticsRequest
  | TsQuickInfoRequest
  | TsDefinitionRequest
  | TsTypeDefinitionRequest
  | TsCompletionsRequest
  | TsCompletionDetailsRequest
  | TsReferencesRequest
  | TsReferencesAtPositionRequest
  | TsPrepareRenameRequest
  | TsRenameEditsRequest
  | TsSignatureHelpRequest
  | TsNameOrDottedNameSpanRequest
  | TsBreakpointStatementRequest
  | TsCodeFixesRequest
  | TsOrganizeImportsRequest
  | TsFormattingEditsRequest
  | TsRangeFormattingEditsRequest
  | TsSuggestionDiagnosticsRequest
  | TsCompilerOptionsDiagnosticsRequest
  | TsImplementationRequest
  | TsDefinitionLinksRequest
  | TsDocumentSymbolsRequest
  | TsNavigationBarItemsRequest
  | TsFoldingRangesRequest
  | TsWorkspaceSymbolsRequest
  | TsInlayHintsRequest
  | TsDocumentHighlightsRequest
  | TsClassificationsRequest
  | TsEncodedClassificationsRequest
  | TsCallHierarchyRequest
  | TsOnTypeFormattingEditsRequest
  | TsBraceMatchingRequest
  | TsIndentationRequest
  | TsValidBraceCompletionRequest
  | TsSpanOfEnclosingCommentRequest
  | TsLineColumnOffsetRequest
  | TsCommentEditsRequest
  | TsRefactorActionsRequest
  | TsRefactorEditsRequest
  | TsMoveToRefactoringFileSuggestionsRequest
  | TsCombinedCodeFixRequest
  | TsFileRenameEditsRequest
  | TsEmitOutputRequest
  | TsSupportedCodeFixesRequest
  | TsApplyCodeActionCommandRequest
  | TsGetProgramRequest
  | TsCompletionEntrySymbolRequest
  | TsSelectionRangeRequest
  | TsFileReferencesRequest
  | TsJsxClosingTagRequest
  | TsLinkedEditingRangeRequest
  | TsDocCommentTemplateRequest
  | TsTodoCommentsRequest
  | TsPreparePasteEditsRequest
  | TsPasteEditsRequest
  | TsDisposeRequest;

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
/** Prepare-rename payload for `ts:prepareRename` (`null` when not renameable). */
export interface TsPrepareRenameResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'prepareRename';
  readonly result: PrepareRenameResult | null;
}
/** Workspace-edit payload; `edit: null` is valid for unavailable refactor edits. */
export interface TsWorkspaceEditResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'workspaceEdit';
  readonly edit: WorkspaceEdit | null;
}
/** Signature-help payload for `ts:getSignatureHelp` (`null` when no call context). */
export interface TsSignatureHelpResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'signatureHelp';
  readonly signatureHelp: SignatureHelp | null;
}
/** Code-action payload for `ts:getCodeFixes` (empty when nothing fixable). */
export interface TsCodeActionsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'codeActions';
  readonly codeActions: readonly CodeAction[];
}
/** Text-edit payload for `ts:getFormattingEdits` / `ts:getRangeFormattingEdits`. */
export interface TsTextEditsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'textEdits';
  readonly textEdits: readonly TextEdit[];
}
export interface TsRangeResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'range';
  readonly range: Range | null;
}
export interface TsRangesResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'ranges';
  readonly ranges: readonly Range[];
}
export interface TsDefinitionLinksResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'definitionLinks';
  readonly definitionLinks: DefinitionLinks;
}
export interface TsDocumentSymbolsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'documentSymbols';
  readonly documentSymbols: readonly DocumentSymbol[];
}
export interface TsNavigationBarItemsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'navigationBarItems';
  readonly navigationBarItems: readonly NavigationBarItem[];
}
export interface TsFoldingRangesResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'foldingRanges';
  readonly foldingRanges: readonly FoldingRange[];
}
export interface TsWorkspaceSymbolsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'workspaceSymbols';
  readonly workspaceSymbols: readonly import('../lsp-types.ts').SymbolInformation[];
}
export interface TsInlayHintsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'inlayHints';
  readonly inlayHints: readonly InlayHint[];
}
export interface TsDocumentHighlightsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'documentHighlights';
  readonly documentHighlights: readonly DocumentHighlight[];
}
export interface TsClassificationsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'classifications';
  readonly classifications: EncodedClassifications;
}
export interface TsClassifiedSpansResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'classifiedSpans';
  readonly spans: readonly ClassifiedSpan[];
}
export interface TsCallHierarchyItemsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'callHierarchyItems';
  readonly items: readonly CallHierarchyItem[];
}
export interface TsIncomingCallsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'incomingCalls';
  readonly calls: readonly CallHierarchyIncomingCall[];
}
export interface TsOutgoingCallsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'outgoingCalls';
  readonly calls: readonly CallHierarchyOutgoingCall[];
}
export interface TsIndentationResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'indentation';
  readonly indentation: number | null;
}
export interface TsBooleanResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'boolean';
  readonly value: boolean;
}
export interface TsPositionResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'position';
  readonly position: Position | null;
}
export interface TsMoveToRefactoringFileSuggestionsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'moveToRefactoringFileSuggestions';
  readonly suggestions: MoveToRefactoringFileSuggestions | null;
}
export interface TsEmitOutputResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'emitOutput';
  readonly emitOutput: EmitOutput;
}
export interface TsSupportedCodeFixesResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'supportedCodeFixes';
  readonly codeFixes: readonly string[];
}
export interface TsSelectionRangeResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'selectionRange';
  readonly selectionRange: SelectionRange | null;
}
export interface TsJsxClosingTagResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'jsxClosingTag';
  readonly tag: { readonly newText: string } | null;
}
export interface TsLinkedEditingRangeResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'linkedEditingRange';
  readonly linkedEditingRange: LinkedEditingRanges | null;
}
export interface TsTextInsertionResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'textInsertion';
  readonly insertion: TextInsertion | null;
}
export interface TsTodoCommentsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'todoComments';
  readonly todoComments: readonly TodoComment[];
}
export interface TsPreparePasteEditsResponse {
  readonly id: number;
  readonly ok: true;
  readonly kind: 'preparePasteEdits';
  readonly supported: boolean;
}
/** Failure response — a thrown error surfaced to the caller (never swallowed). */
export interface TsErrorResponse {
  readonly id: number;
  readonly ok: false;
  readonly kind: 'error';
  readonly error: { readonly name: string; readonly message: string; readonly feature?: string };
}

export type TsResponse =
  | TsAckResponse
  | TsDiagnosticsResponse
  | TsHoverResponse
  | TsLocationsResponse
  | TsCompletionsResponse
  | TsCompletionItemResponse
  | TsPrepareRenameResponse
  | TsWorkspaceEditResponse
  | TsSignatureHelpResponse
  | TsCodeActionsResponse
  | TsTextEditsResponse
  | TsRangeResponse
  | TsRangesResponse
  | TsDefinitionLinksResponse
  | TsDocumentSymbolsResponse
  | TsNavigationBarItemsResponse
  | TsFoldingRangesResponse
  | TsWorkspaceSymbolsResponse
  | TsInlayHintsResponse
  | TsDocumentHighlightsResponse
  | TsClassificationsResponse
  | TsClassifiedSpansResponse
  | TsCallHierarchyItemsResponse
  | TsIncomingCallsResponse
  | TsOutgoingCallsResponse
  | TsIndentationResponse
  | TsBooleanResponse
  | TsPositionResponse
  | TsMoveToRefactoringFileSuggestionsResponse
  | TsEmitOutputResponse
  | TsSupportedCodeFixesResponse
  | TsSelectionRangeResponse
  | TsJsxClosingTagResponse
  | TsLinkedEditingRangeResponse
  | TsTextInsertionResponse
  | TsTodoCommentsResponse
  | TsPreparePasteEditsResponse
  | TsErrorResponse;

/** Kernel-control envelope discriminator (beside `rifty:vfs-write`/`rifty:pty`). */
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
