/**
 * Path-resolving syscalls: `path_open`, `path_filestat_get`,
 * `path_create_directory`. Each resolves a relative path against the base-fd
 * preopen and consults the shared sync VFS mirror.
 */
import { joinPath, normalizePath, syncMirror } from '@rifty/vfs';
import {
  E_BADF,
  E_NOENT,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  type WasiCtx,
  dec,
} from './shared.ts';

export function pathSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    path_open: (
      fd: number,
      _dirflags: number,
      pathPtr: number,
      pathLen: number,
      _oflags: number,
      _fsRightsBase: bigint,
      _fsRightsInheriting: bigint,
      _fdflags: number,
      outFd: number,
    ) => {
      const base = ctx.fds.get(fd);
      if (!base || base.type !== 'dir' || !base.path) return E_BADF;
      const relative = dec.decode(ctx.bytes().subarray(pathPtr, pathPtr + pathLen));
      const fullPath = normalizePath(joinPath(base.path, relative));
      let data: Uint8Array = new Uint8Array(0);
      try {
        data = syncMirror().readFileBytesSync(fullPath) as Uint8Array;
      } catch {
        // create-mode: empty data
      }
      const newFd = ctx.nextFd.value++;
      ctx.fds.set(newFd, { type: 'file', path: fullPath, data, cursor: 0 });
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
      } catch {
        return E_NOENT;
      }
    },
    path_create_directory: (fd: number, pathPtr: number, pathLen: number) => {
      const base = ctx.fds.get(fd);
      if (!base || base.type !== 'dir' || !base.path) return E_BADF;
      const relative = dec.decode(ctx.bytes().subarray(pathPtr, pathPtr + pathLen));
      const fullPath = normalizePath(joinPath(base.path, relative));
      try {
        syncMirror().mkdirSync(fullPath, { recursive: true });
        return E_SUCCESS;
      } catch {
        return E_NOENT;
      }
    },
  };
}
