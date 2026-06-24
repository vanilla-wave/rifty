/**
 * The public language service: a `ts.LanguageService` driven over the rifty VFS,
 * exposing diagnostics as LSP shapes (ADR-0166).
 *
 * `createTsLanguageService` is async — it awaits the std-lib load up front, then
 * builds the (synchronous) overlay + host + `ts.LanguageService`. tsconfig is
 * loaded from `projectRoot` over the VFS.
 */

import type { FsSync } from '@riftydev/vfs';
import ts from 'typescript';
import { createVfsLanguageServiceHost } from './host.ts';
import { loadTypeScriptCompilerForProject } from './lib-dts.ts';
import {
  type CallHierarchyIncomingCall,
  type CallHierarchyItem,
  type CallHierarchyOutgoingCall,
  type ClassificationFormat,
  type ClassifiedSpan,
  type CodeAction,
  type CodeFixOptions,
  type CombinedCodeFixOptions,
  type CompletionDetailsOptions,
  type CompletionItem,
  type CompletionList,
  type CompletionOptions,
  type DefinitionLinks,
  type Diagnostic,
  DiagnosticSeverity,
  type DocCommentTemplateOptions,
  type DocumentHighlight,
  type DocumentSymbol,
  type EmitOutput,
  type EncodedClassifications,
  type FileRenameEditsOptions,
  type FoldingRange,
  type FormattingOptions,
  type Hover,
  type InlayHint,
  type InlayHintOptions,
  type LinkedEditingRanges,
  type Location,
  type MoveToRefactoringFileSuggestions,
  type NavigationBarItem,
  type OrganizeImportsOptions,
  type PasteEditsOptions,
  type Position,
  type PrepareRenameResult,
  type QuickInfoOptions,
  type Range,
  type RefactorEditOptions,
  type RefactorOptions,
  type ReferenceContext,
  type RenameOptions,
  type SelectionRange,
  type SignatureHelp,
  type SignatureHelpOptions,
  type TextEdit,
  type TextInsertion,
  type TodoComment,
  type TodoCommentDescriptor,
  type TypeScriptFormatCodeSettings,
  type TypeScriptUserPreferences,
  type WorkspaceEdit,
  type WorkspaceSymbolOptions,
} from './lsp-types.ts';
import {
  callHierarchyItemToLsp,
  classificationsToLsp,
  classifiedSpanToLsp,
  completionEntryToItem,
  completionInfoToList,
  fileTextChangesToWorkspaceEdit,
  formattingOptionsToFormatCodeSettings,
  highlightSpanToDocumentHighlight,
  incomingCallToLsp,
  inlayHintToLsp,
  linkedEditingInfoToLsp,
  navigateToItemToSymbolInformation,
  navigationBarItemToLsp,
  navigationTreeToDocumentSymbol,
  outgoingCallToLsp,
  outliningSpanToFoldingRange,
  partsToString,
  quickInfoToHover,
  renameLocationToTextEdit,
  renderDocumentation,
  scriptElementKindToCompletionKind,
  selectionRangeToLsp,
  signatureHelpItemsToSignatureHelp,
  spanToRange,
  textChangesToTextEdits,
  textInsertionToLsp,
  todoCommentToLsp,
} from './mapping.ts';
import { createDocumentOverlay } from './overlay.ts';
import { offsetToPosition, positionToOffset } from './position.ts';
import { loadTsConfig } from './tsconfig.ts';

export interface CreateTsLanguageServiceDeps {
  readonly fsSync: FsSync;
  /** Project root (POSIX-absolute); tsconfig is discovered from here. */
  readonly projectRoot: string;
  /**
   * Optional phase logger (worker stdout). The cold build awaits the ~3 MB
   * std-lib over the owner relay then parses tsconfig over fs.* sync-RPC — slow
   * under contention; these lines make each phase boundary observable on CI.
   */
  readonly log?: (message: string) => void;
}

