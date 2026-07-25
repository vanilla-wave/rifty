import { type Diagnostic, DiagnosticSeverity } from '@riftydev/ts-language-service/lsp-types';
import type * as monaco from 'monaco-editor';

const MONACO_MARKER_SEVERITY = {
  Error: 8,
  Warning: 4,
  Info: 2,
  Hint: 1,
} as const satisfies Record<'Error' | 'Warning' | 'Info' | 'Hint', monaco.MarkerSeverity>;

function toMarkerSeverity(severity: DiagnosticSeverity): monaco.MarkerSeverity {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return MONACO_MARKER_SEVERITY.Error;
    case DiagnosticSeverity.Warning:
      return MONACO_MARKER_SEVERITY.Warning;
    case DiagnosticSeverity.Information:
      return MONACO_MARKER_SEVERITY.Info;
    case DiagnosticSeverity.Hint:
      return MONACO_MARKER_SEVERITY.Hint;
    default:
      return MONACO_MARKER_SEVERITY.Error;
  }
}

/** Translate LSP's zero-based diagnostic image to Monaco's one-based marker image. */
export function lspToMonacoMarkers(diags: readonly Diagnostic[]): monaco.editor.IMarkerData[] {
  return diags.map((diagnostic) => ({
    severity: toMarkerSeverity(diagnostic.severity),
    message: diagnostic.message,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    source: diagnostic.source,
  }));
}
