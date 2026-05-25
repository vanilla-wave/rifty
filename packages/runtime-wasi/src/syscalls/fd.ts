/**
 * File-descriptor syscalls: `fd_read`, `fd_write`, `fd_close`, `fd_seek`,
 * `fd_fdstat_get`, `fd_prestat_get`, `fd_prestat_dir_name`. Mutates the fd
 * table and (for `fd_write` on file fds) writes through to the shared VFS via
 * `syncMirror()`.
 */
import { syncMirror } from '@rifty/vfs';
import {
  E_BADF,
  E_INVAL,
  E_NAMETOOLONG,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  type FileDescriptor,
  WHENCE_CUR,
  WHENCE_END,
  WHENCE_SET,
  type WasiCtx,
  dec,
  enc,
} from './shared.ts';

/**
 * preview1 `rights` bitset values relevant for files and directories. We grant
 * a generous default set on opened fds so guests don't hit `ENOTCAPABLE` —
 * the real-capability story is tracked separately. See WASI preview1 spec
 * `rights` table.
 */
const RIGHTS_FILE_BASE =
  /* fd_datasync */ (1n << 0n) |
  /* fd_read */ (1n << 1n) |
  /* fd_seek */ (1n << 2n) |
  /* fd_fdstat_set_flags */ (1n << 3n) |
  /* fd_sync */ (1n << 4n) |
  /* fd_tell */ (1n << 5n) |
  /* fd_write */ (1n << 6n) |
  /* fd_advise */ (1n << 7n) |
  /* fd_allocate */ (1n << 8n) |
  /* fd_filestat_get */ (1n << 21n) |
  /* fd_filestat_set_size */ (1n << 22n) |
  /* fd_filestat_set_times */ (1n << 23n);

const RIGHTS_DIR_BASE =
  /* fd_fdstat_set_flags */ (1n << 3n) |
  /* fd_sync */ (1n << 4n) |
  /* path_create_directory */ (1n << 9n) |
  /* path_create_file */ (1n << 10n) |
  /* path_link_source */ (1n << 11n) |
  /* path_link_target */ (1n << 12n) |
  /* path_open */ (1n << 13n) |
  /* fd_readdir */ (1n << 14n) |
  /* path_readlink */ (1n << 15n) |
  /* path_rename_source */ (1n << 16n) |
  /* path_rename_target */ (1n << 17n) |
  /* path_filestat_get */ (1n << 18n) |
  /* path_filestat_set_size */ (1n << 19n) |
  /* path_filestat_set_times */ (1n << 20n) |
  /* fd_filestat_get */ (1n << 21n) |
  /* path_remove_directory */ (1n << 28n) |
  /* path_unlink_file */ (1n << 29n);

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
  };
}
