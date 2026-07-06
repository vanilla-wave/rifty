/**
 * Effect-free decision core for FileExplorer (epic playground-testable-core):
 * keyboard intents, context-menu composition, clipboard/drag-move routing,
 * edit-submit planning, upload batching + root guard. Solid-free, plain data
 * in/out so node vitest drives every branch; FileExplorer.tsx keeps thin JSX
 * bindings.
 */
import { dirname, joinPath } from '@riftydev/vfs';
import type {
  FileManagerClipboard,
  FileManagerClipboardMode,
} from '../glue/file-manager-clipboard.ts';
import {
  type UploadBatchOptions,
  type UploadPlanEntry,
  type UploadWriteEntry,
  batchUploadWrites,
} from '../glue/file-manager-dnd.ts';
import type { NmRow } from '../glue/file-tree.ts';
import type { IconName } from './icons.tsx';

export type ExplorerRowKind = NmRow['kind'];

/** Owner-routed async mutation target (App wires these to owner RPC frames). */
export interface FileExplorerMutations {
  createFile(path: string): Promise<void>;
  createDir(path: string): Promise<void>;
  deletePath(path: string): Promise<void>;
  renamePath(from: string, to: string): Promise<void>;
  renameMany(entries: readonly { readonly from: string; readonly to: string }[]): Promise<void>;
  copyTree(from: string, to: string): Promise<void>;
  writeFile(path: string, data: Uint8Array, options?: { recursive?: boolean }): Promise<void>;
  writeFiles(
    entries: readonly {
      readonly path: string;
      readonly data: Uint8Array;
      readonly recursive?: boolean;
    }[],
  ): Promise<void>;
}

// --- inline create/rename lifecycle ---

export type ExplorerEditState =
  | { readonly kind: 'create-file'; readonly parent: string; readonly depth: number }
  | { readonly kind: 'create-dir'; readonly parent: string; readonly depth: number }
  | {
      readonly kind: 'rename';
      readonly path: string;
      readonly parent: string;
      readonly depth: number;
      readonly name: string;
      readonly rowKind: 'file' | 'dir';
    };
export type ExplorerRenameEdit = Extract<ExplorerEditState, { readonly kind: 'rename' }>;
export type ExplorerCreateEdit = Exclude<ExplorerEditState, ExplorerRenameEdit>;

/** Validate a typed entry name and resolve it under `parent`. */
export function explorerTargetPath(parent: string, name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Name cannot be empty');
  if (trimmed.includes('/')) throw new Error('Name cannot contain "/"');
  return joinPath(parent, trimmed);
}

export type EditSubmitPlan =
  | { readonly kind: 'create-file'; readonly path: string }
  | { readonly kind: 'create-dir'; readonly path: string }
  | {
      readonly kind: 'rename';
      readonly from: string;
      readonly to: string;
      readonly reopenActive: boolean;
    };

/**
 * Plan an inline-edit submit. `reopenActive` is decided HERE, synchronously
 * from the captured edit state — the async rename closes the old model, so
 * the active-file check must not re-read state after the await.
 */
export function planEditSubmit(
  state: ExplorerEditState,
  rawName: string,
  activePath: string | undefined,
): EditSubmitPlan {
  const path = explorerTargetPath(state.parent, rawName);
  if (state.kind === 'rename') {
    return {
      kind: 'rename',
      from: state.path,
      to: path,
      reopenActive: state.rowKind === 'file' && activePath === state.path,
    };
  }
  return { kind: state.kind, path };
}

// --- row keyboard intents ---

export interface RowKeyInput {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
}
export interface RowKeyCaps {
  readonly mutable: boolean;
  readonly downloadable: boolean;
}
/** Handled intents preventDefault; clipboard/download also stop propagation
 *  (they'd otherwise collide with editor-level shortcuts). */
export type RowKeyIntent =
  | {
      readonly intent: 'copy' | 'cut' | 'paste' | 'download';
      readonly stopPropagation: true;
    }
  | { readonly intent: 'rename' | 'delete' | 'activate'; readonly stopPropagation: false };

export function rowKeyIntent(e: RowKeyInput, caps: RowKeyCaps): RowKeyIntent | null {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && caps.mutable) {
    const key = e.key.toLowerCase();
    if (key === 'c') return { intent: 'copy', stopPropagation: true };
    if (key === 'x') return { intent: 'cut', stopPropagation: true };
    if (key === 'v') return { intent: 'paste', stopPropagation: true };
  }
  if (mod && e.key.toLowerCase() === 's' && caps.downloadable) {
    return { intent: 'download', stopPropagation: true };
  }
  if (e.key === 'F2' && caps.mutable) return { intent: 'rename', stopPropagation: false };
  if ((e.key === 'Delete' || e.key === 'Backspace') && caps.mutable) {
    return { intent: 'delete', stopPropagation: false };
  }
  if (e.key === 'Enter' || e.key === ' ') return { intent: 'activate', stopPropagation: false };
  return null;
}

