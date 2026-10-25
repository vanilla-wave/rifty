import type * as monaco from 'monaco-editor';
import type { Accessor } from 'solid-js';
import type { FsOpsTarget } from '../glue/fs-ops.ts';

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
  /** Adopt acknowledged owner bytes only while the editable model has no unpublished write. */
  applyOwnerBytes(path: string, bytes: Uint8Array): boolean;
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
