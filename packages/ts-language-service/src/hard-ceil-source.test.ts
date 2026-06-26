import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const service = readFileSync(here('./service.ts'), 'utf8');
const protocol = readFileSync(here('./worker/protocol.ts'), 'utf8');
const endpoint = readFileSync(here('./worker/service-endpoint.ts'), 'utf8');
const client = readFileSync(here('../../../apps/playground/src/glue/ts-ls-client.ts'), 'utf8');
const publicIndex = readFileSync(here('./index.ts'), 'utf8');
const compat = readFileSync(here('../../../docs/public/compat/ts-language-service.md'), 'utf8');

describe('TS language service hard-ceil inventory source guards', () => {
  it('exposes reachable TS lifecycle/reference methods instead of hiding them', () => {
    for (const token of [
      'cleanupSemanticCache',
      'getReferencesAtPosition',
      'toLineColumnOffset',
      'getEncodedSemanticClassifications',
      'getSemanticClassifications(',
      'getNavigateToItems(',
      'dispose',
    ]) {
      expect(service).toContain(token);
    }
    for (const frame of [
      'ts:cleanupSemanticCache',
      'ts:getReferencesAtPosition',
      'ts:toLineColumnOffset',
      'ts:getSemanticClassifications',
      'ts:getEncodedSemanticClassifications',
      'ts:getProgram',
      'ts:getCompletionEntrySymbol',
      'ts:dispose',
    ]) {
      expect(protocol).toContain(frame);
      expect(endpoint).toContain(frame);
      expect(client).toContain(frame);
    }
    expect(client).toContain('cleanupSemanticCache(): Promise<void>');
    expect(client).toContain('getReferencesAtPosition(');
    expect(client).toContain('getWorkspaceSymbols(');
    expect(client).toContain('options?: WorkspaceSymbolOptions');
    expect(client).toContain('getEncodedSemanticClassifications(');
    expect(client).toContain('toLineColumnOffset(');
    expect(client).toContain('getProgram(): Promise<never>');
    expect(client).toContain('getCompletionEntrySymbol(');
    expect(client).toContain('disposeLanguageService(): Promise<void>');
    expect(publicIndex).toContain('TsCleanupSemanticCacheRequest');
    expect(publicIndex).toContain('TsReferencesAtPositionRequest');
    expect(publicIndex).toContain('TsLineColumnOffsetRequest');
    expect(publicIndex).toContain('TsEncodedClassificationsRequest');
    expect(publicIndex).toContain('TsGetProgramRequest');
    expect(publicIndex).toContain('TsCompletionEntrySymbolRequest');
    expect(publicIndex).toContain('TsDisposeRequest');
  });

  it('documents non-cloneable TS object-graph methods as explicit ceilings', () => {
    expect(service).toContain("new NotImplementedError(\n        'ts-language-service.getProgram'");
    expect(service).toContain(
      "new NotImplementedError(\n        'ts-language-service.getCompletionEntrySymbol'",
    );
    expect(compat).toContain('Program / Symbol object graph APIs');
    expect(compat).toContain('getProgram');
    expect(compat).toContain('getCompletionEntrySymbol');
  });

  it('threads clone-safe TS action/edit options through every reachable edit API', () => {
    for (const token of [
      'CodeFixOptions',
      'OrganizeImportsOptions',
      'CombinedCodeFixOptions',
      'FileRenameEditsOptions',
      'DocCommentTemplateOptions',
      'PasteEditsOptions',
    ]) {
      expect(service).toContain(token);
      expect(protocol).toContain(token);
      expect(client).toContain(token);
    }
    for (const request of [
      'TsCodeFixesRequest',
      'TsOrganizeImportsRequest',
      'TsCombinedCodeFixRequest',
      'TsFileRenameEditsRequest',
      'TsDocCommentTemplateRequest',
      'TsPasteEditsRequest',
    ]) {
      const start = protocol.indexOf(`export interface ${request}`);
      expect(start).toBeGreaterThanOrEqual(0);
      const block = protocol.slice(start, protocol.indexOf('\n}', start));
      expect(block).toContain('readonly options?:');
    }
    expect(service).not.toContain(
      'getCodeFixesAtPosition(path, start, end, errorCodes, fmtSettings, {})',
    );
    expect(service).not.toContain(
      "organizeImports({ type: 'file', fileName: path }, fmtSettings, {})",
    );
    expect(service).not.toContain('preferences: {},');
    expect(
      (service.match(/requireLanguageServiceMethod\('getEditsForRefactor'\)/g) ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });
});
