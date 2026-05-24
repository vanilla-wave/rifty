import type { SyncVfs } from './vfs-sync.ts';

/**
 * Tiny pure-string in-memory backend for the loader tests. Same wire-format
 * as `MemoryVfs` but synchronous and string-only — async APIs aren't useful
 * inside the resolver.
 *
 * The runtime can adapt any backing store to this interface; for the Worker
 * we'll pair this with an OPFS SyncAccessHandle-backed implementation in M4.
 */
export class MemorySyncVfs implements SyncVfs {
  private readonly files: Map<string, string> = new Map();

  setFile(path: string, content: string): void {
    this.files.set(normalize(path), content);
  }

  /**
   * Bulk-write helper. Keys are absolute paths.
   */
  loadFixture(files: Readonly<Record<string, string>>): void {
    for (const [k, v] of Object.entries(files)) this.setFile(k, v);
  }

  existsSync(path: string): boolean {
    const n = normalize(path);
    if (this.files.has(n)) return true;
    // Treat any prefix of an existing file as a directory.
    return this.isDir(n);
  }

  readFileSync(path: string): string {
    const n = normalize(path);
    const v = this.files.get(n);
    if (v === undefined) throw new Error(`ENOENT: ${path}`);
    return v;
  }

  readFileBytesSync(path: string): Uint8Array {
    return new TextEncoder().encode(this.readFileSync(path));
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean } {
    const n = normalize(path);
    if (this.files.has(n)) return { isFile: true, isDirectory: false };
    if (this.isDir(n)) return { isFile: false, isDirectory: true };
    throw new Error(`ENOENT: ${path}`);
  }

  readdirSync(path: string): readonly string[] {
    const n = normalize(path);
    const prefix = n === '/' ? '/' : `${n}/`;
    const names = new Set<string>();
    for (const f of this.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const slash = rest.indexOf('/');
      names.add(slash === -1 ? rest : rest.slice(0, slash));
    }
    return [...names].sort();
  }

  private isDir(p: string): boolean {
    if (p === '/' || p === '') return true;
    const prefix = `${p}/`;
    for (const f of this.files.keys()) if (f.startsWith(prefix)) return true;
    return false;
  }
}

function normalize(p: string): string {
  if (p === '') return '/';
  // Collapse '..' and '.'
  const parts = p.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return `/${stack.join('/')}`;
}
