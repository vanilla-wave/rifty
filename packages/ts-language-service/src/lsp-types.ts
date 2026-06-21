/**
 * LSP wire shapes — diagnostics subset only (this phase).
 *
 * Values match the Language Server Protocol spec exactly (the eventual transport
 * is LSP-shaped, ADR-0166): 0-based positions, severity 1..4. Other LSP shapes
 * (completions, hover, …) arrive in later phases — not modelled here (YAGNI).
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
