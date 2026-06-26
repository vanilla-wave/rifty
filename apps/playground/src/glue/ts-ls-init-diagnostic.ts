import { type Diagnostic, DiagnosticSeverity } from '@riftydev/ts-language-service/lsp-types';

export const TS_LS_INIT_DIAGNOSTIC_SOURCE = 'ts-lsp-init';

function diagnosticPath(projectRoot: string): string {
  const root = projectRoot.replace(/\/+$/, '') || '/';
  return root === '/' ? '/tsconfig.json' : `${root}/tsconfig.json`;
}

export function upsertTsLsInitDiagnostic(
  prev: Map<string, readonly Diagnostic[]>,
  projectRoot: string,
  message: string,
): Map<string, readonly Diagnostic[]> {
  const next = clearTsLsInitDiagnostics(prev);
  const path = diagnosticPath(projectRoot);
  const diagnostic: Diagnostic = {
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
    severity: DiagnosticSeverity.Error,
    message,
    source: TS_LS_INIT_DIAGNOSTIC_SOURCE,
  };
  next.set(path, [...(next.get(path) ?? []), diagnostic]);
  return next;
}

export function clearTsLsInitDiagnostics(
  prev: Map<string, readonly Diagnostic[]>,
): Map<string, readonly Diagnostic[]> {
  const next = new Map<string, readonly Diagnostic[]>();
  for (const [path, diagnostics] of prev) {
    const filtered = diagnostics.filter((d) => d.source !== TS_LS_INIT_DIAGNOSTIC_SOURCE);
    if (filtered.length > 0) next.set(path, filtered);
  }
  return next;
}
