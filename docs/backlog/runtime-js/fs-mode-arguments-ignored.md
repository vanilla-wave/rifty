---
area: runtime-js
status: draft
title: The mode argument of writeFile, mkdir and open is ignored silently
created: 2026-11-24
why: Node creates the entry with `mode & ~umask`; rifty drops `mode` and reports 0o666/0o777, a silent divergence for any program that writes a private file (0o600) or checks modes.
sources: [docs/backlog/runtime-js/process-umask-missing.md, docs/backlog/runtime-js/fs-default-file-modes.md, docs/public/compat/fs.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-stats.ts]
---

## Context

Probe 2026-11-24 (PR #432 branch, isolate-host `runCode` vs `node -e`, Node v24.16.0, darwin,
umask 022): `fs.writeFileSync('f', 'x', { mode: 0o600 }); fs.mkdirSync('d', { mode: 0o700 });
fs.closeSync(fs.openSync('o', 'w', 0o640))`, then `statSync(p).mode & 0o777` →
Node `600 700 640`, rifty `666 777 666`. `openSync(p, flags, _mode)` drops it (`fs.ts:887`);
the VFS stores no modes (`fs-stats.ts` `VFS_UMASK`; compat isolate-host.md "FS snapshot … modes").
No throw, no compat fs.md row. `chmod`/`fchmod`/`lchmod` are absent members
(`runtime-js/node-builtins-loud-stub-capability-gaps`). Open: a loud refusal of a `mode` the VFS
cannot keep, or stored modes (the `fs-default-file-modes` fork widened to explicit modes).

Owner: runtime-js (fs) with vfs (metadata). Trigger: a package that writes a key/credential with
`mode: 0o600` or compares modes (fstream sets props and calls `chmod` when the stat differs).

## Challenge

challenge: 2026-11-24 — none (factual capture)
