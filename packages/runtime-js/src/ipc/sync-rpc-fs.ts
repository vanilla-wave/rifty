/**
 * Child-side remote `FsSync` (ADR-0150): a supervised child worker reads the
 * single-store owner's fs over sync-RPC. Delegates each call to the owner
 * over the kernel sync-RPC ring (`KernelSyncApi`). Reads pull raw bytes
 * (binary reply) in `FS_RPC_CHUNK` slices keyed by offset (ADR-0365, ADR-0576); writes push base64
 * chunks. All calls block the child via `Atomics.wait` (inside `call`); legal
 * only in a kernel-spawned Worker. fd-level ops stay client-side (`fs.ts`
 * fdTable) — this implements only the `FsSync` methods.
 */

import { type FsSync, type VfsDirent, VfsError, type VfsErrorCode } from '@riftydev/vfs';
import { assertReadRange } from '@riftydev/vfs/internal';
import { setSyncMirror } from '../builtins/fs-sync-mirror.ts';
import {
  FS_METHODS,
  FS_RPC_CHUNK,
  type FsStatShape,
  bytesToBase64,
  decodeReadFileHead,
  encodeFsPathRequest,
  encodeFsReadRangeRequest,
  encodeReadFileHead,
} from './fs-rpc-protocol.ts';

/** The published in-Worker sync-call shim (`KernelSyncApi.call`). */
export type SyncCall = (method: string, payload: unknown) => unknown;
/** The published binary application-payload shim (`KernelSyncApi.callBinary`). */
export type SyncBinaryCall = (method: string, payload: Uint8Array) => unknown;

const VFS_ERROR_CODES = new Set<VfsErrorCode>([
  'ENOENT',
  'EEXIST',
  'EISDIR',
  'ENOTDIR',
  'ENOTEMPTY',
  'EPERM',
  'EINVAL',
  'EACCES',
  'EDQUOT',
  'EIO',
]);

function restoreTransportVfsError(error: unknown): unknown {
  if (error instanceof VfsError) return error;
  if (!(error instanceof Error) || error.name !== 'VfsError') return error;
  const transported = error as Error & { code?: unknown; path?: unknown };
  if (
    typeof transported.code !== 'string' ||
    !VFS_ERROR_CODES.has(transported.code as VfsErrorCode) ||
    typeof transported.path !== 'string'
  ) {
    return error;
  }
  return new VfsError(transported.code as VfsErrorCode, transported.path, transported.message, {
    cause: error,
  });
}

/**
 * A VFS that answers one ADR-0365 head request with one upstream request. A
 * nested-Worker relay serving such a VFS forwards it instead of a whole-file
 * read. Continuations forward through `FsSync.readFileRangeSync` (ADR-0576).
 */
export interface ReadFileHeadSource {
  /** Exact `fs.readFileHead` reply bytes: f64LE total size + first chunk. */
  readFileHeadReply(path: string): Uint8Array;
}

function isReadFileHeadSource(vfs: FsSync): vfs is FsSync & ReadFileHeadSource {
  return typeof (vfs as Partial<ReadFileHeadSource>).readFileHeadReply === 'function';
}

/** `fs.readFileHead` reply for `vfs`: forwarded when it can, else one current full read. */
export function readFileHeadReplyOf(vfs: FsSync, path: string): Uint8Array {
  if (isReadFileHeadSource(vfs)) return vfs.readFileHeadReply(path);
  return encodeReadFileHead(vfs.readFileBytesSync(path));
}

export class SyncRpcFsSync implements FsSync, ReadFileHeadSource {
  constructor(
    private readonly call: SyncCall,
    private readonly callBinary: SyncBinaryCall,
  ) {
    if (typeof call !== 'function') {
      throw new TypeError('SyncRpcFsSync: JSON call is required');
    }
    if (typeof callBinary !== 'function') {
      throw new TypeError('SyncRpcFsSync: binary callBinary is required');
    }
  }

  /** Rehydrate the owner error prototype erased by SyncRpc's JSON frame. */
  private callFs(method: string, payload: unknown): unknown {
    try {
      return this.call(method, payload);
    } catch (error) {
      throw restoreTransportVfsError(error);
    }
  }

  /** Rehydrate errors from the binary request's ordinary JSON error reply. */
  private callFsBinary(method: string, payload: Uint8Array): unknown {
    try {
      return this.callBinary(method, payload);
    } catch (error) {
      throw restoreTransportVfsError(error);
    }
  }

  existsSync(path: string): boolean {
    return this.callFsBinary(FS_METHODS.exists, encodeFsPathRequest(path)) as boolean;
  }

  statSync(path: string): FsStatShape {
    return this.callFsBinary(FS_METHODS.stat, encodeFsPathRequest(path)) as FsStatShape;
  }

