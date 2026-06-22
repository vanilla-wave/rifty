/**
 * The public language service: a `ts.LanguageService` driven over the rifty VFS,
 * exposing diagnostics as LSP shapes (ADR-0166).
 *
 * `createTsLanguageService` is async — it awaits the std-lib load up front, then
 * builds the (synchronous) overlay + host + `ts.LanguageService`. tsconfig is
 * loaded from `projectRoot` over the VFS.
 */

import type { FsSync } from '@riftydev/vfs';
import ts from 'typescript';
import { createVfsLanguageServiceHost } from './host.ts';
import { loadLibDts } from './lib-dts.ts';
import { type Diagnostic, DiagnosticSeverity } from './lsp-types.ts';
import { createDocumentOverlay } from './overlay.ts';
import { offsetToPosition } from './position.ts';
import { loadTsConfig } from './tsconfig.ts';

export interface CreateTsLanguageServiceDeps {
  readonly fsSync: FsSync;
  /** Project root (POSIX-absolute); tsconfig is discovered from here. */
  readonly projectRoot: string;
}

export interface TsLanguageService {
  getSemanticDiagnostics(path: string): Diagnostic[];
  getSyntacticDiagnostics(path: string): Diagnostic[];
  /**
   * Config-level diagnostics from parsing `tsconfig.json` (e.g. an unknown
   * `compilerOptions` value) — what real tsserver surfaces for a broken config.
   * Empty when the config parsed clean. A config error often has no `file`/
   * position; it then collapses to the document start (see {@link toLspDiagnostic}).
   */
  getConfigFileDiagnostics(): Diagnostic[];
  openDocument(path: string, text: string): void;
  updateDocument(path: string, text: string): void;
  closeDocument(path: string): void;
  /** Signal an external VFS write so TS drops its cached copy of `path`. */
  invalidate(path: string): void;
}

function severityOf(category: ts.DiagnosticCategory): DiagnosticSeverity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return DiagnosticSeverity.Error;
    case ts.DiagnosticCategory.Warning:
      return DiagnosticSeverity.Warning;
    case ts.DiagnosticCategory.Suggestion:
      return DiagnosticSeverity.Hint;
    default: // Message
      return DiagnosticSeverity.Information;
  }
}

/**
 * Map a `ts.Diagnostic` to an LSP {@link Diagnostic}. Range comes from the
 * diagnostic's own source file text (`start`+`length`, 0-based via
 * {@link offsetToPosition}); a diagnostic without a file/position collapses to
 * the document start.
 */
function toLspDiagnostic(d: ts.Diagnostic): Diagnostic {
  const text = d.file?.text ?? '';
  const start = d.start ?? 0;
  const end = start + (d.length ?? 0);
  return {
    range: {
      start: offsetToPosition(text, start),
      end: offsetToPosition(text, end),
    },
    severity: severityOf(d.category),
    message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
    code: typeof d.code === 'number' ? d.code : undefined,
    source: 'ts',
  };
}

export async function createTsLanguageService(
  deps: CreateTsLanguageServiceDeps,
): Promise<TsLanguageService> {
  const { fsSync, projectRoot } = deps;
  const libMap = await loadLibDts();
  const parsed = loadTsConfig(fsSync, projectRoot);
  const overlay = createDocumentOverlay();

  const host = createVfsLanguageServiceHost({
    fsSync,
    projectRoot,
    compilerOptions: parsed.options,
    fileNames: parsed.fileNames,
    libMap,
    overlay,
  });
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());

  // tsc routes config-file errors (unknown options, bad option values, bad
  // include/extends) onto the ParsedCommandLine — captured once at build, mapped
  // through the SAME LSP mapper as program diagnostics (real tsserver surfaces
  // these for a broken tsconfig).
  const configDiagnostics = parsed.errors.map(toLspDiagnostic);

  return {
    getSemanticDiagnostics: (path) => service.getSemanticDiagnostics(path).map(toLspDiagnostic),
    getSyntacticDiagnostics: (path) => service.getSyntacticDiagnostics(path).map(toLspDiagnostic),
    getConfigFileDiagnostics: () => [...configDiagnostics],
    openDocument: (path, text) => overlay.open(path, text),
    updateDocument: (path, text) => overlay.update(path, text),
    closeDocument: (path) => overlay.close(path),
    invalidate: (path) => {
      overlay.invalidate(path);
    },
  };
}
