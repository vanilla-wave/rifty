import type { VfsDirent } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import {
  type AsyncFsOpsTarget,
  type FsOpsTarget,
  copyTree,
  createDir,
  createDirAsync,
  createFile,
  createFileAsync,
  deletePath,
  deletePathAsync,
  looksBinary,
  readText,
  renamePath,
  renamePathAsync,
  writeText,
} from './fs-ops.ts';

/** Compact in-memory `FsOpsTarget` fake (dirs explicit, files by path). */
class FakeFs implements FsOpsTarget {
  readonly files = new Map<string, Uint8Array>();
  readonly dirs = new Set<string>(['/']);

  private addAncestors(path: string): void {
    const parts = path.split('/').filter(Boolean);
    parts.pop();
    let cur = '';
    for (const part of parts) {
      cur += `/${part}`;
      this.dirs.add(cur);
    }
  }

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readFileBytesSync(path: string): Uint8Array {
    const b = this.files.get(path);
    if (!b) throw new Error(`ENOENT ${path}`);
    return b;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    this.addAncestors(path);
    this.files.set(path, data);
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    if (options.recursive) {
      const parts = path.split('/').filter(Boolean);
      let cur = '';
      for (const part of parts) {
        cur += `/${part}`;
        this.dirs.add(cur);
      }
    } else {
      this.dirs.add(path);
    }
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    if (this.files.has(path)) {
      this.files.delete(path);
      return;
    }
    if (this.dirs.has(path)) {
      const prefix = `${path}/`;
      for (const f of [...this.files.keys()]) {
        if (f === path || f.startsWith(prefix)) this.files.delete(f);
      }
      for (const d of [...this.dirs]) {
        if (d === path || d.startsWith(prefix)) this.dirs.delete(d);
      }
      return;
    }
    if (!options.force) throw new Error(`ENOENT ${path}`);
  }

  readdirSync(path: string): readonly VfsDirent[] {
    if (!this.dirs.has(path)) throw new Error(`ENOTDIR ${path}`);
    const prefix = path === '/' ? '/' : `${path}/`;
    const children = new Map<string, boolean>();
    const note = (full: string, forceDir: boolean): void => {
      if (full === path || !full.startsWith(prefix)) return;
      const rest = full.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      const isDir = forceDir || slash !== -1;
      children.set(name, (children.get(name) ?? false) || isDir);
    };
    for (const f of this.files.keys()) note(f, false);
    for (const d of this.dirs) note(d, true);
    return [...children].map(([name, isDir]) => ({ name, isFile: !isDir, isDirectory: isDir }));
  }

  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number } {
    if (this.dirs.has(path)) return { isFile: false, isDirectory: true };
    const f = this.files.get(path);
    if (f) return { isFile: true, isDirectory: false, size: f.length };
    throw new Error(`ENOENT ${path}`);
  }

  renameSync(from: string, to: string): void {
    const parent = to.slice(0, to.lastIndexOf('/')) || '/';
    if (!this.dirs.has(parent)) throw new Error(`ENOENT ${parent}`);
    if (this.files.has(from)) {
      const data = this.files.get(from)!;
      this.files.delete(from);
      this.files.set(to, data);
      return;
    }
    if (this.dirs.has(from)) {
      const prefix = `${from}/`;
      this.dirs.delete(from);
      this.dirs.add(to);
      for (const dir of [...this.dirs]) {
        if (!dir.startsWith(prefix)) continue;
        this.dirs.delete(dir);
        this.dirs.add(`${to}/${dir.slice(prefix.length)}`);
      }
      for (const [file, data] of [...this.files]) {
        if (!file.startsWith(prefix)) continue;
        this.files.delete(file);
        this.files.set(`${to}/${file.slice(prefix.length)}`, data);
      }
      return;
    }
    throw new Error(`ENOENT ${from}`);
  }
}

class RenameSpyFs extends FakeFs {
  readonly renameCalls: Array<{ from: string; to: string }> = [];

  override renameSync(from: string, to: string): void {
    this.renameCalls.push({ from, to });
    super.renameSync(from, to);
  }

  override readFileBytesSync(): Uint8Array {
    throw new Error('renamePath must not copy bytes');
  }
}

class AsyncFakeFs extends FakeFs implements AsyncFsOpsTarget {
  readonly calls: unknown[] = [];
  async writeFile(
    path: string,
    data: Uint8Array,
    options: { recursive?: boolean } = {},
  ): Promise<void> {
    this.calls.push({
      op: 'write',
      path,
      size: data.byteLength,
      recursive: options.recursive ?? false,
    });
    this.writeFileSync(path, data);
  }
  async mkdir(path: string, options: { recursive?: boolean }): Promise<void> {
    this.calls.push({ op: 'mkdir', path, recursive: options.recursive ?? false });
    this.mkdirSync(path, options);
  }
  async rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void> {
    this.calls.push({ op: 'rm', path, recursive: options.recursive, force: options.force });
    this.rmSync(path, options);
  }
  async rename(from: string, to: string): Promise<void> {
    this.calls.push({ op: 'rename', from, to });
    renamePath(this, from, to);
  }
  async copy(from: string, to: string): Promise<void> {
    this.calls.push({ op: 'copy', from, to });
    copyTree(this, from, to);
  }
}

