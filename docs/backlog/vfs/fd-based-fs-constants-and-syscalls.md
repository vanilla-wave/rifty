---
area: vfs
status: active
title: fd-based fs API + mkdtemp/opendir/truncate + richer fs/os constants (shared with WASI)
created: 2026-06-11
why: build tooling/test setup commonly use mkdtemp + the fd trio (open/read/write/close/fstat/ftruncate); they're absent, fs.constants lacks O_*/COPYFILE_*, and os.constants.signals/errno are empty — all browser-feasible infra, no curation
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0090, docs/backlog/runtime-wasi/unimplemented-syscalls-nosys.md]
code: [packages/vfs/src/fs-sync.ts, packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/os.ts]
---

## Context

ADR-0090 already landed `copyFileSync`/`cpSync`/`renameSync` (the cp/rename half of the original
finding). This item captures the remaining fs surface common in real build/test code: the fd-based
API (`openSync`/`open`/`read`/`write`/`close`/`fstat`/`ftruncate`/`fsync`), `mkdtemp`/`mkdtempSync`,
`opendir`/`Dir`, `truncate`; richer `fs.constants` (`O_*`, `COPYFILE_*` — today only
`F_OK`/`R_OK`/`W_OK`/`X_OK`) and `os.constants.signals`/`errno` (today empty objects → `undefined`
for `SIGTERM` etc.). Doing the fd surface once in `@riftydev/vfs` lifts both `node:fs` and WASI —
`fd_pread`/`fd_pwrite`/`fd_filestat_set_size` are `E_NOSYS` today (see
`docs/backlog/runtime-wasi/unimplemented-syscalls-nosys.md`). On the M11 "knock down high-frequency
runtime walls" theme.

## Options or Next

- Add an fd table + positional I/O to `FsSync` over OPFS sync-access-handles (mind concurrent
  handles; reuse the ADR-0090/ADR-0072 content-cache pattern); expose via `node:fs` AND WASI
  `fd_pread`/`fd_pwrite`/`fd_filestat_set_size`.
- Add `mkdtemp`/`mkdtempSync`, `opendir`/`Dir`, `truncate`.
- Populate `fs.constants` `O_*`/`COPYFILE_*` and `os.constants.signals`/`errno` (reversible-local).

## Reversibility

IRREVERSIBLE for the fd API — adds to the lower `vfs` package's cross-package surface (rule 1); needs
its own ADR, citing ADR-0090 as the cp/rename precedent. Constants enrichment is reversible-local.
Recorded here.
