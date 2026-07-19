---
area: runtime-js
status: draft
title: Custom require.extensions hooks participate in extensionless resolution
created: 2026-07-19
why: ADR-0294 landed explicit custom-suffix dispatch, but the resolver still probes a fixed suffix list, so an extensionless require of a registered custom source file diverges from Node
user_story: As a developer running a register-style Node package such as a CoffeeScript loader, I want `require('./target')` to consult its registered hook like Node does, but today only the explicit `require('./target.coffee')` form loads through it.
blocked_by: []
sources: [ADR-0294, Node-v24-module-parity]
code: [packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/resolver.ts]
---

## Context

PR #155 (ADR-0294) shipped explicit-suffix dispatch: explicit CJS files use the longest truthy registered basename suffix, then the current `.js`; parity `modules/require-extensions-*` pins that surface. The residual gap is resolution: `resolver.ts` probes a fixed `DEFAULT_EXTENSIONS` list and never consults active hook keys, so after registering `.coffee`, `require('./target')` misses where Node compiles through the hook.

## Refinement path

- RED parity against Node v24 for extensionless file versus directory/package fallback, registration order, replacement, deletion, multiple matching files, and loader-local versus `createRequire` views; keep #155's explicit-suffix rows as controls.
- Determine the exact snapshot/live relationship between resolution candidate order and the mutable hook table; preserve Node's observable order without a hardcoded CoffeeScript suffix.
- Sweep cache and invalidation after a hook table change. Unsupported native `.node` loading remains a loud separate ceiling and must not be faked through this path.
