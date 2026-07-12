---
area: runtime-js
status: draft
title: `require.cache` must expose and control CJS module records
created: 2026-07-12
why: loader-created require functions expose a detached empty object and CJS-local require has no cache property
user_story: As a Node program that inspects or deletes `require.cache[require.resolve(id)]`, I want the operation to observe and reload the same CJS records as Node, but today it is disconnected from rifty's ModuleRegistry.
sources: [ADR-0004, Node-v24.16.0-probe]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/registry.ts]
---

## Context

`createRequire()` currently assigns a fresh empty object to `req.cache`; the
per-module CJS `require` function does not expose `.cache`. Neither view owns or
mutates `ModuleRegistry`. Node v24.16.0 removes a failed `require()` record and
lets `delete require.cache[id]` re-execute the next `require`, while an already
cached ESM namespace for the same URL remains cached. Rifty's explicit
`loader.invalidate(id)` is a separate, intentionally stronger HMR operation
that coherently drops the execution record and derived namespace. Do not claim
that operation as `require.cache` parity.

Node v24.16.0's file translator itself raises `ERR_INTERNAL_ASSERTION` when a
failed `require()` has scheduled a self-import. Rifty throws the directed
`NotImplementedError('module-loader.cjs-import-job-failed-require')` instead of
re-executing the source or attaching the old job to a later execution record.
