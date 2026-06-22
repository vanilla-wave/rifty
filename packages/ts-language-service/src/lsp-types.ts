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
  /** Type/signature detail (from `CompletionEntryDetails.displayParts`). */
  readonly detail?: string;
  /** Rendered JSDoc — markdown (resolved entry) or plain text. */
  readonly documentation?: string | MarkupContent;
  readonly insertText?: string;
  readonly sortText?: string;
  readonly filterText?: string;
}

export interface CompletionList {
  /** Continue requesting completions on subsequent keystrokes. */
  readonly isIncomplete: boolean;
  readonly items: readonly CompletionItem[];
}