export interface TsLanguageService {
  getSemanticDiagnostics(path: string): Diagnostic[];
  getSyntacticDiagnostics(path: string): Diagnostic[];
  /**
   * Config-level diagnostics from parsing `tsconfig.json` (e.g. an unknown
   * `compilerOptions` value) — what real tsserver surfaces for a broken config.
   * Empty when the config parsed clean. A config error often has no `file`/
   * position; it then collapses to the document start (see {@link toLspDiagnostic}).
   */
  getConfigFileDiagnostics(): Diagnostic[];
  cleanupSemanticCache(): void;
  /**
   * Quick-info (hover) at `position` in `path`: the symbol signature as a
   * `typescript` code block + rendered JSDoc, with the symbol's span as `range`.
   * `null` when there is nothing to hover (no symbol/whitespace).
   */
  getQuickInfo(path: string, position: Position, options?: QuickInfoOptions): Hover | null;
  /** Go-to-definition: the declaration sites for the symbol at `position`. */
  getDefinition(path: string, position: Position): Location[];
  /** Go-to-type-definition: the declaration sites of the TYPE of the symbol. */
  getTypeDefinition(path: string, position: Position): Location[];
  /** Completion candidates at `position` (labels + kinds; details on demand). */
  getCompletions(path: string, position: Position, options?: CompletionOptions): CompletionList;
  /**
   * Resolve one completion entry (by `label`) to its full detail (signature +
   * docs). `null` when the entry is unknown at that position.
   */
  getCompletionDetails(
    path: string,
    position: Position,
    label: string,
    options?: CompletionDetailsOptions,
  ): CompletionItem | null;
  getCompletionDetails(
    path: string,
    position: Position,
    label: string,
    source: string | undefined,
    data: unknown,
    options?: CompletionDetailsOptions,
  ): CompletionItem | null;
  /**
   * Find-references for the symbol at `position`. Every occurrence (across files)
   * as a {@link Location}. When `context.includeDeclaration` is false the
   * declaration sites (`isDefinition`) are filtered out — so this needs
   * `findReferences` (which flags definitions), not the flatter
   * `getReferencesAtPosition`.
   */
  getReferences(path: string, position: Position, context: ReferenceContext): Location[];
  getReferencesAtPosition(path: string, position: Position): Location[];
  /**
   * Prepare-rename probe at `position`: the span to rename + the seed text, or
   * `null` when the element there cannot be renamed (keyword, string literal,
   * non-renameable import path). Mirrors `ls.getRenameInfo`.
   */
  prepareRename(
    path: string,
    position: Position,
    options?: RenameOptions,
  ): PrepareRenameResult | null;
  /**
   * Compute the cross-file edits to rename the symbol at `position` to `newName`.
   * Returns a {@link WorkspaceEdit} keyed by VFS path; empty `changes` when the
   * element cannot be renamed (no lying — an empty edit set, not a thrown happy
   * path). Honors tsc's prefix/suffix text (property-shorthand expansion etc.).
   */
  getRenameEdits(
    path: string,
    position: Position,
    newName: string,
    options?: RenameOptions,
  ): WorkspaceEdit;
  /**
   * Signature help at `position` (typically inside a call's argument list): the
   * applicable signatures + the active signature/parameter, or `null` when there
   * is no call context. Mirrors `ls.getSignatureHelpItems`.
   */
  getSignatureHelp(
    path: string,
    position: Position,
    options?: SignatureHelpOptions,
  ): SignatureHelp | null;
  getNameOrDottedNameSpan(path: string, range: Range): Range | null;
  getBreakpointStatement(path: string, position: Position): Range | null;
  /**
   * Quick-fixes for the diagnostics whose codes are `errorCodes`, intersecting
   * the `[start, end)` `range` in `path`. Each `ts.CodeFixAction` becomes a
   * {@link CodeAction} (`title` = the fix description, `kind` `'quickfix'`,
   * `edit` = the fix's `FileTextChanges` as a {@link WorkspaceEdit}). The caller
   * supplies `errorCodes` (typically the in-range diagnostics' `code`s); an empty
   * list yields no fixes (tsc fixes are keyed by error code). Empty array when
   * nothing is fixable — an honest empty, not a lying placeholder.
   */
  getCodeFixes(
    path: string,
    range: Range,
    errorCodes: number[],
    options?: CodeFixOptions,
  ): CodeAction[];
  /**
   * Organize-imports for `path`: sort + de-duplicate + drop unused imports, as a
   * {@link WorkspaceEdit} (tsc's own `organizeImports`). Empty `changes` when the
   * imports are already organized (a real no-op, not a fabricated edit).
   */
  organizeImports(path: string, options?: OrganizeImportsOptions): WorkspaceEdit;
  /**
   * Whole-document format for `path` → the {@link TextEdit}[] tsc would apply,
   * using a `ts.FormatCodeSettings` derived from `options` + tsserver defaults
   * (see `formattingOptionsToFormatCodeSettings`). Empty when already formatted.
   */
  getFormattingEdits(path: string, options: FormattingOptions): TextEdit[];
  /**
   * Format just the `[start, end)` `range` in `path` → the {@link TextEdit}[]
   * tsc would apply (same settings derivation as {@link getFormattingEdits}).
   */
  getRangeFormattingEdits(path: string, range: Range, options: FormattingOptions): TextEdit[];
  getSuggestionDiagnostics(path: string): Diagnostic[];
  getCompilerOptionsDiagnostics(): Diagnostic[];
  getImplementation(path: string, position: Position): Location[];
  getDefinitionLinks(path: string, position: Position): DefinitionLinks;
  getDocumentSymbols(path: string): DocumentSymbol[];
  getNavigationBarItems(path: string): NavigationBarItem[];
  getFoldingRanges(path: string): FoldingRange[];
  getWorkspaceSymbols(search: string, options?: WorkspaceSymbolOptions): SymbolInformation[];
  getInlayHints(path: string, range: Range, options?: InlayHintOptions): InlayHint[];
  getDocumentHighlights(
    path: string,
    position: Position,
    filesToSearch: readonly string[],
  ): DocumentHighlight[];
  getSemanticClassifications(
    path: string,
    range: Range,
    format?: ClassificationFormat,
  ): ClassifiedSpan[];
  getSyntacticClassifications(
    path: string,
    range: Range,
    format?: ClassificationFormat,
  ): ClassifiedSpan[];
  getEncodedSemanticClassifications(path: string, range: Range): EncodedClassifications;
  getEncodedSyntacticClassifications(path: string, range: Range): EncodedClassifications;
  prepareCallHierarchy(path: string, position: Position): CallHierarchyItem[];
  getIncomingCalls(path: string, position: Position): CallHierarchyIncomingCall[];
  getOutgoingCalls(path: string, position: Position): CallHierarchyOutgoingCall[];
  getOnTypeFormattingEdits(
    path: string,
    position: Position,
    key: string,
    options: FormattingOptions,
  ): TextEdit[];
  getBraceMatching(path: string, position: Position): Range[];
  getIndentation(path: string, position: Position, options: FormattingOptions): number | null;
  isValidBraceCompletion(path: string, position: Position, openingBrace: string): boolean;
  getSpanOfEnclosingComment(path: string, position: Position, onlyMultiLine: boolean): Range | null;
  toLineColumnOffset(path: string, offset: number): Position | null;
  toggleLineComment(path: string, range: Range): TextEdit[];
  toggleMultilineComment(path: string, range: Range): TextEdit[];
  commentSelection(path: string, range: Range): TextEdit[];
  uncommentSelection(path: string, range: Range): TextEdit[];
  getRefactorActions(path: string, range: Range, options?: RefactorOptions): CodeAction[];
  getRefactorEdits(
    path: string,
    range: Range,
    refactorName: string,
    actionName: string,
    interactiveArguments?: { readonly targetFile: string } | undefined,
    options?: RefactorEditOptions,
  ): WorkspaceEdit | null;
  getMoveToRefactoringFileSuggestions(
    path: string,
    range: Range,
    options?: RefactorOptions,
  ): MoveToRefactoringFileSuggestions | null;
  getCombinedCodeFix(path: string, fixId: unknown, options?: CombinedCodeFixOptions): WorkspaceEdit;
  getFileRenameEdits(
    oldPath: string,
    newPath: string,
    options?: FileRenameEditsOptions,
  ): WorkspaceEdit;
  getEmitOutput(
    path: string,
    options?: { readonly emitOnlyDtsFiles?: boolean; readonly forceDtsEmit?: boolean },
  ): EmitOutput;
  getSupportedCodeFixes(path?: string): readonly string[];
  applyCodeActionCommand(commands: readonly unknown[]): Promise<never>;
  getProgram(): never;
  getCompletionEntrySymbol(
    path: string,
    position: Position,
    name: string,
    source: string | undefined,
  ): never;
  getSelectionRange(path: string, position: Position): SelectionRange | null;
  getFileReferences(path: string): Location[];
  getJsxClosingTag(path: string, position: Position): { readonly newText: string } | null;
  getLinkedEditingRange(path: string, position: Position): LinkedEditingRanges | null;
  getDocCommentTemplate(
    path: string,
    position: Position,
    options?: DocCommentTemplateOptions,
  ): TextInsertion | null;
  getTodoComments(path: string, descriptors: readonly TodoCommentDescriptor[]): TodoComment[];
  preparePasteEditsForFile(path: string, copiedRanges: readonly Range[]): boolean;
  getPasteEdits(
    path: string,
    pastedText: readonly string[],
    pasteLocations: readonly Range[],
    copiedFrom: { readonly file: string; readonly ranges: readonly Range[] } | undefined,
    options?: PasteEditsOptions,
  ): WorkspaceEdit;
  openDocument(path: string, text: string): void;
  updateDocument(path: string, text: string): void;
  closeDocument(path: string): void;
  /** Signal an external VFS write so TS drops its cached copy of `path`. */
  invalidate(path: string): void;
  dispose(): void;
}

