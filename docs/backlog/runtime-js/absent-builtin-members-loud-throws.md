---
area: runtime-js
status: draft
title: `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage` exist as real or named-loud members
created: 2026-09-15
why: absent members surface as link-time SyntaxError (named import of statfsSync/spawnSync) or `undefined.bind` TypeError (vitest worker init binds process.memoryUsage) — worse than a NotImplementedError and fatal even when the member is never called on the claimed path
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

vitest 4.1.11: `import { statfsSync } from 'node:fs'` (cli-api; called only
in browser-mode chromium GC), tinyexec `import { spawn, spawnSync } from
'node:child_process'` (spawnSync only for `--changed` git), worker init
`process.memoryUsage.bind(process)` (called only with `logHeapUsage`).
Oracle (Node v24.16.0): `typeof statfsSync`, `typeof spawnSync`,
`typeof process.memoryUsage` all `function` (evidence §Oracle).
`node-builtins-loud-stub-capability-gaps` already lists statfs/spawnSync as
"absent — not even a loud throw". `process.setSourceMapsEnabled` and
`process.emitWarning` are also absent but guarded by vitest
(`if (process.setSourceMapsEnabled)`, native mode; deprecation path) — not on
this item; `emitWarning` stays with `process-module-loader-surface`. A member whose real value the browser cannot
supply (heap statistics) is a named `NotImplementedError` per AGENTS.md
§Fidelity, never a fabricated number; `spawnSync` may follow `execSync`'s
existing sync-child path if that is a real implementation, else loud.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)
