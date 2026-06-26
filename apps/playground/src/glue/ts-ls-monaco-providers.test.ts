import type { WorkspaceEdit as LspWorkspaceEdit } from '@riftydev/ts-language-service/lsp-types';
import * as monaco from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { type TestModel, __monacoTestState } from './test-monaco-editor.ts';
import type { TsLanguageServiceClient } from './ts-ls-client.ts';
import {
  type EditorPathBridge,
  applyWorkspaceTextEdit,
  registerTsLanguageServiceProviders,
} from './ts-ls-monaco-providers.ts';

const DISPOSED_CLIENT_ERROR = 'ts-lsp client disposed';
const TEST_PATH = '/scratch/src/main.ts';

function fakeModel(): TestModel {
  return {
    applied: [],
    applyEdits(edits) {
      this.applied.push(edits);
    },
  };
}

function clientWithMethods(methods: Record<string, unknown>): TsLanguageServiceClient {
  return {
    dispose() {},
    ...methods,
  } as unknown as TsLanguageServiceClient;
}

function rejectingClient(error: Error): TsLanguageServiceClient {
  const reject = (): Promise<never> => Promise.reject(error);
  return new Proxy<Record<PropertyKey, unknown>>(
    {},
    {
      get(_target, prop) {
        if (prop === 'dispose') return () => undefined;
        return reject;
      },
    },
  ) as unknown as TsLanguageServiceClient;
}

function disposedClient(): TsLanguageServiceClient {
  return rejectingClient(new Error(DISPOSED_CLIENT_ERROR));
}

function semanticModel(): monaco.editor.ITextModel {
  return {
    uri: monaco.Uri.parse(TEST_PATH),
    getFullModelRange: () => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
    }),
    getPositionAt: () => ({ lineNumber: 1, column: 1 }),
    getOptions: () => ({ tabSize: 2, insertSpaces: true }),
  } as unknown as monaco.editor.ITextModel;
}

function codeActionRange(): monaco.Range {
  return {
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: 1,
    endColumn: 1,
  } as monaco.Range;
}

function codeActionContext(): monaco.languages.CodeActionContext {
  return {
    markers: [],
    trigger: 1 as monaco.languages.CodeActionTriggerType,
  };
}

function bridgeFor(path: string): EditorPathBridge {
  return {
    pathForModel: () => path,
    ensureModel: () => undefined,
    canEnsureModel: () => false,
  };
}

const neverCancelled: monaco.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose() {} }),
};

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
        return monaco.Uri.parse(path);
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

  it('treats a disposed client during semantic-token provider work as cancellation', async () => {
    const providers = registerTsLanguageServiceProviders(disposedClient(), bridgeFor(TEST_PATH));

    try {
      const result = await providers.providers.semanticTokens.provideDocumentSemanticTokens(
        semanticModel(),
        null,
        neverCancelled,
      );

      if (!result || !('data' in result)) {
        throw new Error('expected semantic-token data result');
      }
      expect(result.data).toEqual(new Uint32Array());
    } finally {
      providers.dispose();
    }
  });

  it('rethrows non-lifecycle provider errors', async () => {
    const providers = registerTsLanguageServiceProviders(
      rejectingClient(new Error('boom')),
      bridgeFor(TEST_PATH),
    );

    try {
      await expect(
        providers.providers.semanticTokens.provideDocumentSemanticTokens(
          semanticModel(),
          null,
          neverCancelled,
        ),
      ).rejects.toThrow('boom');
    } finally {
      providers.dispose();
    }
  });

  it('cancels compound code actions when a later client request is disposed', async () => {
    const model = semanticModel();
    __monacoTestState.markers = [
      {
        resource: model.uri,
        owner: 'rifty-ts',
        code: '2304',
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: 1,
      },
    ];
    const client = clientWithMethods({
      getCodeFixes: () =>
        Promise.resolve([
          {
            title: 'Import missing symbol',
            kind: 'quickfix',
            edit: { changes: { [TEST_PATH]: [] } },
            fixId: 'fix-all',
            fixAllDescription: 'Import all missing symbols',
          },
        ]),
      getCombinedCodeFix: () => Promise.reject(new Error(DISPOSED_CLIENT_ERROR)),
      organizeImports: () => Promise.resolve({ changes: {} }),
      getRefactorActions: () => Promise.resolve([]),
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));

    try {
      const result = await providers.providers.codeAction.provideCodeActions(
        model,
        codeActionRange(),
        codeActionContext(),
        neverCancelled,
      );

      if (!result) {
        throw new Error('expected code-action result');
      }
      expect(result.actions).toEqual([]);
    } finally {
      __monacoTestState.markers = [];
      providers.dispose();
    }
  });
});
