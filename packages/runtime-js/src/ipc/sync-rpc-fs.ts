/**
 * Child-side remote `FsSync` (ADR-0150 D P6a). Delegates each call to the owner
 * over the kernel sync-RPC ring (`KernelSyncApi.call`). Reads pull raw bytes
 * (binary reply) in `FS_RPC_CHUNK` slices keyed by offset; writes push base64
 * chunks. All calls block the child via `Atomics.wait` (inside `call`); legal
 * only in a kernel-spawned Worker. fd-level ops stay client-side (`fs.ts`
 * fdTable) — this implements only the 13 `FsSync` methods.
 */

import type { FsSync, VfsDirent } from '@riftydev/vfs';
import { setSyncMirror } from '../builtins/fs-sync-mirror.ts';
import { FS_METHODS, FS_RPC_CHUNK, type FsStatShape, bytesToBase64 } from './fs-rpc-protocol.ts';

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
    const stat = this.call(FS_METHODS.statOrNull, { path }) as FsStatShape | null;
    if (stat === null || !stat.isFile) {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT', path });
    }
    const size = stat.size ?? 0;
    if (size === 0) return new Uint8Array(0);
    const out = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const chunk = this.call(FS_METHODS.readChunk, {
        path,
        offset,
        length: FS_RPC_CHUNK,
      }) as Uint8Array;
      if (chunk.length === 0) break; // truncated mid-read; return what we have
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return offset === size ? out : out.subarray(0, offset);
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
 * Install a {@link SyncRpcFsSync} as this realm's GLOBAL sync mirror (ADR-0150
 * P6a). A spawned child calls this so BOTH the module loader AND the `node:fs`
 * builtins (which read `syncMirror()`) resolve against the owner store over
 * `fs.*` RPC. Returns the installed remote VFS.
 */
export function installRemoteSyncFs(call: SyncCall): SyncRpcFsSync {
  const vfs = new SyncRpcFsSync(call);
  setSyncMirror(vfs);
  return vfs;
}
