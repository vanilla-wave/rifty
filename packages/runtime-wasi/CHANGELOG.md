# Changelog

## [Unreleased]

### Added

- **2026-05-26** — `createWasiProcess(opts)` (ADR 0038): kernel-level
  adapter that turns a WASI run into a `ProcessHandle`. Spawns the guest
  via `@rifty/kernel.globalProcessManager.spawnWorker(...)` so a WASI
  guest gets the same PID space, binary stdio `MessagePort`s, and exit
  lifecycle as a `node`-backed worker child. Companion module
  `worker-entry.ts` exports `runWasiInWorker(process)` — the side-effect
  that runs inside the kernel-spawned Worker, fetching the WASM from
  `process.env.__RIFTY_WASI_WASM_URL` and piping the guest's stdout /
  stderr through the kernel's `process.stdout.write` / `stderr.write`
  shim. Existing `Wasi` / `runWasi` API unchanged — they stay as the
  same-realm syscall-test surface.
- **2026-05-26** — New dependency `@rifty/kernel` (downward edge per
  CLAUDE.md layer order: vfs → kernel → runtime-* → …).
- WASI preview1 shim (`Wasi` class). Implements: args_*, environ_*, fd_read, fd_write, fd_close, fd_seek, fd_fdstat_get, path_open, path_filestat_get, path_create_directory, proc_exit, clock_time_get, random_get. Missing calls return `ENOSYS` instead of silently no-oping.
- `runWasi(bytes, opts)` convenience helper that instantiates a module and runs `_start`.
- Preopens are routed to `@rifty/vfs`'s `syncMirror()` (ADR-0014) — `fs` sees what WASI writes.
- **2026-05-25** — full preview1 import surface so real toolchains
  (`esbuild.wasm`, `tsc.wasm`, `swc.wasm`) don't fail at instantiate with
  `LinkError`. New implementations:
  - `fd_filestat_get` — routes to `syncMirror().statSync` for fd's path
  - `fd_readdir` — enumerates VFS directory entries
  - `fd_renumber`, `fd_fdstat_set_flags`, `fd_tell` — backed by the fd table
  - `path_unlink_file`, `path_remove_directory`, `path_rename` — route to VFS
  - `path_readlink`, `path_link`, `path_symlink`, `path_filestat_set_times`,
    `fd_filestat_set_size`, `fd_filestat_set_times`, `fd_fdstat_set_rights`,
    `fd_pread`, `fd_pwrite`, `fd_allocate`, `proc_raise`, `sock_*`,
    `poll_oneoff` — honest `E_NOSYS` (still PRESENT as functions so
    `WebAssembly.instantiate` doesn't `LinkError`)
  - `clock_res_get` — reports 1 µs resolution for REALTIME / MONOTONIC
  - `fd_advise`, `fd_datasync`, `fd_sync` — harmless successes (advisory or
    no-op-for-in-memory)
- **2026-05-25** — `path_open` now honours `fs_rights_base`. Zero rights
  mean "do not restrict" (WASI spec default — esbuild/tsc rely on this);
  any other value is stored on the fd entry and enforced by `fd_write`,
  which returns `E_PERM` if `RIGHTS_FD_WRITE` is absent.
- **2026-05-25** — new WASI compat matrix at `docs/compat/wasi.md`.

### Fixed

- `fd_readdir` honours the `cookie` argument per WASI preview1 — each entry
  emits `d_next = index + 1`, the call skips entries with `index < cookie`,
  so paginating guests see every entry exactly once instead of re-receiving
  the prefix on every call. Stable ordering of `readdirSync` is the implicit
  contract; today's backends (`MemoryFsSync`, `OpfsFsSync`) honour it.

### Changed

- **2026-05-25** — `errToWasiErrno` default now `E_INVAL` (was `E_NOENT`).
  The old default lied to guests — they assumed the parent dir was
  missing and emitted misleading messages. `EINVAL` is the honest catch-all
  for unmapped errors from the host VFS layer.
- **2026-05-25** — `path_remove_directory` now returns `E_NOTEMPTY` for
  non-empty directories (previously surfaced backend-specific `E_PERM`).
- `path_remove_directory` drops the manual `readdirSync` probe-for-empty
  workaround. The VFS backend (`MemoryBackend.rm`) now raises
  `VfsError('ENOTEMPTY')` directly, which `errToWasiErrno` maps to
  `E_NOTEMPTY` — one source of truth for the error code, no
  backend-specific patch in the syscall handler.
- **2026-05-25** — README corrected: VFS mirror lives in `@rifty/vfs`
  (per ADR-0014), not `@rifty/runtime-js` as previously claimed.

### Internal

- **2026-05-25** — `syscalls/path.ts` split into `path-open.ts`,
  `path-filestat.ts`, `path-mutate.ts`, `path-helpers.ts` per ADR-0024
  file-size budget. Test setup factored into `path-test-fixture.ts` so
  the test files split symmetrically.
- **2026-05-25** — `syscalls/fd.ts` split: auxiliary calls moved to
  `fd-extra.ts`; test setup factored into `fd-test-fixture.ts`.
- **2026-05-26** — `syscalls/` consolidated into 3 semantic buckets (`fd`,
  `path`, `proc`) after ADR-0024 retirement; rights bitsets and `errToWasiErrno`
  moved into `shared.ts`. `path_open` now clamps `fs_rights_base` and
  `fs_rights_inheriting` against the parent dir fd's inheriting set
  (downgrade-only capability handoff, per WASI preview1 spec).
