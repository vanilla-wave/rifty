---
area: runtime-js
status: ready
title: Register `node:path/posix` and `node:path/win32` builtins
created: 2026-09-15
why: `import { join } from 'node:path/posix'` (@vitest/mocker) fails with "Built-in 'node:path/posix' is not implemented" although `path.posix`/`path.win32` already exist
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/path-posix-win32-builtins-evidence.md]
code: [packages/runtime-js/src/builtins/index.ts, packages/runtime-js/src/builtins/path.ts]
---

## Context

`builtins/index.ts` registers `path` only; `path.ts` exports `posix` and
`win32` (`win32 === posix`, POSIX-only posture). Node: `require('path/posix')
=== require('path').posix`. Other subpath builtins (`fs/promises`,
`util/types`, `timers/promises`) already follow this pattern.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## User scenario

The exact vitest tree imports `join` from `node:path/posix`; both path
subpaths load their existing `path` namespace through CJS/ESM (goal map item 2).

## Acceptance

- Bare and `node:`-prefixed `path/posix` and `path/win32` resolve to the
  existing `path.posix` / `path.win32` objects through require/import. → I6
- `import { join } from 'node:path/posix'` joins `a`, `b` as `a/b`. → I6

## Parity cases

- `path/subpaths-cjs.case.ts`: both subpaths/prefixes, CJS object identity,
  POSIX join. → I6
- `path/subpaths-esm.case.ts`: both subpaths/prefixes, ESM default identity,
  POSIX named join. → I6

## Decisions

- 2026-09-23 — RDY-8 observed import defect; real Node baseline and executed
  RED recorded in [evidence](reference/path-posix-win32-builtins-evidence.md).
- 2026-09-23 — registration reuses existing namespaces per goal map item 2;
  existing `win32 === posix` is a known Windows-semantics defect, neither
  repaired nor certified by these registration/identity cases.

## Out of scope

Windows path semantics: this item registers existing namespaces, as the
accepted map states. A green identity case does not certify `win32` methods.
