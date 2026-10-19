/** Session-local identity and creation/change clocks owned by a VFS entry. */
export interface StatMetadata {
  readonly ino: number;
  readonly birthtime: number;
  ctime: number;
}

let nextInode = 1;
export function createStatMetadata(now = Date.now()): StatMetadata {
  return { ino: nextInode++, birthtime: now, ctime: now };
}

export interface FsStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly size?: number;
  readonly mtime?: number;
  readonly atime?: number;
  readonly metadata?: StatMetadata;
  readonly nlink?: number;
}
