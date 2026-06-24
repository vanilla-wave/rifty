import type { WorkspaceEdit as LspWorkspaceEdit } from '@riftydev/ts-language-service/lsp-types';
import { Uri } from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { type TestModel, __monacoTestState } from './test-monaco-editor.ts';
import { type EditorPathBridge, applyWorkspaceTextEdit } from './ts-ls-monaco-providers.ts';

function fakeModel(): TestModel {
  return {
    applied: [],
    applyEdits(edits) {
      this.applied.push(edits);
    },
  };
}

describe('applyWorkspaceTextEdit', () => {
  it('does not create or edit any target when a later workspace edit target cannot open', () => {
    __monacoTestState.models.clear();
    const existing = fakeModel();
    __monacoTestState.models.set('/workspace/src/existing.ts', existing);
    const ensureCalls: string[] = [];
    const bridge: EditorPathBridge = {
      pathForModel: () => undefined,
      canEnsureModel: (path) => path !== '/workspace/src/new.ts',
      ensureModel: (path, options) => {
        ensureCalls.push(path);
        if (options?.isNewFile === true) {
          __monacoTestState.models.set(path, fakeModel());
        }
        return Uri.parse(path);
      },
    };
    const edit: LspWorkspaceEdit = {
      changes: {
        '/workspace/src/existing.ts': [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'existing',
          },
        ],
        '/workspace/src/new.ts': [
          {
            range: {
              start: { line: 0, character: 0 },
              end: { line: 0, character: 0 },
            },
            newText: 'created',
          },
        ],
      },
      newFiles: ['/workspace/src/new.ts'],
    };

    expect(applyWorkspaceTextEdit(edit, bridge)).toBe(false);
    expect(ensureCalls).toEqual([]);
    expect(existing.applied).toEqual([]);
    expect(__monacoTestState.models.has('/workspace/src/new.ts')).toBe(false);
  });
});
