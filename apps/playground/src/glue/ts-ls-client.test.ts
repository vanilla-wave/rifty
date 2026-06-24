import { describe, expect, it } from 'vitest';
import { createTsLanguageServiceClient } from './ts-ls-client.ts';

describe('createTsLanguageServiceClient hard-ceil frames', () => {
  it('sends clone-safe completion options on list and resolve requests', async () => {
    let listener: ((message: unknown) => void) | undefined;
    const sent: unknown[] = [];
    const client = createTsLanguageServiceClient(
      {
        sendTsLsp(message) {
          sent.push(message);
          const request = (message as { request: { id: number; type: string } }).request;
          const response =
            request.type === 'ts:getCompletions'
              ? {
                  id: request.id,
                  ok: true,
                  kind: 'completions',
                  completions: { isIncomplete: false, items: [] },
                }
              : { id: request.id, ok: true, kind: 'completionItem', item: null };
          queueMicrotask(() => listener?.({ type: 'rifty:ts-lsp', response }));
        },
        onTsLsp(cb) {
          listener = cb;
          return () => {
            listener = undefined;
          };
        },
      },
      { timeoutMs: 1_000 },
    );
    const position = { line: 0, character: 1 };
    const options = {
      triggerKind: 'invoked' as const,
      formattingOptions: { tabSize: 4, insertSpaces: false },
      preferences: { quotePreference: 'double' },
    };

    await client.getCompletions('/proj/a.ts', position, options);
    await client.getCompletionDetails('/proj/a.ts', position, 'value', 'pkg', { id: 1 }, options);
    client.dispose();

    expect(sent.map((m) => (m as { request: { type: string } }).request.type)).toEqual([
      'ts:getCompletions',
      'ts:getCompletionDetails',
    ]);
    expect((sent[0] as { request: { options?: unknown } }).request.options).toEqual(options);
    expect((sent[1] as { request: { options?: unknown } }).request.options).toEqual(options);
  });

  it('sends clone-safe action/edit options on every TS edit request that supports them', async () => {
    let listener: ((message: unknown) => void) | undefined;
    const sent: unknown[] = [];
    const client = createTsLanguageServiceClient(
      {
        sendTsLsp(message) {
          sent.push(message);
          const request = (message as { request: { id: number; type: string } }).request;
          const response =
            request.type === 'ts:getCodeFixes'
              ? { id: request.id, ok: true, kind: 'codeActions', codeActions: [] }
              : request.type === 'ts:getDocCommentTemplate'
                ? { id: request.id, ok: true, kind: 'textInsertion', insertion: null }
                : { id: request.id, ok: true, kind: 'workspaceEdit', edit: { changes: {} } };
          queueMicrotask(() => listener?.({ type: 'rifty:ts-lsp', response }));
        },
        onTsLsp(cb) {
          listener = cb;
          return () => {
            listener = undefined;
          };
        },
      },
      { timeoutMs: 1_000 },
    );
    const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } };
    const position = { line: 0, character: 0 };
    const options = {
      preferences: { quotePreference: 'single' },
      formattingOptions: { semicolons: 'insert' },
    };

    await client.getCodeFixes('/proj/a.ts', range, [2304], options);
    await client.organizeImports('/proj/a.ts', options);
    await client.getCombinedCodeFix('/proj/a.ts', 'fix-import', options);
    await client.getFileRenameEdits('/proj/a.ts', '/proj/b.ts', options);
    await client.getDocCommentTemplate('/proj/a.ts', position, {
      generateReturnInDocTemplate: false,
      formattingOptions: { newLineCharacter: '\r\n' },
    });
    await client.getPasteEdits('/proj/a.ts', ['value'], [range], undefined, options);
    client.dispose();

    expect(sent.map((m) => (m as { request: { type: string } }).request.type)).toEqual([
      'ts:getCodeFixes',
      'ts:organizeImports',
      'ts:getCombinedCodeFix',
      'ts:getFileRenameEdits',
      'ts:getDocCommentTemplate',
      'ts:getPasteEdits',
    ]);
    for (const message of sent) {
      expect((message as { request: { options?: unknown } }).request.options).toBeDefined();
    }
  });

  it('returns null for unavailable refactor edits instead of treating it as transport failure', async () => {
    let listener: ((message: unknown) => void) | undefined;
    const client = createTsLanguageServiceClient(
      {
        sendTsLsp(message) {
          const request = (message as { request: { id: number; type: string } }).request;
          queueMicrotask(() =>
            listener?.({
              type: 'rifty:ts-lsp',
              response: {
                id: request.id,
                ok: true,
                kind: 'workspaceEdit',
                edit: null,
              },
            }),
          );
        },
        onTsLsp(cb) {
          listener = cb;
          return () => {
            listener = undefined;
          };
        },
      },
      { timeoutMs: 1_000 },
    );

    await expect(
      client.getRefactorEdits(
        '/proj/a.ts',
        { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
        'missing-refactor',
        'missing-action',
      ),
    ).resolves.toBeNull();
    client.dispose();
  });

  it('sends lifecycle and flat-reference requests over the relay', async () => {
    let listener: ((message: unknown) => void) | undefined;
    const sent: unknown[] = [];
    const client = createTsLanguageServiceClient(
      {
        sendTsLsp(message) {
          sent.push(message);
          const request = (message as { request: { id: number; type: string } }).request;
          const response =
            request.type === 'ts:toLineColumnOffset'
              ? {
                  id: request.id,
                  ok: true,
                  kind: 'position',
                  position: { line: 0, character: 1 },
                }
              : request.type === 'ts:getReferencesAtPosition'
                ? {
                    id: request.id,
                    ok: true,
                    kind: 'locations',
                    locations: [
                      {
                        uri: '/proj/a.ts',
                        range: {
                          start: { line: 0, character: 0 },
                          end: { line: 0, character: 1 },
                        },
                      },
                    ],
                  }
                : { id: request.id, ok: true, kind: 'ack' };
          queueMicrotask(() => listener?.({ type: 'rifty:ts-lsp', response }));
        },
        onTsLsp(cb) {
          listener = cb;
          return () => {
            listener = undefined;
          };
        },
      },
      { timeoutMs: 1_000 },
    );

    await client.cleanupSemanticCache();
    const refs = await client.getReferencesAtPosition('/proj/a.ts', { line: 0, character: 0 });
    const position = await client.toLineColumnOffset('/proj/a.ts', 1);
    await client.disposeLanguageService();
    client.dispose();

    expect(refs).toHaveLength(1);
    expect(position).toEqual({ line: 0, character: 1 });
    expect(sent.map((m) => (m as { request: { type: string } }).request.type)).toEqual([
      'ts:cleanupSemanticCache',
      'ts:getReferencesAtPosition',
      'ts:toLineColumnOffset',
      'ts:dispose',
    ]);
  });

  it('surfaces object-graph ceilings as feature-tagged errors', async () => {
    let listener: ((message: unknown) => void) | undefined;
    const sent: unknown[] = [];
    const client = createTsLanguageServiceClient(
      {
        sendTsLsp(message) {
          sent.push(message);
          const request = (message as { request: { id: number; type: string } }).request;
          queueMicrotask(() =>
            listener?.({
              type: 'rifty:ts-lsp',
              response: {
                id: request.id,
                ok: false,
                kind: 'error',
                error: {
                  name: 'NotImplementedError',
                  message: `${request.type} is not structured-clone-safe`,
                  feature:
                    request.type === 'ts:getProgram'
                      ? 'ts-language-service.getProgram'
                      : 'ts-language-service.getCompletionEntrySymbol',
                },
              },
            }),
          );
        },
        onTsLsp(cb) {
          listener = cb;
          return () => {
            listener = undefined;
          };
        },
      },
      { timeoutMs: 1_000 },
    );

    await expect(client.getProgram()).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'ts-language-service.getProgram',
    });
    await expect(
      client.getCompletionEntrySymbol('/proj/a.ts', { line: 0, character: 1 }, 'a', undefined),
    ).rejects.toMatchObject({
      name: 'NotImplementedError',
      feature: 'ts-language-service.getCompletionEntrySymbol',
    });

    client.dispose();
    expect(sent.map((m) => (m as { request: { type: string } }).request.type)).toEqual([
      'ts:getProgram',
      'ts:getCompletionEntrySymbol',
    ]);
  });
});