type TypeScriptApi = typeof ts;
type SymbolInformation = import('./lsp-types.ts').SymbolInformation;

class NotImplementedError extends Error {
  readonly feature: string;

  constructor(feature: string, message?: string) {
    super(message ?? `${feature} is not implemented`);
    this.name = 'NotImplementedError';
    this.feature = feature;
  }
}

function severityOf(
  category: ts.DiagnosticCategory,
  tsApi: TypeScriptApi = ts,
): DiagnosticSeverity {
  switch (category) {
    case tsApi.DiagnosticCategory.Error:
      return DiagnosticSeverity.Error;
    case tsApi.DiagnosticCategory.Warning:
      return DiagnosticSeverity.Warning;
    case tsApi.DiagnosticCategory.Suggestion:
      return DiagnosticSeverity.Hint;
    default: // Message
      return DiagnosticSeverity.Information;
  }
}

/**
 * Map a `ts.Diagnostic` to an LSP {@link Diagnostic}. Range comes from the
 * diagnostic's own source file text (`start`+`length`, 0-based via
 * {@link offsetToPosition}); a diagnostic without a file/position collapses to
 * the document start.
 */
function toLspDiagnostic(d: ts.Diagnostic, tsApi: TypeScriptApi = ts): Diagnostic {
  const text = d.file?.text ?? '';
  const start = d.start ?? 0;
  const end = start + (d.length ?? 0);
  return {
    range: {
      start: offsetToPosition(text, start),
      end: offsetToPosition(text, end),
    },
    severity: severityOf(d.category, tsApi),
    message: tsApi.flattenDiagnosticMessageText(d.messageText, '\n'),
    code: typeof d.code === 'number' ? d.code : undefined,
    source: 'ts',
  };
}

function emptyClassifications(): EncodedClassifications {
  return { spans: [], endOfLineState: 0 };
}

type CombinedCodeFixId = Parameters<ts.LanguageService['getCombinedCodeFix']>[1];

function userPreferencesToTs(
  preferences: TypeScriptUserPreferences | undefined,
): ts.UserPreferences | undefined {
  return preferences === undefined ? undefined : (preferences as unknown as ts.UserPreferences);
}

function formatCodeSettingsToTs(
  tsApi: TypeScriptApi,
  options: TypeScriptFormatCodeSettings | undefined,
): ts.FormatCodeSettings | undefined {
  if (options === undefined) return undefined;
  const withRequiredEditorDefaults: FormattingOptions = {
    ...options,
    tabSize: typeof options.tabSize === 'number' ? options.tabSize : 4,
    insertSpaces: typeof options.insertSpaces === 'boolean' ? options.insertSpaces : true,
  };
  return formattingOptionsToFormatCodeSettings(withRequiredEditorDefaults, tsApi);
}

function docCommentTemplateOptionsToTs(
  options: DocCommentTemplateOptions | undefined,
): ts.DocCommentTemplateOptions | undefined {
  if (options?.generateReturnInDocTemplate === undefined) return undefined;
  return { generateReturnInDocTemplate: options.generateReturnInDocTemplate };
}

function completionTriggerKindToTs(
  tsApi: TypeScriptApi,
  kind: CompletionOptions['triggerKind'] | undefined,
): ts.CompletionTriggerKind | undefined {
  switch (kind) {
    case 'invoked':
      return tsApi.CompletionTriggerKind.Invoked;
    case 'trigger-character':
      return tsApi.CompletionTriggerKind.TriggerCharacter;
    case 'trigger-for-incomplete':
      return tsApi.CompletionTriggerKind.TriggerForIncompleteCompletions;
    default:
      return undefined;
  }
}

function completionOptionsToTs(
  tsApi: TypeScriptApi,
  options: CompletionOptions | undefined,
): ts.GetCompletionsAtPositionOptions | undefined {
  if (options === undefined) return undefined;
  if (options.includeSymbol === true || options.preferences?.includeSymbol === true) {
    throw new NotImplementedError(
      'ts-language-service.completions.includeSymbol',
      'TypeScript CompletionEntry.symbol is a live compiler object graph and is not structured-clone-safe across the worker protocol',
    );
  }
  const triggerKind = completionTriggerKindToTs(tsApi, options.triggerKind);
  return {
    ...userPreferencesToTs(options.preferences),
    ...(options.includeExternalModuleExports !== undefined
      ? { includeExternalModuleExports: options.includeExternalModuleExports }
      : {}),
    ...(options.includeCompletionsForModuleExports !== undefined
      ? { includeCompletionsForModuleExports: options.includeCompletionsForModuleExports }
      : {}),
    ...(options.includeInsertTextCompletions !== undefined
      ? { includeInsertTextCompletions: options.includeInsertTextCompletions }
      : {}),
    ...(options.includeCompletionsWithSnippetText !== undefined
      ? { includeCompletionsWithSnippetText: options.includeCompletionsWithSnippetText }
      : {}),
    ...(options.triggerCharacter !== undefined
      ? { triggerCharacter: options.triggerCharacter as ts.CompletionsTriggerCharacter }
      : {}),
    ...(triggerKind !== undefined ? { triggerKind } : {}),
  };
}

function completionDataEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function signatureHelpOptionsToTs(
  options: SignatureHelpOptions | undefined,
): ts.SignatureHelpItemsOptions | undefined {
  return options?.triggerReason === undefined
    ? undefined
    : { triggerReason: options.triggerReason as ts.SignatureHelpTriggerReason };
}

function classificationFormatToTs(
  tsApi: TypeScriptApi,
  format: ClassificationFormat | undefined,
): ts.SemanticClassificationFormat | undefined {
  switch (format) {
    case 'original':
      return tsApi.SemanticClassificationFormat.Original;
    case '2020':
      return tsApi.SemanticClassificationFormat.TwentyTwenty;
    default:
      return undefined;
  }
}

