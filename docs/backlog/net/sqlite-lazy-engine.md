---
area: net
status: draft
title: node:sqlite engine independent of presets
created: 2026-07-02
why: node:sqlite works only when a preset sets `cfg.sqlite` (playground boots the sql.js engine ahead of time) — the builtin's availability is keyed to preset config, not the platform
user_story: As a developer, I want `require('node:sqlite')` to work in any project (fresh scratch, forked preset without the flag), but today only sqlite-flagged presets get the engine.
epic: preset-deglue
blocked_by: []
sources: []
code: [packages/net/src/sqlite/engine.ts, packages/net/src/sqlite/register-builtins.ts, apps/playground/src/workers/dev-server-boot.ts]
---

## Context

Engine init (sql.js wasm fetch + instantiate) happens in playground boot behind `cfg.sqlite`; a project without the flag gets no `node:sqlite` at all. Target: builtin always registered, engine init decoupled from presets, `cfg.sqlite` deleted; a fork of express-sqlite (or any scratch project) can use `node:sqlite` without knowing the flag existed.

Open fork → resolve before ready: `DatabaseSync` is a sync API, so the init boundary must be chosen — (a) loader-level await on first `node:sqlite` resolution (loader is async, engine ready before user code runs), (b) eager background fetch at kernel boot + sync readiness gate (pays ~wasm fetch on every boot), (c) sync-over-async via SAB/Atomics. Failure honesty: wasm fetch failure must surface as a loud require/constructor error, never a half-initialized engine.
