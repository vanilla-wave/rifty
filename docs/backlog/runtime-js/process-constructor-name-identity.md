---
area: runtime-js
status: draft
title: Guest `process` constructor name is `NodeProcess`, Node's is `process`
created: 2026-11-17
why: name-based output differs from Node — `util.inspect(process)` header, rejection reason, `ERR_INVALID_ARG_TYPE` text — now that the `Symbol.toStringTag` brand already matches
sources: [docs/adr/runtime-js/0345-expose-exact-node-24-0-0-process-release-identity.md, docs/adr/playground/0157-unified-spec-seeded-mutable-node-process-at-pre-entry-gated-to-node-workers.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/repl/inspect.ts, packages/runtime-js/src/builtins/process-lifecycle-events.ts, packages/runtime-js/src/builtins/vm/index.ts]
---

## Context

REV-12 discovery of the process brand fix (branch `t3/w1-process-tag`,
ADR-0345 §Corrections 2026-11-17): the brand now matches Node, the constructor
name does not. Scratch parity cases on the `node:process` binding (default
mode), Node v24.16.0 vs rifty:

```
Object.getPrototypeOf(p).constructor.name  → Node "process"   · rifty "NodeProcess"
util.inspect(p).slice(0, 8)                → Node "process "  · rifty "NodeProc"
vm.runInContext('1', p)                    → Node ERR_INVALID_ARG_TYPE "… Received an instance of process"
                                             rifty code undefined, "… Received an instance of NodeProcess"
```

Node: `node -e "Promise.reject(process)"` reports `reason "#<process>"`; rifty's
`noSideEffectsToString` (`process-lifecycle-events.ts`) renders
`#<NodeProcess>` from the constructor name (code reading, not executed).
The vm `ERR_INVALID_ARG_TYPE` message comes from `assertContextified`
(`vm/index.ts`), which also omits Node's `code`.

The class is `NodeProcess` (`process.ts`, ADR-0157), also a published export of
the `./builtins/process` subpath — a rename touches that surface. The
same-realm child's `process` is a plain object (constructor `Object`;
`runtime-js/same-realm-child-process-object-shape`).

Latent coupling: rifty's inspect builds the header from `constructor.name` only
and ignores `Symbol.toStringTag` (`repl/inspect.ts` `formatObject`). Node prints
`<Ctor> [<tag>] {` when the two differ (`node -p` on a `class NodeProcess`
instance with own tag `'process'` → `NodeProcess [process] { a: 1 }`), so
honouring tags before the name is fixed would print `NodeProcess [process] {`
(inference) — still not Node's `process {`.

## Next

Owner runtime-js. Trigger: a program or tool whose output or branch depends on
`process.constructor.name`, `util.inspect(process)` or the rejection text.
Parity first on the `node:process` binding (in-process the free global is the
host's): constructor name, inspect header, `Promise.reject(process)` reason,
`vm.runInContext('1', process)` code and message.
