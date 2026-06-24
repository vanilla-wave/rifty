/**
 * LSP wire shapes — diagnostics + hover/definition/completions (ADR-0166).
 *
 * Values match the Language Server Protocol spec exactly (the eventual transport
 * is LSP-shaped): 0-based positions, severity 1..4, `CompletionItemKind` 1..25.
 */

/** 0-based line & character (UTF-16 code units). */
export interface Position {
  readonly line: number;
  readonly character: number;
}

/** Half-open `[start, end)` text span. */
export interface Range {
  readonly start: Position;
  readonly end: Position;
}

/** LSP `DiagnosticSeverity` — wire values 1..4. */
export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface Diagnostic {
  readonly range: Range;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  /** Originating diagnostic code (the TS error number, e.g. 2322). */
  readonly code?: number;
  /** Producer tag; always `'ts'` for this service. */
  readonly source: string;
}

/** LSP `MarkupContent` — rendered docs/hover body. */
export interface MarkupContent {
  readonly kind: 'markdown' | 'plaintext';
  readonly value: string;
}

/** LSP `Hover` — quick-info at a position. */
export interface Hover {
  readonly contents: MarkupContent;
  /** The symbol's span in the queried document (from `QuickInfo.textSpan`). */
  readonly range?: Range;
}

export type CloneSafePrimitive = string | number | boolean | null;
export type CloneSafeValue =
  | CloneSafePrimitive
  | readonly CloneSafeValue[]
  | { readonly [key: string]: CloneSafeValue | undefined };

/** Structured-clone-safe subset of `ts.UserPreferences`. */
export interface TypeScriptUserPreferences {
  readonly [key: string]: CloneSafeValue | undefined;
}

/** Structured-clone-safe subset of `ts.FormatCodeSettings`. */
export interface TypeScriptFormatCodeSettings {
  readonly [key: string]: CloneSafeValue | undefined;
}

/**
 * LSP `Location`. `uri` is the VFS absolute path verbatim (e.g. `/proj/a.ts`);
 * the playground maps it to a Monaco URI later.
 */
export interface Location {
  readonly uri: string;
  readonly range: Range;
}

/**
 * LSP `CompletionItemKind` — wire values 1..25 (spec §Completion Request). The
 * service maps `ts.ScriptElementKind` onto these (see `service.ts`).
 */
export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

export interface CompletionItem {
  readonly label: string;
  readonly kind?: CompletionItemKind;
  readonly kindModifiers?: string;
  /** TS label adornments such as call signatures and import source descriptions. */
  readonly labelDetails?: {
    readonly detail?: string;
    readonly description?: string;
  };
  /** Type/signature detail (from `CompletionEntryDetails.displayParts`). */
  readonly detail?: string;
  /** Rendered JSDoc — markdown (resolved entry) or plain text. */
  readonly documentation?: string | MarkupContent;
  readonly insertText?: string;
  readonly sortText?: string;
  readonly filterText?: string;
  /** TS entry-specific replacement span; must override editor word-range guesses. */
  readonly replacementRange?: Range;
  /** TS says `insertText` is a snippet. */
  readonly isSnippet?: boolean;
  /** Entry-specific commit chars; list-level defaults apply when absent. */
  readonly commitCharacters?: readonly string[];
  /** Resolving this entry may return extra edits/code actions (auto-imports, etc.). */
  readonly hasAction?: boolean;
  /** Same-document extra edits returned by `CompletionEntryDetails.codeActions`. */
  readonly additionalTextEdits?: readonly TextEdit[];
  /** Full edit form for completion code actions, for non-editor clients. */
  readonly additionalTextEditChanges?: WorkspaceEdit;
  /** TS completion-entry source (e.g. auto-import module specifier), echoed for exact resolve. */
  readonly source?: string;
  /** Human-readable TS completion-entry source display, flattened from SymbolDisplayPart[]. */
  readonly sourceDisplay?: string;
  readonly isRecommended?: boolean;
  readonly isFromUncheckedFile?: boolean;
  readonly isPackageJsonImport?: boolean;
  readonly isImportStatementCompletion?: boolean;
  /** Opaque TS completion-entry data, structured-clone safe for the pinned compiler. */
  readonly data?: unknown;
}

