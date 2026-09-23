---
area: runtime-js
status: ready
title: Register the `node:path/posix` builtin as the existing POSIX path namespace
created: 2026-09-15
why: `import { join } from 'node:path/posix'` (@vitest/mocker) fails with "Built-in 'node:path/posix' is not implemented" although `path.posix` already exists
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/path-posix-win32-builtins-evidence.md]
code: [packages/runtime-js/src/builtins/index.ts, packages/runtime-js/src/builtins/path.ts]
---

## User scenario

Vitest 4.1.11 on Vite 8.0.16 imports `join` from `node:path/posix` while
loading `@vitest/mocker`. The same clean project in the goal must pass this
module load and continue to its next runtime wall. → I6

## Reference contract

Node v24.16.0: `require('node:path/posix') === require('node:path').posix`;
`require('path/posix')` shares that identity; static ESM named `join` links and
joins `a/b`; `module.isBuiltin('node:path/posix')` is true. Oracle and RED:
`reference/path-posix-win32-builtins-evidence.md`. The current
`path.win32 === path.posix` is not Node behavior
(`false` in Node) and cannot honestly back a `node:path/win32` registration.

## Acceptance

1. `node:path/posix` and bare `path/posix` resolve to the current `path.posix`
   object by identity for CJS `require`, and `module.isBuiltin` recognizes the
   subpath. → I6
2. Static ESM `import { join } from 'node:path/posix'` links; its default
   export is `path.posix`, and `join('a', 'b')` returns `a/b`. → I6

## Parity cases

1. Node 24.16.0 and rifty run the same CJS alias/identity/`isBuiltin` case.
   RED is the missing `path/posix` registry entry. → I6
2. Node 24.16.0 and rifty run the same static ESM named/default import case.
   RED is the missing `node:path/posix` registry entry. → I6

## Out of scope

- `node:path/win32` remains a loud `MODULE_NOT_FOUND` until Windows path
  semantics are real. The existing `path.win32` POSIX alias is a separate
  baseline defect; registering it here would expose wrong Windows results.

## Decisions

- ready-verdict: 2026-09-23 — Contract+RED @ 08227d2c84e8d4ed52853d1546daab0a4a5ff7ab
- re-cut: 2026-09-23 — dropped `node:path/win32` registration: no claimed Vitest path needs it; existing namespace is a POSIX alias, not Node win32 — trace: none

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)