/** Row activation (click / Enter / Space): dirs toggle, files open, synthetic
 *  loading/error rows do nothing. */
export function rowActivation(kind: ExplorerRowKind): 'toggle-dir' | 'open-file' | null {
  if (kind === 'dir') return 'toggle-dir';
  if (kind === 'file') return 'open-file';
  return null;
}

// --- context menu composition ---

export interface ExplorerRowCaps {
  readonly kind: 'file' | 'dir';
  readonly mutable: boolean;
  readonly downloadable: boolean;
  readonly comparable: boolean;
  readonly headComparable: boolean;
}

export function canOpenContextMenu(
  caps: Pick<ExplorerRowCaps, 'mutable' | 'downloadable' | 'comparable' | 'headComparable'>,
): boolean {
  return caps.mutable || caps.downloadable || caps.comparable || caps.headComparable;
}

export type ContextMenuItemId =
  | 'new-file'
  | 'new-folder'
  | 'copy'
  | 'cut'
  | 'paste'
  | 'duplicate'
  | 'rename'
  | 'delete'
  | 'copy-path'
  | 'copy-relative-path'
  | 'compare-selected'
  | 'compare-head'
  | 'download';
export interface ContextMenuItem {
  readonly id: ContextMenuItemId;
  readonly label: string;
  readonly icon: IconName;
  /** How the component derives the `disabled` attribute (signal reads stay in JSX). */
  readonly disabled: 'never' | 'busy' | 'busy-or-empty-clipboard' | 'not-two-comparable';
}

/**
 * VS-Code-parity menu per row capabilities. Mutation items appear ONLY on
 * mutable rows (download-only rows get no grayed clipboard entries); New
 * File/Folder only on dirs; Copy Path is unconditional.
 */
export function contextMenuItems(caps: ExplorerRowCaps): readonly ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (caps.mutable) {
    if (caps.kind === 'dir') {
      items.push(
        { id: 'new-file', label: 'New File', icon: 'file-plus', disabled: 'busy' },
        { id: 'new-folder', label: 'New Folder', icon: 'folder-plus', disabled: 'busy' },
      );
    }
    items.push(
      { id: 'copy', label: 'Copy', icon: 'copy', disabled: 'busy' },
      { id: 'cut', label: 'Cut', icon: 'corner-down-left', disabled: 'busy' },
      {
        id: 'paste',
        label: 'Paste',
        icon: 'corner-down-left',
        disabled: 'busy-or-empty-clipboard',
      },
      { id: 'duplicate', label: 'Duplicate', icon: 'copy', disabled: 'busy' },
      { id: 'rename', label: 'Rename', icon: 'pencil-to-square', disabled: 'busy' },
      { id: 'delete', label: 'Delete', icon: 'trash-bin', disabled: 'busy' },
    );
  }
  items.push(
    { id: 'copy-path', label: 'Copy Path', icon: 'copy', disabled: 'never' },
    { id: 'copy-relative-path', label: 'Copy Relative Path', icon: 'copy', disabled: 'never' },
  );
  if (caps.comparable) {
    items.push({
      id: 'compare-selected',
      label: 'Compare Selected',
      icon: 'file-text',
      disabled: 'not-two-comparable',
    });
  }
  if (caps.headComparable) {
    items.push({
      id: 'compare-head',
      label: 'Compare with HEAD',
      icon: 'file-text',
      disabled: 'never',
    });
  }
  if (caps.downloadable) {
    items.push({ id: 'download', label: 'Download', icon: 'file-arrow-down', disabled: 'never' });
  }
  return items;
}

// --- clipboard / selection ---

export function isCutSource(clipboard: FileManagerClipboard | null, path: string): boolean {
  return clipboard?.mode === 'cut' && clipboard.paths.includes(path);
}

/** Paths a row action (copy/cut/drag) applies to: the multi-selection when the
 *  row is part of it, else just the row. */
export function pathsForRowAction(
  rowPath: string,
  selected: ReadonlySet<string>,
  mutablePaths: readonly string[],
): readonly string[] {
  if (!selected.has(rowPath)) return [rowPath];
  return mutablePaths.filter((path) => selected.has(path));
}

/** Route paste/move actions through owner mutations: cut/move = ONE coalesced
 *  renameMany frame; copy = copyTree per action. */
