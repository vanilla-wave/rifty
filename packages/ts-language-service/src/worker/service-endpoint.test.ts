/**
 * Protocol endpoint over a REAL service (RPC-or-memory FsSync fixture). Drives
 * the endpoint with `ts:init`/`ts:open`/`ts:getSemanticDiagnostics`/`ts:update`/
 * … frames and asserts the response frames carry the right diagnostics and that
 * open/update flow works — the Node-testable core of the worker (no worker
 * globals, no kernel). The boundary is mocked only at the `fs.*` RPC seam (a
 * fake `call` serving an in-memory fixture, exactly as host-fs-rpc.test.ts).
 */

import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { CompletionItemKind } from '../lsp-types.ts';
import { snapshotVfsFiles, writeRealWorkspaceTypeScript } from '../test-workspace-typescript.ts';
import { makeFakeFsCall } from './fs-rpc-test-helper.ts';
import { createRpcFsSync } from './host-fs-rpc.ts';
import type {
  TsCodeActionsResponse,
  TsCompletionItemResponse,
  TsCompletionsResponse,
  TsDiagnosticsResponse,
  TsErrorResponse,
  TsHoverResponse,
  TsLocationsResponse,
  TsPreparePasteEditsResponse,
  TsPrepareRenameResponse,
  TsSignatureHelpResponse,
  TsTextEditsResponse,
  TsWorkspaceEditResponse,
} from './protocol.ts';
import { createServiceEndpoint } from './service-endpoint.ts';

const enc = (s: string) => new TextEncoder().encode(s);

function buildFixture(): Map<string, Uint8Array> {
  const { fsSync: mem } = createMemoryFs();
  mem.mkdirSync('/proj', { recursive: true });
  mem.writeFileSync(
    '/proj/tsconfig.json',
    enc(JSON.stringify({ compilerOptions: { strict: true } })),
  );
  mem.writeFileSync('/proj/a.ts', enc('export const x: number = 1;\n'));
  writeRealWorkspaceTypeScript(mem, '/proj');
  return snapshotVfsFiles(mem, '/proj');
}

function diags(r: Awaited<ReturnType<ReturnType<typeof createServiceEndpoint>['dispatch']>>) {
  expect(r.ok).toBe(true);
  expect(r.kind).toBe('diagnostics');
  return (r as TsDiagnosticsResponse).diagnostics;
}

