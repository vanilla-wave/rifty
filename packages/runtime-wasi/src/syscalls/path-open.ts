/**
 * `path_open` syscall. Resolves a relative path against the base-fd preopen,
 * loads the file into an in-memory cursor, and registers a new fd with the
 * granted-rights bitmask.
 *
 * Split from {@link ./path.ts} (ADR-0024 file-size budget).
 */
import { syncMirror } from '@rifty/vfs';
import { RIGHTS_FILE_BASE, errToWasiErrno, resolveRel } from './path-helpers.ts';
import {
  E_BADF,
  E_EXIST,
  E_NOENT,
  E_SUCCESS,
  OFLAGS_CREAT,
  OFLAGS_EXCL,
  OFLAGS_TRUNC,
  type WasiCtx,
} from './shared.ts';

export function pathOpenSyscall(
  ctx: WasiCtx,
): (
  fd: number,
  dirflags: number,
  pathPtr: number,
  pathLen: number,
  oflags: number,
  fsRightsBase: bigint,
  fsRightsInheriting: bigint,
  fdflags: number,
  outFd: number,
) => number {
  return (
    fd: number,
    _dirflags: number,
    pathPtr: number,
    pathLen: number,
    oflags: number,
    fsRightsBase: bigint,
    _fsRightsInheriting: bigint,
    fdflags: number,
    outFd: number,
  ) => {
    const base = ctx.fds.get(fd);
    if (!base || base.type !== 'dir' || !base.path) return E_BADF;
    const fullPath = resolveRel(ctx, base.path, pathPtr, pathLen);
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

    // WASI spec: passing zero rights means "do not restrict" — every real
    // toolchain (esbuild, tsc) does this. We mirror the rights the host can
    // actually grant in that case; for restricted opens we honour exactly
    // what the caller asked for. `fd_write` enforces RIGHTS_FD_WRITE later.
    const grantedRights = fsRightsBase === 0n ? RIGHTS_FILE_BASE : fsRightsBase;

    const newFd = ctx.nextFd.value++;
    ctx.fds.set(newFd, {
      type: 'file',
      path: fullPath,
      data,
      cursor: 0,
      fdflags,
      rights: grantedRights,
    });
    ctx.view().setUint32(outFd, newFd, true);
    return E_SUCCESS;
  };
}
