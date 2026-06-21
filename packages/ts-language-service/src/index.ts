/**
 * Public surface of `@riftydev/ts-language-service`: a real `ts.LanguageService`
 * driven over the rifty VFS, exposing diagnostics as LSP shapes (ADR-0166).
 *
 * Internal modules (host, overlay, tsconfig, lib-dts, position, vfs-ts-host)
 * are NOT exported — only the service factory and the LSP wire types.
 */

export { createTsLanguageService } from './service.ts';
export type { CreateTsLanguageServiceDeps, TsLanguageService } from './service.ts';
export { DiagnosticSeverity } from './lsp-types.ts';
export type { Diagnostic, Position, Range } from './lsp-types.ts';