export async function runClipboardActions(
  mutations: Pick<FileExplorerMutations, 'renameMany' | 'copyTree'>,
  mode: FileManagerClipboardMode,
  actions: readonly { readonly from: string; readonly to: string }[],
): Promise<void> {
  if (mode === 'cut') {
    await mutations.renameMany(actions.map((action) => ({ from: action.from, to: action.to })));
  } else {
    for (const action of actions) await mutations.copyTree(action.from, action.to);
  }
}

// --- drag & drop / OS upload ---

export const DRAG_PATHS_MIME = 'application/x-rifty-paths';

/** Decode a row-drag payload; malformed/foreign JSON yields no paths, an empty
 *  payload falls back to the in-component drag state. */
export function parseDragPayload(
  payload: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  if (!payload) return fallback;
  try {
    const parsed = JSON.parse(payload) as unknown;
    return Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')
      ? (parsed as string[])
      : [];
  } catch {
    return fallback;
  }
}

export type DropReaction =
  | { readonly kind: 'reject'; readonly message: string }
  | { readonly kind: 'upload' }
  | { readonly kind: 'move' };

/** Route a drop: non-mutable targets and folder drops reject loudly; OS files
 *  upload; otherwise it is an internal row move. */
export function planDropReaction(opts: {
  /** Name of the row dropped on, or null for the tree background. */
  readonly rowName: string | null;
  readonly rowMutable: boolean;
  readonly hasDirectory: boolean;
  readonly fileCount: number;
}): DropReaction {
  if (opts.rowName !== null && !opts.rowMutable) {
    return { kind: 'reject', message: `Cannot drop on ${opts.rowName}` };
  }
  if (opts.hasDirectory) {
    return { kind: 'reject', message: 'Folder drops are unsupported; drop files instead' };
  }
  return opts.fileCount > 0 ? { kind: 'upload' } : { kind: 'move' };
}

/** Drop destination: dirs receive directly, files target their parent,
 *  synthetic rows (or the background) target the workspace root. */
export function dropTargetForRow(
  row: { readonly kind: ExplorerRowKind; readonly path: string } | undefined,
  root: string,
): string {
  if (row?.kind === 'dir') return row.path;
  if (row?.kind === 'file') return dirname(row.path);
  return root;
}

/** Refuse a drag-move touching anything outside the mutable row set. */
export function ensureMovablePaths(paths: readonly string[], mutable: ReadonlySet<string>): void {
  for (const path of paths) {
    if (!mutable.has(path)) throw new Error(`cannot move non-mutable path "${path}"`);
  }
}

/** Owner write frames stay bounded: at most 32 files / 4 MiB per frame. */
export const UPLOAD_BATCH: UploadBatchOptions = { maxFiles: 32, maxBytes: 4 * 1024 * 1024 };

export interface UploadSource {
  readonly name: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/**
 * Read dropped files and write them through coalesced owner frames. Re-checks
 * the workspace root after every await: a root switch mid-upload must abort,
 * never write into the new workspace.
 */
export async function runUploadPlan(opts: {
  readonly files: readonly UploadSource[];
  readonly plan: readonly UploadPlanEntry[];
  readonly startRoot: string;
  currentRoot(): string;
  readonly batch: UploadBatchOptions;
  writeFiles(entries: readonly UploadWriteEntry[]): Promise<void>;
}): Promise<void> {
  const writes: { path: string; data: Uint8Array; recursive: true }[] = [];
  for (let i = 0; i < opts.files.length; i += 1) {
    const file = opts.files[i];
    const target = opts.plan[i];
    if (!file || !target) continue;
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (opts.currentRoot() !== opts.startRoot) {
      throw new Error('workspace root changed during upload');
    }
    writes.push({ path: target.to, data: bytes, recursive: true });
  }
  for (const batch of batchUploadWrites(writes, opts.batch)) {
    if (opts.currentRoot() !== opts.startRoot) {
      throw new Error('workspace root changed during upload');
    }
    await opts.writeFiles(batch);
  }
}

// --- copy path / compare ---

/** Clipboard text for Copy (Relative) Path: relative only under the root. */
export function explorerPathText(path: string, root: string, relative: boolean): string {
  return relative && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
}

export type CompareSelectedPlan =
  | { readonly kind: 'compare'; readonly left: string; readonly right: string }
  | { readonly kind: 'error'; readonly message: string };

/** Blob-vs-blob compare delegates the two selected files; never diffs here. */
export function planCompareSelected(selected: readonly string[]): CompareSelectedPlan {
  if (selected.length !== 2) {
    return { kind: 'error', message: 'Select exactly two files to compare' };
  }
  return { kind: 'compare', left: selected[0]!, right: selected[1]! };
}
