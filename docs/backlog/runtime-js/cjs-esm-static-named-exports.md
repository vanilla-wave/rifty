---
area: runtime-js
status: draft
title: CJS→ESM residual named re-exports and namespace reflection
created: 2026-07-12
why: ADR-0346 delivers static CJS names and ordinary re-exports, but ESM-target re-exports stay loud and namespace reflection is not yet exotic
user_story: As a package author re-exporting or reflecting on CommonJS, I want the remaining cross-format and namespace observables to match Node 24.
sources: [ADR-0004, ADR-0346, Node-v24.16.0-probe]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/interop.ts]
---

## Context

ADR-0346 pins CJS names/re-exports to static analysis, excludes computed runtime
keys, snapshots values, and validates ordinary CJS/builtin named edges before
evaluation. Two residuals remain:

- a statically detected `module.exports = require('./target.mjs')` edge cannot
  derive the target ESM surface through the CJS metadata cache and throws
  `NotImplementedError('module-loader.cjs-static-named-exports')` before effects;
- the stable null-prototype namespace still has ordinary-object descriptors and
  mutation/reflection behavior, not Node's Module Namespace exotic semantics;
  notably `Object.keys(namespace)` does not read a TDZ binding through exotic
  `[[GetOwnProperty]]` and therefore misses Node's `ReferenceError`.

The completion contract needs Node v24.16.0 differential cases for the
cross-format re-export, descriptors, `Object.isExtensible`, writes/deletes,
`defineProperty`, `Symbol.toStringTag`, and cross-realm reflection. Ordinary
CJS re-export traversal, name discovery, value snapshots, and identity are
already delivered and outside this draft.
