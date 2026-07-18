/**
 * Editor-host session core (epic playground-testable-core): the whole
 * multi-model editor state machine (ADR-0075) extracted from EditorHost.tsx so
 * node vitest can drive it behaviorally — models, tabs, debounced writes, git
 * diffs, dirty gutter, close trees. The component keeps only DOM/Monaco-widget
 * mounting and wires each createEffect to a core handler; Monaco widgets reach
 * the core through the `host` accessors (they exist only after onMount).
 *
 * Solid server runtime note: signals work in node vitest but memos freeze, so
 * `activeTabKind` is a plain derived function (same values; callers' effects
 * track its signal reads directly — so effect-body handlers must `untrack`
 * derived reads they don't key on, see handleGitStatusChanged).
 */
import { basename } from '@riftydev/vfs';
import * as monaco from 'monaco-editor';
import { type Accessor, createSignal, untrack } from 'solid-js';
import { type DirtyGutterChange, dirtyGutterChanges } from '../glue/dirty-gutter.ts';
import { classifyOpen } from '../glue/editor-open.ts';
import {
  type EditorTab,
  type TabKind,
  closeTab,
  initialTabs,
  nextActiveAfterClose,
  openDiffTab,
  openFileTab,
  setDirty,
} from '../glue/editor-tabs.ts';
import { type FsOpsTarget, looksBinary } from '../glue/fs-ops.ts';

export interface EditorOpenFileOptions {
  readonly activate?: boolean;
  /**
   * Reveal + place the cursor at this 1-based position after opening (ADR-0166
   * P1.9c Problems click-to-jump). Monaco-convention coordinates (lineNumber /
   * column, both 1-based). Applied once the tab is active.
   */
  readonly reveal?: { readonly line: number; readonly column: number };
}

export interface EditorWorkingDiffInput {
  readonly path: string;
  readonly ref: string;
  readonly modified?: string;
  readonly deleted?: boolean;
  readonly hasOriginal?: boolean;
}

export interface EditorTextDiffInput {
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly originalTitle: string;
  readonly modifiedTitle: string;
  readonly original: string;
  readonly modified: string;
}

export interface EditorGitOriginalTextInput {
  readonly path: string;
  readonly ref: string;
}

/** A model open/change/close event the page LS client reacts to (ADR-0166 P1.9b). */
export interface EditorDocumentEvent {
  /** Absolute VFS path for an ordinary editor file tab. */
  readonly path: string;
  /** Current model text (empty on `close`). */
  readonly text: string;
  readonly kind: 'open' | 'change' | 'close';
}

/** Imperative handle handed to the App so the explorer can open files. */
export interface EditorApi {
  /**
   * The live monaco namespace. The App's LS/e2e glue builds models, positions
   * and ranges through this instead of an eager `monaco-editor` import — the
   * editor stack loads as a lazy chunk and this api existing proves monaco is
   * loaded (check:arch pins the seam).
   */
  readonly monaco: typeof monaco;
  openFile(path: string, options?: EditorOpenFileOptions): void;
  openInitialFiles(paths: readonly string[]): void;
  openWorkingDiff(input: EditorWorkingDiffInput): void;
  openTextDiff(input: EditorTextDiffInput): void;
  flushPendingWrites(): Promise<void>;
  closePath(path: string): void;
  closePathTree(path: string): void;
  /** Absolute paths of open file tabs at or under `path` (a file or a dir). */
  openPathsUnder(path: string): readonly string[];
  /**
   * Set the rifty-TS diagnostic markers for an open model (ADR-0166 P1.9b). `path`
   * is the absolute VFS path; a no-op
   * if no model is open for it. Owns the `'rifty-ts'` marker owner so it never
   * clobbers Monaco's own markers (which are disabled anyway).
   */
  setMarkers(path: string, markers: monaco.editor.IMarkerData[]): void;
  /**
   * Subscribe to model open/change/close (ADR-0166 P1.9b) so the page can push
   * `ts:open`/`ts:update`/`ts:close` and request diagnostics. Returns an
   * unsubscribe.
   */
  onDocument(cb: (ev: EditorDocumentEvent) => void): () => void;
  /**
   * VFS path for an open Monaco model (ADR-0166 phase 2): the inverse of the
   * private model map, so an LS provider handed a `model` can query the service
   * by path.
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
  /**
   * Close the active editor tab if it is a closable (non-program) tab; returns
   * whether it closed one. Wired to Cmd/Ctrl+W so the shortcut closes a tab, not
   * the browser tab. The tab's pending debounced write is flushed first.
   */
  closeActiveTab(): boolean;
}

