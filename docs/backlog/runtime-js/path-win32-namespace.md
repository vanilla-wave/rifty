---
area: runtime-js
status: draft
title: `path.win32` answers with POSIX semantics and `node:path/win32` is unregistered
created: 2026-09-23
why: `path.win32` is the `path.posix` alias (`sep` `/`, `join('a','b')` `a/b`; Node `\`, `a\b`) — a silent divergence tracked only by a code comment and traps.md `parity-win32-alias`; `node:path/win32` is not a builtin
sources: [docs/backlog/runtime-js/reference/path-posix-win32-builtins-evidence.md, docs/backlog/runtime-js/reference/path-posix-win32-builtins-final-green.json, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/path.ts, packages/runtime-js/src/builtins/index.ts]
---

## Context

REV-12 discovery from `runtime-js/path-posix-win32-builtins` (vitest-run-in-browser
I6 delivered `node:path/posix` only; win32 dropped — no claimed consumer).
Node v24.16.0 vs rifty @ `325ae797c` (evidence §Oracle — `path.win32`,
§Rifty baseline): `win32 === posix` false/true; `win32.sep` `\`/`/`;
`win32.join('a','b')` `a\b`/`a/b`; `require('node:path/win32')` the win32
object / `MODULE_NOT_FOUND` "Built-in 'node:path/win32' is not implemented";
`isBuiltin` true/false. Also owned here (same object graph): `path.posix`
lacks `_makeLong` and the `posix`/`win32` cross-references (Node
`posix.posix === posix`, `posix.win32 === win32`), and Node's
`require('path') === require('path').posix` (rifty: separate object).
Compat ❌ `docs/public/compat/modules.md` `node:path/win32` / `path.win32`.

## Next

Owner runtime-js; trigger: first real consumer reading Windows-path
semantics or importing `path/win32`. Until then the alias stays a loud-ish
compat ❌, never registered as `node:path/win32` (would extend the lie;
pinned by conformance `tests/conformance/builtins/path.test.ts` win32 ceiling).
