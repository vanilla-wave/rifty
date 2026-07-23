import type {
  CodeAction as LspCodeAction,
  CompletionItem as LspCompletionItem,
  CompletionList as LspCompletionList,
  CompletionOptions as LspCompletionOptions,
  DefinitionLinks as LspDefinitionLinks,
  Range as LspRange,
  TextEdit as LspTextEdit,
  WorkspaceEdit as LspWorkspaceEdit,
} from '@riftydev/ts-language-service/lsp-types';
import type { PlaygroundTypeScript } from '@riftydev/workbench/playground';
import * as monaco from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { type TestModel, __monacoTestState } from './test-monaco-editor.ts';
import {
  type EditorPathBridge,
  type TsLanguageServiceProvidersHandle,
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

function clientWithMethods(methods: Record<string, unknown>): PlaygroundTypeScript {
  return {
    dispose() {},
    ...methods,
  } as unknown as PlaygroundTypeScript;
}

function rejectingClient(error: Error): PlaygroundTypeScript {
  const reject = (): Promise<never> => Promise.reject(error);
  return new Proxy<Record<PropertyKey, unknown>>(
    {},
    {
      get(_target, prop) {
        if (prop === 'dispose') return () => undefined;
        return reject;
      },
    },
  ) as unknown as PlaygroundTypeScript;
}

function disposedClient(): PlaygroundTypeScript {
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

  it('treats missing workspace TypeScript during provider work as unavailable', async () => {
    const providers = registerTsLanguageServiceProviders(
      rejectingClient(
        new Error('TypeScript is not installed in this project; run npm install -D typescript'),
      ),
      bridgeFor(TEST_PATH),
    );

    try {
      await expect(
        providers.providers.hover.provideHover(
          semanticModel(),
          { lineNumber: 1, column: 1 } as monaco.Position,
          neverCancelled,
        ),
      ).resolves.toBeNull();
    } finally {
      providers.dispose();
    }
  });

  it('treats an unresolvable workspace TypeScript package as unavailable', async () => {
    const providers = registerTsLanguageServiceProviders(
      rejectingClient(
        new Error(
          'workspace TypeScript at /proj/node_modules/typescript has no resolvable compiler entry (package.json exports/main): Cannot find module',
        ),
      ),
      bridgeFor(TEST_PATH),
    );

    try {
      await expect(
        providers.providers.hover.provideHover(
          semanticModel(),
          { lineNumber: 1, column: 1 } as monaco.Position,
          neverCancelled,
        ),
      ).resolves.toBeNull();
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

// ————— Behavioral heirs of the retired ts-ls-monaco-providers-source greps —————

const APPLY_COMPLETION_COMMAND = 'rifty.ts.applyCompletionWorkspaceEdit';

function lspRange(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
): LspRange {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

function textEdit(text: string): LspTextEdit {
  return { range: lspRange(0, 0, 0, 0), newText: text };
}

/** Monaco image of {@link textEdit}'s zero LSP range (1-based). */
const MONACO_ZERO_RANGE = {
  startLineNumber: 1,
  startColumn: 1,
  endLineNumber: 1,
  endColumn: 1,
};

function completionList(items: readonly LspCompletionItem[]): LspCompletionList {
  return {
    isIncomplete: false,
    isGlobalCompletion: false,
    isMemberCompletion: false,
    isNewIdentifierLocation: false,
    items,
  };
}

function completionModel(
  options: { tabSize?: number; insertSpaces?: boolean } = {},
): monaco.editor.ITextModel {
  return {
    uri: monaco.Uri.parse(TEST_PATH),
    getOptions: () => ({
      tabSize: options.tabSize ?? 2,
      insertSpaces: options.insertSpaces ?? true,
    }),
    getWordUntilPosition: () => ({ word: 'fo', startColumn: 3, endColumn: 5 }),
  } as unknown as monaco.editor.ITextModel;
}

/** Code-action client with quiet defaults; override the method under test. */
function codeActionClient(overrides: Record<string, unknown> = {}): PlaygroundTypeScript {
  return clientWithMethods({
    getCodeFixes: () => Promise.resolve([]),
    getCombinedCodeFix: () => Promise.resolve({ changes: {} }),
    organizeImports: () => Promise.resolve({ changes: {} }),
    getRefactorActions: () => Promise.resolve([]),
    ...overrides,
  });
}

function labelText(label: monaco.languages.CompletionItem['label']): string {
  return typeof label === 'string' ? label : label.label;
}

async function provideCompletions(
  handle: TsLanguageServiceProvidersHandle,
  model: monaco.editor.ITextModel,
  context: monaco.languages.CompletionContext,
): Promise<monaco.languages.CompletionList> {
  const list = await handle.providers.completion.provideCompletionItems(
    model,
    { lineNumber: 2, column: 5 } as monaco.Position,
    context,
    neverCancelled,
  );
  if (!list) throw new Error('expected a completion list');
  return list;
}

async function provideAndResolveFirst(
  handle: TsLanguageServiceProvidersHandle,
  model: monaco.editor.ITextModel,
  context: monaco.languages.CompletionContext = {
    triggerKind: monaco.languages.CompletionTriggerKind.Invoke,
  },
): Promise<monaco.languages.CompletionItem> {
  const list = await provideCompletions(handle, model, context);
  const item = list.suggestions[0];
  if (!item) throw new Error('expected a completion item');
  const completion = handle.providers.completion;
  const resolve = completion.resolveCompletionItem?.bind(completion);
  if (!resolve) throw new Error('expected resolveCompletionItem');
  const resolved = await resolve(item, neverCancelled);
  return resolved ?? item;
}

async function provideCodeActionList(
  handle: TsLanguageServiceProvidersHandle,
  model: monaco.editor.ITextModel,
): Promise<monaco.languages.CodeActionList> {
  const result = await handle.providers.codeAction.provideCodeActions(
    model,
    codeActionRange(),
    codeActionContext(),
    neverCancelled,
  );
  if (!result) throw new Error('expected a code-action list');
  return result;
}

describe('completion + signature trigger context', () => {
  it('passes the Monaco completion trigger context + editor indent options to the TS service', async () => {
    const calls: unknown[][] = [];
    const client = clientWithMethods({
      getCompletions: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(completionList([]));
      },
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      const completion = providers.providers.completion;
      expect(completion.triggerCharacters).toEqual(['.', '"', "'", '`', '/', '@', '<', '#', ' ']);
      const model = completionModel({ tabSize: 3, insertSpaces: false });
      await provideCompletions(providers, model, {
        triggerKind: monaco.languages.CompletionTriggerKind.TriggerCharacter,
        triggerCharacter: '.',
      });
      await provideCompletions(providers, model, {
        triggerKind: monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions,
      });
      await provideCompletions(providers, model, {
        triggerKind: monaco.languages.CompletionTriggerKind.Invoke,
      });
      expect(calls).toHaveLength(3);
      expect(calls[0]?.[0]).toBe(TEST_PATH);
      expect(calls[0]?.[1]).toEqual({ line: 1, character: 4 });
      expect(calls[0]?.[2]).toMatchObject({
        triggerKind: 'trigger-character',
        triggerCharacter: '.',
        formattingOptions: { tabSize: 3, insertSpaces: false },
      });
      expect(calls[1]?.[2]).toMatchObject({ triggerKind: 'trigger-for-incomplete' });
      expect((calls[1]?.[2] as LspCompletionOptions).triggerCharacter).toBeUndefined();
      expect(calls[2]?.[2]).toMatchObject({ triggerKind: 'invoked' });
      expect((calls[2]?.[2] as LspCompletionOptions).triggerCharacter).toBeUndefined();
    } finally {
      providers.dispose();
    }
  });

  it('re-queries completion details with the stashed position, source, data and trigger options', async () => {
    const detailCalls: unknown[][] = [];
    const client = clientWithMethods({
      getCompletions: () =>
        Promise.resolve(completionList([{ label: 'foo', source: 'pkg', data: { entryId: 7 } }])),
      getCompletionDetails: (...args: unknown[]) => {
        detailCalls.push(args);
        return Promise.resolve(null);
      },
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      await provideAndResolveFirst(providers, completionModel(), {
        triggerKind: monaco.languages.CompletionTriggerKind.TriggerCharacter,
        triggerCharacter: '.',
      });
      expect(detailCalls).toHaveLength(1);
      const [path, position, label, source, data, options] = detailCalls[0] ?? [];
      expect(path).toBe(TEST_PATH);
      expect(position).toEqual({ line: 1, character: 4 });
      expect(label).toBe('foo');
      expect(source).toBe('pkg');
      expect(data).toEqual({ entryId: 7 });
      expect(options).toMatchObject({ triggerKind: 'trigger-character', triggerCharacter: '.' });
    } finally {
      providers.dispose();
    }
  });

  it('maps each Monaco signature-help trigger to the TS trigger reason', async () => {
    const calls: unknown[][] = [];
    const client = clientWithMethods({
      getSignatureHelp: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve(null);
      },
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      const signatureHelp = providers.providers.signatureHelp;
      expect(signatureHelp.signatureHelpTriggerCharacters).toEqual(['(', ',', '<']);
      const model = completionModel();
      const position = { lineNumber: 1, column: 9 } as monaco.Position;
      await signatureHelp.provideSignatureHelp(model, position, neverCancelled, {
        triggerKind: monaco.languages.SignatureHelpTriggerKind.TriggerCharacter,
        triggerCharacter: '(',
        isRetrigger: false,
      });
      await signatureHelp.provideSignatureHelp(model, position, neverCancelled, {
        triggerKind: monaco.languages.SignatureHelpTriggerKind.ContentChange,
        triggerCharacter: ')',
        isRetrigger: true,
      });
      await signatureHelp.provideSignatureHelp(model, position, neverCancelled, {
        triggerKind: monaco.languages.SignatureHelpTriggerKind.Invoke,
        isRetrigger: false,
      });
      expect(calls[0]?.[1]).toEqual({ line: 0, character: 8 });
      expect(calls.map((args) => args[2])).toEqual([
        { triggerReason: { kind: 'characterTyped', triggerCharacter: '(' } },
        { triggerReason: { kind: 'retrigger', triggerCharacter: ')' } },
        { triggerReason: { kind: 'invoked' } },
      ]);
    } finally {
      providers.dispose();
    }
  });
});

describe('definition links', () => {
  it('maps definition links with origin/target selection ranges and drops unopenable targets', async () => {
    const client = clientWithMethods({
      getDefinitionLinks: () =>
        Promise.resolve({
          originSelectionRange: lspRange(0, 2, 0, 5),
          locations: [
            {
              targetUri: '/scratch/src/lib.ts',
              targetRange: lspRange(3, 0, 5, 1),
              targetSelectionRange: lspRange(3, 9, 3, 12),
            },
            {
              // No model can be made for a synthetic lib file — must be dropped.
              targetUri: '/ts-lib/lib.dom.d.ts',
              targetRange: lspRange(0, 0, 0, 1),
              targetSelectionRange: lspRange(0, 0, 0, 1),
            },
          ],
        } satisfies LspDefinitionLinks),
    });
    const bridge: EditorPathBridge = {
      pathForModel: () => TEST_PATH,
      ensureModel: (path) => (path === '/scratch/src/lib.ts' ? monaco.Uri.parse(path) : undefined),
      canEnsureModel: () => true,
    };
    const providers = registerTsLanguageServiceProviders(client, bridge);
    try {
      const result = await providers.providers.definition.provideDefinition(
        completionModel(),
        { lineNumber: 1, column: 3 } as monaco.Position,
        neverCancelled,
      );
      if (!Array.isArray(result)) throw new Error('expected a definition link array');
      expect(result).toHaveLength(1);
      const link = result[0] as monaco.languages.LocationLink;
      expect(link.uri.toString()).toBe('/scratch/src/lib.ts');
      expect(link.range).toEqual({
        startLineNumber: 4,
        startColumn: 1,
        endLineNumber: 6,
        endColumn: 2,
      });
      expect(link.targetSelectionRange).toEqual({
        startLineNumber: 4,
        startColumn: 10,
        endLineNumber: 4,
        endColumn: 13,
      });
      // The link itself has no origin span — the list-level one applies.
      expect(link.originSelectionRange).toEqual({
        startLineNumber: 1,
        startColumn: 3,
        endLineNumber: 1,
        endColumn: 6,
      });
    } finally {
      providers.dispose();
    }
  });
});

describe('completion metadata + resolved edits', () => {
  it('maps TS entry metadata into Monaco affordances (deprecated tag, preselect, source display)', async () => {
    const client = clientWithMethods({
      getCompletions: () =>
        Promise.resolve(
          completionList([
            { label: 'depr', kindModifiers: 'deprecated,export' },
            { label: 'rec', isRecommended: true },
            { label: 'imp', sourceDisplay: './util' },
            { label: 'plain' },
          ]),
        ),
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      const list = await provideCompletions(providers, completionModel(), {
        triggerKind: monaco.languages.CompletionTriggerKind.Invoke,
      });
      const byLabel = new Map(list.suggestions.map((s) => [labelText(s.label), s]));
      expect(byLabel.get('depr')?.tags).toEqual([monaco.languages.CompletionItemTag.Deprecated]);
      expect(byLabel.get('plain')?.tags).toBeUndefined();
      expect(byLabel.get('rec')?.preselect).toBe(true);
      expect(byLabel.get('plain')?.preselect).toBe(false);
      expect(byLabel.get('imp')?.label).toEqual({ label: 'imp', description: './util' });
    } finally {
      providers.dispose();
    }
  });

  it('applies resolved detail metadata: detail, deprecated tag, preselect, source display, docs', async () => {
    const client = clientWithMethods({
      getCompletions: () => Promise.resolve(completionList([{ label: 'plain' }])),
      getCompletionDetails: () =>
        Promise.resolve({
          label: 'plain',
          detail: 'const plain: number',
          kindModifiers: 'deprecated',
          isRecommended: true,
          sourceDisplay: './m2',
          documentation: 'docs!',
        }),
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      const resolved = await provideAndResolveFirst(providers, completionModel());
      expect(resolved.detail).toBe('const plain: number');
      expect(resolved.tags).toEqual([monaco.languages.CompletionItemTag.Deprecated]);
      expect(resolved.preselect).toBe(true);
      expect(resolved.label).toEqual({ label: 'plain', description: './m2' });
      expect(resolved.documentation).toEqual({ value: 'docs!' });
    } finally {
      providers.dispose();
    }
  });

  it('applies resolved completion workspace edits through the registered Monaco command', async () => {
    __monacoTestState.models.clear();
    const other = fakeModel();
    __monacoTestState.models.set('/scratch/src/other.ts', other);
    const wsEdit: LspWorkspaceEdit = {
      changes: { '/scratch/src/other.ts': [textEdit("import { x } from './x';\n")] },
    };
    const client = clientWithMethods({
      getCompletions: () => Promise.resolve(completionList([{ label: 'x' }])),
      getCompletionDetails: () =>
        Promise.resolve({
          label: 'x',
          additionalTextEditChanges: wsEdit,
          additionalTextEdits: [textEdit('legacy same-file edit')],
        }),
    });
    const bridge: EditorPathBridge = {
      pathForModel: () => TEST_PATH,
      canEnsureModel: (path) => __monacoTestState.models.has(path),
      ensureModel: (path) =>
        __monacoTestState.models.has(path) ? monaco.Uri.parse(path) : undefined,
    };
    const providers = registerTsLanguageServiceProviders(client, bridge);
    try {
      const resolved = await provideAndResolveFirst(providers, completionModel());
      // The workspace-edit form replaces the same-file fallback entirely.
      expect(resolved.additionalTextEdits).toBeUndefined();
      expect(resolved.command?.id).toBe(APPLY_COMPLETION_COMMAND);
      expect(resolved.command?.arguments).toEqual([wsEdit]);
      const handler = __monacoTestState.commands.get(APPLY_COMPLETION_COMMAND);
      if (!handler) throw new Error('expected the completion workspace-edit command registered');
      handler(undefined, resolved.command?.arguments?.[0]);
      expect(other.applied).toEqual([
        [{ range: MONACO_ZERO_RANGE, text: "import { x } from './x';\n" }],
      ]);
      // Atomicity: an unopenable target must fail loudly, not partially apply.
      expect(() =>
        handler(undefined, { changes: { '/scratch/src/missing.ts': [textEdit('x')] } }),
      ).toThrow(/could not be opened/);
    } finally {
      providers.dispose();
      __monacoTestState.models.clear();
    }
    expect(__monacoTestState.commands.has(APPLY_COMPLETION_COMMAND)).toBe(false);
  });

  it('suppresses both the command and same-file fallback when the workspace edit carries TS commands', async () => {
    __monacoTestState.models.clear();
    const other = fakeModel();
    __monacoTestState.models.set('/scratch/src/other.ts', other);
    const editWithCommands: LspWorkspaceEdit = {
      changes: { '/scratch/src/other.ts': [textEdit('auto-import')] },
      commands: [{ kind: 'install-package' }],
    };
    const client = clientWithMethods({
      getCompletions: () => Promise.resolve(completionList([{ label: 'x' }])),
      getCompletionDetails: () =>
        Promise.resolve({
          label: 'x',
          additionalTextEditChanges: editWithCommands,
          additionalTextEdits: [textEdit('same-file fallback')],
        }),
    });
    const bridge: EditorPathBridge = {
      pathForModel: () => TEST_PATH,
      canEnsureModel: (path) => __monacoTestState.models.has(path),
      ensureModel: (path) =>
        __monacoTestState.models.has(path) ? monaco.Uri.parse(path) : undefined,
    };
    const providers = registerTsLanguageServiceProviders(client, bridge);
    try {
      const resolved = await provideAndResolveFirst(providers, completionModel());
      // Commands are side effects Monaco cannot run: no command, and no silent
      // downgrade to the stale same-file edits either.
      expect(resolved.command).toBeUndefined();
      expect(resolved.additionalTextEdits).toBeUndefined();
      // The registered command likewise refuses a commands-bearing edit.
      const handler = __monacoTestState.commands.get(APPLY_COMPLETION_COMMAND);
      if (!handler) throw new Error('expected the completion workspace-edit command registered');
      handler(undefined, editWithCommands);
      expect(other.applied).toEqual([]);
    } finally {
      providers.dispose();
      __monacoTestState.models.clear();
    }
  });
});

describe('workspace edit atomicity + new-file targets', () => {
  it('creates new-file targets (isNewFile) and applies edits when every target opens', () => {
    __monacoTestState.models.clear();
    const existing = fakeModel();
    __monacoTestState.models.set('/scratch/src/existing.ts', existing);
    const ensureCalls: Array<{ path: string; isNewFile: boolean | undefined }> = [];
    const bridge: EditorPathBridge = {
      pathForModel: () => undefined,
      canEnsureModel: () => true,
      ensureModel: (path, options) => {
        ensureCalls.push({ path, isNewFile: options?.isNewFile });
        if (options?.isNewFile === true) __monacoTestState.models.set(path, fakeModel());
        return monaco.Uri.parse(path);
      },
    };
    const edit: LspWorkspaceEdit = {
      changes: {
        '/scratch/src/existing.ts': [textEdit('touch existing')],
        '/scratch/src/created.ts': [textEdit('seed created')],
      },
      newFiles: ['/scratch/src/created.ts'],
    };

    expect(applyWorkspaceTextEdit(edit, bridge)).toBe(true);
    expect(ensureCalls).toEqual([
      { path: '/scratch/src/existing.ts', isNewFile: false },
      { path: '/scratch/src/created.ts', isNewFile: true },
    ]);
    expect(existing.applied).toEqual([[{ range: MONACO_ZERO_RANGE, text: 'touch existing' }]]);
    expect(__monacoTestState.models.get('/scratch/src/created.ts')?.applied).toEqual([
      [{ range: MONACO_ZERO_RANGE, text: 'seed created' }],
    ]);
    __monacoTestState.models.clear();
  });

  it('fails the whole edit when a resolved target has no backing model (no partial skip)', () => {
    __monacoTestState.models.clear();
    const first = fakeModel();
    __monacoTestState.models.set('/scratch/src/a.ts', first);
    const bridge: EditorPathBridge = {
      pathForModel: () => undefined,
      canEnsureModel: () => true,
      // Yields a Uri for every target, but '/scratch/src/b.ts' has no model.
      ensureModel: (path) => monaco.Uri.parse(path),
    };
    const edit: LspWorkspaceEdit = {
      changes: {
        '/scratch/src/a.ts': [textEdit('a')],
        '/scratch/src/b.ts': [textEdit('b')],
      },
    };

    expect(applyWorkspaceTextEdit(edit, bridge)).toBe(false);
    expect(first.applied).toEqual([]);
    __monacoTestState.models.clear();
  });
});

describe('code-action provider', () => {
  it('offers only refactors Monaco can apply: no TS commands (action or edit), no post-edit rename', async () => {
    const cleanEdit = (): LspWorkspaceEdit => ({ changes: { [TEST_PATH]: [textEdit('ok')] } });
    const client = codeActionClient({
      getRefactorActions: () =>
        Promise.resolve([
          { title: 'top-level command', edit: cleanEdit(), commands: [{ kind: 'install' }] },
          { title: 'edit command', edit: { ...cleanEdit(), commands: [{ kind: 'install' }] } },
          {
            title: 'post-edit rename',
            edit: {
              ...cleanEdit(),
              renameLocation: { uri: TEST_PATH, range: lspRange(0, 0, 0, 1) },
            },
          },
          {
            title: 'post-edit file rename',
            edit: { ...cleanEdit(), renameFilename: '/scratch/src/renamed.ts' },
          },
          { title: 'clean refactor', edit: cleanEdit() },
        ] satisfies LspCodeAction[]),
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      const result = await provideCodeActionList(providers, semanticModel());
      expect(result.actions.map((a) => a.title)).toEqual(['clean refactor']);
    } finally {
      providers.dispose();
    }
  });

  it('resolves code-action edits lazily: discovery opens nothing, resolveCodeAction fills the edit', async () => {
    __monacoTestState.models.clear();
    const ensureCalls: string[] = [];
    const bridge: EditorPathBridge = {
      pathForModel: () => TEST_PATH,
      canEnsureModel: () => true,
      ensureModel: (path, options) => {
        ensureCalls.push(path);
        if (options?.isNewFile === true) __monacoTestState.models.set(path, fakeModel());
        return monaco.Uri.parse(path);
      },
    };
    const client = codeActionClient({
      getRefactorActions: () =>
        Promise.resolve([
          {
            title: 'Move to a new file',
            kind: 'refactor.move',
            edit: {
              changes: { '/scratch/src/moved.ts': [textEdit('moved')] },
              newFiles: ['/scratch/src/moved.ts'],
            },
          },
        ] satisfies LspCodeAction[]),
    });
    const providers = registerTsLanguageServiceProviders(client, bridge);
    try {
      const result = await provideCodeActionList(providers, semanticModel());
      const action = result.actions[0];
      if (!action) throw new Error('expected a code action');
      expect(action.title).toBe('Move to a new file');
      // Discovery must have NO side effects: no edit yet, no model opened/created.
      expect(action.edit).toBeUndefined();
      expect(ensureCalls).toEqual([]);
      expect(__monacoTestState.models.has('/scratch/src/moved.ts')).toBe(false);

      const codeAction = providers.providers.codeAction;
      const resolve = codeAction.resolveCodeAction?.bind(codeAction);
      if (!resolve) throw new Error('expected resolveCodeAction');
      const resolved = await resolve(action, neverCancelled);
      expect(ensureCalls).toEqual(['/scratch/src/moved.ts']);
      const edits = resolved?.edit?.edits as monaco.languages.IWorkspaceTextEdit[];
      expect(edits).toHaveLength(1);
      expect(edits[0]?.resource.toString()).toBe('/scratch/src/moved.ts');
      expect(edits[0]?.textEdit).toEqual({ range: MONACO_ZERO_RANGE, text: 'moved' });
    } finally {
      providers.dispose();
      __monacoTestState.models.clear();
    }
  });

  it('rejects resolveCodeAction when a workspace-edit target cannot be opened', async () => {
    const client = codeActionClient({
      getRefactorActions: () =>
        Promise.resolve([
          {
            title: 'Move to a new file',
            kind: 'refactor.move',
            edit: { changes: { '/scratch/src/moved.ts': [textEdit('moved')] } },
          },
        ] satisfies LspCodeAction[]),
    });
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      const result = await provideCodeActionList(providers, semanticModel());
      const action = result.actions[0];
      if (!action) throw new Error('expected a code action');
      const codeAction = providers.providers.codeAction;
      const resolve = codeAction.resolveCodeAction?.bind(codeAction);
      if (!resolve) throw new Error('expected resolveCodeAction');
      await expect(Promise.resolve(resolve(action, neverCancelled))).rejects.toThrow(
        /could not be opened/,
      );
    } finally {
      providers.dispose();
    }
  });

  it('threads editor indent options + the marker span through code-fix/organize/refactor requests', async () => {
    const codeFixCalls: unknown[][] = [];
    const combinedCalls: unknown[][] = [];
    const organizeCalls: unknown[][] = [];
    const refactorCalls: unknown[][] = [];
    const client = clientWithMethods({
      getCodeFixes: (...args: unknown[]) => {
        codeFixCalls.push(args);
        return Promise.resolve([
          {
            title: 'Add missing import',
            kind: 'quickfix',
            edit: { changes: { [TEST_PATH]: [textEdit('import')] } },
            fixId: 'fixMissingImport',
            fixAllDescription: 'Add all missing imports',
          },
        ]);
      },
      getCombinedCodeFix: (...args: unknown[]) => {
        combinedCalls.push(args);
        return Promise.resolve({ changes: {} });
      },
      organizeImports: (...args: unknown[]) => {
        organizeCalls.push(args);
        return Promise.resolve({ changes: {} });
      },
      getRefactorActions: (...args: unknown[]) => {
        refactorCalls.push(args);
        return Promise.resolve([]);
      },
    });
    const model = {
      uri: monaco.Uri.parse(TEST_PATH),
      getOptions: () => ({ tabSize: 3, insertSpaces: false }),
    } as unknown as monaco.editor.ITextModel;
    __monacoTestState.markers = [
      {
        resource: model.uri,
        owner: 'rifty-ts',
        code: '2304',
        startLineNumber: 3,
        startColumn: 4,
        endLineNumber: 3,
        endColumn: 10,
      },
    ];
    const providers = registerTsLanguageServiceProviders(client, bridgeFor(TEST_PATH));
    try {
      const range = {
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 5,
        endColumn: 1,
      } as monaco.Range;
      await providers.providers.codeAction.provideCodeActions(
        model,
        range,
        codeActionContext(),
        neverCancelled,
      );
      const expectedOptions = { formattingOptions: { tabSize: 3, insertSpaces: false } };
      // The quick-fix query uses the DIAGNOSTIC's own span + code, not the selection.
      expect(codeFixCalls).toEqual([[TEST_PATH, lspRange(2, 3, 2, 9), [2304], expectedOptions]]);
      expect(combinedCalls).toEqual([[TEST_PATH, 'fixMissingImport', expectedOptions]]);
      expect(organizeCalls).toEqual([[TEST_PATH, expectedOptions]]);
      expect(refactorCalls).toEqual([[TEST_PATH, lspRange(0, 0, 4, 0), expectedOptions]]);
    } finally {
      __monacoTestState.markers = [];
      providers.dispose();
    }
  });
});
