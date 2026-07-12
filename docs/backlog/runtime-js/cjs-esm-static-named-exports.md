---
area: runtime-js
status: draft
title: CJS→ESM named exports must use Node's static detection
created: 2026-07-12
why: rifty snapshots every enumerable runtime key while Node statically selects names and exposes a Module Namespace exotic object
user_story: As a package author importing or reflecting on CommonJS, I want the same namespace keys, descriptors, and snapshots as Node 24, but today computed runtime keys appear in rifty and its namespace is an ordinary object.
sources: [ADR-0004, Node-v24.16.0-probe]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/interop.ts]
---

## Context

Node v24.16.0 builds CJS named exports from its `cjs-module-lexer` analysis and
snapshots their values when the namespace is created. Rifty now snapshots values
too, but discovers names with `Object.keys(module.exports)` after evaluation.
That admits computed/runtime-only keys Node omits and cannot reproduce Node's
static re-export detection. The exact implementation needs a pinned upstream
lexer/mechanism decision and differential cases for assignments, computed keys,
re-exports, functions, primitives, mutation after import, property descriptors,
and namespace mutation/reflection. Until then only the exact
`default`/`module.exports` outer and stable namespace identity are claimed.
