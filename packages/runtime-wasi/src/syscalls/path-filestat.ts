/**
 * Stat-family path syscalls: `path_filestat_get` and the not-implemented
 * `path_filestat_set_times`. Split from {@link ./path.ts} (ADR-0024).
 */
import { syncMirror } from '@rifty/vfs';
import { dirBase, errToWasiErrno, resolveRel } from './path-helpers.ts';
import {
  E_NOSYS,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  type WasiCtx,
} from './shared.ts';

export function pathFilestatSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    path_filestat_get: (
      fd: number,
      _flags: number,
      pathPtr: number,
      pathLen: number,
      outBuf: number,
    ) => {
      const base = dirBase(ctx, fd);
      if (!base.ok) return base.rc;
      const fullPath = resolveRel(ctx, base.path, pathPtr, pathLen);
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
    // VFS doesn't track atime/ctime; touching mtime through WASI is a
    // separate question (see Q-2026-05-25-touch-utimes in OPEN_QUESTIONS).
    // For now this is an honest E_NOSYS rather than a silent no-op.
    path_filestat_set_times: () => E_NOSYS,
  };
}
