/**
 * Mutating path syscalls: `path_create_directory`, `path_unlink_file`,
 * `path_remove_directory`, `path_rename`, plus the link family stubs
 * (`path_link`, `path_readlink`, `path_symlink`).
 *
 * Split from {@link ./path.ts} (ADR-0024 file-size budget).
 *
 * Symlinks and hard links are intentionally not modelled in the VFS — the
 * link calls return `E_NOSYS` instead of pretending to succeed (per
 * CLAUDE.md "no silent stubs"). See `docs/compat/wasi.md`.
 */
import { syncMirror } from '@rifty/vfs';
import { dirBase, errToWasiErrno, resolveRel } from './path-helpers.ts';
import {
  E_ISDIR,
  E_NOENT,
  E_NOSYS,
  E_NOTDIR,
  E_NOTEMPTY,
  E_SUCCESS,
  type WasiCtx,
} from './shared.ts';

export function pathMutateSyscalls(ctx: WasiCtx): WebAssembly.ModuleImports {
  return {
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
        // Reject non-empty dirs with ENOTEMPTY rather than letting `rm` raise
        // a backend-specific EPERM (see MemoryBackend.rm which throws EPERM
        // when recursive=false on a non-empty dir).
        const entries = mirror.readdirSync(fullPath);
        if (entries.length > 0) return E_NOTEMPTY;
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
