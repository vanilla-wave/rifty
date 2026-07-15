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
import { type VfsDirent, dirname, isAbsolute, normalizePath } from '@riftydev/vfs';
import type { FsOpsTarget } from './fs-ops.ts';
import type {
  OwnerEpoch,
  OwnerVfsRevisionFrame,
  PathVersion,
  TreeRevision,
} from './owner-vfs-protocol.ts';
import type { VfsSnapshotEntry, VfsSnapshotFrame } from './vfs-snapshot-port.ts';

interface Node {
  readonly kind: 'file' | 'dir';
  readonly size: number;
  readonly version?: PathVersion;
  readonly content?: Uint8Array;
  readonly contentOmitted?: 'size-cap';
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
  #ownerEpoch: OwnerEpoch | null = null;
  #treeRevision: TreeRevision | null = null;
  /** Notified after every applied frame — the owner→page publish event. */
  #listeners = new Set<() => void>();
  #revisionListeners = new Set<(frame: OwnerVfsRevisionFrame) => void>();

  constructor(root: string) {
    this.#root = root;
    this.#nodes.set(root, { kind: 'dir', size: 0 });
    this.#children.set(root, []);
  }

  /**
   * Subscribe to applied snapshot frames (each owner publish). Lets a reader
   * retry a path that a just-seeded owner write has not reflected yet (the
   * editor's seeded-file-editable retry) — event-driven, no polling. Returns an
   * unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Subscribe only to owner-issued revisions after this mirror applied them. */
  subscribeRevisions(listener: (frame: OwnerVfsRevisionFrame) => void): () => void {
    this.#revisionListeners.add(listener);
    return () => this.#revisionListeners.delete(listener);
  }

  get root(): string {
    return this.#root;
  }

  get nodeModulesPresent(): boolean {
    return this.#nodeModulesPresent;
  }

  /**
   * Fence the mirror to one owner lifetime. A changed owner clears the old
   * tree before its first frame; delayed frames from the prior owner stay out.
   */
  bindOwner(ownerEpoch: OwnerEpoch, root = this.#root): void {
    if (this.#ownerEpoch === ownerEpoch) {
      if (root !== this.#root) {
        throw new Error(`SnapshotFs owner ${ownerEpoch} cannot rebind to a different root`);
      }
      return;
    }
    this.#ownerEpoch = ownerEpoch;
    this.#treeRevision = null;
    this.#reset(root);
    this.#notify();
  }

