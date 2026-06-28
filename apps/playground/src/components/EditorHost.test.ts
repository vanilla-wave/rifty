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
    expect(source).toContain('linesDecorationsClassName: `rf-dirty-gutter');
    expect(source).toContain('readGitOriginalTextCached(path, ref)');
    expect(source).toContain('props.gitStatus?.()');
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