export interface CompletionOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
  /** TS returns live `CompletionEntry.symbol` object graphs for this option; rifty rejects it loudly. */
  readonly includeSymbol?: boolean;
  /** @deprecated Mirrors TS `includeExternalModuleExports`; prefer `includeCompletionsForModuleExports`. */
  readonly includeExternalModuleExports?: boolean;
  readonly includeCompletionsForModuleExports?: boolean;
  readonly includeInsertTextCompletions?: boolean;
  readonly includeCompletionsWithSnippetText?: boolean;
  readonly triggerCharacter?: CompletionTriggerCharacter;
  readonly triggerKind?: CompletionTriggerKind;
}

export interface QuickInfoOptions {
  readonly maximumLength?: number;
}

export interface CompletionDetailsOptions extends CompletionOptions {}

export interface CodeFixOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
}

export interface OrganizeImportsOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
  readonly mode?: 'All' | 'SortAndCombine' | 'RemoveUnused';
  /** @deprecated Mirrors TS `OrganizeImportsArgs.skipDestructiveCodeActions`; prefer `mode`. */
  readonly skipDestructiveCodeActions?: boolean;
}

export interface CombinedCodeFixOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
}

export interface FileRenameEditsOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
}

export interface DocCommentTemplateOptions {
  readonly generateReturnInDocTemplate?: boolean;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
}

export interface PasteEditsOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
}

export type CompletionTriggerCharacter = '.' | '"' | "'" | '`' | '/' | '@' | '<' | '#' | ' ';
export type CompletionTriggerKind = 'invoked' | 'trigger-character' | 'trigger-for-incomplete';

export interface CompletionList {
  /** Continue requesting completions on subsequent keystrokes. */
  readonly isIncomplete: boolean;
  /** TS completion-list telemetry/capability flags; numeric enum, structured-clone safe. */
  readonly flags?: number;
  readonly isGlobalCompletion: boolean;
  readonly isMemberCompletion: boolean;
  readonly isNewIdentifierLocation: boolean;
  /** List-level replacement span; entry `replacementRange` wins when present. */
  readonly optionalReplacementRange?: Range;
  readonly defaultCommitCharacters?: readonly string[];
  readonly metadata?: unknown;
  readonly items: readonly CompletionItem[];
}

/** LSP `ReferenceContext` — whether find-references includes the declaration. */
export interface ReferenceContext {
  /** Include the declaration site itself among the results. */
  readonly includeDeclaration: boolean;
}

/** LSP `TextEdit` — replace `range` with `newText` (insert when range is empty). */
export interface TextEdit {
  readonly range: Range;
  readonly newText: string;
}

/**
 * LSP `WorkspaceEdit` (the `changes` form): per-document edit lists. The key is
 * the document uri — here the VFS absolute path verbatim (e.g. `/proj/a.ts`),
 * matching {@link Location.uri}.
 */
export interface WorkspaceEdit {
  readonly changes: Record<string, TextEdit[]>;
  /** File paths whose edit set creates a new file (`ts.FileTextChanges.isNewFile`). */
  readonly newFiles?: readonly string[];
  /** TS refactors may request a rename after edits are applied. */
  readonly renameLocation?: Location;
  readonly renameFilename?: string;
  readonly notApplicableReason?: string;
  /** TS code-action commands (package-install side effects) are not editor text edits. */
  readonly commands?: readonly unknown[];
  /** TS `PasteEdits.fixId`, preserved for clients that need to echo/apply paste fixes. */
  readonly fixId?: unknown;
}

/**
 * LSP `CodeAction` — a quick-fix or source-action the editor can apply. `kind`
 * is a hierarchical dotted string (LSP `CodeActionKind`): quick-fixes are
 * `'quickfix'`; organize-imports source-actions are `'source.organizeImports'`.
 * `edit` is the workspace mutation to apply. `isPreferred` marks the default fix.
 */
