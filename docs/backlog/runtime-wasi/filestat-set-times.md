---
area: runtime-wasi
status: parked
title: fd_filestat_set_times / path_filestat_set_times — atime/mtime mutation (E_NOSYS)
created: 2026-06-08
why: both times-set syscalls return E_NOSYS; FsSync.utimes now exists (ADR-0029) so wiring is feasible, but no verified WASI guest need yet
sources: [docs/compat/wasi.md, Q-2026-05-25-touch-utimes (→ADR-0029)]
---
## Context
`fd_filestat_set_times` and `path_filestat_set_times` → `E_NOSYS` in `packages/runtime-wasi/src/syscalls/{fd,path}.ts`. atime/mtime mutation pending. Note: the sync VFS gained `FsSync.utimes` via ADR-0029 (touch/`fs.utimesSync` route through it; OPFS uses an in-memory mtime side-table), so the host primitive these syscalls need now exists — the WASI bridge to it is just not wired.
## Options / Next
Wire both syscalls through `syncMirror().utimes` (mirror the node:fs path): read the preview1 `atim`/`mtim` (+ `*_NOW`/`*_OMIT` fstflags) and call utimes. Add a conformance case. Parked: no esbuild/tsc/vite guest is known to call them; pick up if a real WASI guest needs timestamp mutation (or fold into the filestat family parity sweep).
## Reversibility
Reversible — single-syscall impl over the existing `FsSync.utimes` surface, no new public API, no cross-package change, no ADR contradiction (ADR-0049 documents these as E_NOSYS-by-current-scope). Gate: a verified guest need.
