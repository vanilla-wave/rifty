import { VfsError } from './errors.ts';
import { dirname, normalizePath, segments } from './path.ts';
import type { Vfs, VfsDirent, VfsStat } from './types.ts';

type Node =
  | { readonly kind: 'file'; data: Uint8Array; mtime: number }
  | { readonly kind: 'dir'; children: Map<string, Node>; mtime: number };

function makeDir(): Node {
  return { kind: 'dir', children: new Map(), mtime: Date.now() };
}

function makeFile(data: Uint8Array): Node {
  return { kind: 'file', data, mtime: Date.now() };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export class MemoryVfs implements Vfs {
  private readonly root: Node = makeDir();

  private resolve(path: string): Node | null {
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

  private resolveDir(path: string): Node & { kind: 'dir' } {
    const node = this.resolve(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    return node;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const node = this.resolve(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'file') throw new VfsError('EISDIR', path);
    return node.data;
  }

  async readFileText(path: string, _encoding: 'utf8' = 'utf8'): Promise<string> {
    const bytes = await this.readFile(path);
    return decoder.decode(bytes);
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
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

  async readdir(path: string): Promise<readonly VfsDirent[]> {
    const dir = this.resolveDir(path);
    const out: VfsDirent[] = [];
    for (const [name, child] of dir.children) {
      out.push({
        name,
        isFile: child.kind === 'file',
        isDirectory: child.kind === 'dir',
      });
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return out;
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const recursive = options?.recursive ?? false;
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

  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    const recursive = options?.recursive ?? false;
    const force = options?.force ?? false;
    const normalized = normalizePath(path);
    if (normalized === '/') {
      if (recursive) {
        (this.root as { children: Map<string, Node> }).children.clear();
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

  async stat(path: string): Promise<VfsStat> {
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

  async exists(path: string): Promise<boolean> {
    return this.resolve(path) !== null;
  }

  async openReadable(
    path: string,
    opts?: { chunkSize?: number; start?: number; end?: number },
  ): Promise<ReadableStream<Uint8Array>> {
    const node = this.resolve(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'file') throw new VfsError('EISDIR', path);
    const data = node.data;
    const start = opts?.start ?? 0;
    const end = Math.min(opts?.end ?? data.byteLength, data.byteLength);
    const chunkSize = opts?.chunkSize ?? 64 * 1024;
    let offset = start;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= end) {
          controller.close();
          return;
        }
        const next = Math.min(offset + chunkSize, end);
        controller.enqueue(data.subarray(offset, next));
        offset = next;
      },
    });
  }
}
