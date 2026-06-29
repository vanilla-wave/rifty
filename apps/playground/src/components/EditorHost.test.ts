import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./EditorHost.tsx', import.meta.url)), 'utf8');
const workingDiffInput =
  source.match(/export interface EditorWorkingDiffInput \{[\s\S]*?\n\}/)?.[0] ?? '';

describe('EditorHost program sync contract', () => {
  it('always clears the programmatic echo guard after program model writes', () => {
    expect(source).toContain(`try {
          suppressProgramEcho = true;
          programModel.setValue(next);
        } finally {
          suppressProgramEcho = false;
        }`);
  });

  it('syncs external program source into the program model, not the active editor model', () => {
    expect(source).toContain('programModel.setValue(next)');
    expect(source).not.toContain('editor.getModel()?.setValue(next)');
    expect(source).not.toContain('editor.getModel().setValue(next)');
  });

  it('maps the program model through a reactive path and language', () => {
    expect(source).toContain('readonly programPath: Accessor<string>;');
    expect(source).toContain('return id === PROGRAM_TAB_ID ? currentProgramPath : id;');
    expect(source).toContain('return path === currentProgramPath ? PROGRAM_TAB_ID : path;');
    expect(source).not.toContain('return id === PROGRAM_TAB_ID ? props.programPath() : id;');
    expect(source).not.toContain('return path === props.programPath() ? PROGRAM_TAB_ID : path;');
    expect(source).toContain(
      'monaco.editor.setModelLanguage(programModel, languageForPath(path));',
    );
  });
});

describe('EditorHost git diff contract', () => {
  it('exposes an owner-fed working-vs-original diff API and mounts Monaco DiffEditor', () => {
    expect(source).toContain('openWorkingDiff(input: EditorWorkingDiffInput): void;');
    expect(source).toContain('function openWorkingDiff(input: EditorWorkingDiffInput): void');
    expect(source).toContain(
      'readGitOriginalText?(input: EditorGitOriginalTextInput): Promise<string>;',
    );
    expect(source).toContain('function riftyGitOriginalUri(path: string, ref: string)');
    expect(source).toContain('monaco.editor.createDiffEditor');
    expect(source).toContain('diffEditor.setModel({ original, modified })');
    expect(source).toContain('openDiffTab(');
    expect(workingDiffInput).not.toContain('readonly original: string;');
  });

  it('renders dirty gutter marks from the same owner HEAD original text as Open Changes', () => {
    expect(source).toContain("from '../glue/dirty-gutter.ts';");
    expect(source).toContain('dirtyGutterDecorations');
    expect(source).toContain('const dirtyGutterLocalPaths = new Set<string>();');
    expect(source).toContain('dirtyGutterLocalPaths.add(docPathForTab(id));');
    expect(source).toContain('linesDecorationsClassName: `rf-dirty-gutter');
    expect(source).toContain('readGitOriginalTextCached(path, ref)');
    expect(source).toContain('(!code && !localChange)');
    expect(source).toContain('props.gitStatus?.()');
  });

  it('exposes a flush hook so SCM can publish pending editor writes before reading status', () => {
    expect(source).toContain('flushPendingWrites(): Promise<void>;');
    expect(source).toContain(
      'onFileWritten?(path: string, content: string): Promise<void> | void;',
    );
    expect(source).toContain('async function flushPendingWrites(): Promise<void>');
    expect(source).toContain('const inFlightWrites = new Map<string, Promise<void>>();');
    expect(source).toContain('function flushWriteTracked(path: string): Promise<void>');
    expect(source).toContain('for (;;) {');
    expect(source).toContain('const inFlight = [...inFlightWrites.values()];');
    expect(source).toContain('const pending = [...writeTimers.keys()];');
    expect(source).toContain('writeTimers.delete(path);');
    expect(source).toContain(
      'await Promise.all([...inFlight, ...pending.map((path) => flushWriteTracked(path))]);',
    );
    expect(source).toContain('if (inFlightWrites.size === 0 && writeTimers.size === 0) return;');
    expect(source).toContain('void flushWriteTracked(path).catch(reportWriteError);');
    expect(source).toContain('flushPendingWrites,');
  });

  it('exposes non-writing close hooks for owner-side rename/delete lifecycles', () => {
    expect(source).toContain('closePath(path: string): void;');
    expect(source).toContain('closePathTree(path: string): void;');
    expect(source).toContain(
      'function closeFile(path: string, opts: { readonly flushPending?: boolean } = {}): void',
    );
    expect(source).toContain('if (opts.flushPending !== false) {');
    expect(source).toContain('function closeExternalPathTree(rootPath: string): void');
    expect(source).toContain('const NO_ACTIVE_TAB_ID = ');
    expect(source).toContain('function closeVisibleTab(id: string): void');
    expect(source).toContain('unregisterModel(PROGRAM_TAB_ID);');
    expect(source).toContain('editor?.setModel(null);');
    expect(source).toContain('const tab = tabs().find((candidate) => candidate.id === id);');
    expect(source).toContain(
      'const model = models.get(id) ?? (id === PROGRAM_TAB_ID ? programModel : undefined);',
    );
    expect(source).toContain('if (programModel && !models.has(PROGRAM_TAB_ID)) {');
    expect(source).toContain("emitDocument(PROGRAM_TAB_ID, 'open');");
    expect(source).toContain('externalWriteClosedPaths.add(path);');
    expect(source).toContain('function setReadOnlyPath(id: string, readOnly: boolean): void');
    expect(source).toContain('editor?.updateOptions({ readOnly });');
    expect(source).toContain('setReadOnlyPath(PROGRAM_TAB_ID, true);');
    expect(source).toContain(
      'props.onError?.(`${basename(path)} was moved or deleted; program editor is read-only`);',
    );
    expect(source).toContain('closeFile(id, { flushPending: false });');
    expect(source).toContain('if (externalWriteClosedPaths.has(currentProgramPath)) {');
    expect(source).toContain('basename(currentProgramPath)');
    expect(source).toContain('was moved or deleted; program editor is read-only');
    expect(source).toContain('untrack(() => setReadOnlyPath(PROGRAM_TAB_ID, false));');
    expect(source).toContain('closePath: (path) => closeExternalPathTree(path),');
    expect(source).toContain('closePathTree: (path) => closeExternalPathTree(path),');
  });

  it('exposes a generic text diff API for Explorer blob-vs-blob compare', () => {
    expect(source).toContain('export interface EditorTextDiffInput');
    expect(source).toContain('openTextDiff(input: EditorTextDiffInput): void;');
    expect(source).toContain('function openTextDiff(input: EditorTextDiffInput): void');
    expect(source).toContain("scheme: 'rifty-compare-original'");
    expect(source).toContain("scheme: 'rifty-compare-modified'");
    expect(source).toContain('query: `id=${encodeURIComponent(input.id)}`');
    expect(source).toContain('originalTitle: input.originalTitle');
    expect(source).toContain('modifiedTitle: input.modifiedTitle');
    expect(source).toContain('openTextDiff,');
  });

  it('rejects placeholder working models and tears git diffs down on root switches', () => {
    expect(source).toContain('if (modified && readOnlyPaths.has(tabId))');
    expect(source).toContain('working file is not text-editable');
    expect(source).toContain('readonly deleted?: boolean;');
    expect(source).toContain(
      'let modified = input.deleted === true ? undefined : models.get(tabId);',
    );
    expect(source).toContain('function clearGitDiffTabs(): void');
    expect(source).toContain('const root = props.root();');
    expect(source).toContain("setTabs((t) => t.filter((tab) => tab.kind !== 'diff'))");
  });
});
