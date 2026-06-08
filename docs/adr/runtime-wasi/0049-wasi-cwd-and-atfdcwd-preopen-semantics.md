# ADR 0049: WASI `cwd` option + `AT_FDCWD` and directory-open semantics (promotes Q-2026-05-27-003)

Status: Accepted
Date: 2026-05-27

> TL;DR: `WasiOptions.cwd` hoists a preopen to fd 3; `AT_FDCWD` resolves to it; `path_open` opens dirs, `fd_readdir` returns `E_NOTDIR`, stdin wired

## Context

Q-2026-05-27-003 deferred the WASI preopens / cwd API until a real consumer hit the constraints. ADR-0047 restored esbuild (`@esbuild/wasi-preview1`) as that consumer. esbuild's Go/WASIp1 runtime canonicalises a working directory at startup and resolves paths against it, forcing the decision.

Prior `@riftydev/runtime-wasi` gaps:

- preopen fds allocated by `Object.keys(preopens)` order, no explicit `cwd` — "first preopen wins fd 3" was the implicit, undocumented contract Q-2026-05-27-003 flagged;
- no `AT_FDCWD`: a guest base fd of `-1` / `0xffffffff` got `E_BADF`;
- `path_open` couldn't open a **directory** — always read the target as a file → `E_ISDIR`;
- `fd_readdir` on a non-dir fd returned `E_BADF`, not `E_NOTDIR`;
- `stdin` option declared but unwired (`fd_read` on fd 0 always EOF).

Observed esbuild failure chain (traced through `runWasi`):

1. `path_open(fd3, ".")` read `.` as a file → `E_ISDIR`. esbuild: *"Cannot read directory '.': Is a directory."*
2. After dir-open: `path_open(AT_FDCWD, "entry.ts")` → `E_BADF` (no `AT_FDCWD` map). esbuild: *"Bad file number."*
3. After `AT_FDCWD`: esbuild probed the opened file with `fd_readdir`, got `E_BADF`; Go treats `E_BADF` as hard error (vs `E_NOTDIR` = "it's a file"). esbuild: *"Cannot read directory 'entry.ts': Bad file number."*
4. stdin transform (`esbuild --loader=ts` over stdin — Vite's actual transform surface) produced empty output: stdin unwired.

Touches **public API** (`WasiOptions` / `runWasi` shape) and syscall behaviour several callers depend on → **IRREVERSIBLE**, own ADR.

## Decision

### D1: `WasiOptions.cwd?: string` (Q-2026-05-27-003 Option A)

Optional `cwd` = guest path of the preopen used as the relative-path default. WASIp1 has no `getcwd`/`chdir`; a guest derives cwd from the preopen table, and esbuild treats **fd 3** (first preopen) as cwd. `cwd` hoists the named preopen to fd 3 regardless of position. Omitted → first insertion-order key keeps fd 3 (backward-compatible).

Chosen over **B** (ordered array — breaks every caller, no benefit esbuild needs) and **C** (array + explicit cwd — two concepts per call site; esbuild's cwd is always a whole preopen, never a subdir, so C's expressiveness is unused).

`ctx.cwdFd` (readonly, value 3) added to `WasiCtx` so path syscalls map `AT_FDCWD` to the cwd preopen.

### D2: `AT_FDCWD` resolution

`AT_FDCWD` sentinel (witx `i32` `-1`, arriving in JS as `-1` or `0xffffffff`) maps to `ctx.cwdFd` via new `resolveDirFd(ctx, fd)`. `path_open` and `dirBase`-based path syscalls run their base fd through it. `AT_FDCWD`-relative calls with no preopen → `E_BADF` (honest: no cwd to resolve against).

### D3: `path_open` opens directories

`path_open` now stats the target first: directory (or guest set `OFLAGS_DIRECTORY`) → returns a `dir`-type fd for `fd_readdir` / child resolution, rights clamped to the parent preopen's inheriting set (downgrade-only). Files keep the existing read/create/truncate path. Real toolchains never combine `O_CREAT` with `O_DIRECTORY`, so a missing dir is plain `E_NOENT`.

### D4: `fd_readdir` returns `E_NOTDIR` for a valid non-directory fd

`fd_readdir` on a valid file fd → `E_NOTDIR` (was `E_BADF`). Go's WASIp1 `os` reads `E_NOTDIR` as "it's a file" and `E_BADF` as a hard error; the old code made esbuild abort on every file entry point. Unknown fd still → `E_BADF`.

### D5: stdin is wired

`fd_read` on fd 0 pulls from new `ctx.onStdin(): Uint8Array | null` (fed by `WasiOptions.stdin`), keeping a residual buffer on the fd entry so a chunk larger than the guest's iovec spans reads. `null`/empty with empty residual = EOF. This is the surface Vite's TS/JSX transform uses (esbuild `transform` reads source from stdin). Default stays immediate EOF — guests that don't read stdin unaffected.

## Alternatives considered

- **Option B / C for the cwd shape** — rejected as above (B breaks callers; C unused expressiveness).
- **Infer cwd from object key order (status quo, no `cwd` option).** Rejected — that *is* the implicit contract Q-2026-05-27-003 flagged; explicit is the point.
- **Open directories only when `O_DIRECTORY` is set.** Rejected: esbuild opens `.` with `oflags=0` and expects a dir fd; gating on `O_DIRECTORY` alone wouldn't fix the failure. We stat and decide.

## Trade-offs

- `path_open` does one extra `statSync` per open to classify file-vs-dir, against the in-memory mirror; negligible.
- The stdin residual buffer reuses `FileDescriptor.data`/`cursor` (same shape files use), so no new fd-table state type.

## Consequences

- `packages/runtime-wasi/src/wasi.ts`: `WasiOptions.cwd`, `onStdin`, `cwdFd` wiring, preopen fd-allocation sort.
- `packages/runtime-wasi/src/syscalls/shared.ts`: `AT_FDCWD` / `AT_FDCWD_U32` constants, `cwdFd` + `onStdin` on `WasiCtx`, `resolveDirFd`, `dirBase` honours `AT_FDCWD`.
- `packages/runtime-wasi/src/syscalls/path.ts`: directory-open in `path_open`, base fd via `resolveDirFd`.
- `packages/runtime-wasi/src/syscalls/fd.ts`: `fd_readdir` E_NOTDIR; `fd_read` stdin.
- New unit tests (path dir-open, `AT_FDCWD`, `fd_readdir` E_NOTDIR, stdin read); `docs/compat/wasi.md` updated for the three changed rows.
- `OPEN_QUESTIONS.md` Q-2026-05-27-003 → Promoted.

## References

- Q-2026-05-27-003 (WASI preopens / cwd API).
- ADR-0047 (restores esbuild as the forcing consumer).
- ADR-0038 (`WasiProcessHandle`), ADR-0014 (shared VFS mirror).
- WASI preview1 spec (witx) — `path_open`, `fd_readdir`, `AT_FDCWD`.
