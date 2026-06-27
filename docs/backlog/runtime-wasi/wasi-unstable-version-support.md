---
area: runtime-wasi
status: draft
title: node:wasi WASI({version:'unstable'}) — snapshot0 namespace + ABI (currently loud NotImplementedError)
created: 2026-06-21
why: Node accepts `new WASI({version:'unstable'})` (snapshot0), exposing imports under the `wasi_unstable` namespace with a slightly different syscall ABI from preview1 (`wasi_snapshot_preview1`). rifty's runner only builds the preview1 namespace, so accepting 'unstable' would silently mis-link the guest. The Node-facing `node:wasi` builtin currently throws a loud `NotImplementedError('wasi.WASI.version:unstable')` instead of flattening — honest, but a real Node version value rifty does not yet support.
user_story: As a dev whose WASI guest is linked against the older `wasi_unstable` (snapshot0) namespace, I want `new WASI({version:'unstable'})` to provide that namespace like Node, but today rifty implements preview1 only and loud-throws NotImplementedError.
sources: [packages/runtime-js/src/builtins/wasi.ts, packages/runtime-wasi/src/wasi.ts, docs/public/compat/wasi.md]
code: [packages/runtime-wasi/src/wasi.ts]
---

## Context

`Wasi` (runtime-wasi) always builds `imports.wasi_snapshot_preview1` and ignores
`opts.version`. The `node:wasi` `WASI` wrapper validates `version` like Node
(`ERR_INVALID_ARG_TYPE` / `ERR_INVALID_ARG_VALUE`) but converts `'unstable'` into
a loud `NotImplementedError` rather than silently serving preview1 under the wrong
namespace (a mis-link the guest can't see). `'unstable'` (snapshot0 / `wasi_unstable`)
differs from preview1 (snapshot1) in the namespace key AND a few syscall layouts
(`fd_seek`, `fd_filestat_get`, `path_filestat_get`, `fd_pread`/`fd_pwrite`), so it is
NOT a pure namespace rename.

## Options or Next

Implement a snapshot0 import set under `wasi_unstable` when `version === 'unstable'`
(the differing syscalls re-shaped for snapshot0; the rest aliased from preview1),
selected by the runner from `opts.version`. Gate behind a guest that actually needs
it — rifty's forcing consumers (esbuild / sqlite / Rolldown) are all preview1, so
this is unscheduled until a real unstable-linked guest appears.

## Reversibility

REVERSIBLE — additive namespace + syscall variants behind the existing `version`
option; no public-API removal. The current behavior is an honest loud gap
(NotImplementedError + compat note in `docs/public/compat/wasi.md`), not a silent
stub, so shipping the gap needs no ADR.