export interface EditorHostProps {
  readonly initialEditorFiles: Accessor<readonly string[]>;
  readonly root: Accessor<string>;
  readonly vfs: FsOpsTarget;
  registerApi(api: EditorApi): void;
  onActive(info: { label: string; language: string; path?: string }): void;
  /** Editor save → the OWNER store (ADR-0148, single-store-owner model): the
   *  workspace owner is the single authoritative store; `content` is the new file
   *  text. */
  onFileWritten?(path: string, content: string): Promise<void> | void;
  onError?(message: string): void;
  /** Owner durability is unproved; presentation marks editable tabs without
   * conflating storage risk with unpublished editor bytes. */
  readonly persistenceAtRisk?: Accessor<boolean>;
  readonly previewUrl?: Accessor<string | undefined>;
  onOpenPreviewTab?(): void;
  /** Async owner read-port (ADR-0080, widened ADR-0148): opening a file the sync
   *  `vfs` (owner snapshot) does not hold — node_modules, over-cap, or owner-only
   *  (shell-written) — reads its bytes from the owner. `content` is null when over
   *  the read cap. Files read this way are view-only. */
  readNodeModulesFile?(path: string): Promise<{ size: number; content: Uint8Array | null }>;
  readGitOriginalText?(input: EditorGitOriginalTextInput): Promise<string>;
  readonly gitStatus?: Accessor<ReadonlyMap<string, string>>;
}

