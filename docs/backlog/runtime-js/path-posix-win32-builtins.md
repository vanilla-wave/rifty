---
area: runtime-js
status: ready
title: Register `node:path/posix` and `node:path/win32` builtins
created: 2026-09-15
why: `import { join } from 'node:path/posix'` (@vitest/mocker) fails with "Built-in 'node:path/posix' is not implemented" although `path.posix`/`path.win32` already exist
user_story: As a developer running a real Node CLI in the browser shell, I want `import { join } from 'node:path/posix'` to resolve like on my machine, but today the loader throws "Built-in 'node:path/posix' is not implemented"
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/builtins/index.ts, packages/runtime-js/src/builtins/path.ts]
ready-verdict: 2026-10-02 — Contract+RED @ <pending>
---

## User scenario

Goal I6 first wall: `@vitest/mocker/dist/node.js` does
`import { join } from 'node:path/posix'` (evidence §I6); today it throws
`ModuleLoadError: Built-in 'node:path/posix' is not implemented` (main
51440931a).

## Context

`builtins/index.ts` registers `path` only; `path.ts` exports `posix` and
`win32` (`win32 === posix`, POSIX-only posture). Node: `require('path/posix')
=== require('path').posix`. Other subpath builtins (`fs/promises`,
`util/types`, `timers/promises`) already follow this pattern.

## Acceptance

1. `import { join } from 'node:path/posix'` resolves and `join('a','b') === 'a/b'`;
   the module is `===` to `require('path').posix` (`→ I6`, Node: same object).
2. `node:path/win32` registered the same way (`win32 === posix` posture kept,
   `→ I6`).
3. `require('path/posix') === require('path').posix` and the named-export
   surface (join/resolve/…/sep/delimiter) matches the existing `path` module
   (`→ I6`).

## Parity cases

Real Node v24.16.0: `import { join } from 'node:path/posix'` → `'a/b'`;
`require('path/posix') === require('path').posix` → `true`. RED target: the
parity case `path/subpath-posix-win32` fails today on the rifty side with
"Built-in 'node:path/posix' is not implemented".

## Out of scope

- Other unregistered subpath builtins not on the claimed path stay loud.
- win32 path semantics — pet project is POSIX-only; `win32 === posix` stays.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| absent builtin | `import 'node:path/foo'` (unregistered subpath) | loud `ModuleLoadError: Built-in 'node:path/foo' is not implemented` (unchanged) |

## Decisions

- ready-verdict: 2026-10-02 — Contract+RED @ <pending>
- 2026-10-02 — agent (PICKUP): registration-only unit; the `posix`/`win32`
  namespaces already exist in `path.ts` and are the single carrier (ADR-0035
  registry). No new mechanism.