export interface CodeAction {
  readonly title: string;
  /** Hierarchical kind (e.g. `'quickfix'`, `'source.organizeImports'`). */
  readonly kind?: string;
  readonly edit?: WorkspaceEdit;
  /** The action editors should auto-apply / show first (LSP `isPreferred`). */
  readonly isPreferred?: boolean;
  /** Opaque TS fix id; callers echo it into `getCombinedCodeFix`. */
  readonly fixId?: unknown;
  readonly fixName?: string;
  readonly fixAllDescription?: string;
  /** Programmatic refactor ids; callers echo them into `getRefactorEdits`. */
  readonly refactorName?: string;
  readonly actionName?: string;
  /** Parent TS refactor group metadata, clone-safe and observable in TS. */
  readonly refactorDescription?: string;
  readonly refactorInlineable?: boolean;
  /** TS action-specific application range; TS line/offset is already zero-based. */
  readonly range?: Range;
  /** TS refactor action requires extra arguments such as `{ targetFile }`. */
  readonly isInteractive?: boolean;
  /** TS says the action/refactor edit cannot apply in this context. */
  readonly notApplicableReason?: string;
  /** Non-text side-effect commands TS attaches to some fixes (for example install package). */
  readonly commands?: readonly unknown[];
}

/**
 * LSP `FormattingOptions` (the subset we honor): the editor's indent settings.
 * The service derives a full `ts.FormatCodeSettings` from these + TS defaults
 * (see `formattingOptionsToFormatCodeSettings` in `mapping.ts`).
 */
export interface FormattingOptions extends TypeScriptFormatCodeSettings {
  /** Spaces (or tab-width) per indentation level. */
  readonly tabSize: number;
  /** Indent with spaces (`true`) or hard tabs (`false`). */
  readonly insertSpaces: boolean;
}

export interface RenameOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly findInStrings?: boolean;
  readonly findInComments?: boolean;
}

export type RefactorTriggerReason = 'implicit' | 'invoked';

export interface InlayHintOptions {
  readonly preferences?: TypeScriptUserPreferences;
}

export interface RefactorOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
  readonly triggerReason?: RefactorTriggerReason;
  readonly kind?: string;
  readonly includeInteractiveActions?: boolean;
}

export interface RefactorEditOptions {
  readonly preferences?: TypeScriptUserPreferences;
  readonly formattingOptions?: TypeScriptFormatCodeSettings;
}

/**
 * LSP `prepareRename` result: the span that will be renamed plus the initial
 * text to seed the rename box. `null` (at the call site) when the element at the
 * position cannot be renamed.
 */
export interface PrepareRenameResult {
  readonly range: Range;
  /** Initial rename text (the symbol's display name). */
  readonly placeholder: string;
}

/** LSP `ParameterInformation` — one parameter shown in signature help. */
export interface ParameterInformation {
  /** The parameter's display label (e.g. `a: number`). */
  readonly label: string;
  readonly documentation?: string | MarkupContent;
}

/** LSP `SignatureInformation` — one callable signature in signature help. */
export interface SignatureInformation {
  /** The full signature label (prefix + params joined + suffix). */
  readonly label: string;
  readonly documentation?: string | MarkupContent;
  readonly parameters: readonly ParameterInformation[];
}

/**
 * LSP `SignatureHelp` — the set of applicable signatures at a call site, plus
 * which signature (`activeSignature`) and which parameter (`activeParameter`)
 * are currently active.
 */
export interface SignatureHelp {
  readonly signatures: readonly SignatureInformation[];
  /** Index into `signatures` of the active overload. */
  readonly activeSignature: number;
  /** Index into the active signature's `parameters` of the active argument. */
  readonly activeParameter: number;
}

export type SignatureHelpTriggerCharacter = ',' | '(' | '<';
export type SignatureHelpRetriggerCharacter = SignatureHelpTriggerCharacter | ')';
export type SignatureHelpTriggerReason =
  | { readonly kind: 'invoked' }
  | { readonly kind: 'characterTyped'; readonly triggerCharacter: SignatureHelpTriggerCharacter }
  | { readonly kind: 'retrigger'; readonly triggerCharacter?: SignatureHelpRetriggerCharacter };

export interface SignatureHelpOptions {
  readonly triggerReason?: SignatureHelpTriggerReason;
}

