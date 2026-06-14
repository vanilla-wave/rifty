/**
 * Read-only page-side view of a worker realm's project tree (ADR-0076).
 *
 * Built from {@link VfsSnapshotFrame}s arriving over {@link ./vfs-snapshot-port.ts};
 * implements the {@link FsOpsTarget} read slice so the {@link
 * ../components/FileExplorer.tsx | FileExplorer} and editor can render the real
 * Vite project that lives in the worker. `readOnly` is `true`: every mutation
 * throws a clear, pathful error (no silent stub — the worker owns these files,
 * the page never writes them back). The `node_modules` subtree is intentionally
 * absent (excluded at the source); {@link nodeModulesPresent} records that it
 * exists in the worker so the UI can hint it without listing thousands of files.
 */
import type { VfsDirent } from '@riftydev/vfs';
import type { FsOpsTarget } from './fs-ops.ts';
import type { VfsSnapshotEntry, VfsSnapshotFrame } from './vfs-snapshot-port.ts';

interface Node {
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly content?: Uint8Array;
}

function readOnlyThrow(op: string, path: string): never {
  throw new Error(`${op}: "${path}" is read-only — it lives in the Vite worker realm`);
}

export class SnapshotFs implements FsOpsTarget {
  readonly readOnly = true;

  #root: string;
  #nodes = new Map<string, Node>();
  /** dir path → sorted immediate-child names (dirs before files). */
  #children = new Map<string, VfsDirent[]>();
  #nodeModulesPresent = false;

  constructor(root: string) {
    this.#root = root;
    this.#nodes.set(root, { kind: 'dir', size: 0 });
    this.#children.set(root, []);
  }

  get root(): string {
    return this.#root;
  }

  get nodeModulesPresent(): boolean {
    return this.#nodeModulesPresent;
  }

  /** Replace the entire view from a fresh full-tree frame. */
  update(frame: VfsSnapshotFrame): void {
    this.#root = frame.root;
    this.#nodeModulesPresent = frame.nodeModulesPresent;
    const nodes = new Map<string, Node>();
    nodes.set(frame.root, { kind: 'dir', size: 0 });
    for (const e of frame.entries) {
      nodes.set(e.path, { kind: e.kind, size: e.size, content: e.content });
    }
    this.#nodes = nodes;
    this.#reindex();
  }

  /** Drop all entries (called when leaving real-vite, so a stale tree never lingers). */
  clear(): void {
    this.#nodes = new Map([[this.#root, { kind: 'dir', size: 0 } as Node]]);
    this.#nodeModulesPresent = false;
    this.#reindex();
  }

  #reindex(): void {
    const children = new Map<string, VfsDirent[]>();
    for (const path of this.#nodes.keys()) children.set(path, []);
    for (const [path, node] of this.#nodes) {
      if (path === this.#root) continue;
      const slash = path.lastIndexOf('/');
      const parent = slash <= 0 ? '/' : path.slice(0, slash);
      const list = children.get(parent);
      if (!list) continue;
      list.push({
        name: path.slice(slash + 1),
        isFile: node.kind === 'file',
        isDirectory: node.kind === 'dir',
      });
    }
    for (const list of children.values()) {
      list.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        const an = a.name.toLowerCase();
        const bn = b.name.toLowerCase();
        return an < bn ? -1 : an > bn ? 1 : 0;
      });
    }
    this.#children = children;
  }

  existsSync(path: string): boolean {
    return this.#nodes.has(path);
  }

  readFileBytesSync(path: string): Uint8Array {
    const node = this.#nodes.get(path);
    if (!node || node.kind !== 'file') throw new Error(`ENOENT: no such file "${path}"`);
    if (!node.content) {
      throw new Error(`"${path}" is ${node.size} bytes — too large to preview from the worker`);
    }
    return node.content;
  }

  readdirSync(path: string): readonly VfsDirent[] {
    const list = this.#children.get(path);
    if (!list) throw new Error(`ENOENT: no such directory "${path}"`);
    return list;
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    const node = this.#nodes.get(path);
    if (!node) throw new Error(`ENOENT: no such file or directory "${path}"`);
    return { isFile: node.kind === 'file', isDirectory: node.kind === 'dir', size: node.size };
  }

  // — Mutations: read-only, every one throws (no silent stub). —
  writeFileSync(path: string, _data: Uint8Array): void {
    readOnlyThrow('writeFileSync', path);
  }
  mkdirSync(path: string, _options: { recursive?: boolean }): void {
    readOnlyThrow('mkdirSync', path);
  }
  rmSync(path: string, _options: { recursive?: boolean; force?: boolean }): void {
    readOnlyThrow('rmSync', path);
  }

  /** Convenience for callers building an entry list (kept for symmetry/tests). */
  entries(): VfsSnapshotEntry[] {
    return [...this.#nodes]
      .filter(([path]) => path !== this.#root)
      .map(([path, n]) => ({ path, kind: n.kind, size: n.size, content: n.content }));
  }
}
