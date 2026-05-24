/**
 * File-descriptor syscalls: `fd_read`, `fd_write`, `fd_close`, `fd_seek`,
 * `fd_fdstat_get`, `fd_prestat_get`, `fd_prestat_dir_name`. Mutates the fd
 * table and (for `fd_write` on file fds) writes through to the shared VFS via
 * `syncMirror()`.
 */
import { syncMirror } from '@rifty/vfs';
import { E_BADF, E_NAMETOOLONG, E_SUCCESS, type WasiCtx, dec, enc } from './shared.ts';

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
      if (!fdEntry || fdEntry.type !== 'file') {
        // stdin: nothing
        ctx.view().setUint32(nread, 0, true);
        return E_SUCCESS;
      }
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
      const cur = fdEntry.cursor ?? 0;
      const size = (fdEntry.data ?? new Uint8Array(0)).length;
      let next: number;
      if (whence === 0) next = Number(offset);
      else if (whence === 1) next = cur + Number(offset);
      else next = size + Number(offset);
      fdEntry.cursor = next;
      ctx.view().setBigUint64(newOffset, BigInt(next), true);
      return E_SUCCESS;
    },
    fd_fdstat_get: (fd: number, _outPtr: number) => {
      return ctx.fds.has(fd) ? E_SUCCESS : E_BADF;
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
