/**
 * Synchronous mirror of a VFS — needed by `fs.readFileSync` and friends.
 *
 * For `MemoryVfs` this is trivially in-process. For OPFS in a Worker the
 * `FileSystemSyncAccessHandle` API gives true sync semantics; this module is
 * the seam that lets us swap implementations behind the same interface.
 *
 * Lives in `@rifty/vfs` so that any layer above (runtime-js for `fs`,
 * runtime-wasi for preopens) can share the same instance without one runtime
 * importing the other.
 */

import { dirname, joinPath, normalizePath } from './path.ts';

export interface FsSync {
  existsSync(path: string): boolean;
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  readdirSync(path: string): readonly string[];
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number };
}

type FileNode = { kind: 'file'; data: Uint8Array; mtime: number };
type DirNode = { kind: 'dir'; children: Map<string, Node>; mtime: number };
type Node = FileNode | DirNode;

export class MemoryFsSync implements FsSync {
  private readonly root: DirNode = { kind: 'dir', children: new Map(), mtime: Date.now() };

  private resolve(path: string): Node | null {
    const n = normalizePath(path);
    if (n === '/') return this.root;
    const parts = n.slice(1).split('/');
    let cur: Node = this.root;
    for (const part of parts) {
      if (cur.kind !== 'dir') return null;
      const next = cur.children.get(part);
      if (!next) return null;
      cur = next;
    }
    return cur;
  }

  existsSync(path: string): boolean {
    return this.resolve(path) !== null;
  }

  readFileBytesSync(path: string): Uint8Array {
    const node = this.resolve(path);
    if (!node) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT', path });
    if (node.kind !== 'file')
      throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR', path });
    return node.data;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    const np = normalizePath(path);
    const parent = dirname(np);
    const name = np.slice(parent === '/' ? 1 : parent.length + 1);
    const parentNode = this.resolve(parent);
    if (!parentNode || parentNode.kind !== 'dir') {
      throw Object.assign(new Error(`ENOENT: ${parent}`), { code: 'ENOENT', path: parent });
    }
    parentNode.children.set(name, { kind: 'file', data, mtime: Date.now() });
    parentNode.mtime = Date.now();
  }

  readdirSync(path: string): readonly string[] {
    const node = this.resolve(path);
    if (!node) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT', path });
    if (node.kind !== 'dir')
      throw Object.assign(new Error(`ENOTDIR: ${path}`), { code: 'ENOTDIR', path });
    return [...node.children.keys()].sort();
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    const np = normalizePath(path);
    if (np === '/') {
      if (options.recursive) return;
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST', path });
    }
    const parts = np.slice(1).split('/');
    let cur: DirNode = this.root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === undefined) continue;
      let next = cur.children.get(part);
      if (!next) {
        if (!options.recursive && i < parts.length - 1) {
          throw Object.assign(new Error(`ENOENT: ${parts.slice(0, i + 1).join('/')}`), {
            code: 'ENOENT',
          });
        }
        next = { kind: 'dir', children: new Map(), mtime: Date.now() };
        cur.children.set(part, next);
        cur.mtime = Date.now();
      }
      if (next.kind !== 'dir') {
        throw Object.assign(new Error(`ENOTDIR: ${part}`), { code: 'ENOTDIR' });
      }
      cur = next;
    }
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    const np = normalizePath(path);
    if (np === '/') {
      if (options.recursive) {
        this.root.children.clear();
        return;
      }
      throw Object.assign(new Error('EPERM: /'), { code: 'EPERM', path: '/' });
    }
    const parent = dirname(np);
    const name = np.slice(parent === '/' ? 1 : parent.length + 1);
    const parentNode = this.resolve(parent);
    if (!parentNode || parentNode.kind !== 'dir') {
      if (options.force) return;
      throw Object.assign(new Error(`ENOENT: ${parent}`), { code: 'ENOENT', path: parent });
    }
    const target = parentNode.children.get(name);
    if (!target) {
      if (options.force) return;
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT', path });
    }
    if (target.kind === 'dir' && target.children.size > 0 && !options.recursive) {
      throw Object.assign(new Error(`ENOTEMPTY: ${path}`), { code: 'ENOTEMPTY', path });
    }
    parentNode.children.delete(name);
    parentNode.mtime = Date.now();
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number; mtime?: number } {
    const node = this.resolve(path);
    if (!node) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT', path });
    if (node.kind === 'file') {
      return { isFile: true, isDirectory: false, size: node.data.byteLength, mtime: node.mtime };
    }
    return { isFile: false, isDirectory: true, size: 0, mtime: node.mtime };
  }

  loadFixture(files: Readonly<Record<string, string>>): void {
    const enc = new TextEncoder();
    for (const [path, content] of Object.entries(files)) {
      const np = normalizePath(path);
      this.mkdirSync(dirname(np), { recursive: true });
      this.writeFileSync(np, enc.encode(content));
    }
  }
}

let active: FsSync & { loadFixture?(files: Readonly<Record<string, string>>): void } =
  new MemoryFsSync();

export function syncMirror(): FsSync & {
  loadFixture?(files: Readonly<Record<string, string>>): void;
} {
  return active;
}

export function resetSyncMirror(): void {
  active = new MemoryFsSync();
}

export function setSyncMirror(impl: FsSync): void {
  active = impl;
}

export { joinPath };
