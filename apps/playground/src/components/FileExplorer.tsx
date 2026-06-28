/**
 * VFS file explorer (ADR-0075) — a lazy-expand tree of the workspace over the
 * main-thread `syncMirror()`. The read view is the owner-published SnapshotFs
 * (still read-only); optional create/rename/delete affordances call an
 * owner-routed async target and wait for reflect-back. A signature-gated poll
 * (no VFS change events exist) only re-reads when the visible tree actually
 * changed, so hover/scroll aren't clobbered.
 */
import { dirname, joinPath } from '@riftydev/vfs';
import {
  For,
  type JSX,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { copyToClipboard } from '../glue/clipboard.ts';
import {
  type FileManagerClipboard,
  planClipboardPaste,
  targetDirectoryForExplorerRow,
} from '../glue/file-manager-clipboard.ts';
import { batchUploadWrites, planDragMove, planUploadFiles } from '../glue/file-manager-dnd.ts';
import {
  type NmNodeState,
  type NmRow,
  type TreeChild,
  composeNodeModulesRows,
  fileCategory,
  readChildren,
} from '../glue/file-tree.ts';
import type { FsOpsTarget } from '../glue/fs-ops.ts';
import {
  type GitDecoration,
  decorationForPath,
  gitStatusDecorationMaps,
} from '../glue/git-decorations.ts';
import type { NodeModulesCache } from '../glue/node-modules-cache.ts';
import { Icon, type IconName } from './icons.tsx';

/** Monochrome row icon per file category (Soft Panels: outline icons, no colour badges). */
const CATEGORY_ICONS: Record<string, IconName> = {
  js: 'code',
  jsx: 'code',
  ts: 'code',
  json: 'file-text',
  md: 'file-text',
  css: 'file-text',
  html: 'file',
};
function iconForCategory(category: string): IconName {
  return CATEGORY_ICONS[category] ?? 'file';
}

/** A rendered explorer row. Sync tree and async node_modules subtree (ADR-0080)
 *  share this shape; `loading`/`error` kinds are node_modules-only. */
type Row = NmRow;
type MutableRow = Row & { readonly kind: 'file' | 'dir' };

const POLL_MS = 1500;
const UPLOAD_BATCH_MAX_FILES = 32;
const UPLOAD_BATCH_MAX_BYTES = 4 * 1024 * 1024;

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

type EditState =
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
type RenameEditState = Extract<EditState, { readonly kind: 'rename' }>;
type CreateEditState = Exclude<EditState, RenameEditState>;

export function FileExplorer(props: {
  vfs: FsOpsTarget;
  mutations?: FileExplorerMutations;
  root: string;
  visible: boolean;
  activePath?: string;
  gitStatus?: ReadonlyMap<string, string>;
  /** When in real-vite mode, enables lazy node_modules browsing (ADR-0080): an
   *  injected node_modules row whose children load on expand via the cache. */
  nodeModules?: {
    readonly cache: NodeModulesCache;
    readonly present: boolean;
    readonly root: string;
  };
  onOpenFile(path: string): void;
  onDownloadFile?(path: string): void;
  onCompareFiles?(leftPath: string, rightPath: string): void;
  onCompareWithHead?(path: string): void;
  onNotify?(message: string, tone: 'error' | 'success'): void;
}) {
  // `vfs` is static; capture once so the unowned poll callback never touches a
  // reactive prop getter (leaks a memo per tick). `visible` and `root` mirror
  // into plain vars/signals via owned effects.
  const vfs = props.vfs;
  let visibleNow = props.visible;
  createEffect(() => {
    visibleNow = props.visible;
  });

  const [rootValue, setRootValue] = createSignal(props.root);
  let rootNow = props.root;
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set([props.root]));
  const [nonce, setNonce] = createSignal(0);
  const [edit, setEdit] = createSignal<EditState | null>(null);
  const [editName, setEditName] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [, setSelectedPath] = createSignal<string | null>(null);
  const [selectedPaths, setSelectedPaths] = createSignal<ReadonlySet<string>>(new Set());
  const [clipboard, setClipboard] = createSignal<FileManagerClipboard | null>(null);
  const [dragging, setDragging] = createSignal<readonly string[] | null>(null);
  const [contextMenu, setContextMenu] = createSignal<{
    readonly path: string;
    readonly name: string;
    readonly kind: 'file' | 'dir';
    readonly mutable: boolean;
    readonly downloadable: boolean;
    readonly comparable: boolean;
    readonly headComparable: boolean;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  let editInputEl: HTMLInputElement | undefined;
  const gitDecorations = createMemo(() => gitStatusDecorationMaps(props.gitStatus ?? new Map()));
  // Per-directory async state of the node_modules subtree (ADR-0080). Written
  // from the remote-read promise; rows memo reads it but never awaits inside.
  const [nmState, setNmState] = createSignal<ReadonlyMap<string, NmNodeState>>(new Map());

  function nodeModulesPath(): string | null {
    const nm = props.nodeModules;
    return nm ? joinPath(nm.root, 'node_modules') : null;
  }
  function isUnderNodeModules(path: string): boolean {
    const nmPath = nodeModulesPath();
    return nmPath !== null && (path === nmPath || path.startsWith(`${nmPath}/`));
  }
  /** Fetch (or replay from cache) one node_modules directory level on expand. */
  function loadNodeModules(path: string): void {
    const nm = props.nodeModules;
    if (!nm) return;
    const cached = nm.cache.peek(path);
    if (cached) {
      setNmState((prev) => new Map(prev).set(path, { status: 'loaded', entries: cached }));
      return;
    }
    setNmState((prev) => new Map(prev).set(path, { status: 'loading' }));
    nm.cache.readdir(path).then(
      (entries) => setNmState((prev) => new Map(prev).set(path, { status: 'loaded', entries })),
      (err: unknown) =>
        setNmState((prev) =>
          new Map(prev).set(path, { status: 'error', message: (err as Error).message }),
        ),
    );
  }
  const refresh = (): void => {
    setNonce((n) => n + 1);
  };
  const canMutate = (): boolean => props.mutations !== undefined;
  const root = (): string => rootValue();

  createEffect(() => {
    const nextRoot = props.root;
    if (nextRoot === rootNow) return;
    rootNow = nextRoot;
    setRootValue(nextRoot);
    setExpanded(new Set([nextRoot]));
    setEdit(null);
    setEditName('');
    setSelectedPath(null);
    setSelectedPaths(new Set<string>());
    setClipboard(null);
    setDragging(null);
    setContextMenu(null);
    refresh();
  });

  function walk(dir: string, depth: number, exp: ReadonlySet<string>, out: Row[]): void {
    let children: TreeChild[];
    try {
      children = readChildren(vfs, dir);
    } catch {
      return; // dir vanished between reads — the next poll reconciles
    }
    for (const child of children) {
      out.push({ ...child, depth });
      if (child.kind === 'dir' && exp.has(child.path)) walk(child.path, depth + 1, exp, out);
    }
  }

  // Cached signature of the last-rendered tree — the poll bumps `nonce` only
  // when this changes (declared before `rows`, which writes it on first run).
  let lastSig = '';
  const rows = createMemo<Row[]>(() => {
    nonce();
    const out: Row[] = [];
    walk(root(), 0, expanded(), out);
    // Signature covers only the sync tree — the node_modules subtree is driven
    // by reactive `nmState` and must NOT make the poll spuriously refresh.
    lastSig = out.map((r) => `${r.path}${r.kind === 'dir' ? '/' : ''}`).join('|');
    const nm = props.nodeModules;
    if (nm?.present) {
      out.push(
        ...composeNodeModulesRows(joinPath(nm.root, 'node_modules'), 0, expanded(), nmState()),
      );
    }
    return out;
  });

  function currentSignature(): string {
    const out: Row[] = [];
    walk(rootNow, 0, expanded(), out);
    return out.map((r) => `${r.path}${r.kind === 'dir' ? '/' : ''}`).join('|');
  }

  onMount(() => {
    const closeContextMenu = (): void => {
      setContextMenu(null);
    };
    document.addEventListener('click', closeContextMenu);
    const timer = setInterval(() => {
      if (!visibleNow) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // TODO(backlog: vfs/vfs-change-events) — poll only because the VFS has no events.
      if (currentSignature() !== lastSig) refresh();
    }, POLL_MS);
    onCleanup(() => {
      clearInterval(timer);
      document.removeEventListener('click', closeContextMenu);
    });
  });

  function toggleDir(path: string): void {
    const willExpand = !expanded().has(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    // Lazily fetch node_modules children on expand (ADR-0080).
    if (willExpand && isUnderNodeModules(path)) loadNodeModules(path);
  }

  function expand(path: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(path);
      return next;
    });
  }

  function canMutateRow(row: Row): row is MutableRow {
    return (
      canMutate() && (row.kind === 'file' || row.kind === 'dir') && !isUnderNodeModules(row.path)
    );
  }
  function canDownloadRow(row: Row): row is Row & { readonly kind: 'file' } {
    return row.kind === 'file' && props.onDownloadFile !== undefined;
  }
  function canCompareRow(row: Row): row is Row & { readonly kind: 'file' } {
    return row.kind === 'file' && props.onCompareFiles !== undefined;
  }
  function canCompareHeadRow(row: Row): row is Row & { readonly kind: 'file' } {
    return (
      row.kind === 'file' && props.onCompareWithHead !== undefined && !isUnderNodeModules(row.path)
    );
  }

  function selectSingle(path: string): void {
    setSelectedPath(path);
    setSelectedPaths(new Set([path]));
  }

  function toggleSelection(path: string): void {
    setSelectedPath(path);
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      if (next.size === 0) next.add(path);
      return next;
    });
  }

  function selectedMutablePathsFor(row: Row): readonly string[] {
    if (!canMutateRow(row)) return [];
    const selected = selectedPaths();
    if (!selected.has(row.path)) return [row.path];
    return rows()
      .filter((candidate): candidate is MutableRow => canMutateRow(candidate))
      .filter((candidate) => selected.has(candidate.path))
      .map((candidate) => candidate.path);
  }

  function selectedComparableFilePaths(): readonly string[] {
    const selected = selectedPaths();
    return rows()
      .filter(
        (candidate): candidate is Row & { readonly kind: 'file' } => candidate.kind === 'file',
      )
      .filter((candidate) => selected.has(candidate.path))
      .map((candidate) => candidate.path);
  }

  function beginCreate(kind: 'create-file' | 'create-dir', parent: string, depth: number): void {
    if (!canMutate() || isUnderNodeModules(parent)) return;
    expand(parent);
    setEdit({ kind, parent, depth });
    setEditName(kind === 'create-file' ? 'untitled.txt' : 'new-folder');
  }

  function beginRename(row: Row): void {
    if (!canMutateRow(row)) return;
    setEdit({
      kind: 'rename',
      path: row.path,
      parent: dirname(row.path),
      depth: row.depth,
      name: row.name,
      rowKind: row.kind,
    });
    setEditName(row.name);
  }

  function cancelEdit(): void {
    setEdit(null);
    setEditName('');
  }

  function renameEditFor(path: string): RenameEditState | null {
    const state = edit();
    return state?.kind === 'rename' && state.path === path ? state : null;
  }

  function createEditForParent(parent: string): CreateEditState | null {
    const state = edit();
    return state && state.kind !== 'rename' && state.parent === parent ? state : null;
  }

  function targetPath(parent: string, name: string): string {
    const trimmed = name.trim();
    if (trimmed.length === 0) throw new Error('Name cannot be empty');
    if (trimmed.includes('/')) throw new Error('Name cannot contain "/"');
    return joinPath(parent, trimmed);
  }

  async function submitEdit(): Promise<void> {
    const state = edit();
    const mutations = props.mutations;
    if (!state || !mutations || busy()) return;
    setBusy(true);
    try {
      if (state.kind === 'create-file') {
        const path = targetPath(state.parent, editName());
        await mutations.createFile(path);
        props.onOpenFile(path);
      } else if (state.kind === 'create-dir') {
        const path = targetPath(state.parent, editName());
        await mutations.createDir(path);
        expand(path);
      } else {
        const path = targetPath(state.parent, editName());
        await mutations.renamePath(state.path, path);
        if (state.rowKind === 'file' && props.activePath === state.path) props.onOpenFile(path);
      }
      cancelEdit();
      refresh();
    } catch (err) {
      props.onNotify?.((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteRow(row: Row): Promise<void> {
    const mutations = props.mutations;
    if (!mutations || !canMutateRow(row) || busy()) return;
    const ok = globalThis.confirm?.(`Delete ${row.name}?`) ?? false;
    if (!ok) return;
    setBusy(true);
    try {
      await mutations.deletePath(row.path);
      if (renameEditFor(row.path)) cancelEdit();
      refresh();
    } catch (err) {
      props.onNotify?.((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function downloadRow(row: Row): void {
    if (!canDownloadRow(row)) return;
    setContextMenu(null);
    props.onDownloadFile?.(row.path);
  }

  function openContextMenu(e: MouseEvent, row: Row): void {
    const mutable = canMutateRow(row);
    const downloadable = canDownloadRow(row);
    const comparable = canCompareRow(row);
    const headComparable = canCompareHeadRow(row);
    if (!mutable && !downloadable && !comparable && !headComparable) return;
    e.preventDefault();
    if (!selectedPaths().has(row.path)) selectSingle(row.path);
    setContextMenu({
      path: row.path,
      name: row.name,
      kind: row.kind === 'dir' ? 'dir' : 'file',
      mutable,
      downloadable,
      comparable,
      headComparable,
      x: e.clientX,
      y: e.clientY,
    });
  }

  function cutSource(path: string): boolean {
    const state = clipboard();
    return state?.mode === 'cut' && state.paths.includes(path);
  }

  function copyRow(row: Row): void {
    if (!canMutateRow(row) || busy()) return;
    setClipboard({ paths: selectedMutablePathsFor(row), mode: 'copy' });
    setContextMenu(null);
  }

  function cutRow(row: Row): void {
    if (!canMutateRow(row) || busy()) return;
    setClipboard({ paths: selectedMutablePathsFor(row), mode: 'cut' });
    setContextMenu(null);
  }

  async function copyExplorerPath(path: string, relative: boolean): Promise<void> {
    const text = relative && path.startsWith(`${root()}/`) ? path.slice(root().length + 1) : path;
    const ok = await copyToClipboard(text);
    props.onNotify?.(ok ? 'Path copied' : 'Could not copy path', ok ? 'success' : 'error');
    setContextMenu(null);
  }

  async function applyClipboard(targetDir: string): Promise<void> {
    const mutations = props.mutations;
    const state = clipboard();
    if (!mutations || !state || busy()) return;
    const plan = planClipboardPaste(vfs, state, targetDir);
    if (plan.actions.length === 0) {
      if (plan.clearAfter) setClipboard(null);
      setContextMenu(null);
      return;
    }
    setBusy(true);
    try {
      for (const action of plan.actions) {
        if (action.kind === 'copy') await mutations.copyTree(action.from, action.to);
        else await mutations.renamePath(action.from, action.to);
      }
      if (plan.clearAfter) setClipboard(null);
      setContextMenu(null);
      refresh();
    } catch (err) {
      props.onNotify?.((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pasteIntoRow(row: Row): Promise<void> {
    if (!canMutateRow(row)) return;
    await applyClipboard(targetDirectoryForExplorerRow(row));
  }

  async function duplicateRow(row: Row): Promise<void> {
    const mutations = props.mutations;
    if (!mutations || !canMutateRow(row) || busy()) return;
    const targetDir = dirname(row.path);
    const plan = planClipboardPaste(vfs, { paths: [row.path], mode: 'copy' }, targetDir);
    setBusy(true);
    try {
      for (const action of plan.actions) await mutations.copyTree(action.from, action.to);
      setContextMenu(null);
      refresh();
    } catch (err) {
      props.onNotify?.((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function hasDroppedDirectory(e: DragEvent): boolean {
    const items = e.dataTransfer?.items;
    if (!items) return false;
    for (const item of Array.from(items)) {
      const entry = (
        item as DataTransferItem & {
          webkitGetAsEntry?: () => { readonly isDirectory?: boolean } | null;
        }
      ).webkitGetAsEntry?.();
      if (entry?.isDirectory) return true;
    }
    return false;
  }

  async function uploadFiles(
    files: readonly File[],
    targetDir: string,
    startRoot = root(),
  ): Promise<void> {
    const mutations = props.mutations;
    if (!mutations || busy()) return;
    const plan = planUploadFiles(vfs, files, targetDir);
    setBusy(true);
    try {
      const writes: { path: string; data: Uint8Array; recursive: true }[] = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const target = plan[i];
        if (!file || !target) continue;
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (root() !== startRoot) throw new Error('workspace root changed during upload');
        writes.push({ path: target.to, data: bytes, recursive: true });
      }
      for (const batch of batchUploadWrites(writes, {
        maxFiles: UPLOAD_BATCH_MAX_FILES,
        maxBytes: UPLOAD_BATCH_MAX_BYTES,
      })) {
        if (root() !== startRoot) throw new Error('workspace root changed during upload');
        await mutations.writeFiles(batch);
      }
      setContextMenu(null);
      refresh();
    } catch (err) {
      props.onNotify?.((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function moveDraggedPaths(paths: readonly string[], targetDir: string): Promise<void> {
    const mutations = props.mutations;
    if (!mutations || busy()) return;
    setBusy(true);
    try {
      const mutable = new Set(
        rows()
          .filter((candidate): candidate is MutableRow => canMutateRow(candidate))
          .map((candidate) => candidate.path),
      );
      for (const path of paths) {
        if (!mutable.has(path)) throw new Error(`cannot move non-mutable path "${path}"`);
      }
      const plan = planDragMove(vfs, paths, targetDir);
      if (plan.length === 0) return;
      await mutations.renameMany(plan.map((action) => ({ from: action.from, to: action.to })));
      setDragging(null);
      setContextMenu(null);
      refresh();
    } catch (err) {
      props.onNotify?.((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  function dragPathsFromEvent(e: DragEvent): readonly string[] {
    const payload = e.dataTransfer?.getData('application/x-rifty-paths');
    if (!payload) return dragging() ?? [];
    try {
      const parsed = JSON.parse(payload) as unknown;
      return Array.isArray(parsed) && parsed.every((p) => typeof p === 'string')
        ? (parsed as string[])
        : [];
    } catch {
      return dragging() ?? [];
    }
  }

  function startRowDrag(e: DragEvent, row: Row): void {
    const paths = selectedMutablePathsFor(row);
    if (paths.length === 0) return;
    setDragging(paths);
    e.dataTransfer?.setData('application/x-rifty-paths', JSON.stringify(paths));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  function dragOverMutableTarget(e: DragEvent, row?: Row): void {
    if (!props.mutations || busy()) return;
    if (row && !canMutateRow(row)) return;
    e.preventDefault();
    if (e.dataTransfer)
      e.dataTransfer.dropEffect = e.dataTransfer.files.length > 0 ? 'copy' : 'move';
  }

  async function dropOnTarget(e: DragEvent, targetDir: string, row?: Row): Promise<void> {
    e.preventDefault();
    e.stopPropagation();
    if (row && !canMutateRow(row)) {
      props.onNotify?.(`Cannot drop on ${row.name}`, 'error');
      return;
    }
    if (hasDroppedDirectory(e)) {
      props.onNotify?.('Folder drops are unsupported; drop files instead', 'error');
      return;
    }
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) {
      await uploadFiles(files, targetDir);
      return;
    }
    await moveDraggedPaths(dragPathsFromEvent(e), targetDir);
  }

  function dropTargetForRow(row: Row): string {
    if (row.kind === 'dir') return row.path;
    if (row.kind === 'file') return dirname(row.path);
    return root();
  }

  function compareSelected(): void {
    const selected = selectedComparableFilePaths();
    if (selected.length !== 2) {
      props.onNotify?.('Select exactly two files to compare', 'error');
      return;
    }
    props.onCompareFiles?.(selected[0]!, selected[1]!);
    setContextMenu(null);
  }

  function compareWithHead(path: string): void {
    props.onCompareWithHead?.(path);
    setContextMenu(null);
  }

  function editNameInput(): JSX.Element {
    return (
      <input
        ref={(el) => {
          editInputEl = el;
        }}
        class="rf-row__input"
        value={editName()}
        disabled={busy()}
        aria-label="File name"
        onInput={(e) => setEditName(e.currentTarget.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            e.preventDefault();
            void submitEdit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
          }
        }}
      />
    );
  }

  function createEditRow(depth: number): JSX.Element {
    return (
      <div class="rf-row" data-kind="edit" style={{ '--rf-row-depth': depth }}>
        <span class="rf-row__ico" aria-hidden="true">
          <Icon name={edit()?.kind === 'create-dir' ? 'folder-plus' : 'file-plus'} size={14} />
        </span>
        {editNameInput()}
      </div>
    );
  }

  function stopButtonKeyPropagation(e: KeyboardEvent): void {
    e.stopPropagation();
  }

  function gitDecoration(row: Row): GitDecoration | null {
    if (row.kind !== 'file' && row.kind !== 'dir') return null;
    return decorationForPath(gitDecorations(), row.path);
  }

  createEffect(() => {
    if (!edit()) return;
    queueMicrotask(() => {
      editInputEl?.focus();
      editInputEl?.select();
    });
  });

  return (
    <div class="rf-explorer" data-mode={canMutate() ? 'owner' : 'read-only'}>
      <div class="rf-explorer__head">
        <span class="rf-explorer__title">Files</span>
        <Show when={!canMutate()}>
          <span class="rf-explorer__path">
            <span class="rf-explorer__ro" title="Mirror of the workspace owner">
              read-only
            </span>
          </span>
        </Show>
        <span class="rf-explorer__tools">
          <Show when={canMutate()}>
            <button
              type="button"
              class="rf-iconbtn rf-iconbtn--sm"
              title="New file"
              aria-label="New file"
              disabled={busy()}
              onClick={() => beginCreate('create-file', root(), 0)}
            >
              <Icon name="file-plus" size={13} />
            </button>
            <button
              type="button"
              class="rf-iconbtn rf-iconbtn--sm"
              title="New folder"
              aria-label="New folder"
              disabled={busy()}
              onClick={() => beginCreate('create-dir', root(), 0)}
            >
              <Icon name="folder-plus" size={13} />
            </button>
          </Show>
          <button
            type="button"
            class="rf-iconbtn rf-iconbtn--sm"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            <Icon name="rotate-ccw" size={13} />
          </button>
        </span>
      </div>

      <div
        class="rf-explorer__scroll"
        role="tree"
        aria-label="Workspace files"
        onDragOver={(e) => dragOverMutableTarget(e)}
        onDrop={(e) => void dropOnTarget(e, root())}
      >
        <Show when={createEditForParent(root())}>{(state) => createEditRow(state().depth)}</Show>
        <For each={rows()}>
          {(row) => (
            <>
              <div
                class="rf-row"
                role="treeitem"
                tabIndex={0}
                data-kind={row.kind}
                data-dim={row.kind === 'dir' && row.name === 'node_modules'}
                data-active={row.kind === 'file' && props.activePath === row.path}
                data-selected={selectedPaths().has(row.path)}
                data-cut={cutSource(row.path)}
                data-git={gitDecoration(row)?.kind}
                draggable={canMutateRow(row)}
                title={gitDecoration(row)?.title}
                aria-expanded={row.kind === 'dir' ? expanded().has(row.path) : undefined}
                style={{ '--rf-row-depth': row.depth }}
                onContextMenu={(e) => openContextMenu(e, row)}
                onFocus={() => setSelectedPath(row.path)}
                onDragStart={(e) => startRowDrag(e, row)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(e) => dragOverMutableTarget(e, row)}
                onDrop={(e) => {
                  void dropOnTarget(e, dropTargetForRow(row), row);
                }}
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) {
                    toggleSelection(row.path);
                    return;
                  }
                  selectSingle(row.path);
                  if (row.kind === 'dir') toggleDir(row.path);
                  else if (row.kind === 'file') props.onOpenFile(row.path);
                }}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && canMutateRow(row)) {
                    const key = e.key.toLowerCase();
                    if (key === 'c') {
                      e.preventDefault();
                      e.stopPropagation();
                      copyRow(row);
                      return;
                    }
                    if (key === 'x') {
                      e.preventDefault();
                      e.stopPropagation();
                      cutRow(row);
                      return;
                    }
                    if (key === 'v') {
                      e.preventDefault();
                      e.stopPropagation();
                      void pasteIntoRow(row);
                      return;
                    }
                  }
                  if (
                    (e.metaKey || e.ctrlKey) &&
                    e.key.toLowerCase() === 's' &&
                    canDownloadRow(row)
                  ) {
                    e.preventDefault();
                    e.stopPropagation();
                    downloadRow(row);
                    return;
                  }
                  if (e.key === 'F2' && canMutateRow(row)) {
                    e.preventDefault();
                    beginRename(row);
                    return;
                  }
                  if ((e.key === 'Delete' || e.key === 'Backspace') && canMutateRow(row)) {
                    e.preventDefault();
                    void deleteRow(row);
                    return;
                  }
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (row.kind === 'dir') toggleDir(row.path);
                    else if (row.kind === 'file') props.onOpenFile(row.path);
                  }
                }}
              >
                <Show when={renameEditFor(row.path)}>
                  <span class="rf-row__ico" aria-hidden="true">
                    <Icon name="pencil-to-square" size={14} />
                  </span>
                  {editNameInput()}
                </Show>
                <Show when={!renameEditFor(row.path)}>
                  {row.kind === 'dir' ? (
                    <span class="rf-row__ico" data-cat="dir" aria-hidden="true">
                      <Icon name={expanded().has(row.path) ? 'folder-open' : 'folder'} size={14} />
                    </span>
                  ) : row.kind === 'loading' ? (
                    <span class="rf-row__ico" data-cat="loading" aria-hidden="true">
                      ◌
                    </span>
                  ) : row.kind === 'error' ? (
                    <span class="rf-row__ico" data-cat="error" aria-hidden="true">
                      ⚠
                    </span>
                  ) : (
                    <span class="rf-row__ico" data-cat={fileCategory(row.name)} aria-hidden="true">
                      <Icon name={iconForCategory(fileCategory(row.name))} size={14} />
                    </span>
                  )}
                  <span class="rf-row__name">{row.name}</span>
                  <Show when={gitDecoration(row)?.badge}>
                    {(badge) => (
                      <span class="rf-row__gitbadge" aria-label={gitDecoration(row)?.title}>
                        {badge()}
                      </span>
                    )}
                  </Show>
                  <Show when={canMutateRow(row) || canDownloadRow(row)}>
                    <span class="rf-row__actions">
                      <Show when={canDownloadRow(row)}>
                        <button
                          type="button"
                          class="rf-iconbtn rf-iconbtn--xs"
                          title={`Download ${row.name}`}
                          aria-label={`Download ${row.name}`}
                          disabled={busy()}
                          onClick={(e) => {
                            e.stopPropagation();
                            downloadRow(row);
                          }}
                          onKeyDown={stopButtonKeyPropagation}
                        >
                          <Icon name="file-arrow-down" size={12} />
                        </button>
                      </Show>
                      <Show when={canMutateRow(row)}>
                        <Show when={row.kind === 'dir'}>
                          <button
                            type="button"
                            class="rf-iconbtn rf-iconbtn--xs"
                            title={`New file in ${row.name}`}
                            aria-label={`New file in ${row.name}`}
                            disabled={busy()}
                            onClick={(e) => {
                              e.stopPropagation();
                              beginCreate('create-file', row.path, row.depth + 1);
                            }}
                            onKeyDown={stopButtonKeyPropagation}
                          >
                            <Icon name="file-plus" size={12} />
                          </button>
                          <button
                            type="button"
                            class="rf-iconbtn rf-iconbtn--xs"
                            title={`New folder in ${row.name}`}
                            aria-label={`New folder in ${row.name}`}
                            disabled={busy()}
                            onClick={(e) => {
                              e.stopPropagation();
                              beginCreate('create-dir', row.path, row.depth + 1);
                            }}
                            onKeyDown={stopButtonKeyPropagation}
                          >
                            <Icon name="folder-plus" size={12} />
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="rf-iconbtn rf-iconbtn--xs"
                          title={`Rename ${row.name}`}
                          aria-label={`Rename ${row.name}`}
                          disabled={busy()}
                          onClick={(e) => {
                            e.stopPropagation();
                            beginRename(row);
                          }}
                          onKeyDown={stopButtonKeyPropagation}
                        >
                          <Icon name="pencil-to-square" size={12} />
                        </button>
                        <button
                          type="button"
                          class="rf-iconbtn rf-iconbtn--xs"
                          title={`Delete ${row.name}`}
                          aria-label={`Delete ${row.name}`}
                          disabled={busy()}
                          onClick={(e) => {
                            e.stopPropagation();
                            void deleteRow(row);
                          }}
                          onKeyDown={stopButtonKeyPropagation}
                        >
                          <Icon name="trash-bin" size={12} />
                        </button>
                      </Show>
                    </span>
                  </Show>
                </Show>
              </div>
              <Show when={createEditForParent(row.path)}>
                {(state) => createEditRow(state().depth)}
              </Show>
            </>
          )}
        </For>

        <Show when={contextMenu()}>
          {(menu) => (
            <div
              class="rf-rowmenu rf-explorer__context"
              role="menu"
              style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            >
              <Show when={menu().mutable}>
                <button
                  type="button"
                  class="rf-rowmenu__item"
                  role="menuitem"
                  disabled={busy()}
                  onClick={() =>
                    copyRow({ path: menu().path, name: menu().name, kind: menu().kind, depth: 0 })
                  }
                >
                  <Icon name="copy" size={13} />
                  Copy
                </button>
                <button
                  type="button"
                  class="rf-rowmenu__item"
                  role="menuitem"
                  disabled={busy()}
                  onClick={() =>
                    cutRow({ path: menu().path, name: menu().name, kind: menu().kind, depth: 0 })
                  }
                >
                  <Icon name="corner-down-left" size={13} />
                  Cut
                </button>
                <button
                  type="button"
                  class="rf-rowmenu__item"
                  role="menuitem"
                  disabled={clipboard() === null || busy()}
                  onClick={() =>
                    void applyClipboard(
                      targetDirectoryForExplorerRow({ kind: menu().kind, path: menu().path }),
                    )
                  }
                >
                  <Icon name="corner-down-left" size={13} />
                  Paste
                </button>
                <button
                  type="button"
                  class="rf-rowmenu__item"
                  role="menuitem"
                  disabled={busy()}
                  onClick={() =>
                    void duplicateRow({
                      path: menu().path,
                      name: menu().name,
                      kind: menu().kind,
                      depth: 0,
                    })
                  }
                >
                  <Icon name="copy" size={13} />
                  Duplicate
                </button>
              </Show>
              <button
                type="button"
                class="rf-rowmenu__item"
                role="menuitem"
                onClick={() => void copyExplorerPath(menu().path, false)}
              >
                <Icon name="copy" size={13} />
                Copy Path
              </button>
              <button
                type="button"
                class="rf-rowmenu__item"
                role="menuitem"
                onClick={() => void copyExplorerPath(menu().path, true)}
              >
                <Icon name="copy" size={13} />
                Copy Relative Path
              </button>
              <Show when={menu().comparable}>
                <button
                  type="button"
                  class="rf-rowmenu__item"
                  role="menuitem"
                  disabled={selectedComparableFilePaths().length !== 2}
                  onClick={compareSelected}
                >
                  <Icon name="file-text" size={13} />
                  Compare Selected
                </button>
              </Show>
              <Show when={menu().headComparable}>
                <button
                  type="button"
                  class="rf-rowmenu__item"
                  role="menuitem"
                  onClick={() => compareWithHead(menu().path)}
                >
                  <Icon name="file-text" size={13} />
                  Compare with HEAD
                </button>
              </Show>
              <Show when={menu().downloadable}>
                <button
                  type="button"
                  class="rf-rowmenu__item"
                  role="menuitem"
                  onClick={() => {
                    props.onDownloadFile?.(menu().path);
                    setContextMenu(null);
                  }}
                >
                  <Icon name="file-arrow-down" size={13} />
                  Download
                </button>
              </Show>
            </div>
          )}
        </Show>

        <Show when={rows().length === 0}>
          <p class="rf-explorer__empty">Loading the workspace from the owner…</p>
        </Show>
      </div>
    </div>
  );
}
