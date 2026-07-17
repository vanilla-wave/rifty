import { describe, expect, it } from 'vitest';
import { initialEditorFilesForPreset, workspacePresetPath } from './initial-editor-files.ts';

describe('initial editor files', () => {
  it('uses preset openFiles as the complete ordered tab set', () => {
    expect(
      initialEditorFilesForPreset(
        {
          openFiles: ['public/client.js', 'src/main.js', 'public/client.js'],
        },
        '/scratch',
      ),
    ).toEqual(['/scratch/public/client.js', '/scratch/src/main.js']);
  });

  it('allows root-relative input but rejects workspace escapes', () => {
    expect(workspacePresetPath('/projects/p1', '/src/main.ts')).toBe('/projects/p1/src/main.ts');
    expect(() => workspacePresetPath('/projects/p1', '../other.js')).toThrow(
      'Preset file escapes workspace: ../other.js',
    );
  });

  it('maps preset files into the semantic project root without allowing parent escape', () => {
    expect(initialEditorFilesForPreset({ openFiles: ['src/main.js'] }, '/')).toEqual([
      '/src/main.js',
    ]);
    expect(() => workspacePresetPath('/', '../other.js')).toThrow(
      'Preset file escapes workspace: ../other.js',
    );
  });
});
