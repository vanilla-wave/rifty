---
area: runtime-js
status: draft
title: New files and directories report mode 100666/40777 where Node under the default umask reports 100644/40755
created: 2026-11-23
why: Found by the external review of the isolate sandbox (PR #419); a program that checks or copies modes sees other bits than under Node.
sources: [PR-419-external-review]
code: [packages/vfs/src/memory-backend.ts, packages/runtime-js/src/builtins/fs-stats.ts]
---

## Context

Probe 2026-11-23, Node v24.16.0 (darwin, umask 022) vs a sandbox `exec` on this
branch: `fs.writeFileSync('f','x'); fs.mkdirSync('d')`, then
`fs.statSync(…).mode.toString(8)` → Node `100644` / `40755`, rifty `100666` /
`40777`. rifty's VFS has no modes (ADR-0050 family; compat `isolate-host.md`
"FS snapshot: … modes"), so the fixed values are rifty's; Node's come from
0o666/0o777 under umask 022. Whether to report Node's default-umask result is
the open question (`process.umask()` would have to agree).

## Challenge

challenge: 2026-11-23 — none yet (factual capture)
