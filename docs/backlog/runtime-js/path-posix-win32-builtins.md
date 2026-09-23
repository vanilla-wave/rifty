---
area: runtime-js
status: ready
title: Register the `node:path/posix` builtin as `require('node:path').posix`
created: 2026-09-15
why: `import { join } from 'node:path/posix'` (@vitest/mocker) fails with "Built-in 'node:path/posix' is not implemented" although `path.posix` already exists
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/path-posix-win32-builtins-evidence.md, ADR-0035]
code: [packages/runtime-js/src/builtins/index.ts, packages/runtime-js/src/builtins/path.ts]
---

## Context

`builtins/index.ts` registers `path` only; `path.ts` exports `posix` and
`win32` (`win32 === posix`, POSIX-only posture). Node: `require('path/posix')
=== require('path').posix`. Other subpath builtins (`fs/promises`,
`util/types`, `timers/promises`) already follow this pattern.
Claimed tree (vitest 4.1.11, vite 8.0.16, rolldown 1.0.3): the only
consumer is `@vitest/mocker/dist/node.js:7`; nothing imports `path/win32`
(evidence §Claimed tree scan).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Reference contract

- Oracle: Node v24.16.0 (npm 11.17.0): `node:path/posix` and bare
  `path/posix` are registered builtins whose export is the `path.posix`
  object itself (identity, not a copy); evidence §Oracle — `node:path/posix`.
- Mechanism: the ADR-0035 builtin registry — one `registerBuiltin` subpath
  line returning the existing `path.posix` object, as `fs/promises` /
  `util/types` do; ESM static names come from that object's own keys.

## Acceptance

1. An ESM module with `import { join } from 'node:path/posix'` (the `@vitest/mocker` line) links and `join('a','b')` is `a/b`; its default, namespace `default` and dynamic `import('node:path/posix')` are the `path.posix` object — parity `path/posix-subpath-import` → I6
2. CJS `require('node:path/posix')` and bare `require('path/posix')` return `require('node:path').posix` itself, and `node:module` reports `path/posix` as a builtin (`isBuiltin` both spellings, `builtinModules`) — parity `path/posix-subpath-require` → I6

## Parity cases

1. `tools/node-parity-runner/cases/path/posix-subpath-import.case.ts` (esm): `join a/b /y/z.js`, `default true`, `namespace true true`, `dynamic true true` (Node v24.16.0, evidence §RED) → I6
2. `tools/node-parity-runner/cases/path/posix-subpath-require.case.ts` (cjs, each probe isolated): `node:path/posix true`, `path/posix true`, `join a/b`, `isBuiltin true true`, `builtinModules true` (Node v24.16.0, evidence §RED) → I6

## Out of scope

- `node:path/win32`: stays unregistered — `require`/`import` throw the loader's
  `ModuleLoadError` `MODULE_NOT_FOUND` "Built-in 'node:path/win32' is not
  implemented" (bare `path/win32`: `MODULE_NOT_FOUND` package miss); pinned by
  `tests/conformance/builtins/path.test.ts` "node:path/win32 ceiling". Compat ❌.
- `path.win32` Windows semantics: the property keeps today's `win32 === posix`
  alias, untouched here (Decisions: discovery routed outside I6).
- `node:path/posix` members Node 24 has and `path.posix` lacks: `matchesGlob`
  (backlog `runtime-js/fs-glob-matchesglob-minimatch`), `_makeLong`, and the
  `posix` / `win32` cross-references; a named import of any of them is a
  link-time `SyntaxError`, as for `node:path` today.

## Decisions

- 2026-09-23 — scope: `path/posix` only; `node:path/win32` dropped from the draft — no invariant needs it (tree scan: never imported; vite's `path.win32.basename` runs only under `process.platform === 'win32'`), registering it onto the `win32 === posix` alias would extend that lie, a real win32 port is machinery I6 is deliverable without (`REV-7`).
- 2026-09-23 — discovery (`REV-12`, outside I6): `path.win32` silently answers with POSIX semantics (Node: `sep` `\`, `join('a','b')` `a\b`; evidence §Rifty baseline), tracked only by a code comment and traps.md `parity-win32-alias` — owed backlog capture `runtime-js/path-win32-namespace` (real `path.win32` + `node:path/win32` + `posix`/`win32` cross-refs); owner runtime-js; trigger: first Windows-path consumer.
- 2026-09-23 — no ADR: a registry line on ADR-0035 with Node-literal identity; `packages/runtime-js/CHANGELOG.md` + compat `modules.md` note at implementation.
