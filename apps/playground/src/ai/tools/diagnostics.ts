/**
 * diagnostics tool (ADR-0190 tool surface, PASS 2): TypeScript language-service
 * diagnostics for one file — the SAME client + readiness gate the Problems
 * panel uses (ctx.tsDiagnostics; syntactic + semantic). Unavailable service
 * (non-TS template, init failure, no editor yet) rejects loudly naming why.
 */
// typebox comes via Pi's re-export (ADR-0190 decision) — never @sinclair/typebox.
import { Type } from '@earendil-works/pi-ai';
import type { Diagnostic } from '@riftydev/ts-language-service/lsp-types';
import { resolveWorkspacePath, workspaceRelative } from '../../glue/workspace-path.ts';
import type { AiAppContext } from '../app-context.ts';
import { type DefinedAiTool, cappedResult, defineAiTool } from './tool-def.ts';

const SEVERITY_LABEL: Record<number, string> = {
  1: 'error',
  2: 'warning',
  3: 'info',
  4: 'hint',
};

/** One line per diagnostic: `severity TS<code> at line:col — message` (1-based). */
export function formatDiagnostics(rel: string, diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return `no diagnostics for ${rel}`;
  const lines = diagnostics.map((diag) => {
    const severity = SEVERITY_LABEL[diag.severity] ?? `severity-${diag.severity}`;
    const code = diag.code === undefined ? '' : ` TS${diag.code}`;
    const line = diag.range.start.line + 1;
    const column = diag.range.start.character + 1;
    return `${severity}${code} at ${rel}:${line}:${column} — ${diag.message}`;
  });
  return lines.join('\n');
}

export function buildDiagnosticsTool(ctx: AiAppContext): DefinedAiTool {
  return defineAiTool({
    name: 'diagnostics',
    label: 'Diagnostics',
    snippet: 'TypeScript diagnostics for a file (same as the Problems panel)',
    description:
      'TypeScript/JavaScript diagnostics (syntactic + semantic) for one workspace file, from ' +
      'the same language service the Problems panel uses. Fails when the language service is ' +
      'not available for this project.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, workspace-relative or absolute' }),
    }),
    execute: async (params) => {
      const path = resolveWorkspacePath(ctx.root(), params.path);
      const diagnostics = await ctx.tsDiagnostics(path);
      const rel = workspaceRelative(ctx.root(), path);
      return cappedResult(formatDiagnostics(rel, diagnostics), {
        path,
        count: diagnostics.length,
      });
    },
  });
}
