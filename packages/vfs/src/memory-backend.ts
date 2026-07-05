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
import { dirnameNormalized, normalizeAbsolute, segments } from './path.ts';

type FileNode = { kind: 'file'; data: Uint8Array; mtime: number; atime: number };
type Dirent = { name: string; isFile: boolean; isDirectory: boolean };
type DirNode = {
  kind: 'dir';
  children: Map<string, Node>;
  mtime: number;
  atime: number;
  /**
   * Memoised sorted dirent list (perf audit 2026-06-05). Invalidated to `null`
   * on ANY mutation of `children` (set/delete/clear) — incl. a child node being
   * replaced (writeFile over an existing name), since each dirent's
   * `isFile`/`isDirectory` is derived from the child node's kind. `null` = stale,
   * rebuild on next read. The cached array is frozen (callers get `readonly[]`).
   */
  sortedDirents: readonly Dirent[] | null;
};
export type Node = FileNode | DirNode;

const encoder = new TextEncoder();

function makeDir(): DirNode {
  const now = Date.now();
  return { kind: 'dir', children: new Map(), mtime: now, atime: now, sortedDirents: null };
}

function makeFile(data: Uint8Array): FileNode {
  const now = Date.now();
  return { kind: 'file', data, mtime: now, atime: now };
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

  /**
   * Strict walk (Node parity): a non-final component that exists as a FILE is
   * `ENOTDIR`, never a silent `null`→ENOENT — open/stat/scandir/unlink through
   * a file must report ENOTDIR (parity case fs/error-shape-errno-syscall).
   * Missing components still return `null` (caller picks ENOENT vs `force`).
   * `reportPath` is the path the error names — callers resolving a PARENT pass
   * the full target so the error points at what the user asked for.
   */
  resolveStrict(path: string, reportPath: string = path): Node | null {
    const parts = segments(path);
    let node: Node = this.root;
    for (const part of parts) {
      if (node.kind !== 'dir') throw new VfsError('ENOTDIR', reportPath);
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
    const node = this.resolveStrict(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'file') throw new VfsError('EISDIR', path);
    return node.data;
  }

  writeFile(path: string, data: Uint8Array | string): void {
    const normalized = normalizeAbsolute(path);
    // `normalized` is already normalized (#10): dirnameNormalized skips the
    // redundant normalizePath pass dirname would run.
    const parent = dirnameNormalized(normalized);
    // Errors name the TARGET path, not the parent (Node parity: `open 'a/b/c'`).
    const parentNode = this.resolveStrict(parent, path);
    if (!parentNode) throw new VfsError('ENOENT', path);
    if (parentNode.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    const name = normalized.slice(parent === '/' ? 1 : parent.length + 1);
    if (name === '') throw new VfsError('EINVAL', path);
    const bytes = typeof data === 'string' ? encoder.encode(data) : data;
    const existing = parentNode.children.get(name);
    if (existing && existing.kind === 'dir') throw new VfsError('EISDIR', path);
    const file = makeFile(bytes);
    // Strictly-monotonic mtime on overwrite: two writes within one clock tick
    // must still bump mtime, else a same-size content edit is invisible to an
    // mtime-trusting stat cache — e.g. isomorphic-git's racy-clean index
    // shortcut, which would silently report `git status`/`diff` as unchanged
    // (silent data loss). See packages/git fs-adapter + ADR-0167.
    if (existing && existing.kind === 'file' && file.mtime <= existing.mtime) {
      file.mtime = existing.mtime + 1;
    }
    parentNode.children.set(name, file);
    // Replacing a child node (even same name) can flip its dirent kind, so
    // invalidate the dirent cache on every set (perf audit 2026-06-05).
    parentNode.sortedDirents = null;
    parentNode.mtime = Date.now();
  }

  readdir(path: string): readonly string[] {
    // Names from the same memoised sorted dirent list (perf audit 2026-06-05) —
    // identical order to the prior `[...keys()].sort()`.
    return this.readdirEntries(path).map((d) => d.name);
  }

  readdirEntries(path: string): readonly Dirent[] {
    const node = this.resolveStrict(path);
    if (!node) throw new VfsError('ENOENT', path);
    if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    if (node.sortedDirents !== null) return node.sortedDirents;
    const out: Dirent[] = [];
    for (const [name, child] of node.children) {
      out.push({ name, isFile: child.kind === 'file', isDirectory: child.kind === 'dir' });
    }
    out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const frozen = Object.freeze(out);
    node.sortedDirents = frozen;
    return frozen;
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
      // Full target path in the error (Node parity: `mkdir 'plain.txt/sub'`).
      if (node.kind !== 'dir') throw new VfsError('ENOTDIR', path);
      const part = parts[i];
      if (part === undefined) continue;
      const next = node.children.get(part);
      if (!next) {
        if (!recursive && i < parts.length - 1) {
          // Missing parent still names the TARGET (same rule as ENOTDIR above).
          throw new VfsError('ENOENT', path);
        }
        const newDir = makeDir();
        node.children.set(part, newDir);
        node.sortedDirents = null; // new child — invalidate dirent cache
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
    const normalized = normalizeAbsolute(path);
    if (normalized === '/') {
      if (recursive) {
        this.root.children.clear();
        this.root.sortedDirents = null; // children cleared — invalidate
        return;
      }
      throw new VfsError('EPERM', '/');
    }
    // `normalized` is already normalized (#10) — see writeFile above.
    const parent = dirnameNormalized(normalized);
    // ENOTDIR (path through a file) throws even under `force` — Node's force
    // suppresses only ENOENT (verified against real Node, 2026-07-05).
    const parentNode = this.resolveStrict(parent, path);
    if (!parentNode) {
      if (force) return;
      throw new VfsError('ENOENT', path);
    }
    if (parentNode.kind !== 'dir') throw new VfsError('ENOTDIR', path);
    const name = normalized.slice(parent === '/' ? 1 : parent.length + 1);
    const target = parentNode.children.get(name);
    if (!target) {
      if (force) return;
      throw new VfsError('ENOENT', path);
    }
    if (target.kind === 'dir' && target.children.size > 0 && !recursive) {
      // Node's fs.rmSync throws `ENOTEMPTY: directory not empty, rmdir '...'`
      // here. Match that code so callers (WASI path_remove_directory, fs.rm
      // error-handling, npm-client install rollback) can branch on it
      // instead of hand-rolling backend-specific workarounds.
      throw new VfsError('ENOTEMPTY', path, `ENOTEMPTY: directory not empty, rmdir '${path}'`);
    }
    parentNode.children.delete(name);
    parentNode.sortedDirents = null; // child removed — invalidate dirent cache
    parentNode.mtime = Date.now();
  }

  stat(path: string): MemoryStat {
    const node = this.resolveStrict(path);
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

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    const node = this.resolveStrict(path);
    if (!node) throw new VfsError('ENOENT', path);
    node.atime = atimeMs;
    node.mtime = mtimeMs;
  }

  copyFile(src: string, dst: string): void {
    const s = normalizeAbsolute(src);
    const d = normalizeAbsolute(dst);
    const node = this.resolveStrict(s, src);
    if (!node) throw new VfsError('ENOENT', src);
    if (node.kind !== 'file') throw new VfsError('EISDIR', src);
    const dstNode = this.resolve(d);
    if (dstNode && dstNode.kind === 'dir') throw new VfsError('EISDIR', dst);
    // writeFile validates dst's parent (ENOENT/ENOTDIR) and stamps mtime=now.
    // .slice() so src and dst are independent buffers.
    this.writeFile(d, node.data.slice());
  }

  cpRecursive(src: string, dst: string, recursive: boolean): void {
    const s = normalizeAbsolute(src);
    const d = normalizeAbsolute(dst);
    const node = this.resolveStrict(s, src);
    if (!node) throw new VfsError('ENOENT', src);
    if (node.kind === 'file') {
      this.copyFile(s, d);
      return;
    }
    if (!recursive) throw new VfsError('EISDIR', src);
    // Guard against copying a dir into its own subtree (`cp -r a a`, `cp -r a
    // a/b`) — without it the recursion never terminates → stack overflow.
    // Matches `rename`'s into-subtree EINVAL.
    if (d === s || d.startsWith(`${s}/`)) throw new VfsError('EINVAL', src);
    this.mkdir(d, { recursive: true });
    // Fail-fast: a child failure propagates; entries copied before remain.
    for (const name of [...node.children.keys()].sort()) {
      this.cpRecursive(`${s}/${name}`, `${d}/${name}`, true);
    }
  }

  rename(src: string, dst: string): void {
    const s = normalizeAbsolute(src);
    const d = normalizeAbsolute(dst);
    if (s === d) return;
    if (s === '/') throw new VfsError('EINVAL', src);
    const srcNode = this.resolveStrict(s, src);
    if (!srcNode) throw new VfsError('ENOENT', src);
    if (srcNode.kind === 'dir' && d.startsWith(`${s}/`)) throw new VfsError('EINVAL', src);

    const srcParentPath = dirnameNormalized(s);
    const srcParent = this.resolveStrict(srcParentPath, src);
    if (!srcParent || srcParent.kind !== 'dir') throw new VfsError('ENOENT', src);
    const srcName = s.slice(srcParentPath === '/' ? 1 : srcParentPath.length + 1);

    const dstParentPath = dirnameNormalized(d);
    const dstParent = this.resolveStrict(dstParentPath, dst);
    if (!dstParent) throw new VfsError('ENOENT', dst);
    if (dstParent.kind !== 'dir') throw new VfsError('ENOTDIR', dst);
    const dstName = d.slice(dstParentPath === '/' ? 1 : dstParentPath.length + 1);
    if (dstName === '') throw new VfsError('EINVAL', dst);

    const dstNode = dstParent.children.get(dstName);
    if (dstNode) {
      if (srcNode.kind === 'file' && dstNode.kind === 'dir') throw new VfsError('EISDIR', dst);
      if (srcNode.kind === 'dir' && dstNode.kind === 'file') throw new VfsError('ENOTDIR', dst);
      if (dstNode.kind === 'dir' && dstNode.children.size > 0) throw new VfsError('ENOTEMPTY', dst);
      dstParent.children.delete(dstName);
      dstParent.sortedDirents = null;
    }
    // Move the live node reference — O(1) on the memory backend, mtime untouched.
    srcParent.children.delete(srcName);
    srcParent.sortedDirents = null;
    dstParent.children.set(dstName, srcNode);
    dstParent.sortedDirents = null;
    const now = Date.now();
    srcParent.mtime = now;
    dstParent.mtime = now;
  }
}
