/**
 * Path-resolving WASI preview1 syscalls.
 *
 * All path-relative calls resolve against the base-fd preopen and consult
 * the shared sync VFS mirror (ADR-0014 — `@rifty/vfs` owns the mirror).
 *
 * Grouped by behaviour:
 *   - `path_open` — open/create a file, granting a (possibly restricted)
 *     rights bag on the returned fd. Rights are clamped against the parent
 *     dir fd's rights so capability handoff downgrades only.
 *   - `path_filestat_get`, `path_filestat_set_times` — stat family.
 *   - `path_create_directory`, `path_unlink_file`, `path_remove_directory`,
 *     `path_rename` — mutating ops.
 *   - `path_link`, `path_readlink`, `path_symlink` — symlink/hardlink stubs
 *     returning `E_NOSYS` (VFS has no link layer; per CLAUDE.md "no silent
 *     stubs" we surface this rather than pretending success).
 *
 * Re-exports {@link errToWasiErrno} for the test suite.
 */
import { syncMirror } from '@rifty/vfs';
import {
  E_BADF,
  E_EXIST,
  E_ISDIR,
  E_NOENT,
  E_NOSYS,
  E_NOTDIR,
  E_SUCCESS,
  FILETYPE_DIRECTORY,
  FILETYPE_REGULAR_FILE,
  FILETYPE_UNKNOWN,
  OFLAGS_CREAT,
  OFLAGS_EXCL,
  OFLAGS_TRUNC,
  RIGHTS_DIR_BASE,
  RIGHTS_FILE_BASE,
  type WasiCtx,
  dirBase,
  errToWasiErrno,
  resolveRel,
} from './shared.ts';

export { errToWasiErrno } from './shared.ts';

export function pathSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
    path_open: (
      fd: number,
      _dirflags: number,
      pathPtr: number,
      pathLen: number,
      oflags: number,
      fsRightsBase: bigint,
      fsRightsInheriting: bigint,
      fdflags: number,
      outFd: number,
    ) => {
      const base = ctx.fds.get(fd);
      if (!base || base.type !== 'dir' || !base.path) return E_BADF;
      // WASI preview1: rights granted on a fd opened via `path_open` are
      // clamped by the parent dir fd's `rights_inheriting` set, not by its
      // `rights` set (the parent's own rights authorise the act of opening;
      // the inheriting set decides what the *child* may hold). `undefined`
      // means "default-permissive" (preopens, stdio) — fall back to the same
      // set `fd_fdstat_get` reports for dir fds.
      const parentInheriting = base.rightsInheriting ?? RIGHTS_DIR_BASE | RIGHTS_FILE_BASE;
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
      // toolchain (esbuild, tsc) does this. We use the parent's inheriting
      // set as the upper bound (RIGHTS_FILE_BASE for default-permissive
      // preopens). For restricted opens we intersect with the parent's rights
      // so a child can never elevate above what its parent fd held. The same
      // clamp applies to `fsRightsInheriting` — see WASI preview1 spec, which
      // is explicit that both bitsets are upper-bounded by the parent fd's
      // capabilities.
      const requestedBase = fsRightsBase === 0n ? RIGHTS_FILE_BASE : fsRightsBase;
      const grantedRights = requestedBase & parentInheriting;
      const requestedInheriting = fsRightsInheriting === 0n ? RIGHTS_FILE_BASE : fsRightsInheriting;
      const grantedInheriting = requestedInheriting & parentInheriting;

      const newFd = ctx.nextFd.value++;
      ctx.fds.set(newFd, {
        type: 'file',
        path: fullPath,
        data,
        cursor: 0,
        fdflags,
        rights: grantedRights,
        rightsInheriting: grantedInheriting,
      });
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
    path_create_directory: (fd: number, pathPtr: number, pathLen: number) => {
      const base = dirBase(ctx, fd);
      if (!base.ok) return base.rc;
      const fullPath = resolveRel(ctx, base.path, pathPtr, pathLen);
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
    path_unlink_file: (fd: number, pathPtr: number, pathLen: number) => {
      const base = dirBase(ctx, fd);
      if (!base.ok) return base.rc;
      const fullPath = resolveRel(ctx, base.path, pathPtr, pathLen);
      const mirror = syncMirror();
      try {
        // Probe existence + type so error codes are deterministic regardless
        // of which backend (`MemoryFsSync`, `OpfsFsSync`) throws.
        if (!mirror.existsSync(fullPath)) return E_NOENT;
        const st = mirror.statSync(fullPath);
        if (st.isDirectory) return E_ISDIR;
        mirror.rmSync(fullPath, {});
        return E_SUCCESS;
      } catch (err) {
        return errToWasiErrno(err);
      }
    },
    path_remove_directory: (fd: number, pathPtr: number, pathLen: number) => {
      const base = dirBase(ctx, fd);
      if (!base.ok) return base.rc;
      const fullPath = resolveRel(ctx, base.path, pathPtr, pathLen);
      const mirror = syncMirror();
      try {
        if (!mirror.existsSync(fullPath)) return E_NOENT;
        const st = mirror.statSync(fullPath);
        if (!st.isDirectory) return E_NOTDIR;
        // Non-empty dirs raise `VfsError('ENOTEMPTY')` from the backend
        // (Node parity, ADR-0037 follow-up); `errToWasiErrno` maps that to
        // `E_NOTEMPTY` automatically — no hand-rolled probe needed.
        mirror.rmSync(fullPath, {});
        return E_SUCCESS;
      } catch (err) {
        return errToWasiErrno(err);
      }
    },
    path_rename: (
      oldFd: number,
      oldPtr: number,
      oldLen: number,
      newFd: number,
      newPtr: number,
      newLen: number,
    ) => {
      const oldBase = dirBase(ctx, oldFd);
      if (!oldBase.ok) return oldBase.rc;
      const newBase = dirBase(ctx, newFd);
      if (!newBase.ok) return newBase.rc;
      const src = resolveRel(ctx, oldBase.path, oldPtr, oldLen);
      const dst = resolveRel(ctx, newBase.path, newPtr, newLen);
      const mirror = syncMirror();
      try {
        // Read-then-write-then-delete. The sync VFS interface has no native
        // rename op (see fs-sync.ts); this mirrors `renameSync` in
        // runtime-js/builtins/fs.ts. Atomicity is not guaranteed — a
        // follow-up could add `FsSync.renameSync` if real workloads care.
        const data = mirror.readFileBytesSync(src);
        mirror.writeFileSync(dst, data);
        mirror.rmSync(src, {});
        return E_SUCCESS;
      } catch (err) {
        return errToWasiErrno(err);
      }
    },
    path_readlink: (
      _fd: number,
      _pathPtr: number,
      _pathLen: number,
      _bufPtr: number,
      _bufLen: number,
      _bufUsed: number,
    ) => {
      // VFS has no symlink layer (M12 follow-up). Returning E_NOSYS is the
      // honest signal — guests that branch on this (e.g. `readlink(2)`-using
      // Rust binaries) fall back to `stat`-only paths.
      return E_NOSYS;
    },
    path_link: (
      _oldFd: number,
      _oldDirflags: number,
      _oldPtr: number,
      _oldLen: number,
      _newFd: number,
      _newPtr: number,
      _newLen: number,
    ) => {
      // Hard links not modelled. See `path_readlink` rationale.
      return E_NOSYS;
    },
    path_symlink: (
      _oldPtr: number,
      _oldLen: number,
      _fd: number,
      _newPtr: number,
      _newLen: number,
    ) => E_NOSYS,
  };
}
