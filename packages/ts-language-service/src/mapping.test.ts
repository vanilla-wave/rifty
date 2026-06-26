import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  completionEntryToItem,
  completionInfoToList,
  fileTextChangesToWorkspaceEdit,
} from './mapping.ts';

describe('ts -> LSP mapping hard-ceil fields', () => {
  it('preserves TS completion metadata that is structured-clone safe', () => {
    const entry: ts.CompletionEntry = {
      name: 'readFile',
      kind: ts.ScriptElementKind.functionElement,
      kindModifiers: 'declare',
      sortText: '0',
      source: 'node:fs',
      sourceDisplay: [{ text: 'node:fs', kind: 'text' }],
      labelDetails: { detail: '(path)', description: 'node:fs' },
      isRecommended: true,
      isFromUncheckedFile: true,
      isPackageJsonImport: true,
      isImportStatementCompletion: true,
    };

    expect(completionEntryToItem(entry)).toMatchObject({
      label: 'readFile',
      kindModifiers: 'declare',
      source: 'node:fs',
      sourceDisplay: 'node:fs',
      labelDetails: { detail: '(path)', description: 'node:fs' },
      isRecommended: true,
      isFromUncheckedFile: true,
      isPackageJsonImport: true,
      isImportStatementCompletion: true,
    });
  });

  it('preserves TS completion-list metadata that is structured-clone safe', () => {
    const entry: ts.CompletionEntry = {
      name: 'readFile',
      kind: ts.ScriptElementKind.functionElement,
      kindModifiers: 'declare',
      sortText: '0',
    };
    const metadata = { cacheHit: true, source: 'tsserver' };
    const info: ts.WithMetadata<ts.CompletionInfo> = {
      flags: ts.CompletionInfoFlags.MayIncludeAutoImports,
      isGlobalCompletion: true,
      isMemberCompletion: false,
      isNewIdentifierLocation: true,
      isIncomplete: true,
      entries: [entry],
      defaultCommitCharacters: ['.'],
      metadata,
    };

    expect(completionInfoToList(info)).toMatchObject({
      flags: ts.CompletionInfoFlags.MayIncludeAutoImports,
      isGlobalCompletion: true,
      isMemberCompletion: false,
      isNewIdentifierLocation: true,
      isIncomplete: true,
      defaultCommitCharacters: ['.'],
      metadata,
      items: [{ label: 'readFile' }],
    });
  });

  it('preserves TS FileTextChanges.isNewFile on workspace edits', () => {
    const edit = fileTextChangesToWorkspaceEdit(
      [
        {
          fileName: '/workspace/src/new-file.ts',
          isNewFile: true,
          textChanges: [{ span: { start: 0, length: 0 }, newText: 'export const value = 1;\n' }],
        },
      ],
      () => '',
    );

    expect(edit).toEqual({
      changes: {
        '/workspace/src/new-file.ts': [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
            newText: 'export const value = 1;\n',
          },
        ],
      },
      newFiles: ['/workspace/src/new-file.ts'],
    });
  });
});
