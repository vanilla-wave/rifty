/**
 * Multi-model editor host (ADR-0075). One Monaco instance, one `ITextModel` per
 * tab; `editor.setModel()` on switch emits no content event, so tab switches
 * never spuriously write.
 *
 * E2E-load-bearing invariants:
 *  - the permanent program tab is active at boot and is the ONLY tab bound to
 *    `machine.source`/`setSource` — the m10 HMR textarea path
 *    (`[data-testid="editor"] textarea`) stays byte-for-byte unchanged;
 *  - preset tabs may auto-open inactive, but the bare editor textarea still
 *    hosts the program model until the user explicitly switches tabs;
 *  - external program-source changes (presets / mode transitions) write the
 *    program model under the single `suppressProgramEcho` flag the change
 *    listener checks-and-clears, so they can't echo back into `setSource`;
 *  - opening the program-mirror path (active template entry, ADR-0165 §4)
 *    from the explorer focuses the program tab instead of creating a second
 *    model (no dual writer to that path).
 */
import { basename } from '@riftydev/vfs';
import * as monaco from 'monaco-editor';
import { type Accessor, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { classifyOpen } from '../glue/editor-open.ts';
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
import { MONO_FONT_STACK } from '../glue/fonts.ts';
import { type FsOpsTarget, looksBinary } from '../glue/fs-ops.ts';
// Side-effect: wires MonacoEnvironment.getWorker before the first editor.
import '../glue/monaco-env.ts';
import { EditorTabs } from './EditorTabs.tsx';
export interface EditorOpenFileOptions {
  readonly activate?: boolean;
  /**
   * Reveal + place the cursor at this 1-based position after opening (ADR-0166
   * P1.9c Problems click-to-jump). Monaco-convention coordinates (lineNumber /
   * column, both 1-based). Applied once the tab is active.
   */
  readonly reveal?: { readonly line: number; readonly column: number };
}

/** A model open/change/close event the page LS client reacts to (ADR-0166 P1.9b). */
export interface EditorDocumentEvent {
  /** Absolute VFS path (the program tab maps to the active template entry). */
  readonly path: string;
  /** Current model text (empty on `close`). */
  readonly text: string;
  readonly kind: 'open' | 'change' | 'close';
}

/** Imperative handle handed to the App so the explorer can open files. */
export interface EditorApi {
  openFile(path: string, options?: EditorOpenFileOptions): void;
  /**
   * Set the rifty-TS diagnostic markers for an open model (ADR-0166 P1.9b). `path`
   * is the absolute VFS path (program tab -> active template entry); a no-op
   * if no model is open for it. Owns the `'rifty-ts'` marker owner so it never
   * clobbers Monaco's own markers (which are disabled anyway).
   */
  setMarkers(path: string, markers: monaco.editor.IMarkerData[]): void;
  /**
   * Subscribe to model open/change/close (ADR-0166 P1.9b) so the page can push
   * `ts:open`/`ts:update`/`ts:close` and request diagnostics. Returns an
   * unsubscribe. The program tab reports the active template entry path.
   */
  onDocument(cb: (ev: EditorDocumentEvent) => void): () => void;
  /**
   * VFS path for an open Monaco model (ADR-0166 phase 2): the inverse of the
   * private model map, so an LS provider handed a `model` can query the service
   * by path (the program tab's model maps back to the active template entry).
   * `undefined` if the model is not one of ours (e.g. a foreign/disposed model).
   */
  pathForModel(model: monaco.editor.ITextModel): string | undefined;
  /**
   * Ensure a Monaco model exists for `path` and return its `Uri` (ADR-0166 phase
   * 2 go-to-definition): a definition can target a file not currently open — a
   * sibling workspace file or a node_modules `.d.ts`. Opens it read-only (via the
   * same owner read-port path the explorer uses) WITHOUT activating its tab, so
   * Monaco can resolve the `Location` to a real model + reveal range. `undefined`
   * when no model can be made for `path` (no bytes anywhere — e.g. the synthetic
   * `/ts-lib/` std-lib whose text lives only inside the LS worker).
   */
  ensureModel(path: string, options?: { readonly isNewFile?: boolean }): monaco.Uri | undefined;
  /**
   * Dry-run companion for {@link ensureModel}: returns whether a model can be
   * made without opening tabs, creating new-file models, or subscribing to a
   * future snapshot frame. Used by workspace edits to validate every target
   * before any editor-visible side effect.
   */
  canEnsureModel(path: string, options?: { readonly isNewFile?: boolean }): boolean;
}

export interface EditorHostProps {
  readonly programValue: Accessor<string>;
  readonly programPath: Accessor<string>;
  readonly programTitle: Accessor<string>;
  /** Active root (ADR-0165 §4): the program-mirror path is `<root>/src/main.js`,
   *  read reactively so a project switch re-keys which path focuses the program
   *  tab + which path the active program tab reports to the explorer. */
  readonly root: Accessor<string>;
  onProgramChange(value: string): void;
  readonly vfs: FsOpsTarget;
  registerApi(api: EditorApi): void;
  onActive(info: { label: string; language: string; path?: string }): void;
  /** Editor save → the OWNER store (ADR-0148, single-store-owner model): the
   *  workspace owner is the single authoritative store; `content` is the new file
   *  text. */
  onFileWritten?(path: string, content: string): void;
  onError?(message: string): void;
  readonly previewUrl?: Accessor<string | undefined>;
  onOpenPreviewTab?(): void;
  /** Async owner read-port (ADR-0080, widened ADR-0148): opening a file the sync
   *  `vfs` (owner snapshot) does not hold — node_modules, over-cap, or owner-only
   *  (shell-written) — reads its bytes from the owner. `content` is null when over
   *  the read cap. Files read this way are view-only. */
  readNodeModulesFile?(path: string): Promise<{ size: number; content: Uint8Array | null }>;
}

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

export function EditorHost(props: EditorHostProps) {
  let container: HTMLDivElement | undefined;
  let editor: monaco.editor.IStandaloneCodeEditor | undefined;
  let programModel: monaco.editor.ITextModel | undefined;
  let currentProgramPath = props.programPath();
  let suppressProgramEcho = false;
  // A reveal queued by `openFile({reveal})` (ADR-0166 P1.9c Problems jump),
  // applied once the target tab is the editor's active model (the activeId effect
  // runs after the signal write). {tabId, line, column} — 1-based Monaco coords.
  let pendingReveal: { id: string; line: number; column: number } | undefined;

  const models = new Map<string, monaco.editor.ITextModel>();
  // Reverse index `model.uri.toString() → tab id` (ADR-0166 phase 2): an LS
  // provider is handed a Monaco `model`, but the service is keyed by VFS path —
  // this resolves the model back to its tab id (→ path via {@link docPathForTab}).
  // Kept in lockstep with `models` on every create/dispose.
  const modelUriToTabId = new Map<string, string>();
  const modelContentDisposables = new Map<string, monaco.IDisposable>();
  const readOnlyPaths = new Set<string>();
  const writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // path → unsubscribe for an in-flight "await the next snapshot frame" retry
  // (a seeded project file racing the owner publish). Cleared once the file
  // opens; torn down on unmount so a never-arriving frame leaks nothing.
  const snapshotAwaits = new Map<string, () => void>();
  // Page LS-client subscribers (ADR-0166 P1.9b): notified on model open/change/close.
  const documentListeners = new Set<(ev: EditorDocumentEvent) => void>();

  /** Tab id → absolute VFS path: the program tab mirrors `props.programPath()`;
   *  every other tab id IS its
   *  absolute path (file-explorer / preset opens key by path). */
  function docPathForTab(id: string): string {
    return id === PROGRAM_TAB_ID ? props.programPath() : id;
  }
  /** Inverse of {@link docPathForTab} — the model key for a VFS path. */
  function tabIdForPath(path: string): string {
    return path === props.programPath() ? PROGRAM_TAB_ID : path;
  }
  /** Track a model under its tab id + index its uri (keeps `modelUriToTabId` in sync). */
  function registerModel(id: string, model: monaco.editor.ITextModel): void {
    modelContentDisposables.get(id)?.dispose();
    models.set(id, model);
    modelUriToTabId.set(model.uri.toString(), id);
    modelContentDisposables.set(
      id,
      model.onDidChangeContent(() => handleModelContentChange(id)),
    );
  }
  /** Drop a model from both maps; returns it for disposal. */
  function unregisterModel(id: string): monaco.editor.ITextModel | undefined {
    const model = models.get(id);
    if (model) modelUriToTabId.delete(model.uri.toString());
    modelContentDisposables.get(id)?.dispose();
    modelContentDisposables.delete(id);
    models.delete(id);
    return model;
  }
  function handleModelContentChange(id: string): void {
    if (id === PROGRAM_TAB_ID) {
      emitDocument(id, 'change');
      if (suppressProgramEcho || !programModel) return;
      props.onProgramChange(programModel.getValue());
      return;
    }
    if (readOnlyPaths.has(id)) return;
    emitDocument(id, 'change');
    setTabs((t) => setDirty(t, id, true));
    scheduleWrite(id);
  }
  function emitDocument(id: string, kind: EditorDocumentEvent['kind']): void {
    if (documentListeners.size === 0) return;
    const model = models.get(id);
    const text = kind === 'close' ? '' : (model?.getValue() ?? '');
    emitDocumentPath(docPathForTab(id), text, kind);
  }
  function emitDocumentPath(path: string, text: string, kind: EditorDocumentEvent['kind']): void {
    if (documentListeners.size === 0) return;
    const ev: EditorDocumentEvent = { path, text, kind };
    for (const cb of documentListeners) cb(ev);
  }

  /** Apply a queued reveal once its tab is the editor's active model (P1.9c jump). */
  function applyPendingRevealIfActive(): void {
    const target = pendingReveal;
    if (!target || !editor) return;
    const model = models.get(target.id);
    if (!model || editor.getModel() !== model) return; // not active yet — wait
    pendingReveal = undefined;
    const position = { lineNumber: target.line, column: target.column };
    editor.setPosition(position);
    editor.revealPositionInCenter(position);
    editor.focus();
  }

  const [tabs, setTabs] = createSignal<EditorTab[]>(initialTabs(props.programTitle()));
  const [activeId, setActiveId] = createSignal<string>(PROGRAM_TAB_ID);

  function flushWrite(path: string): void {
    const m = models.get(path);
    if (!m) return;
    // Single-store-owner (ADR-0148): the OWNER is the single authoritative store —
    // the editor writes there, not the read-only owner-snapshot `vfs` it reads from.
    setTabs((t) => setDirty(t, path, false));
    props.onFileWritten?.(path, m.getValue());
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
   * Open a file via the async owner read-port (ADR-0080, widened ADR-0148): bytes
   * live in the owner realm (node_modules, over-cap, or owner-only files the sync
   * snapshot does not hold). Open a loading tab, await the remote read, then fill
   * in the content (or a too-large / binary / error placeholder). Always read-only
   * — no write path back for these (editable project files take the sync path).
   */
  function openRemoteFile(
    path: string,
    read: (p: string) => Promise<{ size: number; content: Uint8Array | null }>,
    options: EditorOpenFileOptions = {},
  ): void {
    const shouldActivate = options.activate !== false;
    if (models.has(path)) {
      if (shouldActivate) setActiveId(path);
      return;
    }
    readOnlyPaths.add(path);
    const model = monaco.editor.createModel('// loading…', languageForPath(path));
    registerModel(path, model);
    setTabs((t) => openFileTab(t, path, basename(path)));
    if (shouldActivate) setActiveId(path);
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
          // Content landed → let the LS open this buffer with the real text (the
          // initial '// loading…' placeholder would otherwise be what it sees).
          emitDocument(path, 'open');
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

  /** Open an editable/binary tab from already-read snapshot bytes. */
  function openSyncFile(path: string, bytes: Uint8Array, shouldActivate: boolean): void {
    let model: monaco.editor.ITextModel;
    if (looksBinary(bytes)) {
      readOnlyPaths.add(path);
      model = monaco.editor.createModel(
        `// binary file — ${bytes.length} bytes — not editable`,
        'plaintext',
      );
    } else {
      // Editable: edits write to the OWNER via `onFileWritten` (the snapshot the
      // editor reads is owner-published + read-only, but the file itself is not).
      model = monaco.editor.createModel(dec.decode(bytes), languageForPath(path));
    }
    registerModel(path, model);
    setTabs((t) => openFileTab(t, path, basename(path)));
    if (shouldActivate) setActiveId(path);
    emitDocument(path, 'open');
  }

  function openNewEditableFile(path: string, shouldActivate: boolean): monaco.Uri {
    const existing = models.get(path);
    if (existing) {
      if (shouldActivate) setActiveId(path);
      return existing.uri;
    }
    const model = monaco.editor.createModel('', languageForPath(path));
    registerModel(path, model);
    setTabs((t) => openFileTab(t, path, basename(path)));
    if (shouldActivate) setActiveId(path);
    emitDocument(path, 'open');
    return model.uri;
  }

  function canOpenExistingModel(path: string): boolean {
    const id = tabIdForPath(path);
    if (models.has(id)) return true;
    let bytes: Uint8Array | undefined;
    try {
      bytes = props.vfs.readFileBytesSync(path);
    } catch {
      // classifyOpen below needs only the readable boolean.
    }
    const kind = classifyOpen(path, {
      programMirrorPath: props.programPath(),
      isNodeModules: isNodeModulesPath(path),
      present: props.vfs.existsSync(path),
      readable: bytes !== undefined,
      hasRemotePort: Boolean(props.readNodeModulesFile),
    });
    switch (kind) {
      case 'program':
        return true;
      case 'remote':
        return props.readNodeModulesFile !== undefined;
      case 'sync':
        return bytes !== undefined;
      case 'await-snapshot':
        return false;
    }
  }

  /**
   * A seeded/owner-written project file not yet reflected in the snapshot
   * (seed → owner publish → page `snapshotFs.update` is async): subscribe to the
   * next applied frame and open EDITABLE when the sync read lands — never the
   * read-only owner read-port. Race-free: driven by the publish event, no timer.
   * No `subscribe` (plain mirror, never republishes) → surface the read error.
   */
  function awaitSnapshotThenOpen(path: string, err: Error, shouldActivate: boolean): void {
    const subscribe = props.vfs.subscribe?.bind(props.vfs);
    if (!subscribe || snapshotAwaits.has(path)) {
      if (!subscribe) props.onError?.(err.message);
      return;
    }
    const unsubscribe = subscribe(() => {
      // The tab may have been opened (sync retry won) or closed meanwhile.
      if (models.has(path)) {
        clearAwait(path);
        return;
      }
      try {
        const bytes = props.vfs.readFileBytesSync(path);
        clearAwait(path);
        openSyncFile(path, bytes, shouldActivate);
      } catch {
        // Still missing — keep waiting for a later frame.
      }
    });
    snapshotAwaits.set(path, unsubscribe);
  }

  function clearAwait(path: string): void {
    const unsubscribe = snapshotAwaits.get(path);
    if (unsubscribe) {
      unsubscribe();
      snapshotAwaits.delete(path);
    }
  }

  function openFile(path: string, options: EditorOpenFileOptions = {}): void {
    const shouldActivate = options.activate !== false;
    // Queue the click-to-jump reveal (ADR-0166 P1.9c): applied in the activeId
    // effect once this tab's model is the editor's active model.
    if (options.reveal && shouldActivate) {
      pendingReveal = {
        id: tabIdForPath(path),
        line: options.reveal.line,
        column: options.reveal.column,
      };
      applyPendingRevealIfActive();
    }
    const readRemote = props.readNodeModulesFile;
    let bytes: Uint8Array | undefined;
    let readErr: Error | undefined;
    try {
      // Sync read from the owner snapshot (ADR-0148 SSoT): editable project files.
      bytes = props.vfs.readFileBytesSync(path);
    } catch (err) {
      readErr = err as Error;
    }
    switch (
      classifyOpen(path, {
        programMirrorPath: props.programPath(),
        isNodeModules: isNodeModulesPath(path),
        // present-but-over-cap (exists, no inlined bytes) stays view-only-remote,
        // distinct from a racing seed (absent → await the publish).
        present: props.vfs.existsSync(path),
        readable: bytes !== undefined,
        hasRemotePort: Boolean(readRemote),
      })
    ) {
      case 'program':
        if (shouldActivate) setActiveId(PROGRAM_TAB_ID);
        return;
      case 'remote':
        // 'remote' is only returned when a node_modules path has a read-port.
        if (readRemote) openRemoteFile(path, readRemote, options);
        return;
      case 'sync':
        if (models.has(path)) {
          if (shouldActivate) setActiveId(path);
          return;
        }
        // 'sync' is only returned when the snapshot read returned bytes.
        if (bytes) openSyncFile(path, bytes, shouldActivate);
        return;
      case 'await-snapshot':
        if (models.has(path)) {
          if (shouldActivate) setActiveId(path);
          return;
        }
        // Non-node_modules path absent from the snapshot — a project file racing
        // the owner publish (or genuinely owner-only). Wait for the next frame
        // and open editable; never the read-only owner read-port.
        awaitSnapshotThenOpen(path, readErr ?? new Error(`ENOENT: "${path}"`), shouldActivate);
        return;
    }
  }

  function closeFile(path: string): void {
    clearAwait(path);
    const timer = writeTimers.get(path);
    if (timer) {
      clearTimeout(timer);
      writeTimers.delete(path);
      flushWrite(path);
    }
    const next = nextActiveAfterClose(tabs(), path, activeId());
    emitDocument(path, 'close');
    setTabs((t) => closeTab(t, path));
    const m = unregisterModel(path);
    readOnlyPaths.delete(path);
    setActiveId(next);
    // Dispose after the activeId effect has switched the editor off this model.
    queueMicrotask(() => m?.dispose());
  }

  onMount(() => {
    if (!container) return;
    ensureTheme();
    retireBuiltinTsIntelligence();
    programModel = monaco.editor.createModel(
      props.programValue(),
      languageForPath(props.programPath()),
    );
    registerModel(PROGRAM_TAB_ID, programModel);
    editor = monaco.editor.create(container, {
      model: programModel,
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

    props.registerApi({
      openFile,
      setMarkers(path, markers) {
        const model = models.get(tabIdForPath(path));
        if (model) monaco.editor.setModelMarkers(model, 'rifty-ts', markers);
      },
      onDocument(cb) {
        documentListeners.add(cb);
        // Replay already-open models to the new subscriber (ADR-0166 P1.9b): the
        // program tab is open at boot, often before the App wires its LS client.
        // An ordering-free 'open' replay means a late subscriber still opens every
        // live buffer — no missed-before-listener gap.
        for (const [id, model] of models) {
          cb({ path: docPathForTab(id), text: model.getValue(), kind: 'open' });
        }
        return () => documentListeners.delete(cb);
      },
      pathForModel(model) {
        const id = modelUriToTabId.get(model.uri.toString());
        return id === undefined ? undefined : docPathForTab(id);
      },
      ensureModel(path, options) {
        const id = tabIdForPath(path);
        const existing = models.get(id);
        if (existing) return existing.uri;
        if (options?.isNewFile === true) return openNewEditableFile(path, false);
        // Not open yet: open it WITHOUT activating (a go-to-def target the user
        // didn't pick). The sync/remote/program branches create the model
        // synchronously; only `await-snapshot` (a racing seed) defers — that path
        // returns no model now, so the jump simply can't resolve this tick rather
        // than fake one. node_modules `.d.ts` go through the read-port (read-only).
        openFile(path, { activate: false });
        return models.get(id)?.uri;
      },
      canEnsureModel(path, options) {
        if (options?.isNewFile === true) return true;
        return canOpenExistingModel(path);
      },
    });

    // E2E-only window hooks (ADR-0166 P1.9d) — DEV-only: `import.meta.env.DEV`
    // gates them so Vite strips them from the production bundle entirely (mirrors
    // the `#test=execsync` harness gate in main.tsx). The e2e runs against
    // `pnpm dev` (DEV=true), so it still sees them; prod never exposes them.
    if (import.meta.env.DEV) {
      // Read hook: rifty-TS marker count for a VFS path — deterministic proof for
      // the LS e2e (a CSS `.squiggly-error` query is render-timing-flaky).
      (globalThis as unknown as { __riftyTsMarkers?: (path: string) => number }).__riftyTsMarkers =
        (path: string): number => {
          const model = models.get(tabIdForPath(path));
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
        const model = models.get(tabIdForPath(path));
        if (!model) return false;
        model.setValue(text);
        return true;
      };
    }

    // External program-source sync (presets / mode transitions): the one guarded
    // programmatic write; the change listener skips the echo.
    createEffect(() => {
      const next = props.programValue();
      if (programModel && programModel.getValue() !== next) {
        try {
          suppressProgramEcho = true;
          programModel.setValue(next);
        } finally {
          suppressProgramEcho = false;
        }
      }
    });

    createEffect(() => {
      const path = props.programPath();
      if (programModel) monaco.editor.setModelLanguage(programModel, languageForPath(path));
      if (path === currentProgramPath) return;
      const previousPath = currentProgramPath;
      currentProgramPath = path;
      if (programModel) {
        emitDocumentPath(previousPath, '', 'close');
        emitDocumentPath(path, programModel.getValue(), 'open');
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
        label: id === PROGRAM_TAB_ID ? basename(props.programPath()) : basename(id),
        language: model.getLanguageId(),
        // The program tab mirrors the active template entry (ADR-0165 §4).
        path: id === PROGRAM_TAB_ID ? props.programPath() : id,
      });
      // The model just became active — apply a queued Problems click-to-jump.
      applyPendingRevealIfActive();
    });
  });

  onCleanup(() => {
    for (const timer of writeTimers.values()) clearTimeout(timer);
    writeTimers.clear();
    for (const unsubscribe of snapshotAwaits.values()) unsubscribe();
    snapshotAwaits.clear();
    editor?.dispose();
    for (const disposable of modelContentDisposables.values()) disposable.dispose();
    modelContentDisposables.clear();
    for (const m of models.values()) m.dispose();
    models.clear();
    modelUriToTabId.clear();
  });

  return (
    <div class="rf-editorhost rf-card">
      <EditorTabs
        tabs={tabs()}
        activeId={activeId()}
        onSelect={(id) => setActiveId(id)}
        onClose={closeFile}
        previewUrl={props.previewUrl?.()}
        onOpenPreviewTab={props.onOpenPreviewTab}
      />
      <div class="rf-editor__surface">
        <div ref={container} class="rf-editor" data-testid="editor" />
      </div>
    </div>
  );
}
