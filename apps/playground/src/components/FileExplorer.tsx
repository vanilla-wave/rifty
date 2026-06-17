/**
 * VFS file explorer (ADR-0075) — a lazy-expand tree of the workspace over the
 * main-thread `syncMirror()`. READ-ONLY viewer: the owner store is the single
 * source of truth (ADR-0148/0150), so the page never mutates the tree directly
 * (snapshotFs throws on write) — create/rename/delete happen via the editor or
 * the terminal, which route to the owner, and the tree reflects them on the next
 * poll. A signature-gated poll (no VFS change events exist) only re-reads when
 * the visible tree actually changed, so hover/scroll aren't clobbered.
 *
 * Owner-routed in-tree CRUD is a deferred follow-up
 * (backlog: playground/owner-routed-explorer-crud) — it would wire the pure
 * `glue/fs-ops` primitives to an owner-RPC target, NOT the read-only snapshot.
 */
import { joinPath } from '@riftydev/vfs';
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import {
  type NmNodeState,
  type NmRow,
  type TreeChild,
  composeNodeModulesRows,
  fileCategory,
  readChildren,
} from '../glue/file-tree.ts';
import type { FsOpsTarget } from '../glue/fs-ops.ts';
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

const POLL_MS = 1500;

export function FileExplorer(props: {
  vfs: FsOpsTarget;
  root: string;
  visible: boolean;
  activePath?: string;
  /** When in real-vite mode, enables lazy node_modules browsing (ADR-0080): an
   *  injected node_modules row whose children load on expand via the cache. */
  nodeModules?: {
    readonly cache: NodeModulesCache;
    readonly present: boolean;
    readonly root: string;
  };
  onOpenFile(path: string): void;
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
    const timer = setInterval(() => {
      if (!visibleNow) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // TODO(backlog: vfs/vfs-change-events) — poll only because the VFS has no events.
      if (currentSignature() !== lastSig) refresh();
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));
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

  return (
    <div class="rf-explorer">
      <div class="rf-explorer__head">
        <span class="rf-explorer__title">Files</span>
        <span class="rf-explorer__path">
          <span
            class="rf-explorer__ro"
            title="Mirror of the workspace owner — create/rename/delete via the editor or terminal"
          >
            read-only
          </span>
        </span>
        <span class="rf-explorer__tools">
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
        <For each={rows()}>
          {(row) => (
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
            </div>
          )}
        </For>

        <Show when={rows().length === 0}>
          <p class="rf-explorer__empty">Loading the workspace from the owner…</p>
        </Show>
      </div>
    </div>
  );
}
