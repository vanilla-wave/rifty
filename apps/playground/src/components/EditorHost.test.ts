import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./EditorHost.tsx', import.meta.url)), 'utf8');

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

describe('EditorHost session-guard API (frictionless-first-poke)', () => {
  it('exposes closeActiveTab — closes a closable tab, never the program tab', () => {
    expect(source).toContain('closeActiveTab(): boolean;');
    expect(source).toContain('if (id === PROGRAM_TAB_ID) return false;');
  });

  it('exposes flushPendingWrites — flushes every pending debounced write', () => {
    expect(source).toContain('flushPendingWrites(): void;');
    expect(source).toContain('for (const [path, timer] of [...writeTimers]) {');
  });
});
