/**
 * Multi-model editor host (ADR-0075). One Monaco instance, one `ITextModel` per
 * tab; `editor.setModel()` on switch emits no content event, so tab switches
 * never spuriously write.
 *
 * E2E-load-bearing invariants:
 *  - initial editor tabs are ordinary file tabs supplied by preset/project data;
 *  - opening the same path from Explorer, GIT, LS navigation, or initial tabs
 *    reuses the same model (no dual writer to that path).
 *
 * The session state machine lives in {@link ./editor-host-core.ts} (node-testable);
 * this component mounts the Monaco widgets and wires effects to core handlers.
 */
import * as monaco from 'monaco-editor';
import { createEffect, onCleanup, onMount } from 'solid-js';
import { MONO_FONT_STACK } from '../glue/fonts.ts';
// Side-effect: wires MonacoEnvironment.getWorker before the first editor.
import '../glue/monaco-env.ts';
import { EditorTabs } from './EditorTabs.tsx';
import { type EditorHostProps, createEditorHostCore } from './editor-host-core.ts';

export type {
  EditorApi,
  EditorDocumentEvent,
  EditorGitOriginalTextInput,
  EditorHostProps,
  EditorOpenFileOptions,
  EditorTextDiffInput,
  EditorWorkingDiffInput,
} from './editor-host-core.ts';

let themeDefined = false;
/** Soft Panels editor theme — gravity syntax tokens on the #1D1F26 panel. */
function ensureTheme(): void {
  if (themeDefined) return;
  monaco.editor.defineTheme('rifty-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'ffffff4d', fontStyle: 'italic' },
      { token: 'string', foreground: '6fd89a' },
      { token: 'keyword', foreground: 'c7f05a' },
      { token: 'number', foreground: 'ffad7a' },
      { token: 'type', foreground: '7fb5ff' },
      { token: 'attribute.name', foreground: 'c9a6ff' },
      { token: 'key', foreground: 'c9a6ff' },
      { token: 'string.key.json', foreground: 'c9a6ff' },
    ],
    colors: {
      'editor.background': '#1d1f26',
      'editor.foreground': '#ddddde',
      'editorLineNumber.foreground': '#ffffff38',
      'editorLineNumber.activeForeground': '#ffffff80',
      'editor.selectionBackground': '#c7f05a26',
      'editor.lineHighlightBackground': '#ffffff08',
      'editorCursor.foreground': '#c7f05a',
      'editorIndentGuide.background1': '#ffffff12',
      'editorIndentGuide.activeBackground1': '#ffffff24',
      'editorWidget.background': '#23262e',
      'editorWidget.border': '#ffffff1f',
    },
  });
  themeDefined = true;
}

let builtinTsRetired = false;
/**
 * Make the rifty worker-resident TS language service the SINGLE source of truth
 * for ALL JS/TS intelligence (ADR-0166 P1.9b diagnostics + phase 2 hover /
 * completion / go-to-definition): retire Monaco's bundled `ts.worker`. One-time,
 * before the first `monaco.editor.create`.
 *
 * Two narrowings:
 *  1. `setDiagnosticsOptions(off)` — no built-in validation (rifty owns squiggles).
 *  2. `setModeConfiguration(...)` — turn OFF every PROJECT-AWARE built-in provider
 *     (completionItems / hovers / definitions / references / documentHighlights /
 *     rename / signatureHelp / codeActions / inlayHints) AND formatting
 *     (documentFormattingEdits / documentRangeFormattingEdits / onTypeFormattingEdits,
 *     ADR-0166 phase 4 — rifty now owns formatting too). Monaco's worker only
 *     sees its isolated lib.d.ts (no VFS / tsconfig / node_modules) — the
 *     "isolated approximation that lies" ADR-0166 rejects. rifty's relay-backed
 *     providers (`glue/ts-ls-monaco-providers.ts`) serve hover/completion/goto/
 *     code-actions/organize-imports/formatting/document-symbols/folding/inlay
 *     hints/highlights/semantic tokens. Syntax highlighting is the Monarch
 *     tokenizer, independent of the worker, so it is unaffected either way.
 */
function retireBuiltinTsIntelligence(): void {
  if (builtinTsRetired) return;
  const off = { noSemanticValidation: true, noSyntacticValidation: true };
  const modeOff = {
    completionItems: false,
    hovers: false,
    definitions: false,
    references: false,
    documentHighlights: false,
    rename: false,
    signatureHelp: false,
    codeActions: false,
    inlayHints: false,
    diagnostics: false,
    // ADR-0166 phase 4: rifty now owns formatting (no competing built-in) — its
    // relay-backed document/range formatters serve real tsserver-default edits.
    documentFormattingEdits: false,
    documentRangeFormattingEdits: false,
    onTypeFormattingEdits: false,
    documentSymbols: false,
  };
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(off);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(off);
  monaco.languages.typescript.typescriptDefaults.setModeConfiguration(modeOff);
  monaco.languages.typescript.javascriptDefaults.setModeConfiguration(modeOff);
  builtinTsRetired = true;
}