describe('createFile / createDir', () => {
  it('creates an empty file and its parents', () => {
    const fs = new FakeFs();
    createFile(fs, '/workspace/src/a.js');
    expect(fs.existsSync('/workspace/src/a.js')).toBe(true);
    expect(fs.dirs.has('/workspace/src')).toBe(true);
    expect(readText(fs, '/workspace/src/a.js')).toBe('');
  });

  it('throws on collision instead of overwriting', () => {
    const fs = new FakeFs();
    createFile(fs, '/a.js');
    expect(() => createFile(fs, '/a.js')).toThrow(/already exists/);
  });

  it('createDir makes a directory and rejects collisions', () => {
    const fs = new FakeFs();
    createDir(fs, '/workspace/pkg');
    expect(fs.dirs.has('/workspace/pkg')).toBe(true);
    expect(() => createDir(fs, '/workspace/pkg')).toThrow(/already exists/);
  });
});

describe('writeText / readText', () => {
  it('round-trips UTF-8 including non-ASCII', () => {
    const fs = new FakeFs();
    writeText(fs, '/n.txt', 'привет · 🌍');
    expect(readText(fs, '/n.txt')).toBe('привет · 🌍');
  });
});

describe('copyTree', () => {
  it('recursively copies a directory tree', () => {
    const fs = new FakeFs();
    writeText(fs, '/src/a.js', 'A');
    writeText(fs, '/src/lib/b.js', 'B');
    copyTree(fs, '/src', '/dst');
    expect(readText(fs, '/dst/a.js')).toBe('A');
    expect(readText(fs, '/dst/lib/b.js')).toBe('B');
    // original is untouched (copy, not move)
    expect(fs.existsSync('/src/a.js')).toBe(true);
  });
});

describe('renamePath', () => {
  it('renames a file', () => {
    const fs = new FakeFs();
    writeText(fs, '/a.js', 'hi');
    renamePath(fs, '/a.js', '/b.js');
    expect(fs.existsSync('/a.js')).toBe(false);
    expect(readText(fs, '/b.js')).toBe('hi');
  });

  it('uses FsSync.renameSync instead of copying bytes above the VFS primitive', () => {
    const fs = new RenameSpyFs();
    writeText(fs, '/a.js', 'hi');

    renamePath(fs, '/a.js', '/b.js');

    expect(fs.renameCalls).toEqual([{ from: '/a.js', to: '/b.js' }]);
    expect(fs.existsSync('/a.js')).toBe(false);
    expect(fs.existsSync('/b.js')).toBe(true);
  });

  it('renames a directory (recursive move)', () => {
    const fs = new FakeFs();
    writeText(fs, '/old/x.js', 'X');
    renamePath(fs, '/old', '/new');
    expect(fs.existsSync('/old')).toBe(false);
    expect(readText(fs, '/new/x.js')).toBe('X');
  });

  it('throws on destination collision', () => {
    const fs = new FakeFs();
    writeText(fs, '/a.js', '1');
    writeText(fs, '/b.js', '2');
    expect(() => renamePath(fs, '/a.js', '/b.js')).toThrow(/already exists/);
  });

  it('does not create a missing destination parent', () => {
    const fs = new FakeFs();
    writeText(fs, '/a.js', '1');
    expect(() => renamePath(fs, '/a.js', '/missing/b.js')).toThrow(/ENOENT/);
    expect(readText(fs, '/a.js')).toBe('1');
  });

  it('is a no-op when from === to', () => {
    const fs = new FakeFs();
    writeText(fs, '/a.js', '1');
    expect(() => renamePath(fs, '/a.js', '/a.js')).not.toThrow();
    expect(readText(fs, '/a.js')).toBe('1');
  });
});

describe('deletePath', () => {
  it('removes a whole subtree', () => {
    const fs = new FakeFs();
    writeText(fs, '/d/a.js', 'A');
    writeText(fs, '/d/sub/b.js', 'B');
    deletePath(fs, '/d');
    expect(fs.existsSync('/d')).toBe(false);
    expect(fs.existsSync('/d/sub/b.js')).toBe(false);
  });
});

describe('async fs ops', () => {
  it('routes create/delete/rename helpers through async target methods', async () => {
    const fs = new AsyncFakeFs();

    await createFileAsync(fs, '/workspace/a.txt');
    await createDirAsync(fs, '/workspace/dir');
    await renamePathAsync(fs, '/workspace/a.txt', '/workspace/b.txt');
    await deletePathAsync(fs, '/workspace/b.txt');

    expect(fs.calls).toEqual([
      { op: 'write', path: '/workspace/a.txt', size: 0, recursive: false },
      { op: 'mkdir', path: '/workspace/dir', recursive: false },
      { op: 'rename', from: '/workspace/a.txt', to: '/workspace/b.txt' },
      { op: 'rm', path: '/workspace/b.txt', recursive: true, force: false },
    ]);
  });
});

describe('looksBinary', () => {
  it('flags a NUL byte, passes plain text', () => {
    expect(looksBinary(new Uint8Array([72, 105, 0, 1]))).toBe(true);
    expect(looksBinary(new TextEncoder().encode('hello world'))).toBe(false);
  });
});
