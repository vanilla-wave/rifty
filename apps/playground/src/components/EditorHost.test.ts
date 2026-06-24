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
    expect(source).toContain('return id === PROGRAM_TAB_ID ? props.programPath() : id;');
    expect(source).toContain('return path === props.programPath() ? PROGRAM_TAB_ID : path;');
    expect(source).toContain(
      'monaco.editor.setModelLanguage(programModel, languageForPath(path));',
    );
  });
});
