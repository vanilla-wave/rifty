# Changelog

## [Unreleased]

### Added

- **Node `wasi` shape for Vite 8/Rolldown:** `Wasi` now exposes `wasiImport`,
  `getImportObject()`, and `initialize(instance)` aliases matching Node's
  `node:wasi` contract while preserving the existing preview1 syscall surface.
  Node-style `options.version` validation is enforced by runtime-js's
  `node:wasi.WASI` wrapper; this package's `Wasi` class remains the low-level
  runner used by `runWasi`.

### Fixed

- **PR #76 review gap recorded explicitly.** Added a backlog contract and
  `TODO(backlog:)` seam for the playground dev esbuild bridge to preserve
  successful transform warnings instead of throwing on non-empty stderr.

- **Vite 8 browser boot — two WASI faithfulness fixes.** (a) `worker-entry`'s
  top-level guest-run is gated on the kernel having published a *wasi-guest* spec
  (one carrying the WASM-URL key), not merely "in a worker"; the gate is the
  extracted, unit-tested `runWasiGuestEntryIfActive()`. Root cause now removed
  structurally: the channel env keys moved to a side-effect-free
  `wasi-channel-env.ts`, `process-handle` reads them from there, and the package
  index no longer re-exports the side-effectful `worker-entry`. So `node:wasi`
  (imports only `Wasi` from the index) no longer drags `worker-entry`'s top-level
  guest-run into EVERY runtime-js worker's static graph, where its unguarded
  `buildWasiProcess()` threw `KernelProcessSpec is missing` and crashed the host
  worker on boot — hanging the playground at `$ vite`. `worker-entry` /
  `runWasiInWorker` are reachable only via the `@riftydev/runtime-wasi/worker-entry`
  subpath now (a public-surface trim of the index — env keys stay). (b) `random_get` fills a private buffer then
  copies into wasm memory: `crypto.getRandomValues` REJECTS a SharedArrayBuffer-
  backed view (threaded wasm memory, e.g. Rolldown's emnapi pthread build), and
  it chunks by 65536 (the per-call cap).

- **PR #21 review fixes (preview1 contract).** (a) Rights violations now return
  the spec errno `E_NOTCAPABLE` (76), not `E_PERM` — fd_read/fd_write/fd_seek/
  fd_pread/fd_pwrite/fd_filestat_set_size. (b) `fd_pread`/`fd_pwrite`
  additionally require `RIGHTS_FD_SEEK` per spec. (c) `fd_write` on a directory
  fd returns `E_ISDIR`, on stdin `E_BADF` (was: silent fake success counting
  bytes). (d) `RIGHTS_DIR_BASE` had `path_remove_directory`/`path_unlink_file`
  at bits 28/29 (= sock_shutdown/sock_accept); corrected to spec bits 25/26.
  (e) `fd_pread`/`fd_pwrite` iovecs outside guest memory return `E_FAULT`
  instead of throwing a host `RangeError` through the trap path. Guards:
  `syscalls/fd.test.ts`; `docs/public/compat/wasi.md` rows updated.

### Added

- **ADR-0172 — side-effect-free `./wasi` subpath.** `@riftydev/runtime-wasi/wasi`
  exposes `Wasi` / `WasiExit` / `runWasi` without evaluating the kernel
  `worker-entry` auto-run module, so browser Worker hosts can run vendored WASI
  tools directly.

- **M11 fd-based fs slice** — implemented local preview1
  `fd_pread`, `fd_pwrite`, and `fd_filestat_set_size` over `FileDescriptor.data`.
  Positional read/write leave `cursor` unchanged; `fd_read`/`fd_pread` enforce
  `RIGHTS_FD_READ`, `fd_write`/`fd_pwrite` enforce `RIGHTS_FD_WRITE`, and
  `fd_filestat_set_size` enforces `RIGHTS_FD_FILESTAT_SET_SIZE`. Append-mode
  `fd_write` extends from EOF, `fd_seek` enforces `RIGHTS_FD_SEEK`, and
  `fd_fdstat_get` reports the descriptor's granted rights. `fd_filestat_set_size`
  shrinks or grows with zero fill and writes through to the mirror, and invalid
  negative/unsafe offsets or sizes return `E_INVAL`; unknown/non-file fds return
  `E_BADF`.

- **ADR-0049 — WASI working-directory + directory-open semantics (promotes
  Q-2026-05-27-003).** Forced by running the real esbuild WASI binary
  (`@esbuild/wasi-preview1`, restored by ADR-0047) through `runWasi`:
  - `WasiOptions.cwd?: string` (Option A) — names the preopen that serves as
    the relative-path resolution default; it is hoisted to fd 3. Omitting it
    keeps the insertion-order default (backward-compatible). `WasiCtx.cwdFd`
    added.
  - `AT_FDCWD` (`-1` / `0xffffffff`) base-fd resolution via `resolveDirFd`;
    `path_open` and the `dirBase`-based path syscalls honour it.
  - `path_open` opens directories — a directory target (or `O_DIRECTORY`)
    yields a `dir` fd (esbuild opens its cwd via `path_open(".")`). Previously
    returned `E_ISDIR`.
  - `fd_readdir` returns `E_NOTDIR` (not `E_BADF`) on a valid non-directory fd
    so Go/WASIp1 guests treat it as "file" rather than a hard error.
  - `fd_read` on fd 0 is wired to `WasiOptions.stdin` (was always EOF) — the
    surface esbuild's `transform` (Vite's TS/JSX path) reads from. Residual
    buffering for chunked delivery; `null` is EOF.

