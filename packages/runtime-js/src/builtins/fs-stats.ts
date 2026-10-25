/**
 * The ONE `fs.Stats` shape every stat-shaped surface returns — statSync/
 * lstatSync/fstatSync (+ promises/callback twins) AND `fs.watchFile` listener
 * args. Extracted from fs.ts so fs-watch.ts can reuse it without an import
 * cycle: a bespoke `StatsLike` twin drifted (number `mtime`, no `mtimeMs`, no
 * `isSymbolicLink` — review 2026-07-06); the class boundary makes the next
 * field evolve everywhere at once.
 */
import { type FsStat, NotImplementedError } from '@riftydev/vfs';

export class Stats {
  dev = 1;
  ino: number;
  mode: number;
  nlink: number;
  uid = 0;
  gid = 0;
  rdev = 0;
  blksize = 4096;
  blocks: number;
  size: number;
  mtimeMs: number;
  atimeMs: number;
  ctimeMs: number;
  birthtimeMs: number;
  private readonly _isFile: boolean;
  private readonly _isDirectory: boolean;
  constructor(vs: FsStat & { readonly mode?: number }) {
    const missing = !vs.isFile && !vs.isDirectory && vs.mode === undefined;
    if (!missing && (!vs.metadata || vs.atime === undefined || vs.nlink === undefined)) {
      throw new NotImplementedError('fs.Stats.metadata', 'FsSync provider lacks entry metadata');
    }
    this.size = vs.size ?? 0;
    this.mtimeMs = vs.mtime ?? 0;
    this.atimeMs = vs.atime ?? 0;
    this.ctimeMs = vs.metadata?.ctime ?? 0;
    this.birthtimeMs = vs.metadata?.birthtime ?? 0;
    this.ino = vs.metadata?.ino ?? 0;
    this.mode = vs.mode ?? (vs.isFile ? 0o100666 : vs.isDirectory ? 0o40777 : 0);
    this.nlink = vs.nlink ?? 0;
    this.blocks = Math.ceil(this.size / 512);
    this._isFile = vs.isFile;
    this._isDirectory = vs.isDirectory;
    if (missing) {
      this.dev = 0;
      this.blksize = 0;
    }
  }
  get atime(): Date {
    return new Date(this.atimeMs);
  }
  get ctime(): Date {
    return new Date(this.ctimeMs);
  }
  get birthtime(): Date {
    return new Date(this.birthtimeMs);
  }
  isFile(): boolean {
    return this._isFile;
  }
  isDirectory(): boolean {
    return this._isDirectory;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return (this.mode & 0o170000) === 0o20000;
  }
  isFIFO(): boolean {
    return (this.mode & 0o170000) === 0o10000;
  }
  isSocket(): boolean {
    return false;
  }
  get mtime(): Date {
    return new Date(this.mtimeMs);
  }
}

export interface StatOptions {
  bigint?: boolean;
}

export class Dirent {
  readonly name: string;
  /**
   * Directory this entry lives in, echoing the path ARG passed to `readdir`
   * (relative stays relative); for `{ recursive: true }` it's the arg joined with
   * the subdirectory. Node v24 REMOVED the deprecated `path` alias, so it's
   * absent here too.
   */
  readonly parentPath: string;
  private readonly _isFile: boolean;
  private readonly _isDirectory: boolean;
  constructor(d: { name: string; isFile: boolean; isDirectory: boolean; parentPath: string }) {
    this.name = d.name;
    this.parentPath = d.parentPath;
    this._isFile = d.isFile;
    this._isDirectory = d.isDirectory;
  }
  isFile(): boolean {
    return this._isFile;
  }
  isDirectory(): boolean {
    return this._isDirectory;
  }
  isSymbolicLink(): boolean {
    return false;
  }
  isBlockDevice(): boolean {
    return false;
  }
  isCharacterDevice(): boolean {
    return false;
  }
  isFIFO(): boolean {
    return false;
  }
  isSocket(): boolean {
    return false;
  }
}