describe('createServiceEndpoint', () => {
  it('init → query → open/update flow drives diagnostics through response frames', async () => {
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(buildFixture()),
    });

    // init
    const init = await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    expect(init).toEqual({ id: 1, ok: true, kind: 'ack' });

    // clean on disk
    const clean = await endpoint.dispatch({
      id: 2,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    expect(diags(clean)).toHaveLength(0);

    // open a buffer with a type error
    const open = await endpoint.dispatch({
      id: 3,
      type: 'ts:open',
      path: '/proj/a.ts',
      text: 'export const x: number = "bad";\n',
    });
    expect(open.ok).toBe(true);
    const withErr = await endpoint.dispatch({
      id: 4,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    const errs = diags(withErr);
    expect(errs).toHaveLength(1);
    expect(errs[0]?.code).toBe(2322);

    // update fixes it
    await endpoint.dispatch({
      id: 5,
      type: 'ts:update',
      path: '/proj/a.ts',
      text: 'export const x: number = 2;\n',
    });
    const fixed = await endpoint.dispatch({
      id: 6,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    expect(diags(fixed)).toHaveLength(0);

    // close
    const close = await endpoint.dispatch({ id: 7, type: 'ts:close', path: '/proj/a.ts' });
    expect(close.ok).toBe(true);
  });

  it('syntactic diagnostics flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync('/proj/bad.ts', enc('const x = ;\n'));
    writeRealWorkspaceTypeScript(mem, '/proj');
    const files = snapshotVfsFiles(mem, '/proj');

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    const r = await endpoint.dispatch({
      id: 2,
      type: 'ts:getSyntacticDiagnostics',
      path: '/proj/bad.ts',
    });
    expect(diags(r).length).toBeGreaterThanOrEqual(1);
  });

  it('config-file diagnostics flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync(
      '/proj/tsconfig.json',
      enc(JSON.stringify({ compilerOptions: { target: 'not-a-real-target' } })),
    );
    mem.writeFileSync('/proj/a.ts', enc('export const x = 1;\n'));
    writeRealWorkspaceTypeScript(mem, '/proj');
    const files = snapshotVfsFiles(mem, '/proj');

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    const r = await endpoint.dispatch({ id: 2, type: 'ts:getConfigFileDiagnostics' });
    expect(diags(r).length).toBeGreaterThanOrEqual(1);
  });

  it('hover / definition / completions / completion-details flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync(
      '/proj/tsconfig.json',
      enc(
        JSON.stringify({ compilerOptions: { strict: true, module: 'esnext', target: 'es2022' } }),
      ),
    );
    mem.writeFileSync(
      '/proj/math.ts',
      enc('export function add(a: number, b: number): number {\n  return a + b;\n}\n'),
    );
    mem.writeFileSync(
      '/proj/main.ts',
      enc(
        "import { add } from './math.ts';\nconst total = add(1, 2);\nconst arr = [1];\narr.map((n) => n);\n",
      ),
    );
    writeRealWorkspaceTypeScript(mem, '/proj');
    const files = snapshotVfsFiles(mem, '/proj');

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });

    // hover on `add` at its call site (line 1, char 14 = the `a` of `add(`).
    const hoverR = await endpoint.dispatch({
      id: 2,
      type: 'ts:getQuickInfo',
      path: '/proj/main.ts',
      position: { line: 1, character: 14 },
    });
    expect(hoverR.ok).toBe(true);
    expect(hoverR.kind).toBe('hover');
    const hover = (hoverR as TsHoverResponse).hover;
    expect(hover?.contents.kind).toBe('markdown');
    // Rendered as a `typescript` code block; at the call site `add` is an
    // alias-import so the signature reads `(alias) add(a: number, b: number)`.
    expect(hover?.contents.value).toContain('```typescript');
    expect(hover?.contents.value).toContain('add(a: number, b: number): number');

    // definition of `add` → math.ts.
    const defR = await endpoint.dispatch({
      id: 3,
      type: 'ts:getDefinition',
      path: '/proj/main.ts',
      position: { line: 1, character: 14 },
    });
    expect(defR.kind).toBe('locations');
    const defs = (defR as TsLocationsResponse).locations;
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0]?.uri).toBe('/proj/math.ts');

    // type-definition of `arr` (number[]) → a lib .d.ts location.
    const typeDefR = await endpoint.dispatch({
      id: 4,
      type: 'ts:getTypeDefinition',
      path: '/proj/main.ts',
      position: { line: 3, character: 0 }, // `arr.map` line, on `arr`
    });
    expect(typeDefR.kind).toBe('locations');
    expect((typeDefR as TsLocationsResponse).locations.length).toBeGreaterThan(0);

    // completions at member access `arr.|` (line 3, char 4).
    const compR = await endpoint.dispatch({
      id: 5,
      type: 'ts:getCompletions',
      path: '/proj/main.ts',
      position: { line: 3, character: 4 },
    });
    expect(compR.kind).toBe('completions');
    const list = (compR as TsCompletionsResponse).completions;
    const map = list.items.find((i) => i.label === 'map');
    expect(map).toBeDefined();
    expect(map?.kind).toBe(CompletionItemKind.Method);

    // completion details for `map`.
    const detailR = await endpoint.dispatch({
      id: 6,
      type: 'ts:getCompletionDetails',
      path: '/proj/main.ts',
      position: { line: 3, character: 4 },
      label: 'map',
    });
    expect(detailR.kind).toBe('completionItem');
    const item = (detailR as TsCompletionItemResponse).item;
    expect(item?.label).toBe('map');
    expect(item?.detail).toContain('map');
  });

  it('references / prepareRename / renameEdits / signatureHelp flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync(
      '/proj/tsconfig.json',
      enc(
        JSON.stringify({
          compilerOptions: {
            strict: true,
            module: 'esnext',
            target: 'es2022',
            moduleResolution: 'bundler',
          },
        }),
      ),
    );
    mem.writeFileSync(
      '/proj/math.ts',
      enc('export function add(a: number, b: number): number {\n  return a + b;\n}\n'),
    );
    mem.writeFileSync(
      '/proj/main.ts',
      enc("import { add } from './math';\nconst total = add(1, 2);\nadd(total, 3);\n"),
    );
    writeRealWorkspaceTypeScript(mem, '/proj');
    const files = snapshotVfsFiles(mem, '/proj');

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });

    // references on the `add` DEFINITION (math.ts, line 0, char 16) — cross-file
    // set. ts only flags `isDefinition` when the query originates at the decl, so
    // includeDeclaration:false meaningfully drops a result only from here.
    const refR = await endpoint.dispatch({
      id: 2,
      type: 'ts:getReferences',
      path: '/proj/math.ts',
      position: { line: 0, character: 16 },
      context: { includeDeclaration: true },
    });
    expect(refR.kind).toBe('locations');
    const refs = (refR as TsLocationsResponse).locations;
    expect(refs.some((l) => l.uri === '/proj/math.ts')).toBe(true);
    expect(refs.some((l) => l.uri === '/proj/main.ts')).toBe(true);

    // excluding the declaration drops the math.ts definition site.
    const refNoDecl = await endpoint.dispatch({
      id: 3,
      type: 'ts:getReferences',
      path: '/proj/math.ts',
      position: { line: 0, character: 16 },
      context: { includeDeclaration: false },
    });
    expect((refNoDecl as TsLocationsResponse).locations.length).toBeLessThan(refs.length);

    // prepareRename on the same `add` → canRename (placeholder `add`).
    const prepR = await endpoint.dispatch({
      id: 4,
      type: 'ts:prepareRename',
      path: '/proj/main.ts',
      position: { line: 1, character: 14 },
    });
    expect(prepR.kind).toBe('prepareRename');
    expect((prepR as TsPrepareRenameResponse).result?.placeholder).toBe('add');

    // renameEdits from the DEFINITION `add` → `sum`: edits in BOTH files, newText
    // `sum` (renaming from the def propagates cross-file; from an import alias it
    // would only touch main.ts).
    const renR = await endpoint.dispatch({
      id: 5,
      type: 'ts:getRenameEdits',
      path: '/proj/math.ts',
      position: { line: 0, character: 16 },
      newName: 'sum',
    });
    expect(renR.kind).toBe('workspaceEdit');
    const renameEdit = (renR as TsWorkspaceEditResponse).edit;
    expect(renameEdit).not.toBeNull();
    const changes = renameEdit?.changes ?? {};
    expect(Object.keys(changes)).toContain('/proj/math.ts');
    expect(Object.keys(changes)).toContain('/proj/main.ts');
    expect(changes['/proj/math.ts']?.[0]?.newText).toBe('sum');

    // signatureHelp inside `add(total, |3)` (line 2, char 11) → 2nd parameter.
    const sigR = await endpoint.dispatch({
      id: 6,
      type: 'ts:getSignatureHelp',
      path: '/proj/main.ts',
      position: { line: 2, character: 11 },
    });
    expect(sigR.kind).toBe('signatureHelp');
    const sig = (sigR as TsSignatureHelpResponse).signatureHelp;
    expect(sig?.signatures[0]?.label).toContain('add(a: number, b: number): number');
    expect(sig?.activeParameter).toBe(1);
  });

  it('codeFixes / organizeImports / formatting flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync(
      '/proj/tsconfig.json',
      enc(
        JSON.stringify({
          compilerOptions: {
            strict: true,
            module: 'esnext',
            target: 'es2022',
            moduleResolution: 'bundler',
          },
        }),
      ),
    );
    mem.writeFileSync(
      '/proj/helper.ts',
      enc('export function greet(name: string): string {\n  return `hi ${name}`;\n}\n'),
    );
    // main.ts: a missing-import (TS2304) for code-fix, unsorted/unused imports
    // for organize-imports, and bad spacing for formatting — one file, 3 probes.
    mem.writeFileSync(
      '/proj/main.ts',
      enc("import { greet } from './helper';\nconst x=1;\nconsole.log(greet('a'),x);\n"),
    );
    writeRealWorkspaceTypeScript(mem, '/proj');
    const files = snapshotVfsFiles(mem, '/proj');

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });

    // formatting: the whole document → ≥1 edit (the `x=1` needs spaces).
    const fmtR = await endpoint.dispatch({
      id: 2,
      type: 'ts:getFormattingEdits',
      path: '/proj/main.ts',
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(fmtR.ok).toBe(true);
    expect(fmtR.kind).toBe('textEdits');
    expect((fmtR as TsTextEditsResponse).textEdits.length).toBeGreaterThan(0);

    // range formatting: just the `const x=1;` line (line 1).
    const rngR = await endpoint.dispatch({
      id: 3,
      type: 'ts:getRangeFormattingEdits',
      path: '/proj/main.ts',
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 10 } },
      options: { tabSize: 2, insertSpaces: true },
    });
    expect(rngR.kind).toBe('textEdits');
    expect((rngR as TsTextEditsResponse).textEdits.length).toBeGreaterThan(0);

    // organize-imports: a no-op here (single, already-sorted, used import) →
    // empty changes (an honest no-op WorkspaceEdit, not a fabricated edit).
    const orgR = await endpoint.dispatch({
      id: 4,
      type: 'ts:organizeImports',
      path: '/proj/main.ts',
    });
    expect(orgR.kind).toBe('workspaceEdit');
    expect((orgR as TsWorkspaceEditResponse).edit?.changes).toEqual({});

    // code-fixes: open a buffer with a missing import (TS2304 for `missing`), then
    // request fixes for the in-range code → an "Add import" CodeAction.
    await endpoint.dispatch({
      id: 5,
      type: 'ts:open',
      path: '/proj/main.ts',
      text: 'const m = greet("x");\nconsole.log(m);\n',
    });
    const diagR = await endpoint.dispatch({
      id: 6,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/main.ts',
    });
    const codes = [...new Set(diags(diagR).map((d) => d.code))].filter(
      (c): c is number => typeof c === 'number',
    );
    expect(codes).toContain(2304); // `greet` is now unimported
    const fixR = await endpoint.dispatch({
      id: 7,
      type: 'ts:getCodeFixes',
      path: '/proj/main.ts',
      range: { start: { line: 0, character: 10 }, end: { line: 0, character: 15 } },
      errorCodes: codes,
    });
    expect(fixR.ok).toBe(true);
    expect(fixR.kind).toBe('codeActions');
    const actions = (fixR as TsCodeActionsResponse).codeActions;
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0]?.kind).toBe('quickfix');
    expect(actions.some((a) => a.title.includes('Add import'))).toBe(true);
  });

  it('long-tail query frames flow through the endpoint', async () => {
    const { fsSync: mem } = createMemoryFs();
    mem.mkdirSync('/proj', { recursive: true });
    mem.writeFileSync(
      '/proj/tsconfig.json',
      enc(
        JSON.stringify({
          compilerOptions: {
            strict: true,
            module: 'esnext',
            target: 'es2022',
            moduleResolution: 'bundler',
          },
        }),
      ),
    );
    mem.writeFileSync('/proj/base.ts', enc('export interface Runner { run(): void }\n'));
    const implText =
      'import { Runner } from "./base";\nexport class Greeter implements Runner { run(): void {} }\n';
    mem.writeFileSync('/proj/impl.ts', enc(implText));
    mem.writeFileSync(
      '/proj/copied.ts',
      enc('import { Greeter } from "./impl";\nconst pastedGreeter = new Greeter();\n'),
    );
    mem.writeFileSync('/proj/paste-target.ts', enc('const pastedGreeter = new Greeter();\n'));
    writeRealWorkspaceTypeScript(mem, '/proj');
    const files = snapshotVfsFiles(mem, '/proj');

    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(files),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });

    const implR = await endpoint.dispatch({
      id: 2,
      type: 'ts:getImplementation',
      path: '/proj/base.ts',
      position: { line: 0, character: 17 },
    });
    expect(implR.ok).toBe(true);
    expect(implR.kind).toBe('locations');
    expect((implR as TsLocationsResponse).locations.some((l) => l.uri === '/proj/impl.ts')).toBe(
      true,
    );

    const flatRefsR = await endpoint.dispatch({
      id: 20,
      type: 'ts:getReferencesAtPosition',
      path: '/proj/base.ts',
      position: { line: 0, character: 17 },
    });
    expect(flatRefsR.ok).toBe(true);
    expect(flatRefsR.kind).toBe('locations');
    expect((flatRefsR as TsLocationsResponse).locations.length).toBeGreaterThan(0);

    const cleanupR = await endpoint.dispatch({ id: 21, type: 'ts:cleanupSemanticCache' });
    expect(cleanupR).toEqual({ id: 21, ok: true, kind: 'ack' });

    const rawClassR = await endpoint.dispatch({
      id: 23,
      type: 'ts:getSemanticClassifications',
      path: '/proj/impl.ts',
      range: { start: { line: 1, character: 13 }, end: { line: 1, character: 20 } },
      format: '2020',
    });
    expect(rawClassR.ok).toBe(true);
    expect(rawClassR.kind).toBe('classifiedSpans');
    expect(rawClassR.kind === 'classifiedSpans' ? rawClassR.spans.length : 0).toBeGreaterThan(0);

    const encodedClassR = await endpoint.dispatch({
      id: 24,
      type: 'ts:getEncodedSemanticClassifications',
      path: '/proj/impl.ts',
      range: { start: { line: 1, character: 13 }, end: { line: 1, character: 20 } },
    });
    expect(encodedClassR.ok).toBe(true);
    expect(encodedClassR.kind).toBe('classifications');
    expect(
      encodedClassR.kind === 'classifications' ? encodedClassR.classifications.spans.length : 0,
    ).toBeGreaterThan(0);

    const lineColumnR = await endpoint.dispatch({
      id: 25,
      type: 'ts:toLineColumnOffset',
      path: '/proj/impl.ts',
      offset: implText.indexOf('Greeter'),
    });
    expect(lineColumnR).toEqual({
      id: 25,
      ok: true,
      kind: 'position',
      position: { line: 1, character: 13 },
    });

    const symbolsR = await endpoint.dispatch({
      id: 3,
      type: 'ts:getDocumentSymbols',
      path: '/proj/impl.ts',
    });
    expect(symbolsR.ok).toBe(true);
    expect(symbolsR.kind).toBe('documentSymbols');

    const pasteText = 'const pastedGreeter = new Greeter();\n';
    const preparePasteR = await endpoint.dispatch({
      id: 4,
      type: 'ts:preparePasteEditsForFile',
      path: '/proj/copied.ts',
      copiedRanges: [{ start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }],
    });
    expect(preparePasteR.ok).toBe(true);
    expect(preparePasteR.kind).toBe('preparePasteEdits');
    expect((preparePasteR as TsPreparePasteEditsResponse).supported).toBe(true);

    const pasteR = await endpoint.dispatch({
      id: 5,
      type: 'ts:getPasteEdits',
      path: '/proj/paste-target.ts',
      pastedText: [pasteText],
      pasteLocations: [{ start: { line: 0, character: 0 }, end: { line: 1, character: 0 } }],
      copiedFrom: {
        file: '/proj/copied.ts',
        ranges: [{ start: { line: 1, character: 0 }, end: { line: 2, character: 0 } }],
      },
    });
    expect(pasteR.ok).toBe(true);
    expect(pasteR.kind).toBe('workspaceEdit');
    expect(
      (pasteR as TsWorkspaceEditResponse).edit?.changes['/proj/paste-target.ts'],
    ).toBeDefined();

    const disposeR = await endpoint.dispatch({ id: 22, type: 'ts:dispose' });
    expect(disposeR).toEqual({ id: 22, ok: true, kind: 'ack' });
  });

  it('a query before init returns an error frame (not a silent empty)', async () => {
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(buildFixture()),
    });
    const r = await endpoint.dispatch({
      id: 1,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('error');
  });

  it('an unavailable refactor edit returns a successful null edit, not a transport error', async () => {
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(buildFixture()),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });

    const r = await endpoint.dispatch({
      id: 2,
      type: 'ts:getRefactorEdits',
      path: '/proj/a.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 6 } },
      refactorName: 'missing-refactor',
      actionName: 'missing-action',
    });

    expect(r.ok).toBe(true);
    expect(r.kind).toBe('workspaceEdit');
    expect((r as TsWorkspaceEditResponse).edit).toBeNull();
  });

  it('serializes NotImplementedError feature ids across the endpoint boundary', async () => {
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(buildFixture()),
    });
    await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });

    const r = await endpoint.dispatch({
      id: 2,
      type: 'ts:applyCodeActionCommand',
      commands: [],
    });

    expect(r.ok).toBe(false);
    expect(r.kind).toBe('error');
    const err = (r as TsErrorResponse).error;
    expect(err.name).toBe('NotImplementedError');
    expect(err.feature).toBe('ts-language-service.applyCodeActionCommand');
  });

  it.each([
    [null, 'null'],
    ['boom', 'boom'],
  ] as const)(
    'serializes non-object thrown values across the endpoint boundary',
    async (thrown, message) => {
      const endpoint = createServiceEndpoint({
        buildFsSync: (): never => {
          throw thrown;
        },
        call: makeFakeFsCall(buildFixture()),
      });

      const r = await endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });

      expect(r.ok).toBe(false);
      expect(r.kind).toBe('error');
      const err = (r as TsErrorResponse).error;
      expect(err.name).toBe('Error');
      expect(err.message).toBe(message);
      expect(err.feature).toBeUndefined();
    },
  );

  it('a frame queued behind a synchronously FAILED init surfaces the real init error', async () => {
    const endpoint = createServiceEndpoint({
      buildFsSync: (): never => {
        throw new Error('sync fs bridge unavailable');
      },
      call: makeFakeFsCall(buildFixture()),
    });

    const initP = endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    const queryP = endpoint.dispatch({
      id: 2,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });

    const [init, query] = await Promise.all([initP, queryP]);
    expect(init.ok).toBe(false);
    expect(query.ok).toBe(false);
    for (const r of [init, query]) {
      expect(r.kind).toBe('error');
      expect((r as TsErrorResponse).error.message).toContain('sync fs bridge unavailable');
    }
  });

  it('a frame arriving while ts:init is still in flight WAITS for it (no "before ts:init" race)', async () => {
    // The fork-IPC pump dispatches each frame independently; `ts:init` is async
    // (it awaits the std-lib load), so an open/query frame the page sends right
    // after init lands at the endpoint while the service is still building. It
    // MUST queue behind the in-flight init (the page never re-sends), not fail.
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: makeFakeFsCall(buildFixture()),
    });
    // Fire init WITHOUT awaiting it, then a query in the SAME tick — the query's
    // dispatch runs before init's build promise resolves.
    const initP = endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    const queryP = endpoint.dispatch({
      id: 2,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    const openP = endpoint.dispatch({
      id: 3,
      type: 'ts:open',
      path: '/proj/a.ts',
      text: 'export const x: number = "bad";\n',
    });
    const [init, query, open] = await Promise.all([initP, queryP, openP]);
    expect(init).toEqual({ id: 1, ok: true, kind: 'ack' });
    expect(query.ok).toBe(true);
    expect(query.kind).toBe('diagnostics');
    expect((query as TsDiagnosticsResponse).diagnostics).toEqual([]);
    expect(open).toEqual({ id: 3, ok: true, kind: 'ack' });
  });

  it('a query after a FAILED init surfaces the real init error (not "before ts:init")', async () => {
    // Init fails (the owner store is unreachable). The failing frame AND every
    // frame queued behind it must carry the REAL cause — never the misleading
    // "before ts:init" (Fidelity: loud, accurate gaps).
    const boom = new Error('owner fs.* RPC unreachable');
    const failingCall = (): never => {
      throw boom;
    };
    const endpoint = createServiceEndpoint({
      buildFsSync: (call) => createRpcFsSync(call),
      call: failingCall,
    });
    const initP = endpoint.dispatch({ id: 1, type: 'ts:init', projectRoot: '/proj' });
    const queryP = endpoint.dispatch({
      id: 2,
      type: 'ts:getSemanticDiagnostics',
      path: '/proj/a.ts',
    });
    const [init, query] = await Promise.all([initP, queryP]);
    expect(init.ok).toBe(false);
    expect(query.ok).toBe(false);
    for (const r of [init, query]) {
      expect(r.kind).toBe('error');
      expect((r as TsErrorResponse).error.message).toContain('owner fs.* RPC unreachable');
    }
  });
});
