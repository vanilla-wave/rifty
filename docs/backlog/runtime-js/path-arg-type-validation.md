---
area: runtime-js
status: draft
title: "`node:path` functions do not validate non-string arguments: `join` returns `'.'`, the rest throw a bare `TypeError`, not Node's `ERR_INVALID_ARG_TYPE`"
created: 2026-11-17
why: `path.join({})` returns `'.'` and the other functions throw a bare `TypeError` (`p.startsWith is not a function`) where Node throws `ERR_INVALID_ARG_TYPE`, so argument-validation branches and error text differ
sources: [docs/adr/runtime-js/0345-expose-exact-node-24-0-0-process-release-identity.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/path.ts]
---

## Context

REV-12 side observation of the process brand fix's RDY-6 check (branch
`t3/w1-process-tag`; `path.join(process)` returned without throwing).
Scratch parity case, Node v24.16.0 vs rifty, argument `{}`:

```
path.join      Node ERR_INVALID_ARG_TYPE 'The "path" argument must be of type string. Received an instance of Object' · rifty returns '.'
path.resolve   Node ERR_INVALID_ARG_TYPE '… "paths[0]" …'  · rifty TypeError 'p.startsWith is not a function', no code
path.basename  Node ERR_INVALID_ARG_TYPE '… "path" …'      · rifty the same bare TypeError
path.normalize Node ERR_INVALID_ARG_TYPE '… "path" …'      · rifty TypeError 'p.endsWith is not a function'
path.dirname / path.extname  Node ERR_INVALID_ARG_TYPE     · rifty bare TypeError
path.relative  Node ERR_INVALID_ARG_TYPE '… "from" …'      · rifty bare TypeError
```

The RDY-6 reviewer's probe adds `path.isAbsolute` and `path.parse` (bare
`TypeError`); `path.format` and `path.toNamespacedPath` match Node.

`path.ts` `join` filters and joins its parts with no type check; the others
reach string methods unvalidated. Compat ❌: `docs/public/compat/modules.md`
`node:path` argument validation.

## Next

Owner runtime-js. Trigger: a program or test relying on `ERR_INVALID_ARG_TYPE`
from `node:path`, or a silent `'.'` from a non-string `join` argument. Parity
first: every exported function × one non-string argument (code, message,
argument name, `Received …` text), plus the remaining exports not probed here.
