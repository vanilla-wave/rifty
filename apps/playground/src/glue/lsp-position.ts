/**
 * Monaco ↔ LSP coordinate mapping (ADR-0166 phase 2).
 *
 * The whole translation is an off-by-one on EACH coordinate:
 *  - Monaco is 1-based: `IPosition {lineNumber>=1, column>=1}`.
 *  - LSP is 0-based: `Position {line>=0, character>=0}`.
 *
 * So `lspLine = monacoLine - 1`, `lspChar = monacoColumn - 1`; inverse `+1`.
 *
 * Kept monaco-import-free (plain structural types) so it unit-tests under SSR
 * without spinning up the editor — the off-by-one is the #1 provider footgun, so
 * it lives behind a tested seam, not inlined in each provider.
 */

import type { Position, Range } from '@riftydev/ts-language-service/lsp-types';

/** Monaco-convention position (1-based line/column) — structural subset of `monaco.IPosition`. */
export interface MonacoPosition {
  readonly lineNumber: number;
  readonly column: number;
}

/** Monaco-convention range (1-based) — structural subset of `monaco.IRange`. */
export interface MonacoRange {
  readonly startLineNumber: number;
  readonly startColumn: number;
  readonly endLineNumber: number;
  readonly endColumn: number;
}

/** Monaco 1-based position → LSP 0-based position. */
export function monacoToLspPosition(p: MonacoPosition): Position {
  return { line: p.lineNumber - 1, character: p.column - 1 };
}

/** LSP 0-based position → Monaco 1-based position. */
export function lspToMonacoPosition(p: Position): MonacoPosition {
  return { lineNumber: p.line + 1, column: p.character + 1 };
}

/** LSP 0-based range → Monaco 1-based range. */
export function lspToMonacoRange(r: Range): MonacoRange {
  return {
    startLineNumber: r.start.line + 1,
    startColumn: r.start.character + 1,
    endLineNumber: r.end.line + 1,
    endColumn: r.end.character + 1,
  };
}

/** Monaco 1-based range → LSP 0-based range (inverse of {@link lspToMonacoRange}). */
export function monacoToLspRange(r: MonacoRange): Range {
  return {
    start: { line: r.startLineNumber - 1, character: r.startColumn - 1 },
    end: { line: r.endLineNumber - 1, character: r.endColumn - 1 },
  };
}
