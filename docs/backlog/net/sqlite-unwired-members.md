---
area: net
status: parked
title: node:sqlite unwired DatabaseSync/StatementSync members
created: 2026-06-08
why: Members off the opencode boot/query path are unimplemented (loud NotImplementedError)
sources: [ADR-0065 D4]
---
## Context
Several `DatabaseSync`/`StatementSync` members are ❌ — not on opencode's boot/query path, so unimplemented and throwing a directed `NotImplementedError` (never a faked value, ADR-0065 D4): `DatabaseSync.location()`, `function()`, `aggregate()`, `createSession()`, `applyChangeset()`, `enableLoadExtension()`/`loadExtension()`; `StatementSync.expandedSQL` / `sourceSQL`. `location`/`function`/`aggregate`/`expandedSQL`/`sourceSQL` are wireable on sql.js when added; `createSession`/`applyChangeset` (session ext) and `loadExtension` (loadable extensions) are unsupported in the prebuilt WASM build.

## Options / Next
Next (gated): wire each member when a consumer needs it — the sql.js-backable ones (`location`, `function`, `aggregate`, `expandedSQL`, `sourceSQL`) are straight additions; the session/extension members need a WASM build that includes them (or stay permanently out of scope). Each addition lands with a compat-matrix flip and a parity case.

## Reversibility
REVERSIBLE for the sql.js-backable members (additive on net surface). IRREVERSIBLE for session/loadExtension if they require a custom WASM build. Parked behind verified need; loud-throw is the recorded scope.
