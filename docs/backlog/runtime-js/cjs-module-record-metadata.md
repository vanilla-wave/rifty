---
area: runtime-js
status: draft
title: Node CJS module-record metadata and lifecycle
created: 2026-07-17
why: nodemon reads `module.parent.filename`, but rifty CJS records do not expose Node-compatible id, filename, path, paths, parent, children, and loaded transitions
epic: real-node-server-dev-loop
sources: [ADR-0004, ADR-0269]
code: [packages/runtime-js/src/module-loader/cjs.ts, packages/runtime-js/src/module-loader/loader.ts, packages/runtime-js/src/module-loader/registry.ts, tools/node-parity-runner/cases/modules]
---

## Context

The current CJS registry executes and caches modules but does not expose the
complete Node-observable record used by nodemon and cache-aware packages. The
forcing parity covers `id`, `filename`, `path`, `paths`, first-parent identity,
parent/children linkage before child evaluation, `loaded` before/after success,
cycles, cached children, and failed-child unlink from the owning records. This
must deepen the current ADR-0269 shared `require.extensions`/`_compile` and
registry architecture, not restore PR #129's older graph or create a second
record alongside `ModuleRegistry`. The related
`runtime-js/require-cache-module-record-surface` item is blocked on this one and
owns only the public cache view, delete, and reload facade; it does not own
record creation or failed-load cleanup.