### Changed

- **ADR-0041 — `fd_readdir` now writes a real `d_type`.** Each preview1 dirent emits `FILETYPE_REGULAR_FILE` / `FILETYPE_DIRECTORY` based on the `VfsDirent` shape from `FsSync.readdirSync`; guests like esbuild no longer need to re-stat every entry to distinguish files from subdirs. Closes the "fill `d_type`" follow-up (`docs/follow-ups-2026-05-27.md` item #10).


- **ADR-0039 — worker-entry reads `KernelProcessSpec`, not `globalThis.process`.**
  The kernel-side worker bootstrap no longer installs a Node-shape `process`
  global. `worker-entry.ts` now builds its own minimal `WasiProcess`
  (argv/env/cwd/stdout/stderr/exit) from the kernel-published
  `KernelProcessSpec` via `readKernelProcessSpec()`. Same WASI behaviour
  end-to-end — the underlying stdio `MessagePort`s and the
  `RIFTY_PROCESS_EXIT` exit-code propagation are unchanged. No effect on
  `Wasi` / `runWasi` / `createWasiProcess` / `runWasiInWorker` public APIs;
  the `runWasiInWorker(proc)` test surface still takes a structural
  `WasiProcess` shim so unit tests are unaffected.

### Added

- **2026-05-26** — `createWasiProcess(opts)` (ADR 0038): kernel-level
  adapter that turns a WASI run into a `ProcessHandle`. Spawns the guest
  via `@riftydev/kernel.globalProcessManager.spawnWorker(...)` so a WASI
  guest gets the same PID space, binary stdio `MessagePort`s, and exit
  lifecycle as a `node`-backed worker child. Companion module
  `worker-entry.ts` exports `runWasiInWorker(process)` — the side-effect
  that runs inside the kernel-spawned Worker, fetching the WASM from
  `process.env.__RIFTY_WASI_WASM_URL` and piping the guest's stdout /
  stderr through the kernel's `process.stdout.write` / `stderr.write`
  shim. Existing `Wasi` / `runWasi` API unchanged — they stay as the
  same-realm syscall-test surface.
- **2026-05-26** — New dependency `@riftydev/kernel` (downward edge per
  CLAUDE.md layer order: vfs → kernel → runtime-* → …).
- WASI preview1 shim (`Wasi` class). Implements: args_*, environ_*, fd_read, fd_write, fd_close, fd_seek, fd_fdstat_get, path_open, path_filestat_get, path_create_directory, proc_exit, clock_time_get, random_get. Missing calls return `ENOSYS` instead of silently no-oping.
- `runWasi(bytes, opts)` convenience helper that instantiates a module and runs `_start`.
- Preopens are routed to `@riftydev/vfs`'s `syncMirror()` (ADR-0014) — `fs` sees what WASI writes.
- **2026-05-25** — full preview1 import surface so real toolchains
  (`esbuild.wasm`, `tsc.wasm`, `swc.wasm`) don't fail at instantiate with
  `LinkError`. New implementations:
  - `fd_filestat_get` — routes to `syncMirror().statSync` for fd's path
  - `fd_readdir` — enumerates VFS directory entries
  - `fd_renumber`, `fd_fdstat_set_flags`, `fd_tell` — backed by the fd table
  - `path_unlink_file`, `path_remove_directory`, `path_rename` — route to VFS
  - `path_readlink`, `path_link`, `path_symlink`, `path_filestat_set_times`,
    `fd_filestat_set_times`, `fd_fdstat_set_rights`, `fd_allocate`,
    `proc_raise`, `sock_*`, `poll_oneoff` — honest `E_NOSYS` (still PRESENT as functions so
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
- **2026-05-25** — README corrected: VFS mirror lives in `@riftydev/vfs`
  (per ADR-0014), not `@riftydev/runtime-js` as previously claimed.

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
