/**
 * Shared in-memory backend for both the async {@link Vfs} surface and the
 * sync {@link FsSync} surface (ADR-0014).
 *
 * The async {@link MemoryVfs} and the sync {@link MemoryFsSync} are thin
 * views over a single `MemoryBackend`; writes through either surface are
 * visible through the other. `createMemoryFs()` is the canonical factory.
 *
 * All methods on the backend are synchronous — in-memory trees have no I/O
 * to await. The async view just wraps them in `Promise.resolve()`.
 */
import { VfsError } from './errors.ts';
import { dirname, normalizePath, segments } from './path.ts';

type FileNode = { kind: 'file'; data: Uint8Array; mtime: number };
type DirNode = { kind: 'dir'; children: Map<string, Node>; mtime: number };
export type Node = FileNode | DirNode;

const encoder = new TextEncoder();

function makeDir(): DirNode {
  return { kind: 'dir', children: new Map(), mtime: Date.now() };
}

function makeFile(data: Uint8Array): FileNode {
  return { kind: 'file', data, mtime: Date.now() };
}

export interface MemoryStat {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  mtime: number;
}

export class MemoryBackend {
  readonly root: DirNode = makeDir();

  resolve(path: string): Node | null {
    const parts = segments(path);
    let node: Node = this.root;
    for (const part of parts) {
      if (node.kind !== 'dir') return null;
      const next = node.children.get(part);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  exists(path: string): boolean {
    return this.resolve(path) !== null;
  }

  readFile(path: string): Uint8Array {
    const node = this.resolve(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'file') throw new VfsError('EISDIR', path);
    return node.data;
  }

  writeFile(path: string, data: Uint8Array | string): void {
    const normalized = normalizePath(path);
    const parent = dirname(normalized);
    const parentNode = this.resolve(parent);
    if (!parentNode) throw new VfsError('ENOENT', parent);
    if (parentNode.kind !== 'dir') throw new VfsError('ENOTDIR', parent);
    const name = normalized.slice(parent === '/' ? 1 : parent.length + 1);
    if (name === '') throw new VfsError('EINVAL', path);
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    const existing = parentNode.children.get(name);
    if (existing && existing.kind === 'dir') throw new VfsError('EISDIR', path);
    parentNode.children.set(name, makeFile(bytes));
    parentNode.mtime = Date.now();
  }

  readdir(path: string): readonly string[] {
    const node = this.resolve(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    return [...node.children.keys()].sort();
  }

  readdirEntries(path: string): readonly { name: string; isFile: boolean; isDirectory: boolean }[] {
    const node = this.resolve(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    const out: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
    for (const [name, child] of node.children) {
      out.push({ name, isFile: child.kind === 'file', isDirectory: child.kind === 'dir' });
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }

  mkdir(path: string, options: { recursive?: boolean } = {}): void {
    const recursive = options.recursive ?? false;
    const parts = segments(path);
    if (parts.length === 0) {
      if (!recursive) throw new VfsError('EEXIST', path);
      return;
    }
    let node: Node = this.root;
    for (let i = 0; i < parts.length; i++) {
      if (node.kind !== 'dir') throw new VfsError('ENOTDIR', `/${parts.slice(0, i).join('/')}`);
      const part = parts[i];
      if (part === undefined) continue;
      const next = node.children.get(part);
      if (!next) {
        if (!recursive && i < parts.length - 1) {
          throw new VfsError('ENOENT', `/${parts.slice(0, i + 1).join('/')}`);
        }
        const newDir = makeDir();
        node.children.set(part, newDir);
        node.mtime = Date.now();
        node = newDir;
        continue;
      }
      if (i === parts.length - 1) {
        if (next.kind !== 'dir') throw new VfsError('ENOTDIR', path);
        if (!recursive) throw new VfsError('EEXIST', path);
      }
      node = next;
    }
  }

  rm(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    const recursive = options.recursive ?? false;
    const force = options.force ?? false;
    const normalized = normalizePath(path);
    if (normalized === '/') {
      if (recursive) {
        this.root.children.clear();
        return;
      }
      throw new VfsError('EPERM', '/');
    }
    const parent = dirname(normalized);
    const parentNode = this.resolve(parent);
    if (!parentNode || parentNode.kind !== 'dir') {
      if (force) return;
      throw new VfsError('ENOENT', parent);
    }
    const name = normalized.slice(parent === '/' ? 1 : parent.length + 1);
    const target = parentNode.children.get(name);
    if (!target) {
      if (force) return;
      throw new VfsError('ENOENT', path);
    }
    if (target.kind === 'dir' && target.children.size > 0 && !recursive) {
      throw new VfsError('EPERM', path);
    }
    parentNode.children.delete(name);
    parentNode.mtime = Date.now();
  }

  stat(path: string): MemoryStat {
    const node = this.resolve(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind === 'file') {
      return {
        isFile: true,
        isDirectory: false,
        size: node.data.byteLength,
        mtime: node.mtime,
      };
    }
    return { isFile: false, isDirectory: true, size: 0, mtime: node.mtime };
  }
}
