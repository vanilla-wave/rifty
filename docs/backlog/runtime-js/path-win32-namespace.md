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

Owner runtime-js; trigger: now (standing Fidelity violation — AGENTS.md
§Fidelity: a placeholder that lies; no ADR or user decision admits the
alias, only the `path.ts` "POSIX only" comment), or the first consumer
reading Windows-path semantics or importing `path/win32`. Parity first:
the evidence probe above. Honest outcomes to decide at pickup: real win32
semantics (then `node:path/win32` registers), or a named
`NotImplementedError('path.win32')` when `path.win32` is accessed + compat
❌. Never register `node:path/win32` over the alias (extends the lie).
Probe before choosing the loud form: pre-bundled Vite deps link a `win32`
binding by name (ADR-0009 §Context), so a throw must not fire at link or
namespace build. Conformance `tests/conformance/builtins/path.test.ts`
pins today's ceiling.
