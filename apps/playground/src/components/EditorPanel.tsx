import * as monaco from 'monaco-editor';
import { createEffect, onCleanup, onMount } from 'solid-js';
// Side-effect: configures `MonacoEnvironment.getWorker` before any editor is
// created, so the TS language service runs in a real worker (no console spam).
import '../glue/monaco-env.ts';

let themeDefined = false;

/**
 * Define the editor theme once, anchored on the design-system ink (#0f1115)
 * so the editor surface matches the terminal and pane chrome instead of
 * Monaco's default `vs-dark` grey.
 */
function ensureTheme(): void {
  if (themeDefined) return;
  monaco.editor.defineTheme('rifty-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '626b80', fontStyle: 'italic' },
      { token: 'string', foreground: 'c4f042' },
      { token: 'keyword', foreground: '7fb2ff' },
      { token: 'number', foreground: 'f5b942' },
    ],
    colors: {
      'editor.background': '#0f1115',
      'editor.foreground': '#e8eaf1',
      'editorLineNumber.foreground': '#3c4356',
      'editorLineNumber.activeForeground': '#98a1b6',
      'editor.selectionBackground': '#1f2a12',
      'editor.lineHighlightBackground': '#13161d',
      'editorCursor.foreground': '#c4f042',
      'editorIndentGuide.background1': '#171a23',
      'editorIndentGuide.activeBackground1': '#2a2f3c',
      'editorWidget.background': '#12141b',
      'editorWidget.border': '#1f232e',
    },
  });
  themeDefined = true;
}

export function EditorPanel(props: { value: string; onChange(value: string): void }) {
  let container: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(() => {
    if (!container) return;
    ensureTheme();
    editor = monaco.editor.create(container, {
      value: props.value,
      language: 'javascript',
      theme: 'rifty-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
      fontLigatures: true,
      lineNumbersMinChars: 3,
      padding: { top: 14, bottom: 14 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      tabSize: 2,
      renderLineHighlight: 'all',
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    editor.onDidChangeModelContent(() => {
      if (editor) props.onChange(editor.getValue());
    });
  });

  // React to external source changes (e.g. selecting a preset). Guard against
  // the onChange feedback loop by only writing when the value actually differs
  // from what the model already holds.
  createEffect(() => {
    const next = props.value;
    if (editor && editor.getValue() !== next) {
      editor.setValue(next);
    }
  });

  onCleanup(() => editor?.dispose());

  return <div ref={container} class="rf-editor" data-testid="editor" />;
}
