---
area: runtime-js
status: draft
title: Guest `process` constructor name is `NodeProcess`, Node's is `process`
created: 2026-11-17
why: name-based output differs from Node — `util.inspect(process)` header, and any `constructor.name` reader — now that the `Symbol.toStringTag` brand already matches
sources: [docs/adr/runtime-js/0345-expose-exact-node-24-0-0-process-release-identity.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/repl/inspect.ts, packages/runtime-js/src/builtins/child_process-exec.ts]
---

## Context

REV-12 discovery of the process brand fix (branch `t3/w1-process-tag`,
ADR-0345 §Corrections 2026-11-17): the brand now matches Node, the constructor
name does not. Scratch parity case (`require('node:process')`, default mode),
Node v24.16.0 vs rifty:

```
Object.getPrototypeOf(p).constructor.name  → Node "process"   · rifty "NodeProcess"
util.inspect(p).slice(0, 8)                → Node "process "  · rifty "NodeProc"
```

The class is `NodeProcess` (`process.ts`, ADR-0157). The same-realm child's
`process` is a plain object (constructor `Object`, no inspect header;
`runtime-js/same-realm-child-process-object-shape`). Other name readers seen in
code, not executed here: rejection-reason rendering
(`process-lifecycle-events.ts` `noSideEffectsToString` → `#<NodeProcess>`,
Node `#<process>`) and `ERR_INVALID_ARG_TYPE` "Received an instance of …"
(`internal/node-received.ts`).

Latent coupling: rifty's inspect builds the header from `constructor.name` only
and ignores `Symbol.toStringTag` (`repl/inspect.ts` `formatObject`). Node prints
`<Ctor> [<tag>] {` when the two differ, so honouring tags before the name is
fixed would print `NodeProcess [process] {` — still not Node's `process {`.

## Next

Owner runtime-js. Trigger: a program or tool whose output or branch depends on
`process.constructor.name` or `util.inspect(process)`. Parity first on the
`node:process` binding (in-process the free global is the host's): constructor
name, inspect header, rejection reason, `ERR_INVALID_ARG_TYPE` text.
