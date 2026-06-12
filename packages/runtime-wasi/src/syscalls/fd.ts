/**
 * File-descriptor WASI preview1 syscalls.
 *
 * Primary calls: `fd_read`, `fd_write`, `fd_close`, `fd_seek`,
 * `fd_fdstat_get`, `fd_prestat_get`, `fd_prestat_dir_name`. Mutates the fd
 * table and (for `fd_write` on file fds) writes through to the shared VFS via
 * `syncMirror()` (ADR-0014).
 *
 * Auxiliary calls: `fd_fdstat_set_flags`, `fd_filestat_get`,
 * `fd_filestat_set_size`, `fd_pread`, `fd_pwrite`, `fd_readdir`,
 * `fd_renumber`, `fd_tell`, plus the remaining `E_NOSYS` / harmless-success
 * stubs (`fd_advise`, `fd_allocate`, `fd_datasync`, `fd_sync`,
 * `fd_filestat_set_times`, `fd_fdstat_set_rights`).
 */
import { syncMirror } from '@riftydev/vfs';
import {
  E_BADF,
  E_INVAL,
  E_NAMETOOLONG,
  E_NOSYS,
  E_NOTDIR,
  E_PERM,
  E_SUCCESS,
  FDFLAGS_APPEND,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  type FileDescriptor,
  RIGHTS_DIR_BASE,
  RIGHTS_FD_FILESTAT_SET_SIZE,
  RIGHTS_FD_READ,
  RIGHTS_FD_SEEK,
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
      // stdio is a character device in real WASI, but shared.ts lacks
      // FILETYPE_CHARACTER_DEVICE; report unknown (guests rarely inspect this).
      return FILETYPE_UNKNOWN;
  }
}

function rightsFor(entry: FileDescriptor): { base: bigint; inheriting: bigint } {
  if (entry.type === 'dir') {
    return {
      base: entry.rights ?? RIGHTS_DIR_BASE,
      inheriting: entry.rightsInheriting ?? RIGHTS_DIR_BASE | RIGHTS_FILE_BASE,
    };
  }
  if (entry.type === 'file') {
    return { base: entry.rights ?? RIGHTS_FILE_BASE, inheriting: entry.rightsInheriting ?? 0n };
  }
  // stdio
  return { base: entry.rights ?? RIGHTS_FILE_BASE, inheriting: entry.rightsInheriting ?? 0n };
}

