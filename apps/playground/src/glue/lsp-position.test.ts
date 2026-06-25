import { describe, expect, it } from 'vitest';
import {
  type MonacoPosition,
  lspToMonacoPosition,
  lspToMonacoRange,
  monacoToLspPosition,
} from './lsp-position.ts';

describe('Monaco ↔ LSP position mapping', () => {
  it('maps a Monaco position (1-based) to LSP (0-based) with a -1 on each axis', () => {
    expect(monacoToLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 });
    expect(monacoToLspPosition({ lineNumber: 4, column: 14 })).toEqual({ line: 3, character: 13 });
  });

  it('maps an LSP position (0-based) to Monaco (1-based) with a +1 on each axis', () => {
    expect(lspToMonacoPosition({ line: 0, character: 0 })).toEqual({ lineNumber: 1, column: 1 });
    expect(lspToMonacoPosition({ line: 3, character: 13 })).toEqual({ lineNumber: 4, column: 14 });
  });

  it('round-trips Monaco → LSP → Monaco', () => {
    const cases: MonacoPosition[] = [
      { lineNumber: 1, column: 1 },
      { lineNumber: 10, column: 1 },
      { lineNumber: 7, column: 42 },
    ];
    for (const m of cases) {
      expect(lspToMonacoPosition(monacoToLspPosition(m))).toEqual(m);
    }
  });

  it('maps an LSP range (0-based half-open) to a Monaco range (1-based)', () => {
    expect(
      lspToMonacoRange({ start: { line: 2, character: 4 }, end: { line: 2, character: 7 } }),
    ).toEqual({ startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 8 });
  });
});
