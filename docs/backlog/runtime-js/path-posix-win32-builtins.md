---
area: runtime-js
status: draft
title: Register `node:path/posix` and `node:path/win32` builtins
created: 2026-09-15
why: `import { join } from 'node:path/posix'` (@vitest/mocker) fails with "Built-in 'node:path/posix' is not implemented" although `path.posix`/`path.win32` already exist
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/builtins/index.ts, packages/runtime-js/src/builtins/path.ts]
---

## Context

`builtins/index.ts` registers `path` only; `path.ts` exports `posix` and
`win32` (`win32 === posix`, POSIX-only posture). Node: `require('path/posix')
=== require('path').posix`. Other subpath builtins (`fs/promises`,
`util/types`, `timers/promises`) already follow this pattern.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)
