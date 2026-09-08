/// <reference lib="webworker" />
import { isCrswapArtifactName } from './opfs-errors.ts';
import type { VfsDirent } from './types.ts';

/** Acquired persisted tree could not be read; never authorize memory fallback. */
export class OpfsPreloadError extends Error {
  constructor(cause: unknown) {
    super(
      `OPFS persisted tree preload failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
    this.name = 'OpfsPreloadError';
  }
}

export interface IndexEntry {
  readonly kind: 'file' | 'dir';
  /** Last-known size in bytes (files only; `0` for dirs). */
  size: number;
  /**
   * For directories: the set of child names (one segment, no slash).
   * Maintained in lockstep with the prefix-keyed `index` map so dir-shape
   * ops are O(children) instead of O(tree). `undefined` for files.
   */
  children?: Set<string>;
  /**
   * For directories: memoised sorted dirent list (perf audit 2026-06-05).
   * Invalidated to `null` on attach/detach/removeSubtree of a child AND on a
   * per-child index.set (a child's kind/identity can flip — e.g. writeFileSync
   * over an existing name — and each dirent's isFile/isDirectory is derived
   * per-child). Cleared wholesale on refreshIndex. `null`/absent = rebuild.
   */
  sortedDirents?: readonly VfsDirent[] | null;
}

/** Read one native tree; content is optional for metadata-only refreshes. */
export async function walkOpfsTree(
  root: FileSystemDirectoryHandle,
  content?: Map<string, Uint8Array>,
): Promise<Map<string, IndexEntry>> {
  const out = new Map<string, IndexEntry>();
  out.set('/', { kind: 'dir', size: 0, children: new Set() });
  async function recurse(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    const children = out.get(prefix)?.children;
    for await (const [name, handle] of dir as unknown as AsyncIterable<
      [string, FileSystemHandle]
    >) {
      if (handle.kind === 'file' && isCrswapArtifactName(name)) continue;
      const path = prefix === '/' ? `/${name}` : `${prefix}/${name}`;
      children?.add(name);
      if (handle.kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        out.set(path, { kind: 'file', size: file.size });
        if (content) content.set(path, new Uint8Array(await file.arrayBuffer()));
      } else if (handle.kind === 'directory') {
        out.set(path, { kind: 'dir', size: 0, children: new Set() });
        await recurse(handle as FileSystemDirectoryHandle, path);
      }
    }
  }
  try {
    await recurse(root, '/');
    return out;
  } catch (cause) {
    throw new OpfsPreloadError(cause);
  }
}
