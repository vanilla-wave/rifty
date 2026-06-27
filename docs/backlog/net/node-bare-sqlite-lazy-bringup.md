---
area: net
status: draft
title: Lazy `node:sqlite` engine bring-up for a bare `node <file>`
created: 2026-06-18
why: the 30 s sql.js WASM engine is brought up eagerly only on the template path (`cfg.sqlite`); a bare `node <file>` that imports `node:sqlite` has no engine, so `DatabaseSync` is unavailable until lazily wired
user_story: As a developer running `node seed.js` that uses `node:sqlite`, I want the WASM engine to come up on first `DatabaseSync` use, but today only the express-sqlite template path initialises it (eagerly, via `cfg.sqlite`) — a bare `node <file>` does not.
sources: [ADR-0155, ADR-0065]
code: [apps/playground/src/workers/node-entry-bootstrap.ts, apps/playground/src/workers/dev-server-boot.ts, packages/net/src/sqlite/engine.ts]
---

## Context

ADR-0155 lands `node <file>` registering net builtins always (http/net), but NOT the `node:sqlite`
engine — `dev-server-boot.ts` `bootNodeServer` fetches the bundled `sql-wasm.wasm` + `initSqliteEngine`
eagerly under `cfg.sqlite` (template-gated). A bare-node entry importing `node:sqlite` therefore has
NO `node:sqlite` builtin registered at all: `node-entry-bootstrap.ts` calls only `registerNetBuiltins()`
(net/http/https), while the `node:sqlite` builtin lives in a separate `packages/net/src/sqlite/
register-builtins.ts` that the node-entry path never imports. Per Fidelity this stays a loud gap, not a
silent stub.

## Options or Next

Make the `node:sqlite` builtin bring up the engine LAZILY on first `DatabaseSync` (fetch wasm +
`initSqliteEngine`, memoised) so a bare `node seed.js` works like Node, without paying the 30 s cost
on every `node <file>` run. Reuse the `wasmBinary` + pinned `locateFile` shape from
`dev-server-boot.ts` (D-001 — bundled same-origin asset, no CDN). Until then a bare-node
`require('node:sqlite')` fails LOUD as `ModuleLoadError(code:'MODULE_NOT_FOUND')` ("Built-in
'node:sqlite' is not implemented") from the resolver's unknown-builtin path (`module-loader/
resolver.ts`) — NOT a `NotImplementedError`, and never a silent stub. (Once the builtin is wired but
the engine is lazy, the failure class shifts to the engine-not-initialised throw.)

## Reversibility

REVERSIBLE — internal engine bring-up timing; no public API change. Recorded here; compat ❌ row in
`docs/public/compat/process.md`.
