import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./EditorHost.tsx', import.meta.url)), 'utf8');
const workingDiffInput =
  source.match(/export interface EditorWorkingDiffInput \{[\s\S]*?\n\}/)?.[0] ?? '';

describe('EditorHost ordinary initial tabs contract', () => {
  it('has no special program model or program-only props', () => {
    expect(source).not.toContain('PROGRAM_TAB_ID');
    expect(source).not.toContain('programModel');
    expect(source).not.toContain('programValue');
    expect(source).not.toContain('programPath');
    expect(source).not.toContain('programTitle');
    expect(source).not.toContain('onProgramChange');
    expect(source).not.toContain('suppressProgramEcho');
  });

  it('can replace the visible editor set from ordinary initial file paths', () => {
    expect(source).toContain('openInitialFiles(paths: readonly string[]): void;');
    expect(source).toContain('function openInitialFiles(paths: readonly string[]): void');
    expect(source).toContain('resetOpenFileTabs(paths);');
    expect(source).toContain('function titleForFilePath(path: string): string');
    expect(source).toContain('openFileTab(t, path, titleForFilePath(path))');
    expect(source).toContain('editor = monaco.editor.create(container, {');
    expect(source).toContain('model: null,');
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

  it('exposes a flush hook so GIT can publish pending editor writes before reading status', () => {
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
    expect(source).toContain('function disposeDiffTab(id: string): void');
    expect(source).toContain('const pendingDiffOpens = new Map');
    expect(source).toContain('function cancelPendingDiffOpen(id: string): void');
    expect(source).toContain('function cancelPendingDiffOpensForPathTree(');
    expect(source).toContain('function closeDiffTabsForPathTree(');
    expect(source).toContain('closeDiffTabsForPathTree(path, { liveModelOnly: true });');
    expect(source).toContain('if (opts.flushPending !== false) {');
    expect(source).toContain('function closeExternalPathTree(rootPath: string): void');
    expect(source).toContain('closeDiffTabsForPathTree(normalizedRoot);');
    expect(source).toContain('const NO_ACTIVE_TAB_ID = ');
    expect(source).toContain('function closeVisibleTab(id: string): void');
    expect(source).toContain('editor?.setModel(null);');
    expect(source).toContain('const tab = tabs().find((candidate) => candidate.id === id);');
    expect(source).toContain('editor.updateOptions({ readOnly: readOnlyPaths.has(id) });');
    expect(source).toContain('closeFile(id, { flushPending: false });');
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
    expect(source).toContain(
      'pendingDiffOpens.set(id, { token, modified, disposeModified, path });',
    );
    expect(source).toContain('if (!pending || pending.token !== token) return;');
    expect(source).toContain('function clearGitDiffTabs(): void');
    expect(source).toContain(
      'for (const id of [...pendingDiffOpens.keys()]) cancelPendingDiffOpen(id);',
    );
    expect(source).toContain('const root = props.root();');
    expect(source).toContain("setTabs((t) => t.filter((tab) => tab.kind !== 'diff'))");
  });
});
