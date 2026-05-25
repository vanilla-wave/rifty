# Compatibility matrix — WASI preview1

Status of `wasi_snapshot_preview1` import surface in `@rifty/runtime-wasi`.

Every canonical preview1 syscall is **present** as a function in the imports
table — even when not implemented — so `WebAssembly.instantiate` never fails
with a `LinkError` for a real toolchain (`esbuild.wasm`, `tsc.wasm`,
`swc.wasm`). Unsupported calls return `E_NOSYS` (52). The link-surface
guarantee is enforced by `packages/runtime-wasi/src/syscalls/wasi-link.test.ts`.

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not
implemented — call returns `E_NOSYS` and behaviour is documented.

| Syscall | Status | Notes |
|---|---|---|
| `args_get` | ✅ | Reads from `WasiOptions.args` |
| `args_sizes_get` | ✅ | |
| `environ_get` | ✅ | Reads from `WasiOptions.env` |
| `environ_sizes_get` | ✅ | |
| `clock_res_get` | ⚠️ | Reports 1 µs for `REALTIME` / `MONOTONIC`; CPU-time clocks → `E_INVAL` |
| `clock_time_get` | ⚠️ | `REALTIME` ← `Date.now()`, `MONOTONIC` ← `performance.now()`; CPU-time clocks → `E_INVAL` (no honest equivalent in browser/Node) |
| `fd_advise` | ⚠️ | Returns `E_SUCCESS` (advisory hint; honest no-op) |
| `fd_allocate` | ❌ | `E_NOSYS` — meaningless for in-memory backend |
| `fd_close` | ✅ | stdio (fd ≤ 2) is a no-op; file/dir fds are removed |
| `fd_datasync` | ⚠️ | Returns `E_SUCCESS` — in-memory writes are immediately durable |
| `fd_fdstat_get` | ✅ | Reports filetype, fdflags, rights bag for files/dirs/stdio |
| `fd_fdstat_set_flags` | ✅ | Mutates fd's `fdflags` field |
| `fd_fdstat_set_rights` | ❌ | `E_NOSYS` — per-fd rights downgrade not modelled |
| `fd_filestat_get` | ✅ | Routes to `syncMirror().statSync` for fd's path; reports size + mtime (atime/ctime = 0) |
| `fd_filestat_set_size` | ❌ | `E_NOSYS` — truncate not exposed by `FsSync` |
| `fd_filestat_set_times` | ❌ | `E_NOSYS` — atime/mtime mutation pending (see Q-2026-05-25-touch-utimes) |
| `fd_pread` | ❌ | `E_NOSYS` — toolchains rarely use positional read |
| `fd_prestat_get` | ✅ | Reports preopen type + name length |
| `fd_prestat_dir_name` | ✅ | Copies preopen name into guest memory |
| `fd_pwrite` | ❌ | `E_NOSYS` — positional write not modelled |
| `fd_read` | ⚠️ | Reads from fd's in-memory data buffer; stdin returns EOF (not wired) |
| `fd_readdir` | ⚠️ | Enumerates VFS dir entries; `d_type` = `UNKNOWN` (would need per-entry stat); cookie is ignored — full re-emit on each call (guests that paginate large dirs will see duplicates) |
| `fd_renumber` | ✅ | Moves fd entry to a new id |
| `fd_seek` | ✅ | All three `whence` modes; negative result → `E_INVAL` |
| `fd_sync` | ⚠️ | `E_SUCCESS` — in-memory writes are immediately visible |
| `fd_tell` | ✅ | Returns current cursor |
| `fd_write` | ✅ | Writes through cursor + through `syncMirror()` for file fds; stdio routed to `onStdout` / `onStderr`. Enforces `RIGHTS_FD_WRITE` — returns `E_PERM` if absent. |
| `path_create_directory` | ✅ | Non-recursive; `EEXIST` mapped from VFS |
| `path_filestat_get` | ✅ | Reports filetype + size; atime/ctime/nlink = 0 |
| `path_filestat_set_times` | ❌ | `E_NOSYS` |
| `path_link` | ❌ | `E_NOSYS` — hard links not modelled by VFS |
| `path_open` | ⚠️ | Honours `oflags` (CREAT/EXCL/TRUNC) + `fs_rights_base` (zero = spec default-permissive; non-zero is stored and enforced by `fd_write` — `E_PERM` if `RIGHTS_FD_WRITE` absent). `fs_rights_inheriting` is stored on the new fd and intersected with the parent dir fd's inheriting set, so capability handoff is downgrade-only. `dirflags` is currently not enforced. |
| `path_readlink` | ❌ | `E_NOSYS` — VFS has no symlink layer (M12) |
| `path_remove_directory` | ✅ | `ENOTEMPTY` for non-empty dirs |
| `path_rename` | ⚠️ | Read-then-write-then-delete (non-atomic); same-dir or cross-preopen both work |
| `path_symlink` | ❌ | `E_NOSYS` — no symlinks |
| `path_unlink_file` | ✅ | `EISDIR` for directories; `ENOENT` for missing |
| `poll_oneoff` | ❌ | `E_NOSYS` — no in-browser equivalent for fd polling |
| `proc_exit` | ✅ | Throws `WasiExit`; `runWasi` surfaces the code |
| `proc_raise` | ❌ | `E_NOSYS` — no signal infrastructure |
| `random_get` | ✅ | `crypto.getRandomValues` (browser + Node ≥ 19) |
| `sched_yield` | ⚠️ | `E_SUCCESS` — JS has no preemptive scheduler to yield to |
| `sock_accept` | ❌ | `E_NOSYS` — no BSD sockets in browser |
| `sock_recv` | ❌ | `E_NOSYS` |
| `sock_send` | ❌ | `E_NOSYS` |
| `sock_shutdown` | ❌ | `E_NOSYS` |

## Summary

- **Implemented (✅):** 20 — `args_*` (2), `environ_*` (2), `fd_close`, `fd_fdstat_get`, `fd_fdstat_set_flags`, `fd_filestat_get`, `fd_prestat_*` (2), `fd_renumber`, `fd_seek`, `fd_tell`, `fd_write`, `path_create_directory`, `path_filestat_get`, `path_remove_directory`, `path_unlink_file`, `proc_exit`, `random_get`.
- **Partial / no-op (⚠️):** 10 — `clock_res_get`, `clock_time_get`, `fd_advise`, `fd_datasync`, `fd_read`, `fd_readdir`, `fd_sync`, `path_open`, `path_rename`, `sched_yield`.
- **Not implemented — honest `E_NOSYS` (❌):** 16 — `fd_allocate`, `fd_fdstat_set_rights`, `fd_filestat_set_size`, `fd_filestat_set_times`, `fd_pread`, `fd_pwrite`, `path_filestat_set_times`, `path_link`, `path_readlink`, `path_symlink`, `poll_oneoff`, `proc_raise`, `sock_*` (4).

## Notes

- The `wasi-link.test.ts` smoke test asserts every name above is a function
  in the `wasi_snapshot_preview1` namespace. New WASI revisions add syscalls;
  the test list must be kept in sync.
- `syncMirror()` is shared with `@rifty/runtime-js`'s `node:fs` layer per
  ADR-0014, so files written via `fs.writeFileSync` are visible to WASI
  guests and vice versa.
- Symlinks are intentionally absent from the VFS (M9 acceptance). Calls
  return `E_NOSYS` rather than synthesising fake link metadata; M12 will
  revisit when an actual use case appears.
