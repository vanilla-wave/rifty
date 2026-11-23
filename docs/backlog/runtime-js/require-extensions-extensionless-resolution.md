---
area: runtime-js
status: draft
title: Custom require.extensions hooks participate in extensionless resolution
created: 2026-10-25
why: ADR-0294 dispatches explicit custom suffixes, but the CJS resolver probes a fixed `.js`/`.json`/`.node` list, so `require('./target')` misses a registered `.coffee` file Node loads through its hook
user_story: As a developer running a register-style loader such as CoffeeScript's, I want `require('./target')` to find `target.coffee` through the registered hook as in Node, but today only `require('./target.coffee')` loads and the extensionless form throws MODULE_NOT_FOUND.
blocked_by: []
sources: [ADR-0294, PR-158-salvage-probe-2026-10-25]
code: [packages/runtime-js/src/module-loader/resolver-profile.ts, packages/runtime-js/src/module-loader/resolver.ts, packages/runtime-js/src/module-loader/cjs.ts]
---

## Context

Salvaged from PR #158 (2026-07-19); re-verified on main `7d038adb0`.
ADR-0294 shipped explicit-suffix dispatch (`cjs.ts:1880-1914`, longest
truthy registered suffix) pinned by parity `modules/require-extensions-*`,
and declares extensionless candidates out of its scope; compat
`modules.md` `require.extensions` row is ⚠️ and names the gap.

The resolver never consults the hook table: `REQUIRE_EXTENSIONS =
['.js', '.json', '.node']` (`resolver-profile.ts:23`), selected by
`resolutionOrder` and probed in `resolveAsFile` (`resolver.ts:457-468`).

Probe: `require.extensions['.coffee'] = (m, f) => m._compile(fs.readFileSync(f,
'utf8'), f); require('./target')` beside `target.coffee`:
Node v24.16.0 → `coffee-target`; rifty (`createModuleLoader` over
MemoryFsSync, uncommitted scratch) → `MODULE_NOT_FOUND Cannot find module './target'`.

## Question

What snapshot/live relationship between the mutable hook table and candidate
order does Node use (registration order, replacement, deletion, multiple
matching files, file vs directory/package fallback, local vs `createRequire`
view), and how is resolver cache invalidated on a table change? Settled at
PICKUP with Node RED parity; ADR-0294 explicit-suffix rows stay controls;
no hardcoded suffix; native `.node` stays a loud ceiling.