  statSyncOrNull(path: string): FsStatShape | null {
    return this.callFsBinary(
      FS_METHODS.statOrNull,
      encodeFsPathRequest(path),
    ) as FsStatShape | null;
  }

  readdirSync(path: string): readonly VfsDirent[] {
    return this.callFs(FS_METHODS.readdir, { path }) as VfsDirent[];
  }

  readFileHeadReply(path: string): Uint8Array {
    return this.callFsBinary(FS_METHODS.readFileHead, encodeFsPathRequest(path)) as Uint8Array;
  }

  /** One `fs.readChunk` exchange: one owner store call, ≤ `length` bytes. */
  private readPiece(path: string, offset: number, length: number): Uint8Array {
    const piece = this.callFsBinary(
      FS_METHODS.readChunk,
      encodeFsReadRangeRequest(path, offset, length),
    );
    if (!(piece instanceof Uint8Array)) {
      throw new TypeError(`sync-rpc-fs: range reply for ${path} must be a Uint8Array`);
    }
    if (piece.length > length) {
      throw new Error(
        `sync-rpc-fs: oversized read for ${path} — ${piece.length} bytes exceeds the ${length} requested`,
      );
    }
    return piece;
  }

  /**
   * ADR-0576. ≤ `FS_RPC_CHUNK`: one exchange. Longer: one exchange per piece,
   * each the file at its exchange (a concurrent write may land between them).
   */
  readFileRangeSync(path: string, position: number, length: number): Uint8Array {
    assertReadRange(position, length);
    if (length <= FS_RPC_CHUNK) return this.readPiece(path, position, length);
    const pieces: Uint8Array[] = [];
    let got = 0;
    while (got < length) {
      const want = Math.min(FS_RPC_CHUNK, length - got);
      const piece = this.readPiece(path, position + got, want);
      pieces.push(piece);
      got += piece.length;
      if (piece.length < want) break;
    }
    const out = new Uint8Array(got);
    let at = 0;
    for (const piece of pieces) {
      out.set(piece, at);
      at += piece.length;
    }
    return out;
  }

  readFileBytesSync(path: string): Uint8Array {
    const { size, firstChunk } = decodeReadFileHead(this.readFileHeadReply(path));
    if (size === 0) return new Uint8Array(0);
    if (size <= FS_RPC_CHUNK) return firstChunk.slice();
    const out = new Uint8Array(size);
    out.set(firstChunk);
    let offset = firstChunk.length;
    while (offset < size) {
      const requested = Math.min(FS_RPC_CHUNK, size - offset);
      const chunk = this.readPiece(path, offset, requested);
      // Empty chunk before the admitted size means the owner store shrank mid-read
      // (snapshot inconsistent). ADR-0150 forbids silent truncation — fail loud
      // rather than hand the caller a partial file presented as the whole thing.
      if (chunk.length === 0) {
        throw new Error(
          `sync-rpc-fs: short read for ${path} — got ${offset} of ${size} bytes (owner store changed mid-read)`,
        );
      }
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    if (data.length === 0) {
      this.callFs(FS_METHODS.writeChunk, { path, b64: '', offset: 0, truncate: true });
      return;
    }
    let offset = 0;
    let first = true;
    while (offset < data.length) {
      const slice = data.subarray(offset, offset + FS_RPC_CHUNK);
      this.callFs(FS_METHODS.writeChunk, {
        path,
        b64: bytesToBase64(slice),
        offset,
        truncate: first,
      });
      offset += slice.length;
      first = false;
    }
  }

  mkdirSync(path: string, options: { recursive?: boolean }): void {
    this.callFs(FS_METHODS.mkdir, { path, recursive: options.recursive === true });
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.callFs(FS_METHODS.rm, {
      path,
      recursive: options.recursive === true,
      force: options.force === true,
    });
  }

  renameSync(src: string, dst: string): void {
    this.callFs(FS_METHODS.rename, { src, dst });
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.callFs(FS_METHODS.utimes, { path, atimeMs, mtimeMs });
  }

  copyFileSync(src: string, dst: string): void {
    this.callFs(FS_METHODS.copyFile, { src, dst });
  }

  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void {
    this.callFs(FS_METHODS.cp, { src, dst, recursive: options?.recursive === true });
  }
}

/**
 * Install a {@link SyncRpcFsSync} as this realm's GLOBAL sync mirror (ADR-0150).
 * A spawned child calls this so BOTH the module loader AND the `node:fs`
 * builtins (which read `syncMirror()`) resolve against the owner store over
 * `fs.*` RPC. Returns the installed remote VFS.
 */
export function installRemoteSyncFs(call: SyncCall, callBinary: SyncBinaryCall): SyncRpcFsSync {
  const vfs = new SyncRpcFsSync(call, callBinary);
  setSyncMirror(vfs);
  return vfs;
}
