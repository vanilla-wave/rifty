import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// RESIDUAL source pins (epic playground-testable-core). EditorHost.tsx is
// unrenderable in node vitest: it module-imports ../glue/monaco-env.ts whose
// `?worker` import only resolves under the bundler. The session state machine
// lives in editor-host-core.ts and its behavioral heirs in
// editor-host-core.test.ts; the greps below pin ONLY component-side wiring a
// node test cannot observe (widget mounts + effect→core-handler hookup).
const source = readFileSync(fileURLToPath(new URL('./EditorHost.tsx', import.meta.url)), 'utf8');
const coreSource = readFileSync(
  fileURLToPath(new URL('./editor-host-core.ts', import.meta.url)),
  'utf8',
);

describe('EditorHost component wiring (residual greps — see header)', () => {
  it('wires each session effect to its core handler and hands the core api to the App', () => {
    expect(source).toContain('createEffect(() => core.handleInitialFilesChanged());');
    expect(source).toContain('createEffect(() => core.handleRootChanged());');
    expect(source).toContain('createEffect(() => core.handleGitStatusChanged());');
    expect(source).toContain('createEffect(() => core.syncActiveEditor());');
    expect(source).toContain('props.registerApi(core.api);');
  });

  it('mounts one model-less Monaco editor plus the diff editor widget', () => {
    expect(source).toContain('editor = monaco.editor.create(container, {');
    expect(source).toContain('model: null,');
    expect(source).toContain('monaco.editor.createDiffEditor');
  });

  it('has no special program model or program-only props', () => {
    const programProps =
      /PROGRAM_TAB_ID|programModel|programValue|programPath|programTitle|onProgramChange|suppressProgramEcho/;
    expect(source).not.toMatch(programProps);
    expect(coreSource).not.toMatch(programProps);
  });
});
