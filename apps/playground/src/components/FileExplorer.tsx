/**
 * VFS file explorer (ADR-0075) — a lazy-expand tree of the workspace over the
 * main-thread `syncMirror()`. Real CRUD (open / new file / new folder / rename /
 * delete), inline name input, and a signature-gated poll (no VFS change events
 * exist) that only re-reads when the visible tree actually changed — so hover /
 * scroll / an open rename input aren't clobbered.
 */
import { basename, dirname, joinPath } from '@riftydev/vfs';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  type NmNodeState,
  type NmRow,
  type TreeChild,
  composeNodeModulesRows,
  fileCategory,
  readChildren,
} from '../glue/file-tree.ts';
import { type FsOpsTarget, createDir, createFile, deletePath, renamePath } from '../glue/fs-ops.ts';
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

type Editing =
  | { readonly kind: 'new-file' | 'new-folder'; readonly parent: string }
  | { readonly kind: 'rename'; readonly path: string }
  | null;

const POLL_MS = 1500;

export function FileExplorer(props: {
  vfs: FsOpsTarget;
  root: string;
  visible: boolean;
  activePath?: string;
  /** When set, the tree is a read-only mirror (e.g. the real-vite worker
   *  project, ADR-0076): mutation controls are hidden. */
  readOnly?: boolean;
  /** When in real-vite mode, enables lazy node_modules browsing (ADR-0080): an
   *  injected node_modules row whose children load on expand via the cache. */
  nodeModules?: {
    readonly cache: NodeModulesCache;
    readonly present: boolean;
    readonly root: string;
  };
  onOpenFile(path: string): void;
  onError?(message: string): void;
}) {
  // `vfs` / `root` are static; capture once so the unowned poll callback never
  // touches a reactive prop getter (leaks a memo per tick). `visible` is
  // mirrored into a plain var via an owned effect.
  const vfs = props.vfs;
  const root = props.root;
  let visibleNow = props.visible;
  createEffect(() => {
    visibleNow = props.visible;
  });

  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set([root]));
  const [nonce, setNonce] = createSignal(0);
  const [contextDir, setContextDir] = createSignal(root);
  const [editing, setEditing] = createSignal<Editing>(null);
  // Per-directory async state of the node_modules subtree (ADR-0080). Written
  // from the remote-read promise; rows memo reads it but never awaits inside.
  const [nmState, setNmState] = createSignal<ReadonlyMap<string, NmNodeState>>(new Map());

  const fail = (err: unknown): void => props.onError?.((err as Error).message);

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
    walk(root, 0, expanded(), out);
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
    walk(root, 0, expanded(), out);
    return out.map((r) => `${r.path}${r.kind === 'dir' ? '/' : ''}`).join('|');
  }

  onMount(() => {
    // Ensure the workspace exists so the tree is never an error/empty void.
    // Skipped for a read-only mirror (its mkdir throws by design).
    if (!props.readOnly) {
      try {
        vfs.mkdirSync(root, { recursive: true });
      } catch {
        /* best-effort */
      }
    }
    const timer = setInterval(() => {
      if (!visibleNow || editing() !== null) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // TODO(backlog: vfs/vfs-change-events) — poll only because the VFS has no events.
      if (currentSignature() !== lastSig) refresh();
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  function toggleDir(path: string): void {
    setContextDir(path);
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
    setExpanded((prev) => new Set(prev).add(path));
  }

  function startCreate(kind: 'new-file' | 'new-folder'): void {
    const parent = contextDir();
    expand(parent);
    setEditing({ kind, parent });
  }

  function commitEditing(rawName: string): void {
    const state = editing();
    setEditing(null);
    const name = rawName.trim();
    if (!name || name.includes('/')) return;
    try {
      if (state?.kind === 'new-file') createFile(vfs, joinPath(state.parent, name));
      else if (state?.kind === 'new-folder') createDir(vfs, joinPath(state.parent, name));
      else if (state?.kind === 'rename')
        renamePath(vfs, state.path, joinPath(dirname(state.path), name));
    } catch (err) {
      fail(err);
    }
    refresh();
  }

  function remove(path: string, kind: 'file' | 'dir'): void {
    const what = kind === 'dir' ? 'folder (and its contents)' : 'file';
    if (typeof confirm === 'function' && !confirm(`Delete this ${what}?\n${path}`)) return;
    try {
      deletePath(vfs, path);
    } catch (err) {
      fail(err);
    }
    refresh();
  }

  return (
    <div class="rf-explorer">
      <div class="rf-explorer__head">
        <span class="rf-explorer__title">Files</span>
        <span class="rf-explorer__path" title={contextDir()}>
          {contextDir() === root ? '' : basename(contextDir())}
          <Show when={props.readOnly}>
            <span class="rf-explorer__ro" title="Mirror of the Vite worker — read-only">
              read-only
            </span>
          </Show>
        </span>
        <span class="rf-explorer__tools">
          <Show when={!props.readOnly}>
            <button
              type="button"
              class="rf-iconbtn rf-iconbtn--sm"
              title="New file"
              aria-label="New file"
              onClick={() => startCreate('new-file')}
            >
              <Icon name="file-plus" size={13} />
            </button>
            <button
              type="button"
              class="rf-iconbtn rf-iconbtn--sm"
              title="New folder"
              aria-label="New folder"
              onClick={() => startCreate('new-folder')}
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

      <div class="rf-explorer__scroll" role="tree" aria-label="Workspace files">
        <Show when={editing()?.kind === 'new-file' || editing()?.kind === 'new-folder'}>
          <NameInput
            placeholder={editing()?.kind === 'new-folder' ? 'folder name' : 'file name'}
            onCommit={commitEditing}
            onCancel={() => setEditing(null)}
          />
        </Show>

        <For each={rows()}>
          {(row) => {
            const isRenaming = (): boolean => {
              const e = editing();
              return e?.kind === 'rename' && e.path === row.path;
            };
            return (
              <Show
                when={!isRenaming()}
                fallback={
                  <NameInput
                    depth={row.depth}
                    initial={row.name}
                    onCommit={commitEditing}
                    onCancel={() => setEditing(null)}
                  />
                }
              >
                <div
                  class="rf-row"
                  role="treeitem"
                  tabIndex={0}
                  data-kind={row.kind}
                  data-dim={row.kind === 'dir' && row.name === 'node_modules'}
                  data-active={row.kind === 'file' && props.activePath === row.path}
                  aria-expanded={row.kind === 'dir' ? expanded().has(row.path) : undefined}
                  style={{ '--rf-row-depth': row.depth }}
                  onClick={() => {
                    if (row.kind === 'dir') toggleDir(row.path);
                    else if (row.kind === 'file') props.onOpenFile(row.path);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (row.kind === 'dir') toggleDir(row.path);
                      else if (row.kind === 'file') props.onOpenFile(row.path);
                    }
                  }}
                >
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
                  <Show when={!props.readOnly && (row.kind === 'file' || row.kind === 'dir')}>
                    <span class="rf-row__actions">
                      <button
                        type="button"
                        class="rf-iconbtn rf-iconbtn--xs"
                        title="Rename"
                        aria-label={`Rename ${row.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing({ kind: 'rename', path: row.path });
                        }}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        class="rf-iconbtn rf-iconbtn--xs"
                        title="Delete"
                        aria-label={`Delete ${row.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (row.kind === 'file' || row.kind === 'dir') remove(row.path, row.kind);
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  </Show>
                </div>
              </Show>
            );
          }}
        </For>

        <Show when={rows().length === 0 && !editing()}>
          <Show
            when={props.readOnly}
            fallback={
              <p class="rf-explorer__empty">
                Empty workspace. Use ＋ to add a file, or run <code>npm install</code> in the
                console.
              </p>
            }
          >
            <p class="rf-explorer__empty">Loading the Vite project from the worker…</p>
          </Show>
        </Show>
      </div>
    </div>
  );
}

function NameInput(props: {
  initial?: string;
  placeholder?: string;
  depth?: number;
  onCommit(name: string): void;
  onCancel(): void;
}) {
  let input: HTMLInputElement | undefined;
  onMount(() => {
    input?.focus();
    input?.select();
  });
  return (
    <div class="rf-row rf-row--edit" style={{ '--rf-row-depth': props.depth ?? 0 }}>
      <input
        ref={input}
        class="rf-row__input"
        type="text"
        value={props.initial ?? ''}
        placeholder={props.placeholder}
        spellcheck={false}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            props.onCommit(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            props.onCancel();
          }
        }}
        onBlur={(e) => {
          const v = e.currentTarget.value.trim();
          if (v) props.onCommit(v);
          else props.onCancel();
        }}
      />
    </div>
  );
}