/** LSP `LocationLink`, used by definition-and-bound-span. */
export interface LocationLink {
  readonly targetUri: string;
  readonly targetRange: Range;
  readonly targetSelectionRange: Range;
  readonly originSelectionRange?: Range;
}

export interface DefinitionLinks {
  readonly originSelectionRange?: Range;
  readonly locations: readonly LocationLink[];
}

/** LSP `SymbolKind` — wire values 1..26 (spec §Document Symbol). */
export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Package = 4,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  String = 15,
  Number = 16,
  Boolean = 17,
  Array = 18,
  Object = 19,
  Key = 20,
  Null = 21,
  EnumMember = 22,
  Struct = 23,
  Event = 24,
  Operator = 25,
  TypeParameter = 26,
}

export interface DocumentSymbol {
  readonly name: string;
  readonly detail?: string;
  readonly kind: SymbolKind;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly children?: readonly DocumentSymbol[];
}

export interface NavigationBarItem {
  readonly text: string;
  readonly kind: SymbolKind;
  readonly detail?: string;
  readonly ranges: readonly Range[];
  readonly childItems: readonly NavigationBarItem[];
  readonly indent: number;
  readonly bolded: boolean;
  readonly grayed: boolean;
}

export interface SymbolInformation {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly location: Location;
  readonly containerName?: string;
}

export interface FoldingRange {
  /** 0-based start line (LSP), inclusive. */
  readonly startLine: number;
  /** 0-based end line (LSP), inclusive. */
  readonly endLine: number;
  readonly kind?: 'comment' | 'imports' | 'region' | string;
}

export interface InlayHint {
  readonly position: Position;
  readonly label: string;
  readonly kind?: 'Type' | 'Parameter' | 'Enum';
  readonly paddingLeft?: boolean;
  readonly paddingRight?: boolean;
}

/** LSP `DocumentHighlightKind` — 1=text, 2=read, 3=write. */
export enum DocumentHighlightKind {
  Text = 1,
  Read = 2,
  Write = 3,
}

export interface DocumentHighlight {
  readonly range: Range;
  readonly kind?: DocumentHighlightKind;
}

/** Raw TS encoded classifications. Semantic classifications use TS 2020 token encoding. */
export interface EncodedClassifications {
  readonly spans: readonly number[];
  readonly endOfLineState: number;
}

export type ClassificationFormat = 'original' | '2020';

export interface ClassifiedSpan {
  readonly range: Range;
  readonly classificationType: string | number;
}

export interface WorkspaceSymbolOptions {
  readonly maxResultCount?: number;
  readonly fileName?: string;
  readonly excludeDtsFiles?: boolean;
  readonly excludeLibFiles?: boolean;
}

export interface CallHierarchyItem {
  readonly name: string;
  readonly kind: SymbolKind;
  readonly uri: string;
  readonly range: Range;
  readonly selectionRange: Range;
  readonly containerName?: string;
}

export interface CallHierarchyIncomingCall {
  readonly from: CallHierarchyItem;
  readonly fromRanges: readonly Range[];
}

export interface CallHierarchyOutgoingCall {
  readonly to: CallHierarchyItem;
  readonly fromRanges: readonly Range[];
}

export interface SelectionRange {
  readonly range: Range;
  readonly parent?: SelectionRange;
}

export interface LinkedEditingRanges {
  readonly ranges: readonly Range[];
  readonly wordPattern?: string;
}

export interface TextInsertion {
  readonly newText: string;
  readonly caretOffset: number;
}

export interface TodoCommentDescriptor {
  readonly text: string;
  readonly priority: number;
}

export interface TodoComment {
  readonly descriptor: TodoCommentDescriptor;
  readonly message: string;
  readonly position: Position;
}

export interface MoveToRefactoringFileSuggestions {
  readonly newFileName: string;
  readonly files: readonly string[];
}

export interface EmitOutputFile {
  readonly name: string;
  readonly writeByteOrderMark: boolean;
  readonly text: string;
}

export interface EmitOutput {
  readonly outputFiles: readonly EmitOutputFile[];
  readonly emitSkipped: boolean;
  readonly diagnostics: readonly Diagnostic[];
}
