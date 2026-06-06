/**
 * Multi-model editor host (ADR-0075). One Monaco instance, one `ITextModel` per
 * tab; `editor.setModel()` on switch emits no content event, so tab switches
 * never spuriously write.
 *
 * E2E-load-bearing invariants:
 *  - the permanent program tab is active at boot and is the ONLY tab bound to
 *    `machine.source`/`setSource` — REPL Run and the m10 HMR textarea path
 *    (`[data-testid="editor"] textarea`) stay byte-for-byte unchanged;
 *  - nothing auto-opens a file tab, so the bare editor textarea always hosts
 *    the program model;
 *  - external program-source changes (presets / mode transitions) write the
 *    program model under the single `suppressProgramEcho` flag the change
 *    listener checks-and-clears, so they can't echo back into `setSource`;
 *  - opening `/workspace/src/main.js` from the explorer focuses the program tab
 *    instead of creating a second model (no dual writer to that path).
 */
import { basename } from '@riftydev/vfs';
import * as monaco from 'monaco-editor';
import { type Accessor, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  type EditorTab,
  PROGRAM_TAB_ID,
  closeTab,
  initialTabs,
  nextActiveAfterClose,
  openFileTab,
  setDirty,
  setProgramTitle,
} from '../glue/editor-tabs.ts';
import { type FsOpsTarget, looksBinary } from '../glue/fs-ops.ts';
// Side-effect: wires MonacoEnvironment.getWorker before the first editor.
import '../glue/monaco-env.ts';
import { EditorTabs } from './EditorTabs.tsx';

/** Program edits write here; opening this exact path focuses the program tab. */
export const PROGRAM_MIRROR_PATH = '/workspace/src/main.js';

/** Imperative handle handed to the App so the explorer can open files. */
export interface EditorApi {
  openFile(path: string): void;
}

export interface EditorHostProps {
  readonly programValue: Accessor<string>;
  readonly programTitle: Accessor<string>;
  onProgramChange(value: string): void;
  readonly vfs: FsOpsTarget;
  registerApi(api: EditorApi): void;
  onActive(info: { label: string; language: string; path?: string }): void;
  onFileWritten?(path: string): void;
  onError?(message: string): void;
  /** When set (real-vite mode, ADR-0080), opening a node_modules path reads its
   *  bytes async from the worker instead of the sync VFS. `content` is null when
   *  the file exceeds the read cap. */
  readNodeModulesFile?(path: string): Promise<{ size: number; content: Uint8Array | null }>;
}

let themeDefined = false;
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

function languageForPath(path: string): string {
  const dot = path.lastIndexOf('.');
  const ext = dot <= 0 ? '' : path.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'cjs':
    case 'mjs':
    case 'jsx':
      return 'javascript';
    case 'json':
      return 'json';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'md':
    case 'markdown':
      return 'markdown';
    default:
      return 'plaintext';
  }
}

const dec = new TextDecoder();
const enc = new TextEncoder();