export async function createTsLanguageService(
  deps: CreateTsLanguageServiceDeps,
): Promise<TsLanguageService> {
  const { fsSync, projectRoot, log } = deps;
  const startedAt = log ? Date.now() : 0;
  const compiler = await loadTypeScriptCompilerForProject(fsSync, projectRoot);
  const tsApi = compiler.ts;
  log?.(
    `init: ${compiler.source} typescript ${tsApi.version} loaded (+${Date.now() - startedAt}ms, ${compiler.libMap.size} lib files)`,
  );
  const parsed = loadTsConfig(fsSync, projectRoot, tsApi);
  log?.(`init: tsconfig parsed (+${Date.now() - startedAt}ms, ${parsed.fileNames.length} roots)`);
  const overlay = createDocumentOverlay();
  const serviceRef: { current?: ts.LanguageService } = {};

  const host = createVfsLanguageServiceHost({
    ts: tsApi,
    fsSync,
    projectRoot,
    compilerOptions: parsed.options,
    fileNames: parsed.fileNames,
    libMap: compiler.libMap,
    overlay,
    getProgram: () => serviceRef.current?.getProgram(),
  });
  const service = tsApi.createLanguageService(host, tsApi.createDocumentRegistry());
  serviceRef.current = service;
  log?.(`init: language service created (+${Date.now() - startedAt}ms)`);

  /**
   * Whether `path` has a SourceFile in the current program. A query/diagnostic
   * for a path the program never admitted — a `.js` file with `allowJs` off, an
   * untitled buffer, a path outside every tsconfig — makes the raw
   * `ts.LanguageService` THROW "Could not find source file". Real tsserver
   * answers nothing for such a file (it lives in no project here), so the
   * methods below gate on this and return an honest empty, never a crash. NOT a
   * lying empty: a file outside the program genuinely has no program-level
   * result. `getProgram()` is the same (cached) program the queries use.
   */
  const inProgram = (path: string): boolean =>
    service.getProgram()?.getSourceFile(path) !== undefined;

  // tsc routes config-file errors (unknown options, bad option values, bad
  // include/extends) onto the ParsedCommandLine — captured once at build, mapped
  // through the SAME LSP mapper as program diagnostics (real tsserver surfaces
  // these for a broken tsconfig).
  const configDiagnostics = parsed.errors.map((d) => toLspDiagnostic(d, tsApi));

  /**
   * Text of `path` as the program sees it (overlay buffer → std-lib → VFS) —
   * the host's own `readFile` does exactly that resolution, so definition/hover
   * spans map against the SAME bytes TS computed them from. `''` if absent (a
   * missing target collapses spans to the document start, like diagnostics).
   */
  const readText = (path: string): string => host.readFile?.(path) ?? '';

  const requireLanguageServiceMethod = (name: keyof ts.LanguageService): void => {
    const member: unknown = service[name];
    if (typeof member !== 'function') {
      throw new NotImplementedError(
        `ts-language-service.${String(name)}`,
        `Selected TypeScript LanguageService does not expose ${String(name)}`,
      );
    }
  };

  /** Map a `position` in `path` to a TS offset using the file's current text. */
  const offsetAt = (path: string, position: Position): number =>
    positionToOffset(readText(path), position);

  // Default format settings for code-fixes + organize-imports (which carry no
  // editor FormattingOptions of their own): tsserver's defaults at tabSize 4 /
  // spaces. These shape only the WHITESPACE of the emitted edits, but the parity
  // gold side MUST pass the SAME settings or the edits' indentation diverges —
  // hence the shared `formattingOptionsToFormatCodeSettings` (imported by both).
  const fmtSettings = formattingOptionsToFormatCodeSettings(
    { tabSize: 4, insertSpaces: true },
    tsApi,
  );

  /** Map ts.DefinitionInfo[] → Location[] (each target's own text → Range). */
  const toLocations = (
    defs: readonly { readonly fileName: string; readonly textSpan: ts.TextSpan }[] | undefined,
  ): Location[] =>
    (defs ?? []).map((d) => ({
      uri: d.fileName,
      range: spanToRange(readText(d.fileName), d.textSpan),
    }));

  const rangeToTextSpan = (path: string, range: Range): ts.TextSpan => {
    const text = readText(path);
    const start = positionToOffset(text, range.start);
    const end = positionToOffset(text, range.end);
    return { start, length: Math.max(0, end - start) };
  };

  const rangeToTextRange = (path: string, range: Range): ts.TextRange => {
    const span = rangeToTextSpan(path, range);
    return { pos: span.start, end: span.start + span.length };
  };

  const refactorEditToWorkspaceEdit = (edit: ts.RefactorEditInfo): WorkspaceEdit => {
    const textEdit = fileTextChangesToWorkspaceEdit(edit.edits, readText, edit.commands ?? []);
    const renameLocation =
      edit.renameFilename !== undefined && edit.renameLocation !== undefined
        ? (() => {
            const position = offsetToPosition(readText(edit.renameFilename), edit.renameLocation);
            return {
              uri: edit.renameFilename,
              range: { start: position, end: position },
            };
          })()
        : undefined;
    return {
      ...textEdit,
      ...(edit.renameFilename !== undefined ? { renameFilename: edit.renameFilename } : {}),
      ...(renameLocation !== undefined ? { renameLocation } : {}),
      ...(edit.notApplicableReason !== undefined
        ? { notApplicableReason: edit.notApplicableReason }
        : {}),
    };
  };

  return {
    getSemanticDiagnostics: (path) =>
      inProgram(path)
        ? service.getSemanticDiagnostics(path).map((d) => toLspDiagnostic(d, tsApi))
        : [],
    getSyntacticDiagnostics: (path) =>
      inProgram(path)
        ? service.getSyntacticDiagnostics(path).map((d) => toLspDiagnostic(d, tsApi))
        : [],
    getConfigFileDiagnostics: () => [...configDiagnostics],
    cleanupSemanticCache: () => service.cleanupSemanticCache(),
    getQuickInfo: (path, position, options) => {
      if (!inProgram(path)) return null;
      const info = service.getQuickInfoAtPosition(
        path,
        offsetAt(path, position),
        options?.maximumLength,
      );
      return info ? quickInfoToHover(info, readText(path)) : null;
    },
    getDefinition: (path, position) =>
      inProgram(path)
        ? toLocations(service.getDefinitionAtPosition(path, offsetAt(path, position)))
        : [],
    getTypeDefinition: (path, position) =>
      inProgram(path)
        ? toLocations(service.getTypeDefinitionAtPosition(path, offsetAt(path, position)))
        : [],
    getCompletions: (path, position, options) => {
      if (!inProgram(path))
        return {
          isIncomplete: false,
          isGlobalCompletion: false,
          isMemberCompletion: false,
          isNewIdentifierLocation: false,
          items: [],
        };
      const text = readText(path);
      const info = service.getCompletionsAtPosition(
        path,
        offsetAt(path, position),
        completionOptionsToTs(tsApi, options),
        formatCodeSettingsToTs(tsApi, options?.formattingOptions),
      );
      return completionInfoToList(info, text);
    },
    getReferencesAtPosition: (path, position) =>
      inProgram(path)
        ? toLocations(service.getReferencesAtPosition(path, offsetAt(path, position)))
        : [],
    getCompletionDetails: (
      path,
      position,
      label,
      sourceOrOptions?: string | CompletionDetailsOptions,
      data?: unknown,
      detailsOptions?: CompletionDetailsOptions,
    ) => {
      if (!inProgram(path)) return null;
      const source = typeof sourceOrOptions === 'string' ? sourceOrOptions : undefined;
      const options =
        typeof sourceOrOptions === 'object' && sourceOrOptions !== null
          ? sourceOrOptions
          : detailsOptions;
      const formatOptions =
        formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
      const preferences = userPreferencesToTs(options?.preferences);
      const offset = offsetAt(path, position);
      // Exact resolve needs the entry's source/data. New clients echo those
      // fields from the completion item; the list re-query preserves older
      // label-only callers without inventing placeholder metadata.
      const list = service.getCompletionsAtPosition(
        path,
        offset,
        completionOptionsToTs(tsApi, options),
        formatOptions,
      );
      const entry =
        source !== undefined || data !== undefined
          ? list?.entries.find(
              (e) => e.name === label && e.source === source && completionDataEquals(e.data, data),
            )
          : list?.entries.find((e) => e.name === label);
      const details = service.getCompletionEntryDetails(
        path,
        offset,
        label,
        formatOptions,
        source ?? entry?.source,
        preferences,
        (data ?? entry?.data) as ts.CompletionEntryData | undefined,
      );
      if (!details) return null;
      const documentation = renderDocumentation(details.documentation, details.tags);
      const baseItem = entry ? completionEntryToItem(entry, readText(path)) : undefined;
      const sourceDisplay = partsToString(details.sourceDisplay ?? details.source);
      const actionEdit =
        details.codeActions && details.codeActions.length > 0
          ? fileTextChangesToWorkspaceEdit(
              details.codeActions.flatMap((action) => action.changes),
              readText,
              details.codeActions.flatMap((action) => action.commands ?? []),
            )
          : undefined;
      const item: CompletionItem = {
        ...baseItem,
        label: details.name,
        kind: baseItem?.kind ?? scriptElementKindToCompletionKind(details.kind),
        kindModifiers: details.kindModifiers,
        detail: partsToString(details.displayParts),
        ...(sourceDisplay.length > 0 ? { sourceDisplay } : {}),
        ...(documentation ? { documentation: { kind: 'markdown', value: documentation } } : {}),
        ...(actionEdit &&
        (Object.keys(actionEdit.changes).length > 0 ||
          (actionEdit.commands !== undefined && actionEdit.commands.length > 0))
          ? { additionalTextEditChanges: actionEdit }
          : {}),
        ...(actionEdit?.changes[path] && actionEdit.changes[path].length > 0
          ? { additionalTextEdits: actionEdit.changes[path] }
          : {}),
      };
      return item;
    },
    getReferences: (path, position, context) => {
      if (!inProgram(path)) return [];
      // findReferences (NOT getReferencesAtPosition): the flattened entries carry
      // `isDefinition`, which is what `includeDeclaration: false` filters on. Each
      // entry's span maps against ITS OWN file's text (cross-file safe).
      const symbols = service.findReferences(path, offsetAt(path, position)) ?? [];
      const out: Location[] = [];
      for (const sym of symbols) {
        for (const ref of sym.references) {
          if (context.includeDeclaration === false && ref.isDefinition === true) continue;
          out.push({ uri: ref.fileName, range: spanToRange(readText(ref.fileName), ref.textSpan) });
        }
      }
      return out;
    },
    prepareRename: (path, position, options) => {
      if (!inProgram(path)) return null;
      const info = service.getRenameInfo(path, offsetAt(path, position), {
        allowRenameOfImportPath: false,
        ...userPreferencesToTs(options?.preferences),
      });
      if (!info.canRename) return null;
      const result: PrepareRenameResult = {
        range: spanToRange(readText(path), info.triggerSpan),
        placeholder: info.displayName,
      };
      return result;
    },
    getRenameEdits: (path, position, newName, options) => {
      if (!inProgram(path)) return { changes: {} };
      const offset = offsetAt(path, position);
      const preferences = userPreferencesToTs(options?.preferences);
      const renameInfo = service.getRenameInfo(path, offset, {
        allowRenameOfImportPath: false,
        ...preferences,
      });
      if (renameInfo.canRename && renameInfo.fileToRename !== undefined) {
        return fileTextChangesToWorkspaceEdit(
          service.getEditsForFileRename(renameInfo.fileToRename, newName, fmtSettings, preferences),
          readText,
        );
      }
      const locations =
        service.findRenameLocations(
          path,
          offset,
          options?.findInStrings ?? false,
          options?.findInComments ?? false,
          {
            providePrefixAndSuffixTextForRename: true,
            ...preferences,
          },
        ) ?? [];
      const changes: Record<string, TextEdit[]> = {};
      for (const loc of locations) {
        const edits = changes[loc.fileName] ?? [];
        edits.push(renameLocationToTextEdit(loc, newName, readText(loc.fileName)));
        changes[loc.fileName] = edits;
      }
      return { changes };
    },
    getSignatureHelp: (path, position, options) => {
      if (!inProgram(path)) return null;
      const items = service.getSignatureHelpItems(
        path,
        offsetAt(path, position),
        signatureHelpOptionsToTs(options),
      );
      return items ? signatureHelpItemsToSignatureHelp(items) : null;
    },
    getNameOrDottedNameSpan: (path, range) => {
      if (!inProgram(path)) return null;
      const span = rangeToTextRange(path, range);
      const result = service.getNameOrDottedNameSpan(path, span.pos, span.end);
      return result ? spanToRange(readText(path), result) : null;
    },
    getBreakpointStatement: (path, position) => {
      if (!inProgram(path)) return null;
      const result = service.getBreakpointStatementAtPosition(path, offsetAt(path, position));
      return result ? spanToRange(readText(path), result) : null;
    },
    getCodeFixes: (path, range, errorCodes, options) => {
      if (!inProgram(path)) return [];
      // getCodeFixesAtPosition takes a [start,end) OFFSET span; the LSP Range
      // maps through the file's current text (same bytes the program sees). The
      // shared format settings are tsc's defaults (fmt only affects the edits'
      // whitespace — but it MUST match what the parity gold side passes).
      const text = readText(path);
      const start = positionToOffset(text, range.start);
      const end = positionToOffset(text, range.end);
      const formatOptions =
        formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
      const preferences = userPreferencesToTs(options?.preferences) ?? {};
      const fixes = service.getCodeFixesAtPosition(
        path,
        start,
        end,
        errorCodes,
        formatOptions,
        preferences,
      );
      return fixes.map(
        (fix): CodeAction => ({
          title: fix.description,
          kind: 'quickfix',
          edit: fileTextChangesToWorkspaceEdit(fix.changes, readText, fix.commands),
          ...(fix.fixId !== undefined ? { fixId: fix.fixId } : {}),
          ...(fix.fixName !== undefined ? { fixName: fix.fixName } : {}),
          ...(fix.fixAllDescription !== undefined
            ? { fixAllDescription: fix.fixAllDescription }
            : {}),
          ...(fix.commands !== undefined && fix.commands.length > 0
            ? { commands: fix.commands as readonly unknown[] }
            : {}),
        }),
      );
    },
    organizeImports: (path, options) => {
      if (!inProgram(path)) return { changes: {} };
      const formatOptions =
        formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
      const scope: ts.OrganizeImportsArgs = {
        type: 'file',
        fileName: path,
        ...(options?.mode !== undefined ? { mode: options.mode as ts.OrganizeImportsMode } : {}),
        ...(options?.skipDestructiveCodeActions !== undefined
          ? { skipDestructiveCodeActions: options.skipDestructiveCodeActions }
          : {}),
      };
      const changes = service.organizeImports(
        scope,
        formatOptions,
        userPreferencesToTs(options?.preferences),
      );
      return fileTextChangesToWorkspaceEdit(changes, readText);
    },
    getFormattingEdits: (path, options) => {
      if (!inProgram(path)) return [];
      const settings = formattingOptionsToFormatCodeSettings(options, tsApi);
      const changes = service.getFormattingEditsForDocument(path, settings);
      return textChangesToTextEdits(changes, readText(path));
    },
    getRangeFormattingEdits: (path, range, options) => {
      if (!inProgram(path)) return [];
      const settings = formattingOptionsToFormatCodeSettings(options, tsApi);
      const text = readText(path);
      const start = positionToOffset(text, range.start);
      const end = positionToOffset(text, range.end);
      const changes = service.getFormattingEditsForRange(path, start, end, settings);
      return textChangesToTextEdits(changes, text);
    },
    getSuggestionDiagnostics: (path) =>
      inProgram(path)
        ? service.getSuggestionDiagnostics(path).map((d) => toLspDiagnostic(d, tsApi))
        : [],
    getCompilerOptionsDiagnostics: () =>
      service.getCompilerOptionsDiagnostics().map((d) => toLspDiagnostic(d, tsApi)),
    getImplementation: (path, position) =>
      inProgram(path)
        ? toLocations(service.getImplementationAtPosition(path, offsetAt(path, position)))
        : [],
    getDefinitionLinks: (path, position) => {
      if (!inProgram(path)) return { locations: [] };
      requireLanguageServiceMethod('getDefinitionAndBoundSpan');
      const result = service.getDefinitionAndBoundSpan(path, offsetAt(path, position));
      if (!result) return { locations: [] };
      const originSelectionRange = spanToRange(readText(path), result.textSpan);
      return {
        originSelectionRange,
        locations: (result.definitions ?? []).map((d) => {
          const targetRange = spanToRange(readText(d.fileName), d.contextSpan ?? d.textSpan);
          const targetSelectionRange = spanToRange(readText(d.fileName), d.textSpan);
          return {
            targetUri: d.fileName,
            targetRange,
            targetSelectionRange,
            originSelectionRange,
          };
        }),
      };
    },
    getDocumentSymbols: (path) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getNavigationTree');
      const tree = service.getNavigationTree(path);
      const text = readText(path);
      return (tree.childItems ?? [tree]).map((item) => navigationTreeToDocumentSymbol(item, text));
    },
    getNavigationBarItems: (path) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getNavigationBarItems');
      const text = readText(path);
      return service.getNavigationBarItems(path).map((item) => navigationBarItemToLsp(item, text));
    },
    getFoldingRanges: (path) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getOutliningSpans');
      return service
        .getOutliningSpans(path)
        .map((span) => outliningSpanToFoldingRange(span, readText(path)));
    },
    getWorkspaceSymbols: (search, options) => {
      requireLanguageServiceMethod('getNavigateToItems');
      return service
        .getNavigateToItems(
          search,
          options?.maxResultCount,
          options?.fileName,
          options?.excludeDtsFiles,
          options?.excludeLibFiles,
        )
        .map((item) => navigateToItemToSymbolInformation(item, readText));
    },
    getInlayHints: (path, range, options) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('provideInlayHints');
      return service
        .provideInlayHints(
          path,
          rangeToTextSpan(path, range),
          userPreferencesToTs(options?.preferences),
        )
        .map((hint) => inlayHintToLsp(hint, readText(path)));
    },
    getDocumentHighlights: (path, position, filesToSearch) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getDocumentHighlights');
      const docs =
        service.getDocumentHighlights(path, offsetAt(path, position), [...filesToSearch]) ?? [];
      const out: DocumentHighlight[] = [];
      for (const doc of docs) {
        const text = readText(doc.fileName);
        out.push(...doc.highlightSpans.map((span) => highlightSpanToDocumentHighlight(span, text)));
      }
      return out;
    },
    getSemanticClassifications: (path, range, format) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getSemanticClassifications');
      const textSpan = rangeToTextSpan(path, range);
      const tsFormat = classificationFormatToTs(tsApi, format);
      const spans =
        tsFormat === undefined
          ? service.getSemanticClassifications(path, textSpan)
          : service.getSemanticClassifications(path, textSpan, tsFormat);
      return spans.map((span) => classifiedSpanToLsp(span, readText(path)));
    },
    getSyntacticClassifications: (path, range, format) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getSyntacticClassifications');
      const textSpan = rangeToTextSpan(path, range);
      const tsFormat = classificationFormatToTs(tsApi, format);
      const spans =
        tsFormat === undefined
          ? service.getSyntacticClassifications(path, textSpan)
          : service.getSyntacticClassifications(path, textSpan, tsFormat);
      return spans.map((span) => classifiedSpanToLsp(span, readText(path)));
    },
    getEncodedSemanticClassifications: (path, range) => {
      if (!inProgram(path)) return emptyClassifications();
      requireLanguageServiceMethod('getEncodedSemanticClassifications');
      // TODO(backlog: toolchain-build/ts-language-service-encoded-classification-format): expose the TS encoded format knob for non-Monaco callers.
      return classificationsToLsp(
        service.getEncodedSemanticClassifications(
          path,
          rangeToTextSpan(path, range),
          tsApi.SemanticClassificationFormat.TwentyTwenty,
        ),
      );
    },
    getEncodedSyntacticClassifications: (path, range) => {
      if (!inProgram(path)) return emptyClassifications();
      requireLanguageServiceMethod('getEncodedSyntacticClassifications');
      return classificationsToLsp(
        service.getEncodedSyntacticClassifications(path, rangeToTextSpan(path, range)),
      );
    },
    prepareCallHierarchy: (path, position) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('prepareCallHierarchy');
      const result = service.prepareCallHierarchy(path, offsetAt(path, position));
      if (!result) return [];
      const items = Array.isArray(result) ? result : [result];
      return items.map((item) => callHierarchyItemToLsp(item, readText));
    },
    getIncomingCalls: (path, position) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('provideCallHierarchyIncomingCalls');
      return service
        .provideCallHierarchyIncomingCalls(path, offsetAt(path, position))
        .map((call) => incomingCallToLsp(call, readText));
    },
    getOutgoingCalls: (path, position) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('provideCallHierarchyOutgoingCalls');
      return service
        .provideCallHierarchyOutgoingCalls(path, offsetAt(path, position))
        .map((call) => outgoingCallToLsp(call, readText, path));
    },
    getOnTypeFormattingEdits: (path, position, key, options) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getFormattingEditsAfterKeystroke');
      const text = readText(path);
      const settings = formattingOptionsToFormatCodeSettings(options, tsApi);
      return textChangesToTextEdits(
        service.getFormattingEditsAfterKeystroke(
          path,
          positionToOffset(text, position),
          key,
          settings,
        ),
        text,
      );
    },
    getBraceMatching: (path, position) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getBraceMatchingAtPosition');
      return service
        .getBraceMatchingAtPosition(path, offsetAt(path, position))
        .map((span) => spanToRange(readText(path), span));
    },
    getIndentation: (path, position, options) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getIndentationAtPosition');
      return service.getIndentationAtPosition(
        path,
        offsetAt(path, position),
        formattingOptionsToFormatCodeSettings(options, tsApi),
      );
    },
    isValidBraceCompletion: (path, position, openingBrace) => {
      if (!inProgram(path)) return false;
      requireLanguageServiceMethod('isValidBraceCompletionAtPosition');
      if (openingBrace.length !== 1) {
        throw new Error('openingBrace must be exactly one UTF-16 code unit');
      }
      return service.isValidBraceCompletionAtPosition(
        path,
        offsetAt(path, position),
        openingBrace.charCodeAt(0),
      );
    },
    getSpanOfEnclosingComment: (path, position, onlyMultiLine) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getSpanOfEnclosingComment');
      const span = service.getSpanOfEnclosingComment(path, offsetAt(path, position), onlyMultiLine);
      return span ? spanToRange(readText(path), span) : null;
    },
    toLineColumnOffset: (path, offset) => {
      if (!inProgram(path)) return null;
      if (!service.toLineColumnOffset) {
        throw new NotImplementedError(
          'ts-language-service.toLineColumnOffset',
          'Selected TypeScript LanguageService does not expose toLineColumnOffset',
        );
      }
      const result = service.toLineColumnOffset(path, offset);
      return { line: result.line, character: result.character };
    },
    toggleLineComment: (path, range) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('toggleLineComment');
      return textChangesToTextEdits(
        service.toggleLineComment(path, rangeToTextRange(path, range)),
        readText(path),
      );
    },
    toggleMultilineComment: (path, range) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('toggleMultilineComment');
      return textChangesToTextEdits(
        service.toggleMultilineComment(path, rangeToTextRange(path, range)),
        readText(path),
      );
    },
    commentSelection: (path, range) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('commentSelection');
      return textChangesToTextEdits(
        service.commentSelection(path, rangeToTextRange(path, range)),
        readText(path),
      );
    },
    uncommentSelection: (path, range) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('uncommentSelection');
      return textChangesToTextEdits(
        service.uncommentSelection(path, rangeToTextRange(path, range)),
        readText(path),
      );
    },
    getRefactorActions: (path, range, options) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getApplicableRefactors');
      requireLanguageServiceMethod('getEditsForRefactor');
      const span = rangeToTextRange(path, range);
      const preferences = userPreferencesToTs(options?.preferences);
      const formatOptions =
        formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
      const refs = service.getApplicableRefactors(
        path,
        span,
        preferences,
        options?.triggerReason ?? 'invoked',
        options?.kind,
        options?.includeInteractiveActions ?? true,
      );
      const actions: CodeAction[] = [];
      for (const refactor of refs) {
        for (const action of refactor.actions) {
          const edit = action.isInteractive
            ? undefined
            : action.notApplicableReason
              ? undefined
              : service.getEditsForRefactor(
                  path,
                  formatOptions,
                  span,
                  refactor.name,
                  action.name,
                  preferences,
                );
          actions.push({
            title: action.description,
            kind: action.kind ?? 'refactor',
            refactorName: refactor.name,
            actionName: action.name,
            refactorDescription: refactor.description,
            ...(refactor.inlineable !== undefined
              ? { refactorInlineable: refactor.inlineable }
              : {}),
            ...(action.range !== undefined
              ? {
                  range: {
                    start: {
                      line: action.range.start.line - 1,
                      character: action.range.start.offset - 1,
                    },
                    end: {
                      line: action.range.end.line - 1,
                      character: action.range.end.offset - 1,
                    },
                  },
                }
              : {}),
            ...(action.isInteractive === true ? { isInteractive: true } : {}),
            ...(action.notApplicableReason !== undefined
              ? { notApplicableReason: action.notApplicableReason }
              : {}),
            ...(edit ? { edit: refactorEditToWorkspaceEdit(edit) } : {}),
          });
        }
      }
      return actions;
    },
    getRefactorEdits: (path, range, refactorName, actionName, interactiveArguments, options) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getEditsForRefactor');
      const formatOptions =
        formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
      const edit = service.getEditsForRefactor(
        path,
        formatOptions,
        rangeToTextRange(path, range),
        refactorName,
        actionName,
        userPreferencesToTs(options?.preferences),
        interactiveArguments,
      );
      return edit ? refactorEditToWorkspaceEdit(edit) : null;
    },
    getMoveToRefactoringFileSuggestions: (path, range, options) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getMoveToRefactoringFileSuggestions');
      return service.getMoveToRefactoringFileSuggestions(
        path,
        rangeToTextRange(path, range),
        userPreferencesToTs(options?.preferences),
        options?.triggerReason ?? 'invoked',
        options?.kind,
      );
    },
    getCombinedCodeFix: (path, fixId, options) =>
      inProgram(path)
        ? (() => {
            requireLanguageServiceMethod('getCombinedCodeFix');
            const formatOptions =
              formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
            const combined = service.getCombinedCodeFix(
              { type: 'file', fileName: path },
              fixId as CombinedCodeFixId,
              formatOptions,
              userPreferencesToTs(options?.preferences) ?? {},
            );
            return fileTextChangesToWorkspaceEdit(combined.changes, readText, combined.commands);
          })()
        : { changes: {} },
    getFileRenameEdits: (oldPath, newPath, options) =>
      (() => {
        requireLanguageServiceMethod('getEditsForFileRename');
        const formatOptions =
          formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
        return fileTextChangesToWorkspaceEdit(
          service.getEditsForFileRename(
            oldPath,
            newPath,
            formatOptions,
            userPreferencesToTs(options?.preferences),
          ),
          readText,
        );
      })(),
    getEmitOutput: (path, options) => {
      if (!inProgram(path)) return { emitSkipped: true, outputFiles: [], diagnostics: [] };
      requireLanguageServiceMethod('getEmitOutput');
      const output = service.getEmitOutput(path, options?.emitOnlyDtsFiles, options?.forceDtsEmit);
      return {
        emitSkipped: output.emitSkipped,
        outputFiles: output.outputFiles.map((file) => ({
          name: file.name,
          writeByteOrderMark: file.writeByteOrderMark,
          text: file.text,
        })),
        diagnostics: output.diagnostics.map((d) => toLspDiagnostic(d, tsApi)),
      };
    },
    getSupportedCodeFixes: (path) => {
      requireLanguageServiceMethod('getSupportedCodeFixes');
      return service.getSupportedCodeFixes(path);
    },
    applyCodeActionCommand: async () => {
      throw new NotImplementedError(
        'ts-language-service.applyCodeActionCommand',
        'TypeScript applyCodeActionCommand currently carries package-install side effects, not VFS text edits',
      );
    },
    getProgram: () => {
      throw new NotImplementedError(
        'ts-language-service.getProgram',
        'TypeScript getProgram returns a live compiler object graph that is not structured-clone-safe across the worker protocol',
      );
    },
    getCompletionEntrySymbol: () => {
      throw new NotImplementedError(
        'ts-language-service.getCompletionEntrySymbol',
        'TypeScript getCompletionEntrySymbol returns a live Symbol object graph that is not structured-clone-safe across the worker protocol',
      );
    },
    getSelectionRange: (path, position) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getSmartSelectionRange');
      return selectionRangeToLsp(
        service.getSmartSelectionRange(path, offsetAt(path, position)),
        readText(path),
      );
    },
    getFileReferences: (path) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getFileReferences');
      return service.getFileReferences(path).map((ref) => ({
        uri: ref.fileName,
        range: spanToRange(readText(ref.fileName), ref.textSpan),
      }));
    },
    getJsxClosingTag: (path, position) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getJsxClosingTagAtPosition');
      return service.getJsxClosingTagAtPosition(path, offsetAt(path, position)) ?? null;
    },
    getLinkedEditingRange: (path, position) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getLinkedEditingRangeAtPosition');
      const info = service.getLinkedEditingRangeAtPosition(path, offsetAt(path, position));
      return info ? linkedEditingInfoToLsp(info, readText(path)) : null;
    },
    getDocCommentTemplate: (path, position, options) => {
      if (!inProgram(path)) return null;
      requireLanguageServiceMethod('getDocCommentTemplateAtPosition');
      const formatOptions =
        formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
      const insert = service.getDocCommentTemplateAtPosition(
        path,
        offsetAt(path, position),
        docCommentTemplateOptionsToTs(options),
        formatOptions,
      );
      return insert ? textInsertionToLsp(insert) : null;
    },
    getTodoComments: (path, descriptors) => {
      if (!inProgram(path)) return [];
      requireLanguageServiceMethod('getTodoComments');
      return service
        .getTodoComments(path, [...descriptors])
        .map((comment) => todoCommentToLsp(comment, readText(path)));
    },
    preparePasteEditsForFile: (path, copiedRanges) => {
      if (!inProgram(path)) return false;
      requireLanguageServiceMethod('preparePasteEditsForFile');
      return service.preparePasteEditsForFile(
        path,
        copiedRanges.map((range) => rangeToTextRange(path, range)),
      );
    },
    getPasteEdits: (path, pastedText, pasteLocations, copiedFrom, options) => {
      if (!inProgram(path)) return { changes: {} };
      if (copiedFrom && !inProgram(copiedFrom.file)) return { changes: {} };
      requireLanguageServiceMethod('getPasteEdits');
      const formatOptions =
        formatCodeSettingsToTs(tsApi, options?.formattingOptions) ?? fmtSettings;
      const edits = service.getPasteEdits(
        {
          targetFile: path,
          pastedText: [...pastedText],
          pasteLocations: pasteLocations.map((range) => rangeToTextRange(path, range)),
          copiedFrom: copiedFrom
            ? {
                file: copiedFrom.file,
                range: copiedFrom.ranges.map((range) => rangeToTextRange(copiedFrom.file, range)),
              }
            : undefined,
          preferences: userPreferencesToTs(options?.preferences) ?? {},
        },
        formatOptions,
      );
      const edit = fileTextChangesToWorkspaceEdit(edits.edits, readText);
      return edits.fixId !== undefined ? { ...edit, fixId: edits.fixId } : edit;
    },
    openDocument: (path, text) => overlay.open(path, text),
    updateDocument: (path, text) => overlay.update(path, text),
    closeDocument: (path) => overlay.close(path),
    invalidate: (path) => {
      overlay.invalidate(path);
    },
    dispose: () => service.dispose(),
  };
}
