---
area: runtime-js
status: draft
title: util.format('%s') of a node:vm value picks its branch by the membrane's shape, not the value's
created: 2026-11-25
why: "`%s` of a vm context's `Date`/`Error` prints `String()` (`Thu Jan 01 1970 …`, `Error: m`) where Node inspects (ISO date, the stack); the membrane's prototypes have no own `constructor`, so a built-in `toString` reads as a user one — silent, every host with vm"
sources: ["PR #449 external review (manager-relayed, 2026-11-25)", docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/util.ts, packages/runtime-js/src/builtins/vm/membrane.ts]
---

## Context

Probe 2026-11-25, live `node -e` v24.16.0 vs rifty parity-runner (in-process, QuickJS vm),
`util.format('%s', vm.runInNewContext(src))`:

| `src` | Node | rifty after PR #449 | rifty main |
|---|---|---|---|
| `new Date(0)` | `1970-01-01T00:00:00.000Z` | `String(date)` (`Thu Jan 01 1970 …`) | `{}` |
| `new Error("m")` | its stack | `Error: m` | `{}` |
| `[1, 2]`, `[]`, `[1,[2]]` | `[ 1, 2 ]` … | as Node (a walk ending in null is inspected) | as Node |

Node: `hasBuiltInToString` finds the prototype owning `toString` and checks its own
`constructor` name (`Date`, `Error` → built-in → inspect). rifty's membrane prototypes carry
the methods but no own `constructor`, so `%s` takes `String()`. Also reached: `util.inspect`
of the same values (`{}`, Node the date/stack; `Map {}` for a vm `Map`,
`runtime-js/inspect-default-format-gaps`). Pinned:
`tests/conformance/builtins/util-format-percent-s-declared.test.ts`. The isolate guest has no
vm (`ensureVmEngineReady` not preloaded). Compat modules.md "`util.format('%s')` of a
`node:vm` value" ⚠️. Neighbour: `runtime-js/vm-quickjs-seed-readonly-and-brand` (membrane
brand), not a duplicate.

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge)