function toSafeNonNegativeNumber(value: bigint): number | null {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function allocateFileBytes(length: number): Uint8Array | null {
  try {
    return new Uint8Array(length);
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
}

function hasRight(entry: FileDescriptor, right: bigint): boolean {
  return entry.rights === undefined || (entry.rights & right) !== 0n;
}

export function fdSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    fd_write: (fd: number, iovs: number, iovsLen: number, nwritten: number) => {
      const fdEntry = ctx.fds.get(fd);
      if (!fdEntry) return E_BADF;
      // Only enforce RIGHTS_FD_WRITE when path_open saved an explicit rights bag;
      // stdio and preopens leave `rights` undefined → default-permissive.
      if (fdEntry.type === 'file' && !hasRight(fdEntry, RIGHTS_FD_WRITE)) return E_PERM;
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
          const existing = fdEntry.data ?? new Uint8Array(0);
          const cur =
            (fdEntry.fdflags ?? 0) & FDFLAGS_APPEND ? existing.length : (fdEntry.cursor ?? 0);
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
      // Guests rely on E_BADF to detect mis-tracked fds; E_SUCCESS + 0 bytes masks bugs.
      if (!fdEntry) return E_BADF;
      // Stdin from the `onStdin` callback (esbuild's `transform` feeds source bytes).
      // Residual buffer on the fd entry delivers a chunk larger than the guest's
      // iovec across reads; `null`/empty from the callback with empty residual = EOF.
      if (fdEntry.type === 'stdin') {
        const view = ctx.view();
        const bytes = ctx.bytes();
        let residual = fdEntry.data ?? new Uint8Array(0);
        let cursor = fdEntry.cursor ?? 0;
        let readTotal = 0;
        for (let i = 0; i < iovsLen; i++) {
          const ptr = view.getUint32(iovs + i * 8, true);
          const len = view.getUint32(iovs + i * 8 + 4, true);
          if (len === 0) continue;
          if (cursor >= residual.length) {
            const next = ctx.onStdin();
            if (!next || next.length === 0) break; // EOF
            residual = next;
            cursor = 0;
          }
          const take = Math.min(len, residual.length - cursor);
          bytes.set(residual.subarray(cursor, cursor + take), ptr);
          cursor += take;
          readTotal += take;
        }
        fdEntry.data = residual;
        fdEntry.cursor = cursor;
        view.setUint32(nread, readTotal, true);
        return E_SUCCESS;
      }
      // stdout/stderr are write-only.
      if (fdEntry.type !== 'file') return E_BADF;
      if (!hasRight(fdEntry, RIGHTS_FD_READ)) return E_PERM;
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
      if (!hasRight(fdEntry, RIGHTS_FD_SEEK)) return E_PERM;
      if (whence !== WHENCE_SET && whence !== WHENCE_CUR && whence !== WHENCE_END) {
        return E_INVAL;
      }
      const cur = fdEntry.cursor ?? 0;
      const size = (fdEntry.data ?? new Uint8Array(0)).length;
      const offsetNum = toSafeNonNegativeNumber(offset < 0n ? -offset : offset);
      if (offsetNum === null) return E_INVAL;
      let next: number;
      if (whence === WHENCE_SET) {
        if (offset < 0n) return E_INVAL;
        next = offsetNum;
      } else if (whence === WHENCE_CUR) {
        next = offset < 0n ? cur - offsetNum : cur + offsetNum;
        if (next < 0) return E_INVAL;
      } else {
        next = offset < 0n ? size - offsetNum : size + offsetNum;
        if (next < 0) return E_INVAL;
      }
      if (!Number.isSafeInteger(next)) return E_INVAL;
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
    // No per-fd rights downgrade: rights live on the FileDescriptor, checked at
    // use. E_NOSYS lets guests that branch on this fall back to no restriction.
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
    fd_filestat_set_size: (fd: number, size: bigint) => {
      const entry = ctx.fds.get(fd);
      if (!entry || entry.type !== 'file') return E_BADF;
      if (!hasRight(entry, RIGHTS_FD_FILESTAT_SET_SIZE)) return E_PERM;
      const sizeNum = toSafeNonNegativeNumber(size);
      if (sizeNum === null) return E_INVAL;
      const existing = entry.data ?? new Uint8Array(0);
      let next: Uint8Array;
      if (sizeNum === existing.length) {
        next = existing;
      } else if (sizeNum < existing.length) {
        next = existing.slice(0, sizeNum);
      } else {
        const grown = allocateFileBytes(sizeNum);
        if (!grown) return E_INVAL;
        grown.set(existing, 0);
        next = grown;
      }
      entry.data = next;
      if (entry.path) syncMirror().writeFileSync(entry.path, next);
      return E_SUCCESS;
    },
    fd_filestat_set_times: () => E_NOSYS,
    fd_readdir: (fd: number, bufPtr: number, bufLen: number, cookie: bigint, bufUsed: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry) return E_BADF;
      // A non-directory fd must report E_NOTDIR, not E_BADF. Go's WASIp1 os layer
      // (esbuild) probes opened paths with fd_readdir: E_NOTDIR means "it's a file,
      // read it as one"; E_BADF is a hard error that made esbuild abort on every
      // file entry point.
      if (entry.type !== 'dir' || !entry.path) return E_NOTDIR;
      const mirror = syncMirror();
      // Ordering contract: preview1 cookie semantics require `readdirSync` to
      // return entries in a stable order between calls. Both backends satisfy
      // this for a fixed tree (MemoryFsSync: insertion-ordered Map; OpfsFsSync:
      // FileSystemDirectoryHandle iterator). A backend that reordered between
      // calls would make paginating guests skip or duplicate; sort-by-name is a
      // possible future hardening.
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
      // Cookie semantics: each entry emits `d_next = index + 1` (so cookie 0 =
      // start from the beginning). The guest re-invokes with the last cookie it
      // kept, so `index >= cookie` is the "still to emit" predicate.
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
        // d_type from the dirent shape (ADR-0041); saves guests like esbuild
        // a re-stat per entry to tell files from subdirs.
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
    fd_pread: (fd: number, iovs: number, iovsLen: number, offset: bigint, nread: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry || entry.type !== 'file') return E_BADF;
      if (!hasRight(entry, RIGHTS_FD_READ)) return E_PERM;
      const offsetNum = toSafeNonNegativeNumber(offset);
      if (offsetNum === null) return E_INVAL;
      const view = ctx.view();
      const bytes = ctx.bytes();
      let readTotal = 0;
      let cursor = offsetNum;
      const data = entry.data ?? new Uint8Array(0);
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
      view.setUint32(nread, readTotal, true);
      return E_SUCCESS;
    },
    fd_pwrite: (fd: number, iovs: number, iovsLen: number, offset: bigint, nwritten: number) => {
      const entry = ctx.fds.get(fd);
      if (!entry || entry.type !== 'file') return E_BADF;
      if (!hasRight(entry, RIGHTS_FD_WRITE)) return E_PERM;
      const offsetNum = toSafeNonNegativeNumber(offset);
      if (offsetNum === null) return E_INVAL;
      const view = ctx.view();
      const bytes = ctx.bytes();
      const chunks: { offset: number; data: Uint8Array }[] = [];
      let writeOffset = offsetNum;
      let written = 0;
      let neededLength = (entry.data ?? new Uint8Array(0)).length;
      for (let i = 0; i < iovsLen; i++) {
        const ptr = view.getUint32(iovs + i * 8, true);
        const len = view.getUint32(iovs + i * 8 + 4, true);
        const slice = bytes.subarray(ptr, ptr + len);
        const needed = writeOffset + slice.length;
        if (!Number.isSafeInteger(needed)) return E_INVAL;
        chunks.push({ offset: writeOffset, data: slice });
        writeOffset = needed;
        written += slice.length;
        neededLength = Math.max(neededLength, needed);
      }
      const existing = entry.data ?? new Uint8Array(0);
      let next = existing;
      if (neededLength > existing.length) {
        const grown = allocateFileBytes(neededLength);
        if (!grown) return E_INVAL;
        grown.set(existing, 0);
        next = grown;
      }
      for (const chunk of chunks) next.set(chunk.data, chunk.offset);
      entry.data = next;
      if (entry.path) syncMirror().writeFileSync(entry.path, next);
      view.setUint32(nwritten, written, true);
      return E_SUCCESS;
    },
    fd_advise: () => E_SUCCESS, // advisory hint; honest no-op
    fd_allocate: () => E_NOSYS, // pre-allocating storage is meaningless in-memory
    fd_datasync: () => E_SUCCESS, // in-memory writes are immediately visible
    fd_sync: () => E_SUCCESS, // ditto
  };
}
