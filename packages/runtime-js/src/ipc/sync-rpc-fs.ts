/**
 * Child-side remote `FsSync` (ADR-0150): a supervised child worker reads the
 * single-store owner's fs over sync-RPC. Delegates each call to the owner
 * over the kernel sync-RPC ring (`KernelSyncApi.call`). Reads pull raw bytes
 * (binary reply) in `FS_RPC_CHUNK` slices keyed by offset; writes push base64
 * chunks. All calls block the child via `Atomics.wait` (inside `call`); legal
 * only in a kernel-spawned Worker. fd-level ops stay client-side (`fs.ts`
 * fdTable) — this implements only the 13 `FsSync` methods.
 */

import type { FsSync, VfsDirent } from '@riftydev/vfs';
import { setSyncMirror } from '../builtins/fs-sync-mirror.ts';
import {
  FS_METHODS,
  FS_RPC_CHUNK,
  type FsStatShape,
  bytesToBase64,
  decodeReadFileHead,
} from './fs-rpc-protocol.ts';

/** The published in-Worker sync-call shim (`KernelSyncApi.call`). */
export type SyncCall = (method: string, payload: unknown) => unknown;

export class SyncRpcFsSync implements FsSync {
  constructor(private readonly call: SyncCall) {}

  existsSync(path: string): boolean {
    return this.call(FS_METHODS.exists, { path }) as boolean;
  }

  statSync(path: string): FsStatShape {
    return this.call(FS_METHODS.stat, { path }) as FsStatShape;
  }

  statSyncOrNull(path: string): FsStatShape | null {
    return this.call(FS_METHODS.statOrNull, { path }) as FsStatShape | null;
  }

  readdirSync(path: string): readonly VfsDirent[] {
    return this.call(FS_METHODS.readdir, { path }) as VfsDirent[];
  }

  readFileBytesSync(path: string): Uint8Array {
    const { size, firstChunk } = decodeReadFileHead(this.call(FS_METHODS.readFileHead, { path }));
    if (size === 0) return new Uint8Array(0);
    if (size <= FS_RPC_CHUNK) return firstChunk.slice();
    const out = new Uint8Array(size);
    out.set(firstChunk);
    let offset = firstChunk.length;
    while (offset < size) {
      const requested = Math.min(FS_RPC_CHUNK, size - offset);
      const chunk = this.call(FS_METHODS.readChunk, {
        path,
        offset,
        length: requested,
      }) as Uint8Array;
      // Empty chunk before the admitted size means the owner store shrank mid-read
      // (snapshot inconsistent). ADR-0150 forbids silent truncation — fail loud
      // rather than hand the caller a partial file presented as the whole thing.
      if (chunk.length === 0) {
        throw new Error(
          `sync-rpc-fs: short read for ${path} — got ${offset} of ${size} bytes (owner store changed mid-read)`,
        );
      }
      if (chunk.length > requested) {
        throw new Error(
          `sync-rpc-fs: oversized read for ${path} — ${chunk.length} bytes exceeds ${requested} remaining in the head snapshot`,
        );
      }
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }

  writeFileSync(path: string, data: Uint8Array): void {
    if (data.length === 0) {
      this.call(FS_METHODS.writeChunk, { path, b64: '', offset: 0, truncate: true });
      return;
    }
    let offset = 0;
    let first = true;
    while (offset < data.length) {
      const slice = data.subarray(offset, offset + FS_RPC_CHUNK);
      this.call(FS_METHODS.writeChunk, {
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
    this.call(FS_METHODS.mkdir, { path, recursive: options.recursive === true });
  }

  rmSync(path: string, options: { recursive?: boolean; force?: boolean }): void {
    this.call(FS_METHODS.rm, {
      path,
      recursive: options.recursive === true,
      force: options.force === true,
    });
  }

  renameSync(src: string, dst: string): void {
    this.call(FS_METHODS.rename, { src, dst });
  }

  utimes(path: string, atimeMs: number, mtimeMs: number): void {
    this.call(FS_METHODS.utimes, { path, atimeMs, mtimeMs });
  }

  copyFileSync(src: string, dst: string): void {
    this.call(FS_METHODS.copyFile, { src, dst });
  }

  cpSync(src: string, dst: string, options?: { recursive?: boolean }): void {
    this.call(FS_METHODS.cp, { src, dst, recursive: options?.recursive === true });
  }
}

/**
 * Install a {@link SyncRpcFsSync} as this realm's GLOBAL sync mirror (ADR-0150).
 * A spawned child calls this so BOTH the module loader AND the `node:fs`
 * builtins (which read `syncMirror()`) resolve against the owner store over
 * `fs.*` RPC. Returns the installed remote VFS.
 */
export function installRemoteSyncFs(call: SyncCall): SyncRpcFsSync {
  const vfs = new SyncRpcFsSync(call);
  setSyncMirror(vfs);
  return vfs;
}
