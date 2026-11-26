---
area: runtime-js
status: draft
title: util.format('%s') of a node:vm value follows the membrane's shape, not the value's
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

More membrane shapes reached by `%s` (PR #449 review round 2, verified in-process):

- The membrane does not carry a prototype's `Symbol.toPrimitive`:
  `vm.runInNewContext('class P{[Symbol.toPrimitive](){return "P"}}; new P()')` → `String(v)`
  Node `P`, rifty `[object Object]`; `%s` Node `P`, rifty `P {}`. An own
  `[Symbol.toPrimitive]` works (`({[Symbol.toPrimitive](){return "own"}})` → `own` both).
- A context function: `%s` of `vm.runInNewContext('(()=>1)')` → Node `()=>1`, rifty
  `function () { [native code] }` (its `toString` is the host wrapper's).

Node: `hasBuiltInToString` finds the prototype owning `toString` and checks its own
`constructor` name (`Date`, `Error` → built-in → inspect). rifty's membrane prototypes carry
the methods but no own `constructor`, so `%s` takes `String()`. Also reached: `util.inspect`
of the same values (`{}`, Node the date/stack; `Map {}` for a vm `Map`,
`runtime-js/inspect-default-format-gaps`). Pinned:
`tests/conformance/builtins/util-format-percent-s-declared.test.ts`. The isolate guest has no
vm (`ensureVmEngineReady` not preloaded). Compat modules.md "`util.format('%s')` of a
`node:vm` value" ⚠️. Neighbour: `runtime-js/vm-quickjs-seed-readonly-and-brand` (membrane
brand), not a duplicate.

Same membrane, a brand check (PR #462 review n5, verified in-process 2026-11-26):
`new StringDecoder('hex').write(vm.runInNewContext('new DataView(new Uint8Array([2,3]).buffer)'))`
→ Node `0203`, rifty `ERR_INVALID_ARG_TYPE … Received an instance of DataView` (the membrane's
`DataView` is no view: `ArrayBuffer.isView` false); a vm `Uint8Array` decodes as Node.

Same membrane shape in `fs` (PR #469 external review, 2026-11-26, in-process; Node v24.16.0 re-run here):
`fs.writeFileSync(p, vm.runInNewContext('new DataView(new Uint8Array([1,2,3]).buffer, 1)'))` → Node
writes `2,3`, rifty an empty file (the membrane value is no view: `ArrayBuffer.isView` false, copied as an
object's elements); `vm.runInNewContext('new ArrayBuffer(3)')` as data → Node `ERR_INVALID_ARG_TYPE`,
rifty not refused. A vm `Uint8Array` writes `1,2,3` in Node (rifty side not re-run here).

## Challenge

challenge: 2026-11-25 — finding capture; no premise critic (README §Challenge)
