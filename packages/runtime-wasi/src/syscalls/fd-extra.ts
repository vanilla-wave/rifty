/**
 * Auxiliary file-descriptor syscalls split from {@link ./fd.ts} for the
 * ADR-0024 line budget: `fd_filestat_get`, `fd_readdir`, `fd_renumber`,
 * and the family of E_NOSYS / harmless-success stubs (`fd_pread`,
 * `fd_pwrite`, `fd_advise`, `fd_allocate`, `fd_datasync`, `fd_sync`,
 * `fd_filestat_set_size`, `fd_filestat_set_times`, `fd_fdstat_set_rights`).
 *
 * Routes file-state queries through `syncMirror()` (ADR-0014) so the
 * filesystem view stays consistent with the `node:fs` layer.
 */
import { syncMirror } from '@rifty/vfs';
import {
  E_BADF,
  E_NOSYS,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  type FileDescriptor,
  type WasiCtx,
  enc,
} from './shared.ts';

function filetypeFor(entry: FileDescriptor): number {
  switch (entry.type) {
    case 'file':
      return FILETYPE_REGULAR_FILE;
    case 'dir':
      return FILETYPE_DIRECTORY;
    default:
      return FILETYPE_UNKNOWN;
  }
}

export function fdExtraSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    fd_fdstat_set_flags: (fd: number, flags: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry) return E_BADF;
      entry.fdflags = flags;
      return E_SUCCESS;
    },
    // No per-fd rights downgrade in the current model (rights live on the
    // FileDescriptor and are checked at use). E_NOSYS is the honest signal —
    // guests that branch on this fall back to no restriction.
    fd_fdstat_set_rights: () => E_NOSYS,
    fd_filestat_get: (fd: number, outBuf: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry) return E_BADF;
      const view = ctx.view();
      // preview1 filestat layout (64 bytes):
      //   0: dev (u64)        — always 0 (single VFS)
      //   8: ino (u64)        — always 0 (we don't track inodes)
      //  16: filetype (u8)
      //  17: padding (7 bytes)
      //  24: nlink (u64)      — always 1
      //  32: size (u64)
      //  40: atim (u64)       — 0 (atime not modelled)
      //  48: mtim (u64)       — best-effort from VFS
      //  56: ctim (u64)       — 0
      view.setBigUint64(outBuf, 0n, true);
      view.setBigUint64(outBuf + 8, 0n, true);
      view.setUint8(outBuf + 16, filetypeFor(entry));
      for (let i = 17; i < 24; i++) view.setUint8(outBuf + i, 0);
      view.setBigUint64(outBuf + 24, 1n, true);
      let size = 0n;
      let mtime = 0n;
      if (entry.type === 'file' && entry.path) {
        try {
          const st = syncMirror().statSync(entry.path);
          size = BigInt(st.size ?? 0);
          mtime = BigInt((st.mtime ?? 0) * 1_000_000); // ms → ns
        } catch {
          // Fall back to in-memory cursor view if the path isn't reachable.
          size = BigInt((entry.data ?? new Uint8Array(0)).length);
        }
      } else if (entry.type === 'dir' && entry.path) {
        try {
          const st = syncMirror().statSync(entry.path);
          mtime = BigInt((st.mtime ?? 0) * 1_000_000);
        } catch {
          /* directory may be virtual; size stays 0 */
        }
      }
      view.setBigUint64(outBuf + 32, size, true);
      view.setBigUint64(outBuf + 40, 0n, true);
      view.setBigUint64(outBuf + 48, mtime, true);
      view.setBigUint64(outBuf + 56, 0n, true);
      return E_SUCCESS;
    },
    fd_filestat_set_size: () => E_NOSYS,
    fd_filestat_set_times: () => E_NOSYS,
    fd_readdir: (fd: number, bufPtr: number, bufLen: number, _cookie: bigint, bufUsed: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry) return E_BADF;
      if (entry.type !== 'dir' || !entry.path) return E_BADF;
      const mirror = syncMirror();
      let names: readonly string[];
      try {
        names = mirror.readdirSync(entry.path);
      } catch {
        return E_BADF;
      }
      const view = ctx.view();
      const bytes = ctx.bytes();
      let off = bufPtr;
      const end = bufPtr + bufLen;
      // preview1 dirent layout (21 bytes tightly packed):
      //   0: d_next (u64), 8: d_ino (u64), 16: d_namlen (u32), 20: d_type (u8)
      for (let i = 0; i < names.length; i++) {
        const name = names[i] ?? '';
        const nameBytes = enc.encode(name);
        const headerSize = 21;
        const recordSize = headerSize + nameBytes.length;
        if (off + headerSize > end) break;
        view.setBigUint64(off, BigInt(i + 1), true); // d_next (cookie)
        view.setBigUint64(off + 8, 0n, true); // d_ino (not tracked)
        view.setUint32(off + 16, nameBytes.length, true);
        // d_type — we'd need a stat per entry to distinguish file/dir; for
        // now report unknown so guests that care can re-stat. Real WASI
        // returns the type, but this keeps `readdir` O(N) on the VFS.
        view.setUint8(off + 20, FILETYPE_UNKNOWN);
        const namePos = off + headerSize;
        const room = Math.min(nameBytes.length, end - namePos);
        if (room > 0) bytes.set(nameBytes.subarray(0, room), namePos);
        off += Math.min(recordSize, end - off);
        if (off >= end) break;
      }
      view.setUint32(bufUsed, off - bufPtr, true);
      return E_SUCCESS;
    },
    fd_renumber: (from: number, to: number) => {
      const src = ctx.fds.get(from);
      if (!src) return E_BADF;
      ctx.fds.set(to, src);
      ctx.fds.delete(from);
      return E_SUCCESS;
    },
    fd_tell: (fd: number, outPtr: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry || entry.type !== 'file') return E_BADF;
      ctx.view().setBigUint64(outPtr, BigInt(entry.cursor ?? 0), true);
      return E_SUCCESS;
    },
    // fd_pread / fd_pwrite take an offset rather than using the cursor. We
    // could implement these by manipulating the cursor temporarily, but real
    // toolchains rarely use them and the honest E_NOSYS surfaces missing
    // support in the compat matrix.
    fd_pread: () => E_NOSYS,
    fd_pwrite: () => E_NOSYS,
    fd_advise: () => E_SUCCESS, // advisory hint; honest no-op
    fd_allocate: () => E_NOSYS, // pre-allocating storage is meaningless in-memory
    fd_datasync: () => E_SUCCESS, // in-memory writes are immediately visible
    fd_sync: () => E_SUCCESS, // ditto
  };
}
