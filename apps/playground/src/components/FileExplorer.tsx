/**
 * VFS file explorer (ADR-0075) — a lazy-expand tree of the workspace over the
 * main-thread `syncMirror()`. Real CRUD (open / new file / new folder / rename /
 * delete), inline name input, and a signature-gated poll (no VFS change events
 * exist) that only re-reads when the visible tree actually changed — so hover /
 * scroll / an open rename input aren't clobbered.
 */
import { basename, dirname, joinPath } from '@riftydev/vfs';
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { type TreeChild, fileCategory, glyphForCategory, readChildren } from '../glue/file-tree.ts';
import { type FsOpsTarget, createDir, createFile, deletePath, renamePath } from '../glue/fs-ops.ts';

interface Row extends TreeChild {
  readonly depth: number;
}

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
  onOpenFile(path: string): void;
  onError?(message: string): void;
}) {
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set([props.root]));
  const [nonce, setNonce] = createSignal(0);
  const [contextDir, setContextDir] = createSignal(props.root);
  const [editing, setEditing] = createSignal<Editing>(null);

  const fail = (err: unknown): void => props.onError?.((err as Error).message);
  const refresh = (): void => setNonce((n) => n + 1);

  function walk(dir: string, depth: number, exp: ReadonlySet<string>, out: Row[]): void {
    let children: TreeChild[];
    try {
      children = readChildren(props.vfs, dir);
    } catch {
      return; // dir vanished between reads — the next poll reconciles
    }
    for (const child of children) {
      out.push({ ...child, depth });
      if (child.kind === 'dir' && exp.has(child.path)) walk(child.path, depth + 1, exp, out);
    }
  }

  const rows = createMemo<Row[]>(() => {
    nonce();
    const out: Row[] = [];
    walk(props.root, 0, expanded(), out);
    lastSig = out.map((r) => `${r.path}${r.kind === 'dir' ? '/' : ''}`).join('|');
    return out;
  });

  let lastSig = '';
  function currentSignature(): string {
    const out: Row[] = [];
    walk(props.root, 0, expanded(), out);
    return out.map((r) => `${r.path}${r.kind === 'dir' ? '/' : ''}`).join('|');
  }

  onMount(() => {
    // Ensure the workspace exists so the tree is never an error/empty void.
    try {
      props.vfs.mkdirSync(props.root, { recursive: true });
    } catch {
      /* best-effort */
    }
    const timer = setInterval(() => {
      if (!props.visible || editing() !== null) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      // TODO(ADR): Q-2026-06-04-312 — poll only because the VFS has no events.
      if (currentSignature() !== lastSig) refresh();
    }, POLL_MS);
    onCleanup(() => clearInterval(timer));
  });

  function toggleDir(path: string): void {
    setContextDir(path);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
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
      if (state?.kind === 'new-file') createFile(props.vfs, joinPath(state.parent, name));
      else if (state?.kind === 'new-folder') createDir(props.vfs, joinPath(state.parent, name));
      else if (state?.kind === 'rename') renamePath(props.vfs, state.path, joinPath(dirname(state.path), name));
    } catch (err) {
      fail(err);
    }
    refresh();
  }

  function remove(path: string, kind: 'file' | 'dir'): void {
    const what = kind === 'dir' ? 'folder (and its contents)' : 'file';
    if (typeof confirm === 'function' && !confirm(`Delete this ${what}?\n${path}`)) return;
    try {
      deletePath(props.vfs, path);
    } catch (err) {
      fail(err);
    }
    refresh();
  }

  return (
    <div class="rf-explorer">
      <div class="rf-explorer__head">
        <span class="rf-eyebrow">Explorer</span>
        <span class="rf-explorer__path" title={contextDir()}>
          {contextDir() === props.root ? 'workspace' : basename(contextDir())}
        </span>
        <span class="rf-explorer__tools">
          <button
            type="button"
            class="rf-iconbtn rf-iconbtn--sm"
            title="New file"
            aria-label="New file"
            onClick={() => startCreate('new-file')}
          >
            ＋
          </button>
          <button
            type="button"
            class="rf-iconbtn rf-iconbtn--sm"
            title="New folder"
            aria-label="New folder"
            onClick={() => startCreate('new-folder')}
          >
            ＋▸
          </button>
          <button
            type="button"
            class="rf-iconbtn rf-iconbtn--sm"
            title="Refresh"
            aria-label="Refresh"
            onClick={refresh}
          >
            ↻
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
                  tabindex="0"
                  data-kind={row.kind}
                  data-active={row.kind === 'file' && props.activePath === row.path}
                  aria-expanded={row.kind === 'dir' ? expanded().has(row.path) : undefined}
                  style={{ '--rf-row-depth': row.depth }}
                  onClick={() => (row.kind === 'dir' ? toggleDir(row.path) : props.onOpenFile(row.path))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (row.kind === 'dir') toggleDir(row.path);
                      else props.onOpenFile(row.path);
                    }
                  }}
                >
                  {row.kind === 'dir' ? (
                    <span class="rf-row__twisty" data-open={expanded().has(row.path)} aria-hidden="true">
                      ▸
                    </span>
                  ) : (
                    <span
                      class="rf-row__ico"
                      data-cat={fileCategory(row.name)}
                      aria-hidden="true"
                    >
                      {glyphForCategory(fileCategory(row.name))}
                    </span>
                  )}
                  <span class="rf-row__name">{row.name}</span>
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
                        remove(row.path, row.kind);
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              </Show>
            );
          }}
        </For>

        <Show when={rows().length === 0 && !editing()}>
          <p class="rf-explorer__empty">
            Empty workspace. Use ＋ to add a file, or run <code>npm install</code> in the console.
          </p>
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