  /** Replace the view only with a newer frame from the bound owner. */
  update(frame: VfsSnapshotFrame): void {
    if (!Number.isSafeInteger(frame.treeRevision) || frame.treeRevision < 0) {
      throw new Error(`invalid owner tree revision ${String(frame.treeRevision)}`);
    }
    if (this.#ownerEpoch === null) return;
    if (frame.ownerEpoch !== this.#ownerEpoch) return;
    if (frame.root !== this.#root) return;
    if (this.#treeRevision !== null) {
      if (frame.treeRevision < this.#treeRevision) return;
    }

    const nodes = validatedSnapshotNodes(frame);
    if (frame.treeRevision === this.#treeRevision) {
      // A no-op commit can legitimately republish the current revision. The
      // coordinator still needs this post-send reflection event, but only from
      // an exact complete frame for the already-applied revision.
      if (!sameNodes(nodes, this.#nodes) || frame.nodeModulesPresent !== this.#nodeModulesPresent) {
        throw new Error(`owner snapshot revision ${String(frame.treeRevision)} changed content`);
      }
      this.#notify(frame, false);
      return;
    }
    this.#root = frame.root;
    this.#nodeModulesPresent = frame.nodeModulesPresent;
    this.#nodes = nodes;
    this.#treeRevision = frame.treeRevision;
    this.#reindex();
    this.#notify(frame);
  }

  /** Drop all entries and require an explicit owner bind before accepting again. */
  clear(): void {
    this.#ownerEpoch = null;
    this.#treeRevision = null;
    this.#reset(this.#root);
    this.#notify();
  }

  #notify(frame?: OwnerVfsRevisionFrame, viewChanged = true): void {
    const failures: unknown[] = [];
    if (viewChanged) {
      for (const listener of this.#listeners) {
        try {
          listener();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (frame !== undefined) {
      for (const listener of this.#revisionListeners) {
        try {
          listener(frame);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
      throw new AggregateError(failures, 'SnapshotFs listeners failed');
    }
  }

  #reset(root: string): void {
    this.#root = root;
    this.#nodes = new Map([[root, { kind: 'dir', size: 0 } as Node]]);
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
    return node.content.slice();
  }

  readdirSync(path: string): readonly VfsDirent[] {
    const list = this.#children.get(path);
    if (!list) throw new Error(`ENOENT: no such directory "${path}"`);
    return list.map((entry) => ({ ...entry }));
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
  renameSync(from: string, _to: string): void {
    readOnlyThrow('renameSync', from);
  }

  /** Convenience for callers building an entry list (kept for symmetry/tests). */
  entries(): VfsSnapshotEntry[] {
    return [...this.#nodes]
      .filter(([path]) => path !== this.#root)
      .map(([path, node]) => {
        if (node.version === undefined) {
          throw new Error(`owner snapshot version missing for ${path}`);
        }
        return {
          path,
          kind: node.kind,
          size: node.size,
          version: node.version,
          content: node.content?.slice(),
          contentOmitted: node.contentOmitted,
        };
      });
  }
}

function validatedSnapshotNodes(frame: VfsSnapshotFrame): Map<string, Node> {
  if (frame.type !== 'snapshot') throw new Error('invalid owner snapshot frame type');
  if (typeof frame.nodeModulesPresent !== 'boolean') {
    throw new Error('invalid owner snapshot node_modules presence');
  }
  if (!Array.isArray(frame.entries)) throw new Error('invalid owner snapshot entries');

  const nodes = new Map<string, Node>();
  nodes.set(frame.root, { kind: 'dir', size: 0 });
  for (const entry of frame.entries) {
    const path = entry?.path;
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      normalizePath(path) !== path ||
      path === frame.root ||
      (frame.root !== '/' && !path.startsWith(`${frame.root}/`))
    ) {
      throw new Error(`owner snapshot path is not a canonical descendant of ${frame.root}`);
    }
    if (nodes.has(path)) throw new Error(`owner snapshot path is duplicated: ${path}`);
    nodes.set(path, snapshotNode(entry));
  }

  for (const path of nodes.keys()) {
    if (path === frame.root) continue;
    const parent = nodes.get(dirname(path));
    if (!parent || parent.kind !== 'dir') {
      throw new Error(`owner snapshot directory parent missing for ${path}`);
    }
  }
  return nodes;
}

function snapshotNode(entry: VfsSnapshotEntry): Node {
  if (entry.kind !== 'file' && entry.kind !== 'dir') {
    throw new Error(`invalid owner snapshot kind for ${entry.path}`);
  }
  if (typeof entry.version !== 'string' || entry.version.length === 0) {
    throw new Error(`owner snapshot version missing for ${entry.path}`);
  }
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
    throw new Error(`invalid owner snapshot size for ${entry.path}`);
  }
  if (entry.kind === 'dir') {
    if (entry.size !== 0) throw new Error(`owner snapshot directory has size for ${entry.path}`);
    if (entry.content !== undefined || entry.contentOmitted !== undefined) {
      throw new Error(`owner snapshot directory carries file content for ${entry.path}`);
    }
  } else if (entry.content === undefined) {
    if (entry.contentOmitted !== 'size-cap') {
      throw new Error(`owner snapshot content omission is not explicit for ${entry.path}`);
    }
  } else {
    if (entry.contentOmitted !== undefined) {
      throw new Error(`owner snapshot content and omission conflict for ${entry.path}`);
    }
    if (!(entry.content instanceof Uint8Array)) {
      throw new Error(`owner snapshot content is not bytes for ${entry.path}`);
    }
    if (entry.content.byteLength !== entry.size) {
      throw new Error(`owner snapshot content size mismatch for ${entry.path}`);
    }
  }
  return {
    kind: entry.kind,
    size: entry.size,
    version: entry.version,
    content: entry.content?.slice(),
    contentOmitted: entry.contentOmitted,
  };
}

function sameNodes(left: ReadonlyMap<string, Node>, right: ReadonlyMap<string, Node>): boolean {
  if (left.size !== right.size) return false;
  for (const [path, node] of left) {
    const other = right.get(path);
    if (
      !other ||
      node.kind !== other.kind ||
      node.size !== other.size ||
      node.version !== other.version ||
      node.contentOmitted !== other.contentOmitted ||
      !sameBytes(node.content, other.content)
    ) {
      return false;
    }
  }
  return true;
}

function sameBytes(left: Uint8Array | undefined, right: Uint8Array | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}
