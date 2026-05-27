/**
 * File-descriptor WASI preview1 syscalls.
 *
 * Primary calls: `fd_read`, `fd_write`, `fd_close`, `fd_seek`,
 * `fd_fdstat_get`, `fd_prestat_get`, `fd_prestat_dir_name`. Mutates the fd
 * table and (for `fd_write` on file fds) writes through to the shared VFS via
 * `syncMirror()` (ADR-0014).
 *
 * Auxiliary calls: `fd_fdstat_set_flags`, `fd_filestat_get`, `fd_readdir`,
 * `fd_renumber`, `fd_tell`, plus the family of `E_NOSYS` / harmless-success
 * stubs (`fd_pread`, `fd_pwrite`, `fd_advise`, `fd_allocate`, `fd_datasync`,
 * `fd_sync`, `fd_filestat_set_size`, `fd_filestat_set_times`,
 * `fd_fdstat_set_rights`).
 *
 * Routes file-state queries through `syncMirror()` so the filesystem view
 * stays consistent with the `node:fs` layer.
 */
import { syncMirror } from '@rifty/vfs';
import {
  E_BADF,
  E_INVAL,
  E_NAMETOOLONG,
  E_NOSYS,
  E_PERM,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  type FileDescriptor,
  RIGHTS_DIR_BASE,
  RIGHTS_FD_WRITE,
  RIGHTS_FILE_BASE,
  WHENCE_CUR,
  WHENCE_END,
  WHENCE_SET,
  type WasiCtx,
  dec,
  enc,
} from './shared.ts';

function filetypeFor(entry: FileDescriptor): number {
  switch (entry.type) {
    case 'file':
      return FILETYPE_REGULAR_FILE;
    case 'dir':
      return FILETYPE_DIRECTORY;
    default:
      // stdin/stdout/stderr appear as character devices in real WASI; we
      // don't have a constant for FILETYPE_CHARACTER_DEVICE in the
      // truncated shared.ts set, so report unknown. Guests rarely
      // inspect stdio filetypes.
      return FILETYPE_UNKNOWN;
  }
}

function rightsFor(entry: FileDescriptor): { base: bigint; inheriting: bigint } {
  if (entry.type === 'dir') {
    return { base: RIGHTS_DIR_BASE, inheriting: RIGHTS_DIR_BASE | RIGHTS_FILE_BASE };
  }
  if (entry.type === 'file') {
    return { base: RIGHTS_FILE_BASE, inheriting: 0n };
  }
  // stdio
  return { base: RIGHTS_FILE_BASE, inheriting: 0n };
}

