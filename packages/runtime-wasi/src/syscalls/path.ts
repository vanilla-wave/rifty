/**
 * Path-resolving syscalls: `path_open`, `path_filestat_get`,
 * `path_create_directory`. Each resolves a relative path against the base-fd
 * preopen and consults the shared sync VFS mirror.
 */
import { joinPath, normalizePath, syncMirror } from '@rifty/vfs';
import {
  E_ACCES,
  E_BADF,
  E_EXIST,
  E_INVAL,
  E_ISDIR,
  E_NOENT,
  E_NOTDIR,
  E_PERM,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  OFLAGS_CREAT,
  OFLAGS_EXCL,
  OFLAGS_TRUNC,
  type WasiCtx,
  dec,
} from './shared.ts';

/**
 * Map a caught error from the sync VFS mirror to a WASI preview1 errno.
 * The VFS layer raises `VfsError` instances with a `code` field; native fs
 * shims (Node) and bare `Error` callers may also pass a `code` like
 * `'ENOENT'` / `'EEXIST'`. Anything we don't recognise falls back to
 * `E_NOENT` for backwards compatibility — better choices are documented
 * inline.
 */
function errToWasiErrno(err: unknown): number {
  if (err && typeof err === 'object' && 'code' in err) {
    switch ((err as { code: unknown }).code) {
      case 'ENOENT':
        return E_NOENT;
      case 'EEXIST':
        return E_EXIST;
      case 'EISDIR':
        return E_ISDIR;
      case 'ENOTDIR':
        return E_NOTDIR;
      case 'EACCES':
        return E_ACCES;
      case 'EPERM':
        return E_PERM;
      case 'EINVAL':
        return E_INVAL;
    }
  }
  return E_NOENT;
}

export function pathSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    path_open: (
      fd: number,
      _dirflags: number,
      pathPtr: number,
      pathLen: number,
      oflags: number,
      _fsRightsBase: bigint,
      _fsRightsInheriting: bigint,
      fdflags: number,
      outFd: number,
    ) => {
      const base = ctx.fds.get(fd);
      if (!base || base.type !== 'dir' || !base.path) return E_BADF;
      const relative = dec.decode(ctx.bytes().subarray(pathPtr, pathPtr + pathLen));
      const fullPath = normalizePath(joinPath(base.path, relative));
      const wantCreate = (oflags & OFLAGS_CREAT) !== 0;
      const wantExclusive = (oflags & OFLAGS_EXCL) !== 0;
      const wantTruncate = (oflags & OFLAGS_TRUNC) !== 0;

      const mirror = syncMirror();
      let data: Uint8Array;
      let existed: boolean;
      try {
        data = mirror.readFileBytesSync(fullPath) as Uint8Array;
        existed = true;
      } catch (err) {
        const code = errToWasiErrno(err);
        if (code !== E_NOENT) return code;
        existed = false;
        data = new Uint8Array(0);
      }

      // O_EXCL alone has no effect; only meaningful in combination with O_CREAT.
      if (wantCreate && wantExclusive && existed) return E_EXIST;
      if (!wantCreate && !existed) return E_NOENT;
      if (wantTruncate && existed) data = new Uint8Array(0);

      // If we're creating a fresh file, write the empty buffer through the
      // mirror so the file is visible to subsequent path_open/stat calls.
      if (wantCreate && !existed) {
        try {
          mirror.writeFileSync(fullPath, data);
        } catch (err) {
          return errToWasiErrno(err);
        }
      } else if (wantTruncate && existed) {
        try {
          mirror.writeFileSync(fullPath, data);
        } catch (err) {
          return errToWasiErrno(err);
        }
      }

      const newFd = ctx.nextFd.value++;
      ctx.fds.set(newFd, { type: 'file', path: fullPath, data, cursor: 0, fdflags });
      ctx.view().setUint32(outFd, newFd, true);
      return E_SUCCESS;
    },
    path_filestat_get: (
      fd: number,
      _flags: number,
      pathPtr: number,
      pathLen: number,
      outBuf: number,
    ) => {
      const base = ctx.fds.get(fd);
      if (!base || base.type !== 'dir' || !base.path) return E_BADF;
      const relative = dec.decode(ctx.bytes().subarray(pathPtr, pathPtr + pathLen));
      const fullPath = normalizePath(joinPath(base.path, relative));
      try {
        const st = syncMirror().statSync(fullPath);
        const view = ctx.view();
        view.setBigUint64(outBuf, 0n, true);
        view.setBigUint64(outBuf + 8, 0n, true);
        view.setUint8(
          outBuf + 16,
          st.isDirectory
            ? FILETYPE_DIRECTORY
            : st.isFile
              ? FILETYPE_REGULAR_FILE
              : FILETYPE_UNKNOWN,
        );
        view.setBigUint64(outBuf + 24, BigInt(st.size ?? 0), true);
        return E_SUCCESS;
      } catch (err) {
        return errToWasiErrno(err);
      }
    },
    path_create_directory: (fd: number, pathPtr: number, pathLen: number) => {
      const base = ctx.fds.get(fd);
      if (!base || base.type !== 'dir' || !base.path) return E_BADF;
      const relative = dec.decode(ctx.bytes().subarray(pathPtr, pathPtr + pathLen));
      const fullPath = normalizePath(joinPath(base.path, relative));
      try {
        // Note: WASI `path_create_directory` does NOT imply `recursive: true`.
        // We pass `recursive: false` so the backend can report `EEXIST` for
        // existing dirs (matching Node `mkdirSync` without `recursive`).
        syncMirror().mkdirSync(fullPath, { recursive: false });
        return E_SUCCESS;
      } catch (err) {
        return errToWasiErrno(err);
      }
    },
  };
}
