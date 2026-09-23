---
area: runtime-js
status: ready
title: Builtin static export names include prototype methods so `import { cwd } from 'node:process'` links
created: 2026-09-15
why: ESM link-time validation of a builtin uses `Object.keys(instance)`; `NodeProcess` methods (cwd, nextTick, hrtime, …) live on the prototype, so tinyexec's `import { spawn } ... ; import { cwd } from 'node:process'` fails with "does not provide an export named 'cwd'"
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/runtime-js/src/module-loader/cjs-interop-authority.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

`cjs-interop-authority.ts` `buildStaticNameNode`: `for (const name of
Object.keys(loadBuiltin(id)))`. In Node, `process.cwd` etc. are own
properties of the process object, so the ESM facade exposes them. rifty's
`process` builtin is a class instance; its methods are non-enumerable
prototype members and vanish from the static name set. Same shape risk for
any class-backed builtin. Runtime reads through the prototype already work.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Reference contract

Node v24.16.0 exposes `cwd/chdir/hrtime/uptime/exit/kill` as own process
properties and ESM names; inherited EventEmitter/Object methods are absent.
Executable oracle: `tools/node-parity-runner/cases/process/named-method-exports.case.ts`.

## Acceptance

1. Static named process imports link, equal default members, and remain callable without a receiver. → I6

## Parity cases

1. The six process methods are own properties and identical named exports; unbound cwd/hrtime/uptime work, hrtime.bigint remains callable; inherited on/constructor/toString stay absent. Carrier: `process/named-method-exports`. → I6

## Out of scope

Unimplemented process capabilities retain their existing ceilings.

## Decisions

re-cut: 2026-09-23 — fix process instance shape at its owner; generic prototype traversal would falsely export inherited methods — trace: none
- 2026-09-23 — RDY-8 observed defect: `node --import tsx tools/node-parity-runner/src/cli.ts process/named-method-exports` RED: missing `cwd` export. Native execution of the case on Node v24.16.0 exits 0: six `function true true` rows; cwd true, hrtime true bigint, uptime number, inherited false false false.
- 2026-09-23 — class `sibling-drift`, in-process builtin projection: process is the registered class instance; ordinary module objects/functions keep their own-property export authority. Bind public own methods once, preserve function properties; exclude runtime-only helpers and inherited EventEmitter methods.
