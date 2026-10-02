---
area: runtime-js
status: ready
title: Builtin static export names include prototype methods so `import { cwd } from 'node:process'` links
created: 2026-09-15
why: ESM link-time validation of a builtin uses `Object.keys(instance)`; `NodeProcess` methods (cwd, nextTick, hrtime, …) live on the prototype, so tinyexec's `import { cwd } from 'node:process'` fails with "does not provide an export named 'cwd'"
user_story: As a real npm package running in the browser shell, I want `import { cwd } from 'node:process'` to link like on my machine, but today the link fails with "The requested module 'node:process' does not provide an export named 'cwd'"
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/module-loader/cjs-interop-authority.ts, packages/runtime-js/src/builtins/process.ts]
ready-verdict: 2026-10-02 — Contract+RED @ <pending>
---

## User scenario

Goal I6: `tinyexec/dist/main.mjs` does `import { cwd } from 'node:process'`
(evidence §I6); today: `SyntaxError: The requested module 'node:process' does
not provide an export named 'cwd'` (main 51440931a).

## Context

`cjs-interop-authority.ts` `buildStaticNameNode`: `for (const name of
Object.keys(loadBuiltin(id)))`. In Node, `process.cwd` etc. are own
properties of the process object, so the ESM facade exposes them. rifty's
`process` builtin is a class instance; its methods are non-enumerable
prototype members and vanish from the static name set. Same shape risk for
any class-backed builtin. Runtime reads through the prototype already work.

## Acceptance

1. `import { cwd } from 'node:process'` links in ESM and `typeof cwd() === 'string'`;
   `nextTick` links the same way (`→ I6`).
2. A prototype method name binds the LIVE member: the hydrated namespace value
   of `cwd` is the same function the instance dispatches (`→ I6`).
3. Own static names keep working: `import { argv, env } from 'node:process'`
   (`→ scenario`, unchanged baseline).

## Parity cases

Real Node v24.16.0: `import { cwd, nextTick, chdir } from 'node:process'` →
`string function function` (host probe 2026-10-02). RED target:
`process/esm-named-prototype-methods.case.ts` — fails today on the rifty side
with the link-time SyntaxError.

## Out of scope

- CJS file modules — the cjs-module-lexer path is separate and untouched.
- Symbol-keyed export names — out of the named-export surface.
- `constructor` and internal-realm names stay out of the static set (Node's
  own-key surface does not export them either way on the claimed path).

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| absent member | `import { statfsSync } from 'node:fs'` (name still absent from the builtin) | loud link-time SyntaxError — carried by `runtime-js/absent-builtin-members-loud-throws` (→ I6) |

## Decisions

- ready-verdict: 2026-10-02 — Contract+RED @ <pending>
- 2026-10-02 — agent (PICKUP): single authority — the builtin branch of
  `cjs-interop-authority.buildStaticNameNode` collects instance keys plus
  prototype-chain own property names (excluding `Object.prototype` and
  `constructor`); hydration already resolves members through the prototype
  (`interop.ts` reads `outer[name]`), so no second mechanism is added.
- carrier note (goal): a computed key bound to a `Symbol` value is provably
  never `'Function'` — the guard-precision unit (`runtime-js/
  symbol-key-global-write-guard-precision`) owns that adjacent wall.