export function EditorHost(props: EditorHostProps) {
  let container: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let programModel: monaco.editor.ITextModel | undefined;
  let suppressProgramEcho = false;

  const models = new Map<string, monaco.editor.ITextModel>();
  const readOnlyPaths = new Set<string>();
  const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const [tabs, setTabs] = createSignal<EditorTab[]>(initialTabs(props.programTitle()));
  const [activeId, setActiveId] = createSignal<string>(PROGRAM_TAB_ID);

  function flushWrite(path: string): void {
    const m = models.get(path);
    if (!m) return;
    try {
      props.vfs.writeFileSync(path, enc.encode(m.getValue()));
      setTabs((t) => setDirty(t, path, false));
      props.onFileWritten?.(path);
    } catch (err) {
      props.onError?.((err as Error).message);
    }
  }

  function scheduleWrite(path: string): void {
    const prev = writeTimers.get(path);
    if (prev) clearTimeout(prev);
    writeTimers.set(
      path,
      setTimeout(() => {
        writeTimers.delete(path);
        flushWrite(path);
      }, 300),
    );
  }

  function isNodeModulesPath(path: string): boolean {
    return path.split('/').includes('node_modules');
  }

  /**
   * Open a node_modules file (ADR-0080). Bytes live in the worker realm, so the
   * read is async: open a loading tab, await the remote read, then fill in the
   * content (or a too-large / binary / error placeholder). Always read-only —
   * no write path back to the worker's node_modules.
   */
  function openNodeModulesFile(
    path: string,
    read: (p: string) => Promise<{ size: number; content: Uint8Array | null }>,
  ): void {
    if (models.has(path)) {
      setActiveId(path);
      return;
    }
    readOnlyPaths.add(path);
    const model = monaco.editor.createModel('// loading…', languageForPath(path));
    models.set(path, model);
    setTabs((t) => openFileTab(t, path, basename(path)));
    setActiveId(path);
    read(path).then(
      (res) => {
        // The tab may have been closed (model disposed) during the await.
        if (models.get(path) !== model) return;
        if (res.content === null) {
          model.setValue(`// too large to preview — ${res.size} bytes`);
        } else if (looksBinary(res.content)) {
          model.setValue(`// binary file — ${res.size} bytes — not editable`);
        } else {
          model.setValue(dec.decode(res.content));
        }
      },
      (err: unknown) => {
        if (models.get(path) === model) {
          model.setValue(`// failed to read node_modules file: ${(err as Error).message}`);
        }
        props.onError?.((err as Error).message);
      },
    );
  }

  function openFile(path: string): void {
    if (path === PROGRAM_MIRROR_PATH) {
      setActiveId(PROGRAM_TAB_ID);
      return;
    }
    const readNm = props.readNodeModulesFile;
    if (readNm && isNodeModulesPath(path)) {
      openNodeModulesFile(path, readNm);
      return;
    }
    if (models.has(path)) {
      setActiveId(path);
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = props.vfs.readFileBytesSync(path);
    } catch (err) {
      props.onError?.((err as Error).message);
      return;
    }
    let model: monaco.editor.ITextModel;
    if (looksBinary(bytes)) {
      readOnlyPaths.add(path);
      model = monaco.editor.createModel(
        `// binary file — ${bytes.length} bytes — not editable`,
        'plaintext',
      );
    } else {
      model = monaco.editor.createModel(dec.decode(bytes), languageForPath(path));
      // Read-only source (e.g. real-vite worker mirror, ADR-0076): view-only,
      // no write path back to the worker realm.
      if (props.vfs.readOnly) readOnlyPaths.add(path);
    }
    models.set(path, model);
    setTabs((t) => openFileTab(t, path, basename(path)));
    setActiveId(path);
  }

  function closeFile(path: string): void {
    const timer = writeTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      writeTimers.delete(path);
      flushWrite(path);
    }
    const next = nextActiveAfterClose(tabs(), path, activeId());
    setTabs((t) => closeTab(t, path));
    const m = models.get(path);
    models.delete(path);
    readOnlyPaths.delete(path);
    setActiveId(next);
    // Dispose after the activeId effect has switched the editor off this model.
    queueMicrotask(() => m?.dispose());
  }

  onMount(() => {
    if (!container) return;
    ensureTheme();
    programModel = monaco.editor.createModel(props.programValue(), 'javascript');
    models.set(PROGRAM_TAB_ID, programModel);
    editor = monaco.editor.create(container, {
      model: programModel,
      theme: 'rifty-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
      fontLigatures: true,
      lineNumbersMinChars: 3,
      padding: { top: 12, bottom: 12 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      tabSize: 2,
      renderLineHighlight: 'all',
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });

    editor.onDidChangeModelContent(() => {
      const id = activeId();
      if (id === PROGRAM_TAB_ID) {
        if (suppressProgramEcho || !programModel) return;
        props.onProgramChange(programModel.getValue());
      } else {
        // Read-only tabs (snapshot mirror, ADR-0076 / node_modules, ADR-0080)
        // have no write path back; a programmatic setValue (async load) must
        // not schedule a write into a read-only VFS.
        if (readOnlyPaths.has(id)) return;
        setTabs((t) => setDirty(t, id, true));
        scheduleWrite(id);
      }
    });

    props.registerApi({ openFile });

    // External program-source sync (presets / mode transitions): the one guarded
    // programmatic write; the change listener skips the echo.
    createEffect(() => {
      const next = props.programValue();
      if (programModel && programModel.getValue() !== next) {
        suppressProgramEcho = true;
        programModel.setValue(next);
        suppressProgramEcho = false;
      }
    });

    createEffect(() => {
      const title = props.programTitle();
      setTabs((t) => setProgramTitle(t, title));
    });

    createEffect(() => {
      const id = activeId();
      const model = models.get(id) ?? programModel;
      if (!editor || !model) return;
      if (editor.getModel() !== model) editor.setModel(model);
      editor.updateOptions({ readOnly: readOnlyPaths.has(id) });
      props.onActive({
        label: id === PROGRAM_TAB_ID ? 'main.js' : basename(id),
        language: model.getLanguageId(),
        path: id === PROGRAM_TAB_ID ? undefined : id,
      });
    });
  });

  onCleanup(() => {
    for (const timer of writeTimers.values()) clearTimeout(timer);
    writeTimers.clear();
    editor?.dispose();
    for (const m of models.values()) m.dispose();
    models.clear();
  });

  return (
    <div class="rf-editorhost">
      <EditorTabs
        tabs={tabs()}
        activeId={activeId()}
        onSelect={(id) => setActiveId(id)}
        onClose={closeFile}
      />
      <div class="rf-editor__surface">
        <div ref={container} class="rf-editor" data-testid="editor" />
      </div>
    </div>
  );
}
