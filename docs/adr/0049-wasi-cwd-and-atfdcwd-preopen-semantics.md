# ADR 0049: WASI `cwd` option + `AT_FDCWD` and directory-open semantics (promotes Q-2026-05-27-003)

Status: Accepted
Date: 2026-05-27

## Context

Q-2026-05-27-003 deferred the WASI preopens / working-directory API until a
real consumer ran through `runWasi` and exposed the constraints. ADR-0047
restored esbuild (`@esbuild/wasi-preview1`) as that consumer. Running it forced
the decision: esbuild's Go/WASIp1 runtime, even for a stdin transform,
canonicalises a working directory at startup and resolves paths against it.

`@rifty/runtime-wasi` previously:

- allocated preopen fds by `Object.keys(preopens)` iteration order, with no
  explicit `cwd` — "first preopen wins fd 3" was an implicit, undocumented
  contract (the original Q-2026-05-27-003 complaint);
- had no `AT_FDCWD` handling — a guest passing `-1` / `0xffffffff` as the base
  fd got `E_BADF`;
- could not open a **directory** via `path_open` — it always tried to read the
  target as a file, returning `E_ISDIR` for a directory;
- returned `E_BADF` (not `E_NOTDIR`) from `fd_readdir` on a non-directory fd;
- declared a `stdin` option that was never wired (`fd_read` on fd 0 always
  returned EOF).

The observed esbuild failure chain made the gaps concrete (traced through
`runWasi`):

1. `path_open(fd3, ".")` → our shim read `.` as a file → `E_ISDIR`. esbuild:
   *"Cannot read directory '.': Is a directory."*
2. After directory-open was added: `path_open(AT_FDCWD, "entry.ts")` →
   `E_BADF` (we didn't map `AT_FDCWD`). esbuild: *"Bad file number."*
3. After `AT_FDCWD` mapping: esbuild opened the file, then probed it with
   `fd_readdir`, got `E_BADF`. Go reads `E_BADF` as a hard error rather than
   "this is a file" (which is `E_NOTDIR`). esbuild: *"Cannot read directory
   'entry.ts': Bad file number."*
4. The stdin transform path (`esbuild --loader=ts` over stdin — Vite's actual
   transform surface) produced empty output because stdin was never wired.

This touches **public API** (`WasiOptions` / `runWasi` options shape) and
syscall behaviour several callers will depend on, so it is **IRREVERSIBLE** per
the checklist and gets its own ADR.

## Decision

### D1: `WasiOptions.cwd?: string` (Q-2026-05-27-003 Option A)

Add an optional `cwd` to `WasiOptions`: the guest path of the preopen that
serves as the relative-path resolution default. WASI preview1 has no
`getcwd`/`chdir`; a guest derives cwd from the preopen table, and esbuild
treats **fd 3** (the first preopen) as cwd. The `cwd` option makes that
explicit — the named preopen is hoisted to fd 3 regardless of its position in
the `preopens` record. When omitted, the first key in insertion order keeps
fd 3 (backward-compatible; no existing caller changes behaviour).

Option A was chosen over B (ordered array — breaks every caller for no benefit
esbuild needs) and C (array + explicit cwd — two concepts at every call site;
esbuild's cwd is always a whole preopen, never a subdirectory of one, so C's
extra expressiveness is unused).

`ctx.cwdFd` (readonly, value 3) is added to `WasiCtx` so path syscalls can map
`AT_FDCWD` to the cwd preopen.

### D2: `AT_FDCWD` resolution

WASI's `AT_FDCWD` sentinel (witx `i32` of `-1`, arriving in JS as `-1` or
`0xffffffff`) is mapped to `ctx.cwdFd` by a new `resolveDirFd(ctx, fd)` helper.
`path_open` and the `dirBase`-based path syscalls run their base fd through it.
A guest issuing `AT_FDCWD`-relative calls with no preopen gets `E_BADF` (honest
— there is no cwd to resolve against).

### D3: `path_open` opens directories

`path_open` now stats the target first: if it is a directory (or the guest set
`OFLAGS_DIRECTORY`), it returns a `dir`-type fd the guest can `fd_readdir` /
resolve children against, with rights clamped to the parent preopen's
inheriting set (downgrade-only handoff). Files keep the existing read/create/
truncate path. Real toolchains never combine `O_CREAT` with `O_DIRECTORY`, so a
missing directory is a plain `E_NOENT`.

### D4: `fd_readdir` returns `E_NOTDIR` for a valid non-directory fd

`fd_readdir` on a valid file fd returns `E_NOTDIR` (was `E_BADF`). Go's WASIp1
`os` layer reads `E_NOTDIR` as "it's a file, read it as one" and `E_BADF` as a
hard error; the old code made esbuild abort on every file entry point. An
unknown fd still returns `E_BADF`.

### D5: stdin is wired

`fd_read` on fd 0 pulls from a new `ctx.onStdin(): Uint8Array | null` callback
(fed by `WasiOptions.stdin`), keeping a residual buffer on the fd entry so a
chunk larger than the guest's iovec is delivered across reads. `null`/empty
with an empty residual is EOF. This is the surface Vite's TS/JSX transform uses
(esbuild `transform` reads source from stdin). The default remains immediate
EOF, so guests that don't read stdin are unaffected.

## Alternatives considered

- **Option B / C for the cwd shape** — rejected as above (B breaks callers; C
  unused expressiveness).
- **Infer cwd purely from object key order (status quo, no `cwd` option).**
  Rejected — that *is* the implicit contract Q-2026-05-27-003 flagged; an
  explicit option is the whole point.
- **Open directories only when `O_DIRECTORY` is set.** Rejected: esbuild opens
  `.` with `oflags=0` and expects a directory fd back; gating on `O_DIRECTORY`
  alone would not fix the observed failure. We stat and decide.

## Trade-offs

- `path_open` now does an extra `statSync` on the open path to classify
  file-vs-directory. One stat per open against the in-memory mirror; negligible.
- The stdin residual buffer reuses the `FileDescriptor.data`/`cursor` fields
  (same shape files use), so no new fd-table state type.

## Consequences

- `packages/runtime-wasi/src/wasi.ts`: `WasiOptions.cwd`, `onStdin`, `cwdFd`
  wiring, preopen fd-allocation sort.
- `packages/runtime-wasi/src/syscalls/shared.ts`: `AT_FDCWD` / `AT_FDCWD_U32`
  constants, `cwdFd` + `onStdin` on `WasiCtx`, `resolveDirFd`, `dirBase`
  honours `AT_FDCWD`.
- `packages/runtime-wasi/src/syscalls/path.ts`: directory-open in `path_open`,
  base fd via `resolveDirFd`.
- `packages/runtime-wasi/src/syscalls/fd.ts`: `fd_readdir` E_NOTDIR; `fd_read`
  stdin.
- New unit tests (path dir-open, `AT_FDCWD`, `fd_readdir` E_NOTDIR, stdin
  read); `docs/compat/wasi.md` updated for the three changed rows.
- `OPEN_QUESTIONS.md` Q-2026-05-27-003 → Promoted.

## References

- Q-2026-05-27-003 (WASI preopens / cwd API).
- ADR-0047 (restores esbuild as the forcing consumer — the reason this question
  could finally be resolved).
- ADR-0038 (`WasiProcessHandle`), ADR-0014 (shared VFS mirror).
- WASI preview1 spec (witx) — `path_open`, `fd_readdir`, `AT_FDCWD`.
