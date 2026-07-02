import type { Diagnostic } from '@riftydev/ts-language-service/lsp-types';
import { describe, expect, it } from 'vitest';
import { formatDiagnostics } from './diagnostics.ts';

function diag(over: Partial<Diagnostic> = {}): Diagnostic {
  return {
    range: { start: { line: 2, character: 6 }, end: { line: 2, character: 12 } },
    severity: 1,
    message: "Type 'string' is not assignable to type 'number'.",
    code: 2322,
    source: 'ts',
    ...over,
  };
}

describe('formatDiagnostics', () => {
  it('renders 1-based positions, severity and TS code — the Problems-panel data', () => {
    expect(formatDiagnostics('src/broken.ts', [diag()])).toBe(
      "error TS2322 at src/broken.ts:3:7 — Type 'string' is not assignable to type 'number'.",
    );
  });

  it('renders warnings and diagnostics without a code', () => {
    const warning = diag({ severity: 2, code: undefined, message: 'unused variable' });
    expect(formatDiagnostics('a.ts', [warning])).toBe('warning at a.ts:3:7 — unused variable');
  });

  it('says explicitly when a file is clean', () => {
    expect(formatDiagnostics('src/ok.ts', [])).toBe('no diagnostics for src/ok.ts');
  });
});
