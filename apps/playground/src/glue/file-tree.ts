/**
 * Pure helpers for the {@link ../components/FileExplorer.tsx | FileExplorer}
 * tree (ADR-0075). Solid-free and reader-injected so the sort / lazy-read /
 * icon logic is unit-testable with a fake `readdirSync` (no VFS, no DOM).
 */
import type { VfsDirent } from '@riftydev/vfs';
import { basename, joinPath } from '@riftydev/vfs';
import type { NodeModulesDirEntry } from './node-modules-port.ts';

export interface TreeChild {
  /** Absolute VFS path. */
  readonly path: string;
  readonly name: string;
  readonly kind: 'file' | 'dir';
}

/** The slice of the sync mirror the tree reads (kept narrow for testing). */
export interface DirentReader {
  readdirSync(path: string): readonly VfsDirent[];
}

/** Directories first, then files, each case-insensitive alphabetical. */
export function sortDirents(entries: readonly VfsDirent[]): VfsDirent[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

/** Read+sort the immediate children of `dir` into {@link TreeChild}s (lazy: one level). */
export function readChildren(reader: DirentReader, dir: string): TreeChild[] {
  return sortDirents(reader.readdirSync(dir)).map((e) => ({
    path: joinPath(dir, e.name),
    name: e.name,
    kind: e.isDirectory ? 'dir' : 'file',
  }));
}

/**
 * A coarse file category from the extension, used to pick a glyph + accent in
 * the explorer (CSS keys off `data-cat`). Returning a category (not a raw
 * glyph) keeps this testable and the visual vocabulary in one CSS place.
 */
export function fileCategory(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot <= 0 ? '' : name.slice(dot + 1).toLowerCase();
  switch (ext) {
    case 'js':
    case 'cjs':
    case 'mjs':
      return 'js';
    case 'ts':
      return 'ts';
    case 'jsx':
    case 'tsx':
      return 'jsx';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'md';
    case 'css':
      return 'css';
    case 'html':
    case 'htm':
      return 'html';
    case 'txt':
    case 'log':
      return 'txt';
    default:
      if (name === 'package.json') return 'json';
      if (name.endsWith('lock') || name === 'package-lock.json' || name === 'pnpm-lock.yaml') {
        return 'lock';
      }
      return 'file';
  }
}

/**
 * Per-directory async state of the `node_modules` subtree (ADR-0080). Held in a
 * Solid signal by {@link ../components/FileExplorer.tsx} and written from the
 * remote-read promise's `.then`/`.catch`; this module stays Solid-free.
 */
export type NmNodeState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly entries: readonly NodeModulesDirEntry[] }
  | { readonly status: 'error'; readonly message: string };

/** A composed explorer row for the `node_modules` subtree. `loading`/`error`
 *  are synthetic rows the renderer shows in place of children. */
export interface NmRow {
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly kind: 'dir' | 'file' | 'loading' | 'error';
  /** Present on `error` rows — the worker's message. */
  readonly message?: string;
}

function appendNmChildren(
  dir: string,
  depth: number,
  expanded: ReadonlySet<string>,
  nmState: ReadonlyMap<string, NmNodeState>,
  out: NmRow[],
): void {
  const state = nmState.get(dir);
  if (!state || state.status === 'loading') {
    out.push({ path: `${dir}#loading`, name: 'Loading…', depth, kind: 'loading' });
    return;
  }
  if (state.status === 'error') {
    out.push({
      path: `${dir}#error`,
      name: state.message,
      depth,
      kind: 'error',
      message: state.message,
    });
    return;
  }
  for (const entry of state.entries) {
    const childPath = joinPath(dir, entry.name);
    out.push({ path: childPath, name: entry.name, depth, kind: entry.kind });
    if (entry.kind === 'dir' && expanded.has(childPath)) {
      appendNmChildren(childPath, depth + 1, expanded, nmState, out);
    }
  }
}

/**
 * Compose the rows for the `node_modules` subtree (ADR-0080), interleaving the
 * async per-directory state into the same flat row list the sync walk produces.
 * Pure (Solid-free) so the async-row interleave — the load-bearing bit — is
 * unit-tested without jsdom: the rows memo reads `nmState`/`expanded` signal
 * values and calls this; the async work lives in event handlers that write them.
 *
 * Returns the collapsed `node_modules` dir row, plus — when it (or a loaded
 * subdir) is expanded — a loading row, an error row, or its children at depth+1.
 */
export function composeNodeModulesRows(
  nodeModulesPath: string,
  baseDepth: number,
  expanded: ReadonlySet<string>,
  nmState: ReadonlyMap<string, NmNodeState>,
): NmRow[] {
  const out: NmRow[] = [
    { path: nodeModulesPath, name: basename(nodeModulesPath), depth: baseDepth, kind: 'dir' },
  ];
  if (expanded.has(nodeModulesPath)) {
    appendNmChildren(nodeModulesPath, baseDepth + 1, expanded, nmState, out);
  }
  return out;
}

/** A single-glyph badge per category — bespoke, monochrome, no icon-font dep. */
export function glyphForCategory(cat: string): string {
  switch (cat) {
    case 'js':
    case 'jsx':
      return 'JS';
    case 'ts':
      return 'TS';
    case 'json':
      return '{}';
    case 'md':
      return 'M↓';
    case 'css':
      return '#';
    case 'html':
      return '<>';
    case 'txt':
      return '¶';
    case 'lock':
      return '⚿';
    default:
      return '◦';
  }
}
