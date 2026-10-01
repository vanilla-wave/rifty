---
area: runtime-js
status: ready
title: Builtin static export names include prototype methods so `import { cwd } from 'node:process'` links
created: 2026-09-15
why: ESM link-time validation of a builtin uses `Object.keys(instance)`; `NodeProcess` methods (cwd, nextTick, hrtime, …) live on the prototype, so tinyexec's `import { spawn } ... ; import { cwd } from 'node:process'` fails with "does not provide an export named 'cwd'"
user_story: As a developer running vitest in the browser shell, I want tinyexec's named `node:process` imports to link, but today the CLI dies at module load because the static name set misses prototype methods
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/module-loader/cjs-interop-authority.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

`cjs-interop-authority.ts` `buildStaticNameNode` builtin branch:
`for (const name of Object.keys(loadBuiltin(id)))`. That set is the single
authority for BOTH ESM link validation and the builtin namespace object
(`knownNames` → `cjsNamespaceFor`). In Node, `process.cwd` etc. are own
properties of the process object, so the ESM facade exposes them (84 named
exports, probed below). rifty's `process` builtin is a `NodeProcess` class
instance; its methods are non-enumerable prototype members and vanish from
the static name set. Runtime reads through the prototype already work — the
gap is link-time only. `process` is the only class-instance builtin; every
other registered builtin is a plain module object (direct prototype is
`Object.prototype`).

Node parity boundary (probed, Node v24.16.0): the named-export set does NOT
include EventEmitter methods — `import { on } from 'node:process'` is a link
SyntaxError in real Node (`on` lives on `EventEmitter.prototype`, which
cjs-module-lexer/Node's wrapper never enumerates). So the fix collects the
DIRECT class prototype's own names only and stops there; walking further
would export `on`/`emit`/`once` where Node throws.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. ESM `import { cwd, nextTick, hrtime, uptime } from 'node:process'` links;
   `cwd() === process.cwd()` and the rest are functions (parity case with
   pinned expected output) → I6
2. The namespace does NOT gain EventEmitter members: `'on' in ns`,
   `'emit' in ns`, `'once' in ns` are `false` while `'cwd' in ns` is `true`
   (same parity case) — guards against walking past the direct prototype → I6
3. CJS shape unchanged: `const { cwd } = require('node:process')` keeps
   working and `require('node:process').cwd ===
   (await import('node:process')).cwd` (parity case) → I6

## Reference contract

- Oracle: Node v24.16.0 (host), probed 2026-10-01:
  `Object.keys(await import('node:process'))` → 84 names incl. `cwd`,
  `nextTick`, `hrtime`, `uptime`; `import { on } from 'node:process'` →
  `SyntaxError: The requested module 'node:process' does not provide an
  export named 'on'`.
- Mechanism: in `buildStaticNameNode`'s builtin branch, after
  `Object.keys(instance)`, add `Object.getOwnPropertyNames` of the DIRECT
  prototype when it is neither `null` nor `Object.prototype`, excluding
  `constructor`. One fix point feeds link validation and namespace
  construction. Plain-object builtins (all but `process`) are unaffected
  (direct prototype IS `Object.prototype`).

## Parity cases

1. Node v24.16.0 ESM: named prototype-method imports link and run;
   EventEmitter members absent from the namespace — carrier
   `tools/node-parity-runner/cases/process/esm-named-prototype-imports.case.ts`
   with `expected` pinned from the oracle → I6

## Out of scope

- Members `NodeProcess` lacks entirely (`memoryUsage`, `cpuUsage`,
  `emitWarning`, …) — sibling item `absent-builtin-members-loud-throws`.
- Deep prototype chains beyond the direct class prototype — no class-backed
  builtin needs it today (§Simplicity); Node's own boundary for `process`
  excludes EventEmitter.

## Decisions

- 2026-10-01 — direct-prototype-only collection: matches Node's own-property
  boundary for `process` (methods are own props in Node's bootstrap;
  EventEmitter methods are not exported). A full-chain walk would diverge
  (link-succeed where Node link-throws).
