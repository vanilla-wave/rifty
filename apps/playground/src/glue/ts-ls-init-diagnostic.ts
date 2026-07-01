import { type Diagnostic, DiagnosticSeverity } from '@riftydev/ts-language-service/lsp-types';
import type { ProjectSpec } from '../templates/project-spec.ts';

export const TS_LS_INIT_DIAGNOSTIC_SOURCE = 'ts-lsp-init';
const MISSING_WORKSPACE_TYPESCRIPT_ERROR =
  'TypeScript is not installed in this project; run npm install -D typescript';

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

function projectSpecDeclaresTypeScript(spec: ProjectSpec): boolean {
  const devDependencies = spec.devDependencies ?? {};
  return Object.hasOwn(spec.install, 'typescript') || Object.hasOwn(devDependencies, 'typescript');
}

export function shouldPublishTsLsInitDiagnostic(spec: ProjectSpec, message: string): boolean {
  if (!message.includes(MISSING_WORKSPACE_TYPESCRIPT_ERROR)) return true;
  return projectSpecDeclaresTypeScript(spec);
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
