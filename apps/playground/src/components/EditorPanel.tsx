import * as monaco from 'monaco-editor';
import { onCleanup, onMount } from 'solid-js';

export function EditorPanel(props: { value: string; onChange(value: string): void }) {
  let container: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;

  onMount(() => {
    if (!container) return;
    editor = monaco.editor.create(container, {
      value: props.value,
      language: 'javascript',
      theme: 'vs-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      tabSize: 2,
    });
    editor.onDidChangeModelContent(() => {
      if (editor) props.onChange(editor.getValue());
    });
  });

  onCleanup(() => editor?.dispose());

  return (
    <div ref={container} style={{ height: '100%', background: '#0f1115' }} data-testid="editor" />
  );
}
