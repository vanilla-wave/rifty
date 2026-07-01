import { DiagnosticSeverity } from '@riftydev/ts-language-service/lsp-types';
import { describe, expect, it } from 'vitest';
import { TYPESCRIPT_TEMPLATE } from '../templates/typescript.ts';
import { VITE_TEMPLATE } from '../templates/vite.ts';
import {
  TS_LS_INIT_DIAGNOSTIC_SOURCE,
  clearTsLsInitDiagnostics,
  shouldPublishTsLsInitDiagnostic,
  upsertTsLsInitDiagnostic,
} from './ts-ls-init-diagnostic.ts';

describe('ts-ls init diagnostics', () => {
  it('publishes a root-scoped Problems diagnostic for init failures', () => {
    const next = upsertTsLsInitDiagnostic(
      new Map(),
      '/scratch',
      'TypeScript is not installed in this project; run npm install -D typescript',
    );

    expect([...next.keys()]).toEqual(['/scratch/tsconfig.json']);
    expect(next.get('/scratch/tsconfig.json')).toEqual([
      {
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        severity: DiagnosticSeverity.Error,
        message: 'TypeScript is not installed in this project; run npm install -D typescript',
        source: TS_LS_INIT_DIAGNOSTIC_SOURCE,
      },
    ]);
  });

  it('replaces stale init diagnostics without dropping real TS diagnostics', () => {
    const realTsDiagnostic = {
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 3 } },
      severity: DiagnosticSeverity.Warning,
      message: 'real warning',
      source: 'ts',
    };
    const first = upsertTsLsInitDiagnostic(new Map(), '/scratch', 'old');
    first.set('/scratch/src/main.ts', [realTsDiagnostic]);

    const replaced = upsertTsLsInitDiagnostic(first, '/projects/p1', 'new');
    expect(replaced.has('/scratch/tsconfig.json')).toBe(false);
    expect(replaced.get('/scratch/src/main.ts')).toEqual([realTsDiagnostic]);
    expect(replaced.get('/projects/p1/tsconfig.json')?.[0]?.message).toBe('new');

    const cleared = clearTsLsInitDiagnostics(replaced);
    expect(cleared.get('/scratch/src/main.ts')).toEqual([realTsDiagnostic]);
    expect(cleared.has('/projects/p1/tsconfig.json')).toBe(false);
  });

  it('suppresses the expected missing-TypeScript init diagnostic for non-TS templates', () => {
    expect(
      shouldPublishTsLsInitDiagnostic(
        VITE_TEMPLATE,
        'TypeScript is not installed in this project; run npm install -D typescript',
      ),
    ).toBe(false);

    expect(
      shouldPublishTsLsInitDiagnostic(
        TYPESCRIPT_TEMPLATE,
        'TypeScript is not installed in this project; run npm install -D typescript',
      ),
    ).toBe(true);

    expect(shouldPublishTsLsInitDiagnostic(VITE_TEMPLATE, 'ts-lsp request timed out')).toBe(true);
  });
});
