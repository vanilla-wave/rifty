---
area: runtime-js
status: ready
title: Register `node:path/posix` and `node:path/win32` builtins
created: 2026-09-15
why: `import { join } from 'node:path/posix'` (@vitest/mocker) fails with "Built-in 'node:path/posix' is not implemented" although `path.posix`/`path.win32` already exist
user_story: As a developer running vitest in the browser shell, I want @vitest/mocker's `node:path/posix` import to link, but today the subpath builtin is unregistered and the CLI dies at module load
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/builtins/index.ts, packages/runtime-js/src/builtins/path.ts]
---

## Context

`builtins/index.ts` registers `path` only; `path.ts` exports `posix` and
`win32` (`win32 === posix`, POSIX-only posture). Node: `require('path/posix')
=== require('path').posix`. Other subpath builtins (`fs/promises`,
`util/types`, `timers/promises`) already follow this pattern. The builtin
registry (`@riftydev/io/builtin-registry.ts`) strips the `node:` prefix and
caches one namespace per bare name, so both specifier forms return the same
object once registered.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. `require('node:path/posix') === require('node:path').posix`,
   `require('node:path/win32') === require('node:path').win32`, and bare
   `require('path/posix')` returns the same object (parity case with pinned
   expected output) → I6
2. ESM `import { join } from 'node:path/posix'` links and computes
   `join('a','b') === 'a/b'`; default imports of both subpaths return the
   live `path.posix` / `path.win32` namespaces (parity case) → I6

## Reference contract

- Oracle: Node v24.16.0 (host) — epic evidence §Oracle
  (`import { join } from 'node:path/posix'` → `a/b`).
- Mechanism: subpath registration in the existing builtin registry — the
  `fs/promises` / `util/types` pattern; no new resolution machinery.

## Parity cases

1. Node v24.16.0 CJS: subpath identity (`require('node:path/posix') ===
   require('node:path').posix`, win32 twin, bare form) and `posix.join`
   output — carrier `tools/node-parity-runner/cases/path/subpath-builtins-cjs.case.ts`
   with `expected` pinned from the oracle → I6
2. Node v24.16.0 ESM: `import { join } from 'node:path/posix'` +
   default-import identity for both subpaths — carrier
   `tools/node-parity-runner/cases/path/subpath-builtins-esm.case.ts` → I6

## Out of scope

- win32 path SEMANTICS (separators, drive letters): rifty's POSIX-only
  posture (`win32 === posix`) is unchanged and never parity-tested against
  real win32 output (traps.md parity-win32-alias).
- Other unregistered subpath builtins — untouched by this item.

## Decisions

- 2026-10-01 — carrier: two `registerBuiltin` calls (`path/posix`,
  `path/win32`) returning the existing namespaces; no resolver change (the
  registry already strips `node:` and caches per bare name).