/** Monaco widgets mounted by the component (exist only after onMount). */
export interface EditorHostSurface {
  getEditor(): monaco.editor.IStandaloneCodeEditor | undefined;
  getDiffEditor(): monaco.editor.IStandaloneDiffEditor | undefined;
  getDirtyGutter(): monaco.editor.IEditorDecorationsCollection | undefined;
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
const NO_ACTIVE_TAB_ID = '__no_active__';

function riftyGitOriginalUri(path: string, ref: string): monaco.Uri {
  return monaco.Uri.from({
    scheme: 'rifty-git',
    authority: 'owner',
    path,
    query: `ref=${encodeURIComponent(ref)}`,
  });
}

export type EditorHostCore = ReturnType<typeof createEditorHostCore>;

export function createEditorHostCore(props: EditorHostProps, host: EditorHostSurface) {
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
  interface EditorWriteState {
    readonly model: monaco.editor.ITextModel;
    generation: number;
    publishedGeneration: number;
    timer: ReturnType<typeof setTimeout> | undefined;
    readonly inFlight: Map<number, Promise<void>>;
  }
  const writeStates = new Map<string, EditorWriteState>();
  const diffModels = new Map<
    string,
    {
      original: monaco.editor.ITextModel;
      modified: monaco.editor.ITextModel;
      disposeModified: boolean;
      readOnly: boolean;
      path: string;
      title: string;
    }
  >();
  const pendingDiffOpens = new Map<
    string,
    {
      token: number;
      modified: monaco.editor.ITextModel;
      disposeModified: boolean;
      path: string;
    }
  >();
  let diffOpenSeq = 0;
  const gitOriginalTextCache = new Map<string, Promise<string>>();
  const dirtyGutterLocalPaths = new Set<string>();
  let dirtyGutterSeq = 0;
  // path → unsubscribe for an in-flight "await the next snapshot frame" retry
  // (a seeded project file racing the owner publish). Cleared once the file
  // opens; torn down on unmount so a never-arriving frame leaks nothing.
  const snapshotAwaits = new Map<string, () => void>();
  // Page LS-client subscribers (ADR-0166 P1.9b): notified on model open/change/close.
  const documentListeners = new Set<(ev: EditorDocumentEvent) => void>();

  function discardWriteState(path: string): void {
    const state = writeStates.get(path);
    if (state?.timer !== undefined) clearTimeout(state.timer);
    writeStates.delete(path);
  }

  function discardAllWriteStates(): void {
    for (const state of writeStates.values()) {
      if (state.timer !== undefined) clearTimeout(state.timer);
    }
    writeStates.clear();
  }

  function editWriteState(path: string, model: monaco.editor.ITextModel): EditorWriteState {
    const current = writeStates.get(path);
    if (current?.model === model) return current;
    discardWriteState(path);
    const state: EditorWriteState = {
      model,
      generation: 0,
      publishedGeneration: 0,
      timer: undefined,
      inFlight: new Map(),
    };
    writeStates.set(path, state);
    return state;
  }

  /** Tab id → absolute VFS path. File tab ids are absolute paths. */
  function docPathForTab(id: string): string {
    return id;
  }
  /** Inverse of {@link docPathForTab} — the model key for a VFS path. */
  function tabIdForPath(path: string): string {
    return path;
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
    discardWriteState(id);
    modelContentDisposables.get(id)?.dispose();
    modelContentDisposables.delete(id);
    models.delete(id);
    return model;
  }
  function handleModelContentChange(id: string): void {
    if (readOnlyPaths.has(id)) return;
    const model = models.get(id);
    if (model === undefined) return;
    const write = editWriteState(id, model);
    write.generation += 1;
    emitDocument(id, 'change');
    setTabs((t) => setDirty(t, id, true));
    dirtyGutterLocalPaths.add(docPathForTab(id));
    scheduleWrite(id);
    if (id === activeId()) updateDirtyGutterForActive();
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

  function gitOriginalCacheKey(path: string, ref: string): string {
    return `${props.root()}:${ref}:${path}`;
  }

  function readGitOriginalTextCached(path: string, ref: string): Promise<string> {
    const key = gitOriginalCacheKey(path, ref);
    const cached = gitOriginalTextCache.get(key);
    if (cached) return cached;
    const read = props.readGitOriginalText;
    if (!read) return Promise.reject(new Error('git original-content provider is unavailable'));
    const next = read({ path, ref });
    gitOriginalTextCache.set(key, next);
    return next;
  }

  function statusCodeForPath(path: string): string | undefined {
    return props.gitStatus?.().get(path);
  }

  function statusHasOriginalBlob(code: string): boolean {
    return code !== '??' && code[0] !== 'A';
  }

  function dirtyGutterDecoration(
    change: DirtyGutterChange,
    model: monaco.editor.ITextModel,
  ): monaco.editor.IModelDeltaDecoration {
    const lineNumber = Math.min(Math.max(1, change.lineNumber), model.getLineCount());
    return {
      range: new monaco.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: `rf-dirty-gutter rf-dirty-gutter--${change.kind}`,
        linesDecorationsTooltip: `rifty-git ${change.kind} line`,
      },
    };
  }

  function clearDirtyGutter(): void {
    dirtyGutterSeq += 1;
    host.getDirtyGutter()?.clear();
  }

  function updateDirtyGutterForActive(): void {
    const editor = host.getEditor();
    const id = activeId();
    const model = models.get(id);
    const path = docPathForTab(id);
    const code = statusCodeForPath(path);
    const localChange = dirtyGutterLocalPaths.has(path);
    if (
      !editor ||
      !model ||
      activeTabKind() === 'diff' ||
      readOnlyPaths.has(id) ||
      (!code && !localChange)
    ) {
      clearDirtyGutter();
      return;
    }
    dirtyGutterSeq += 1;
    const seq = dirtyGutterSeq;
    const ref = 'HEAD';
    const original =
      code === undefined || statusHasOriginalBlob(code)
        ? readGitOriginalTextCached(path, ref)
        : Promise.resolve('');
    original.then(
      (originalText) => {
        if (seq !== dirtyGutterSeq || activeId() !== id) return;
        const changes = dirtyGutterChanges(originalText, model.getValue());
        host.getDirtyGutter()?.set(changes.map((change) => dirtyGutterDecoration(change, model)));
      },
      (err: unknown) => {
        if (seq === dirtyGutterSeq && activeId() === id) host.getDirtyGutter()?.clear();
        if (code !== undefined) props.onError?.((err as Error).message);
      },
    );
  }

  /** Apply a queued reveal once its tab is the editor's active model (P1.9c jump). */
  function applyPendingRevealIfActive(): void {
    const editor = host.getEditor();
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

  function revealEditorTarget(target: monaco.IRange | monaco.IPosition): void {
    const editor = host.getEditor();
    if (!editor) return;
    if ('startLineNumber' in target) {
      editor.setSelection(target);
      editor.revealRangeInCenter(target);
      return;
    }
    editor.setPosition(target);
    editor.revealPositionInCenter(target);
  }

  function publishActiveInfo(id: string): void {
    const model = models.get(id);
    if (!model) return;
    props.onActive({
      label: basename(id),
      language: model.getLanguageId(),
      path: id,
    });
  }

  const [tabs, setTabs] = createSignal<EditorTab[]>(initialTabs());
  const [activeId, setActiveId] = createSignal<string>(NO_ACTIVE_TAB_ID);
  // Plain derived function, not createMemo: solid SERVER memos compute once and
  // freeze (node vitest), while callers' effects still track the signal reads.
  const activeTabKind = (): TabKind | undefined =>
    tabs().find((tab) => tab.id === activeId())?.kind;

  function closeVisibleTab(id: string): void {
    const before = tabs();
    const next = nextActiveAfterClose(before, id, activeId());
    const after = closeTab(before, id);
    setTabs(after);
    setActiveId(
      next && after.some((tab) => tab.id === next) ? next : (after[0]?.id ?? NO_ACTIVE_TAB_ID),
    );
  }

  function normalizeTreeRoot(path: string): string {
    return path !== '/' && path.endsWith('/') ? path.slice(0, -1) : path;
  }

  function pathIsInTree(path: string, rootPath: string): boolean {
    const normalizedRoot = normalizeTreeRoot(rootPath);
    return (
      path === normalizedRoot ||
      (normalizedRoot === '/' ? path.startsWith('/') : path.startsWith(`${normalizedRoot}/`))
    );
  }

  function disposeDiffTab(id: string): void {
    cancelPendingDiffOpen(id);
    const diff = diffModels.get(id);
    if (!diff) return;
    diffModels.delete(id);
    closeVisibleTab(id);
    queueMicrotask(() => {
      diff.original.dispose();
      if (diff.disposeModified) diff.modified.dispose();
    });
  }

  function cancelPendingDiffOpen(id: string): void {
    const pending = pendingDiffOpens.get(id);
    if (!pending) return;
    pendingDiffOpens.delete(id);
    if (pending.disposeModified) pending.modified.dispose();
  }

  function cancelPendingDiffOpensForPathTree(
    rootPath: string,
    opts: { readonly liveModelOnly?: boolean } = {},
  ): void {
    const ids = [...pendingDiffOpens.entries()]
      .filter(
        ([, pending]) =>
          pathIsInTree(pending.path, rootPath) &&
          (opts.liveModelOnly !== true || pending.disposeModified === false),
      )
      .map(([id]) => id);
    for (const id of ids) cancelPendingDiffOpen(id);
  }

  function closeDiffTabsForPathTree(
    rootPath: string,
    opts: { readonly liveModelOnly?: boolean } = {},
  ): void {
    cancelPendingDiffOpensForPathTree(rootPath, opts);
    const ids = [...diffModels.entries()]
      .filter(
        ([, diff]) =>
          pathIsInTree(diff.path, rootPath) &&
          (opts.liveModelOnly !== true || diff.disposeModified === false),
      )
      .map(([id]) => id);
    for (const id of ids) disposeDiffTab(id);
  }

  function reportWriteError(err: unknown): void {
    props.onError?.((err as Error).message);
  }

  function flushWriteTracked(path: string): Promise<void> {
    const state = writeStates.get(path);
    const model = models.get(path);
    if (
      state === undefined ||
      model !== state.model ||
      readOnlyPaths.has(path) ||
      state.publishedGeneration >= state.generation
    ) {
      return Promise.resolve();
    }
    const generation = state.generation;
    const existing = state.inFlight.get(generation);
    if (existing !== undefined) return existing;
    const text = model.getValue();
    let publication: Promise<void>;
    try {
      // Single-store-owner (ADR-0148): capture one exact model generation for
      // the OWNER; later model edits cannot change this admitted write's text.
      publication = Promise.resolve(props.onFileWritten?.(path, text));
    } catch (error) {
      publication = Promise.reject(error);
    }
    const tracked = publication
      .then(() => {
        if (writeStates.get(path) !== state || models.get(path) !== model) return;
        state.publishedGeneration = Math.max(state.publishedGeneration, generation);
        if (state.publishedGeneration === state.generation) {
          setTabs((tabs) => setDirty(tabs, path, false));
        }
      })
      .finally(() => {
        state.inFlight.delete(generation);
        if (
          writeStates.get(path) === state &&
          state.timer === undefined &&
          state.inFlight.size === 0 &&
          state.publishedGeneration === state.generation
        ) {
          writeStates.delete(path);
        }
      });
    state.inFlight.set(generation, tracked);
    return tracked;
  }

  async function flushPendingWrites(): Promise<void> {
    for (;;) {
      const admitted = new Set<Promise<void>>();
      for (const [path, state] of writeStates) {
        if (models.get(path) !== state.model || readOnlyPaths.has(path)) {
          discardWriteState(path);
          continue;
        }
        if (state.timer !== undefined) {
          clearTimeout(state.timer);
          state.timer = undefined;
        }
        for (const write of state.inFlight.values()) admitted.add(write);
        if (state.publishedGeneration < state.generation) {
          admitted.add(flushWriteTracked(path));
        }
      }
      if (admitted.size === 0) return;
      await Promise.all(admitted);
      if (writeStates.size === 0) return;
    }
  }

  function scheduleWrite(path: string): void {
    const state = writeStates.get(path);
    if (state === undefined) return;
    if (state.timer !== undefined) clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      if (writeStates.get(path) !== state) return;
      state.timer = undefined;
      void flushWriteTracked(path).catch(reportWriteError);
    }, 300);
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
    setTabs((t) => openFileTab(t, path, titleForFilePath(path)));
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
    setTabs((t) => openFileTab(t, path, titleForFilePath(path)));
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
    setTabs((t) => openFileTab(t, path, titleForFilePath(path)));
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
      isNodeModules: isNodeModulesPath(path),
      present: props.vfs.existsSync(path),
      readable: bytes !== undefined,
      hasRemotePort: Boolean(props.readNodeModulesFile),
    });
    switch (kind) {
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
  function awaitSnapshotThenOpen(
    path: string,
    err: Error,
    activation: 'never' | 'requested' | 'if-empty',
  ): void {
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
        openSyncFile(
          path,
          bytes,
          activation === 'requested' ||
            (activation === 'if-empty' && activeId() === NO_ACTIVE_TAB_ID),
        );
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

  function openFile(
    path: string,
    options: EditorOpenFileOptions = {},
    awaitedActivation: 'requested' | 'if-empty' = 'requested',
  ): void {
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
        isNodeModules: isNodeModulesPath(path),
        // present-but-over-cap (exists, no inlined bytes) stays view-only-remote,
        // distinct from a racing seed (absent → await the publish).
        present: props.vfs.existsSync(path),
        readable: bytes !== undefined,
        hasRemotePort: Boolean(readRemote),
      })
    ) {
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
        awaitSnapshotThenOpen(
          path,
          readErr ?? new Error(`ENOENT: "${path}"`),
          shouldActivate ? awaitedActivation : 'never',
        );
        return;
    }
  }

  function openWorkingDiff(input: EditorWorkingDiffInput): void {
    const path = input.path;
    const tabId = tabIdForPath(path);
    let disposeModified = false;
    if (input.deleted !== true) openFile(path, { activate: false });
    let modified = input.deleted === true ? undefined : models.get(tabId);
    if (modified && readOnlyPaths.has(tabId)) {
      props.onError?.(`Cannot open diff for ${path}: working file is not text-editable`);
      return;
    }
    if (!modified && input.modified !== undefined) {
      modified = monaco.editor.createModel(
        input.modified,
        languageForPath(path),
        monaco.Uri.from({ scheme: 'rifty-working', path }),
      );
      disposeModified = true;
    }
    if (!modified) {
      props.onError?.(`Cannot open diff for ${path}: working file is not available`);
      return;
    }
    const id = `diff:${input.ref}:${path}`;
    const previousPending = pendingDiffOpens.get(id);
    if (previousPending?.disposeModified) previousPending.modified.dispose();
    diffOpenSeq += 1;
    const token = diffOpenSeq;
    pendingDiffOpens.set(id, { token, modified, disposeModified, path });
    const originalText =
      input.hasOriginal === false
        ? Promise.resolve('')
        : readGitOriginalTextCached(path, input.ref);
    originalText.then(
      (text) => {
        const pending = pendingDiffOpens.get(id);
        if (!pending || pending.token !== token) return;
        pendingDiffOpens.delete(id);
        const previous = diffModels.get(id);
        previous?.original.dispose();
        if (previous?.disposeModified) previous.modified.dispose();
        const original = monaco.editor.createModel(
          text,
          languageForPath(path),
          riftyGitOriginalUri(path, input.ref),
        );
        const title = `${basename(path)} ↔ ${input.ref}`;
        diffModels.set(id, { original, modified, disposeModified, readOnly: false, path, title });
        setTabs((t) =>
          openDiffTab(t, {
            id,
            kind: 'diff',
            path,
            title,
            originalTitle: input.ref,
            modifiedTitle: basename(path),
            dirty: false,
          }),
        );
        setActiveId(id);
      },
      (err: unknown) => {
        const pending = pendingDiffOpens.get(id);
        if (!pending || pending.token !== token) return;
        pendingDiffOpens.delete(id);
        if (disposeModified) modified.dispose();
        props.onError?.((err as Error).message);
      },
    );
  }

  function openTextDiff(input: EditorTextDiffInput): void {
    const previous = diffModels.get(input.id);
    previous?.original.dispose();
    if (previous?.disposeModified) previous.modified.dispose();
    const original = monaco.editor.createModel(
      input.original,
      languageForPath(input.path),
      monaco.Uri.from({
        scheme: 'rifty-compare-original',
        path: input.path,
        query: `id=${encodeURIComponent(input.id)}`,
      }),
    );
    const modified = monaco.editor.createModel(
      input.modified,
      languageForPath(input.path),
      monaco.Uri.from({
        scheme: 'rifty-compare-modified',
        path: input.path,
        query: `id=${encodeURIComponent(input.id)}`,
      }),
    );
    diffModels.set(input.id, {
      original,
      modified,
      disposeModified: true,
      readOnly: true,
      path: input.path,
      title: input.title,
    });
    setTabs((t) =>
      openDiffTab(t, {
        id: input.id,
        kind: 'diff',
        path: input.path,
        title: input.title,
        originalTitle: input.originalTitle,
        modifiedTitle: input.modifiedTitle,
        dirty: false,
      }),
    );
    setActiveId(input.id);
  }

  function closeFile(path: string, opts: { readonly flushPending?: boolean } = {}): void {
    const diff = diffModels.get(path);
    if (diff) {
      disposeDiffTab(path);
      return;
    }
    closeDiffTabsForPathTree(path, { liveModelOnly: true });
    clearAwait(path);
    const write = writeStates.get(path);
    if (write?.timer !== undefined) {
      clearTimeout(write.timer);
      write.timer = undefined;
    }
    if (
      opts.flushPending !== false &&
      write !== undefined &&
      write.publishedGeneration < write.generation
    ) {
      void flushWriteTracked(path).catch(reportWriteError);
    }
    emitDocument(path, 'close');
    const m = unregisterModel(path);
    readOnlyPaths.delete(path);
    closeVisibleTab(path);
    // Dispose after the activeId effect has switched the editor off this model.
    queueMicrotask(() => m?.dispose());
  }

  /** Absolute paths of open file tabs at or under `rootPath` (a file or a dir). */
  function openDocPathsUnder(rootPath: string): readonly string[] {
    const normalizedRoot = normalizeTreeRoot(rootPath);
    const ids = new Set([
      ...models.keys(),
      ...tabs()
        .filter((tab) => tab.kind === 'file')
        .map((tab) => tab.id),
    ]);
    return [...ids]
      .map((id) => docPathForTab(id))
      .filter((path) => pathIsInTree(path, normalizedRoot));
  }

  function closeExternalPathTree(rootPath: string): void {
    const normalizedRoot = normalizeTreeRoot(rootPath);
    closeDiffTabsForPathTree(normalizedRoot);
    const matchingIds = openDocPathsUnder(normalizedRoot).map((path) => tabIdForPath(path));
    for (const id of matchingIds) closeFile(id, { flushPending: false });
  }

  function titleForFilePath(path: string): string {
    const root = props.root();
    return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : basename(path);
  }

  function disposeAllOpenModels(): void {
    discardAllWriteStates();
    for (const unsubscribe of snapshotAwaits.values()) unsubscribe();
    snapshotAwaits.clear();
    for (const id of [...pendingDiffOpens.keys()]) cancelPendingDiffOpen(id);
    for (const diff of diffModels.values()) {
      diff.original.dispose();
      if (diff.disposeModified) diff.modified.dispose();
    }
    diffModels.clear();
    host.getDiffEditor()?.setModel(null);
    for (const id of [...models.keys()]) {
      emitDocument(id, 'close');
      unregisterModel(id)?.dispose();
    }
    readOnlyPaths.clear();
    dirtyGutterLocalPaths.clear();
    clearDirtyGutter();
    modelUriToTabId.clear();
  }

  // Dedup key for the reactive initial-files effect. Session-scoped (not effect-
  // local) so the imperative openInitialFiles path shares it — see openInitialFiles.
  let initialFilesKey = '';
  function resetOpenFileTabs(paths: readonly string[]): void {
    const uniquePaths = [...new Set(paths)];
    disposeAllOpenModels();
    setTabs(initialTabs());
    setActiveId(NO_ACTIVE_TAB_ID);
    for (const path of uniquePaths) {
      // A preset path may have been renamed/deleted by the user. A visible tab
      // therefore starts only with a real model. If an earlier path is merely
      // racing its snapshot frame, it may become active later only while no
      // available sibling has already claimed the editor.
      openFile(path, { activate: activeId() === NO_ACTIVE_TAB_ID }, 'if-empty');
    }
  }

  function openInitialFiles(paths: readonly string[]): void {
    // Sync the reactive dedup key (below) so the imperative App reset — which ALSO
    // writes the initialEditorFiles signal — does not trigger a SECOND full reset
    // when that signal effect fires.
    initialFilesKey = paths.join('\0');
    resetOpenFileTabs(paths);
  }

  /** Body of the component's initial-files createEffect (reads = its tracked deps). */
  function handleInitialFilesChanged(): void {
    const paths = props.initialEditorFiles();
    const key = paths.join('\0');
    if (key === initialFilesKey) return;
    untrack(() => openInitialFiles(paths));
  }

  function clearGitDiffTabs(): void {
    for (const id of [...pendingDiffOpens.keys()]) cancelPendingDiffOpen(id);
    const ids = [...diffModels.keys()];
    if (ids.length === 0) return;
    host.getDiffEditor()?.setModel(null);
    for (const id of ids) {
      const diff = diffModels.get(id);
      if (!diff) continue;
      diff.original.dispose();
      if (diff.disposeModified) diff.modified.dispose();
      diffModels.delete(id);
    }
    setTabs((t) => t.filter((tab) => tab.kind !== 'diff'));
    if (ids.includes(activeId())) setActiveId(tabs()[0]?.id ?? NO_ACTIVE_TAB_ID);
  }

  // Baseline root: the first handleRootChanged call (the effect's mount run)
  // records it and tears nothing down — same as the pre-extraction `let diffRoot
  // = props.root()` initialized right before the effect.
  let diffRoot: string | undefined;
  /** Body of the component's root-switch createEffect. */
  function handleRootChanged(): void {
    const root = props.root();
    if (diffRoot === undefined) {
      diffRoot = root;
      return;
    }
    if (root === diffRoot) return;
    diffRoot = root;
    gitOriginalTextCache.clear();
    dirtyGutterLocalPaths.clear();
    clearDirtyGutter();
    clearGitDiffTabs();
  }

  /** Body of the component's git-status createEffect. Keys on gitStatus +
   *  activeId ONLY (the pre-extraction dep set: activeTabKind was a cutoff
   *  memo there): `untrack` keeps the raw `tabs()` reads inside
   *  updateDirtyGutterForActive from re-running the effect — cache wipe +
   *  HEAD-text refetch — on every keystroke's setDirty tabs write. */
  function handleGitStatusChanged(): void {
    props.gitStatus?.();
    activeId();
    gitOriginalTextCache.clear();
    untrack(() => updateDirtyGutterForActive());
  }

  /** Body of the component's activeId createEffect: point the mounted Monaco
   *  widgets at the active tab's model(s). */
  function syncActiveEditor(): void {
    const editor = host.getEditor();
    const diffEditor = host.getDiffEditor();
    const id = activeId();
    const diff = diffModels.get(id);
    if (diff && diffEditor) {
      const { original, modified } = diff;
      diffEditor.updateOptions({ readOnly: diff.readOnly });
      diffEditor.setModel({ original, modified });
      props.onActive({
        label: diff.title,
        language: languageForPath(diff.path),
        path: diff.path,
      });
      return;
    }
    diffEditor?.setModel(null);
    const tab = tabs().find((candidate) => candidate.id === id);
    if (!tab) {
      editor?.setModel(null);
      props.onActive({ label: '', language: 'plaintext' });
      clearDirtyGutter();
      return;
    }
    const model = models.get(id);
    if (!editor || !model) return;
    if (editor.getModel() !== model) editor.setModel(model);
    editor.updateOptions({ readOnly: readOnlyPaths.has(id) });
    publishActiveInfo(id);
    updateDirtyGutterForActive();
    // The model just became active — apply a queued Problems click-to-jump.
    applyPendingRevealIfActive();
  }

  /** `registerEditorOpener` target (the component keeps the `source === editor`
   *  guard): route an in-editor navigation to one of our open models. */
  function openInHostEditor(
    resource: monaco.Uri,
    selectionOrPosition?: monaco.IRange | monaco.IPosition,
  ): boolean {
    const editor = host.getEditor();
    if (!editor) return false;
    const id = modelUriToTabId.get(resource.toString());
    const model = id === undefined ? undefined : models.get(id);
    if (!id || !model) return false;
    if (editor.getModel() !== model) editor.setModel(model);
    setActiveId(id);
    editor.updateOptions({ readOnly: readOnlyPaths.has(id) });
    if (selectionOrPosition) revealEditorTarget(selectionOrPosition);
    editor.focus();
    return true;
  }

  /** Open Monaco model for a VFS path (DEV e2e hooks read/write through this). */
  function modelForPath(path: string): monaco.editor.ITextModel | undefined {
    return models.get(tabIdForPath(path));
  }

  /** onCleanup part 1: stop debounced writes + snapshot awaits (before widget disposal). */
  function teardownPendingWork(): void {
    discardAllWriteStates();
    for (const unsubscribe of snapshotAwaits.values()) unsubscribe();
    snapshotAwaits.clear();
  }

  /** onCleanup part 2: dispose every model + listener (after widget disposal). */
  function teardownModels(): void {
    for (const id of [...pendingDiffOpens.keys()]) cancelPendingDiffOpen(id);
    for (const diff of diffModels.values()) {
      diff.original.dispose();
      if (diff.disposeModified) diff.modified.dispose();
    }
    diffModels.clear();
    for (const disposable of modelContentDisposables.values()) disposable.dispose();
    modelContentDisposables.clear();
    for (const m of models.values()) m.dispose();
    models.clear();
    modelUriToTabId.clear();
  }

  const api: EditorApi = {
    monaco,
    openFile,
    openInitialFiles,
    openWorkingDiff,
    openTextDiff,
    flushPendingWrites,
    closePath: (path) => closeExternalPathTree(path),
    closePathTree: (path) => closeExternalPathTree(path),
    openPathsUnder: (path) => openDocPathsUnder(path),
    setMarkers(path, markers) {
      const model = models.get(tabIdForPath(path));
      if (model) monaco.editor.setModelMarkers(model, 'rifty-ts', markers);
    },
    onDocument(cb) {
      documentListeners.add(cb);
      // Replay already-open models to the new subscriber (ADR-0166 P1.9b):
      // initial file tabs can open before the App wires its LS client. An
      // ordering-free 'open' replay means a late subscriber still opens every
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
      // didn't pick). The sync/remote branches create the model synchronously;
      // only `await-snapshot` (a racing seed) defers — that path
      // returns no model now, so the jump simply can't resolve this tick rather
      // than fake one. node_modules `.d.ts` go through the read-port (read-only).
      openFile(path, { activate: false });
      return models.get(id)?.uri;
    },
    canEnsureModel(path, options) {
      if (options?.isNewFile === true) return true;
      return canOpenExistingModel(path);
    },
    closeActiveTab() {
      const id = activeId();
      if (id === NO_ACTIVE_TAB_ID) return false; // no active editor tab to close
      closeFile(id); // id === path for a file tab; flushes its pending write first
      return true;
    },
  };

  /** Publish the imperative API only after preset tabs exist. Registration may
   *  synchronously drain user opens queued while Monaco was mounting; hydrating
   *  afterwards would reset those freshly opened tabs. */
  function registerHydratedApi(registerApi: (api: EditorApi) => void): void {
    handleInitialFilesChanged();
    registerApi(api);
  }

  return {
    api,
    tabs,
    activeId,
    setActiveId,
    activeTabKind,
    closeFile,
    registerHydratedApi,
    handleInitialFilesChanged,
    handleRootChanged,
    handleGitStatusChanged,
    syncActiveEditor,
    openInHostEditor,
    modelForPath,
    teardownPendingWork,
    teardownModels,
  };
}
