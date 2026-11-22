/**
 * Guest FS snapshot, format v1 (ADR-0567): a rifty FS ⇄ one opaque byte string.
 * Pure JS — `Uint8Array`, `DataView`, `Map`, `Set`, `String.fromCharCode`
 * only — so the same module runs in the bare isolate (bundled into
 * `guest.js`) and in the consumer's Node realm. The reader trusts nothing the
 * writer promises: a snapshot taken after guest code ran comes from the
 * guest's realm.
 */

/** The template a snapshot belongs to (ADR-0567 §4). */
export interface SnapshotTemplate {
  readonly id: string;
  readonly version: string;
}

export interface SnapshotOptions {
  /** Recorded at snapshot; restore requires the same (both `null`, or equal strings). */
  readonly template: SnapshotTemplate | null;
  /** Largest blob, in bytes, either direction accepts. */
  readonly maxBytes: number;
}

export type FsSnapshotErrorCode =
  | 'ERR_FS_SNAPSHOT_TOO_LARGE'
  | 'ERR_FS_SNAPSHOT_CORRUPT'
  | 'ERR_FS_SNAPSHOT_VERSION'
  | 'ERR_FS_SNAPSHOT_TEMPLATE'
  | 'ERR_FS_SNAPSHOT_NOT_FRESH';

/** A refused snapshot or restore. `message` = `<code>: <fixed text>`; never carries blob bytes. */
export class FsSnapshotError extends Error {
  readonly code: FsSnapshotErrorCode;
  constructor(code: FsSnapshotErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'FsSnapshotError';
    this.code = code;
  }
}

/** The times of an entry, restored verbatim (`ino` is renewed, ADR-0567 §1). */
export interface SnapshotStat {
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
}

/** The rifty FS surface the codec uses; `MemoryFsSync` (`@riftydev/vfs`) implements it. */
export interface SnapshotFs {
  readdirSync(
    path: string,
  ): readonly { readonly name: string; readonly isFile: boolean; readonly isDirectory: boolean }[];
  statSync(path: string): {
    readonly isFile: boolean;
    readonly isDirectory: boolean;
    readonly mtime?: number;
    readonly atime?: number;
    readonly metadata?: {
      readonly ino: number;
      readonly birthtime: number;
      readonly ctime: number;
    };
  };
  readFileBytesSync(path: string): Uint8Array;
  writeFileSync(path: string, data: Uint8Array): void;
  mkdirSync(path: string, options: { recursive?: boolean }): void;
  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void;
  /** Set the four times of an existing entry exactly. */
  restoreStatSync(path: string, stat: SnapshotStat): void;
}

/** The whole tree of `fs` as one blob (ADR-0567 §1). Throws `ERR_FS_SNAPSHOT_TOO_LARGE` before allocating. */
export function snapshotFs(_fs: SnapshotFs, _options: SnapshotOptions): Uint8Array {
  throw new Error('Not implemented: isolate-guest.snapshotFs');
}

/**
 * Replace the whole tree of `fs` with the blob's. Validates every byte first:
 * a refused blob leaves `fs` as it was (ADR-0567 §5–§6).
 */
export function restoreFs(_fs: SnapshotFs, _bytes: Uint8Array, _options: SnapshotOptions): void {
  throw new Error('Not implemented: isolate-guest.restoreFs');
}