export function EditorHost(props: EditorHostProps) {
  let container: HTMLDivElement | undefined;
  let diffContainer: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let diffEditor: monaco.editor.IStandaloneDiffEditor | undefined;
  let dirtyGutterDecorations: monaco.editor.IEditorDecorationsCollection | undefined;
  let editorOpenerDisposable: monaco.IDisposable | undefined;

  const core = createEditorHostCore(props, {
    getEditor: () => editor,
    getDiffEditor: () => diffEditor,
    getDirtyGutter: () => dirtyGutterDecorations,
  });

  onMount(() => {
    if (!container) return;
    ensureTheme();
    retireBuiltinTsIntelligence();
    editor = monaco.editor.create(container, {
      model: null,
      theme: 'rifty-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 12.5,
      lineHeight: 21,
      fontFamily: MONO_FONT_STACK,
      fontLigatures: true,
      lineNumbersMinChars: 3,
      padding: { top: 14, bottom: 14 },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      tabSize: 2,
      renderLineHighlight: 'all',
      // No overview ruler: with the minimap off it only added a colored strip
      // that long lines visually collided with at the right edge.
      overviewRulerLanes: 0,
      overviewRulerBorder: false,
      hideCursorInOverviewRuler: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
    });
    dirtyGutterDecorations = editor.createDecorationsCollection();
    if (diffContainer) {
      diffEditor = monaco.editor.createDiffEditor(diffContainer, {
        theme: 'rifty-dark',
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 12.5,
        lineHeight: 21,
        fontFamily: MONO_FONT_STACK,
        fontLigatures: true,
        renderSideBySide: true,
        scrollBeyondLastLine: false,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
      });
    }
    editorOpenerDisposable = monaco.editor.registerEditorOpener({
      openCodeEditor(source, resource, selectionOrPosition) {
        if (!editor || source !== editor) return false;
        return core.openInHostEditor(resource, selectionOrPosition);
      },
    });

    props.registerApi(core.api);

    // E2E-only window hooks (ADR-0166 P1.9d) — DEV-only: `import.meta.env.DEV`
    // gates them so Vite strips them from the production bundle entirely (mirrors
    // the `#test=execsync` harness gate in main.tsx). The e2e runs against
    // `pnpm dev` (DEV=true), so it still sees them; prod never exposes them.
    if (import.meta.env.DEV) {
      // Read hook: rifty-TS marker count for a VFS path — deterministic proof for
      // the LS e2e (a CSS `.squiggly-error` query is render-timing-flaky).
      (globalThis as unknown as { __riftyTsMarkers?: (path: string) => number }).__riftyTsMarkers =
        (path: string): number => {
          const model = core.modelForPath(path);
          if (!model) return -1; // no model open for this path
          return monaco.editor.getModelMarkers({ resource: model.uri, owner: 'rifty-ts' }).length;
        };
      // Write hook: set an open model's whole content. Drives the EXACT same
      // `onDidChangeModelContent` the keyboard fires (→ emitDocument('change') →
      // debounced ts:update → the real LS relay → real diagnostics), so the
      // pipeline under test is 100% real — only the text delivery is
      // deterministic (Monaco's Cmd/Ctrl-A select-all is unreliable under
      // Playwright). Returns false if no model is open.
      (
        globalThis as unknown as { __riftySetEditorValue?: (path: string, text: string) => boolean }
      ).__riftySetEditorValue = (path: string, text: string): boolean => {
        const model = core.modelForPath(path);
        if (!model) return false;
        model.setValue(text);
        return true;
      };
    }

    createEffect(() => core.handleInitialFilesChanged());
    createEffect(() => core.handleRootChanged());
    createEffect(() => core.handleGitStatusChanged());
    createEffect(() => core.syncActiveEditor());
  });

  onCleanup(() => {
    core.teardownPendingWork();
    editorOpenerDisposable?.dispose();
    dirtyGutterDecorations?.clear();
    diffEditor?.dispose();
    editor?.dispose();
    core.teardownModels();
  });

  return (
    <div class="rf-editorhost rf-card">
      <EditorTabs
        tabs={core.tabs()}
        activeId={core.activeId()}
        onSelect={(id) => core.setActiveId(id)}
        onClose={core.closeFile}
        previewUrl={props.previewUrl?.()}
        onOpenPreviewTab={props.onOpenPreviewTab}
      />
      <div class="rf-editor__surface">
        <div
          ref={container}
          class="rf-editor"
          data-testid="editor"
          data-active={core.activeTabKind() !== 'diff'}
        />
        <div
          ref={diffContainer}
          class="rf-diff-editor"
          data-active={core.activeTabKind() === 'diff'}
        />
      </div>
    </div>
  );
}
