---
area: runtime-js
status: draft
title: Custom require.extensions hooks participate in explicit and extensionless loading
created: 2026-07-19
why: current main dispatches CJS through a hardcoded .js hook and resolves a fixed suffix list, so registered custom extensions do not load like Node; PR #155 proposes only the explicit-suffix slice
user_story: As a developer running a register-style Node package such as a CoffeeScript loader, I want explicit and extensionless local requires to use its registered hook, but today the same package cannot load its custom source files like Node.
blocked_by: []
sources: [PR-155-scope, Node-v24-module-parity]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/resolver.ts]
---

## Context

Node dispatches an explicit custom suffix through the matching active `require.extensions` hook and consults active hook keys when resolving an extensionless file: after registering `.coffee`, both `require('./target.coffee')` and `require('./target')` can compile through that hook. Current `main` still dispatches runnable CJS through `.js` and resolves a fixed suffix list, so both forms diverge. PR #155 is an unmerged generic slice for explicit custom-suffix loading and active `.js` behavior; its contract intentionally does not claim extensionless candidates. This item records the complete current Node contract and must rebase on #155's actual merge state before becoming `ready`.

## Refinement path

- RED parity against Node v24 for registration order, replacement, deletion, multiple matching files, explicit suffix, extensionless file, directory/package fallback, and loader-local versus `createRequire` views.
- If #155 lands, retain its explicit-suffix rows as controls and refine the extensionless residual; if it does not, keep both explicit and extensionless behavior in this one semantic resolver/dispatch contract instead of assuming an unmerged prerequisite.
- Determine the exact snapshot/live relationship between resolution candidate order and the mutable hook table; preserve Node's observable order without a hardcoded CoffeeScript suffix.
- Sweep cache and invalidation after a hook table change. Unsupported native `.node` loading remains a loud separate ceiling and must not be faked through this path.