export function fdSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => {
      const fdEntry = ctx.fds.get(fd);
      if (!fdEntry) return E_BADF;
      // Rights check: if the fd was opened with an explicit rights bag (i.e.
      // `path_open` saved one), require RIGHTS_FD_WRITE before writing. stdio
      // and preopens leave `rights` undefined → default-permissive.
      if (fdEntry.type === 'file' && fdEntry.rights !== undefined) {
        if ((fdEntry.rights & RIGHTS_FD_WRITE) === 0n) return E_PERM;
      }
      const view = ctx.view();
      const bytes = ctx.bytes();
      let written = 0;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovs + i * 8, true);
        const len = view.getUint32(iovs + i * 8 + 4, true);
        const slice = bytes.subarray(ptr, ptr + len);
        if (fdEntry.type === 'stdout') ctx.onStdout(dec.decode(slice));
        else if (fdEntry.type === 'stderr') ctx.onStderr(dec.decode(slice));
        else if (fdEntry.type === 'file') {
          const cur = fdEntry.cursor ?? 0;
          const existing = fdEntry.data ?? new Uint8Array(0);
          const needed = cur + slice.length;
          const next = needed > existing.length ? new Uint8Array(needed) : existing;
          if (next !== existing) next.set(existing, 0);
          next.set(slice, cur);
          fdEntry.data = next;
          fdEntry.cursor = needed;
          if (fdEntry.path) syncMirror().writeFileSync(fdEntry.path, next);
        }
        written += slice.length;
      }
      view.setUint32(nwritten, written, true);
      return E_SUCCESS;
    },
    fd_read: (fd: number, iovs: number, iovsLen: number, nread: number) => {
      const fdEntry = ctx.fds.get(fd);
      // Unknown fd → bad descriptor. WASI guests rely on E_BADF here to detect
      // mis-tracked fds; silently returning E_SUCCESS + 0 bytes masked bugs.
      if (!fdEntry) return E_BADF;
      // Stdin: not yet wired in, but it IS a valid fd, so return EOF.
      if (fdEntry.type === 'stdin') {
        ctx.view().setUint32(nread, 0, true);
        return E_SUCCESS;
      }
      // stdout/stderr are write-only.
      if (fdEntry.type !== 'file') return E_BADF;
      const view = ctx.view();
      const bytes = ctx.bytes();
      let readTotal = 0;
      let cursor = fdEntry.cursor ?? 0;
      const data = fdEntry.data ?? new Uint8Array(0);
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovs + i * 8, true);
        const len = view.getUint32(iovs + i * 8 + 4, true);
        const remaining = data.length - cursor;
        if (remaining <= 0) break;
        const take = Math.min(len, remaining);
        bytes.set(data.subarray(cursor, cursor + take), ptr);
        cursor += take;
        readTotal += take;
      }
      fdEntry.cursor = cursor;
      view.setUint32(nread, readTotal, true);
      return E_SUCCESS;
    },
    fd_close: (fd: number) => {
      if (!ctx.fds.has(fd)) return E_BADF;
      if (fd <= 2) return E_SUCCESS;
      ctx.fds.delete(fd);
      return E_SUCCESS;
    },
    fd_seek: (fd: number, offset: bigint, whence: number, newOffset: number) => {
      const fdEntry = ctx.fds.get(fd);
      if (!fdEntry || fdEntry.type !== 'file') return E_BADF;
      if (whence !== WHENCE_SET && whence !== WHENCE_CUR && whence !== WHENCE_END) {
        return E_INVAL;
      }
      const cur = fdEntry.cursor ?? 0;
      const size = (fdEntry.data ?? new Uint8Array(0)).length;
      const offsetNum = Number(offset);
      let next: number;
      if (whence === WHENCE_SET) {
        if (offsetNum < 0) return E_INVAL;
        next = offsetNum;
      } else if (whence === WHENCE_CUR) {
        next = cur + offsetNum;
        if (next < 0) return E_INVAL;
      } else {
        next = size + offsetNum;
        if (next < 0) return E_INVAL;
      }
      fdEntry.cursor = next;
      ctx.view().setBigUint64(newOffset, BigInt(next), true);
      return E_SUCCESS;
    },
    fd_fdstat_get: (fd: number, outPtr: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry) return E_BADF;
      const view = ctx.view();
      // preview1 fdstat layout (24 bytes total):
      //   0: fs_filetype (u8)
      //   1: padding (1 byte)
      //   2: fs_flags (u16)
      //   4: padding (4 bytes)
      //   8: fs_rights_base (u64)
      //  16: fs_rights_inheriting (u64)
      view.setUint8(outPtr, filetypeFor(entry));
      view.setUint8(outPtr + 1, 0);
      view.setUint16(outPtr + 2, entry.fdflags ?? 0, true);
      view.setUint32(outPtr + 4, 0, true);
      const { base, inheriting } = rightsFor(entry);
      view.setBigUint64(outPtr + 8, base, true);
      view.setBigUint64(outPtr + 16, inheriting, true);
      return E_SUCCESS;
    },
    fd_prestat_get: (fd: number, outPtr: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry || !entry.isPreopen || !entry.preopenName) return E_BADF;
      const view = ctx.view();
      view.setUint8(outPtr, 0); // PREOPEN_TYPE_DIR
      view.setUint32(outPtr + 4, enc.encode(entry.preopenName).length, true);
      return E_SUCCESS;
    },
    fd_prestat_dir_name: (fd: number, ptr: number, len: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry || !entry.preopenName) return E_BADF;
      const name = enc.encode(entry.preopenName);
      if (name.length > len) return E_NAMETOOLONG;
      ctx.bytes().set(name, ptr);
      return E_SUCCESS;
    },
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
    fd_readdir: (fd: number, bufPtr: number, bufLen: number, cookie: bigint, bufUsed: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry) return E_BADF;
      if (entry.type !== 'dir' || !entry.path) return E_BADF;
      const mirror = syncMirror();
      // Ordering contract: we trust `readdirSync` to return entries in a
      // stable order between calls for the same directory (no concurrent
      // mutation; same VFS backend). MemoryFsSync iterates an ES Map's
      // insertion-ordered children, which is deterministic. OpfsFsSync's
      // ordering comes from the underlying FileSystemDirectoryHandle async
      // iterator and is also stable for a fixed tree. WASI preview1's
      // cookie semantics rely on this — if a future backend returns
      // entries in a different order between calls, paginating guests
      // will skip or duplicate. Re-stat / sort-by-name is a possible
      // future hardening if that turns out to matter.
      let entries: readonly { name: string; isFile: boolean; isDirectory: boolean }[];
      try {
        entries = mirror.readdirSync(entry.path);
      } catch {
        return E_BADF;
      }
      const view = ctx.view();
      const bytes = ctx.bytes();
      let off = bufPtr;
      const end = bufPtr + bufLen;
      // preview1 dirent layout (21 bytes tightly packed):
      //   0: d_next (u64), 8: d_ino (u64), 16: d_namlen (u32), 20: d_type (u8)
      //
      // Cookie semantics (preview1): each entry emits `d_next = index + 1`
      // (so cookie 0 is the canonical "start from the beginning" value).
      // The guest re-invokes with the cookie of the last entry it kept;
      // we must skip every entry whose index satisfies `index < cookie`,
      // i.e. `index >= cookie` is the "still to emit" predicate.
      for (let i = 0; i < entries.length; i++) {
        if (BigInt(i) < cookie) continue;
        const dirent = entries[i];
        if (!dirent) continue;
        const nameBytes = enc.encode(dirent.name);
        const headerSize = 21;
        const recordSize = headerSize + nameBytes.length;
        if (off + headerSize > end) break;
        view.setBigUint64(off, BigInt(i + 1), true); // d_next (cookie)
        view.setBigUint64(off + 8, 0n, true); // d_ino (not tracked)
        view.setUint32(off + 16, nameBytes.length, true);
        // d_type — backed by the dirent shape introduced in ADR-0041;
        // guests like esbuild no longer need to re-stat each entry to
        // distinguish files from subdirs.
        const dType = dirent.isDirectory
          ? FILETYPE_DIRECTORY
          : dirent.isFile
            ? FILETYPE_REGULAR_FILE
            : FILETYPE_UNKNOWN;
        view.setUint8(off + 20, dType);
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
