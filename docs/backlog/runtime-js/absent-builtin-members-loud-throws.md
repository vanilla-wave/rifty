---
area: runtime-js
status: ready
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

## Reference contract

Node v24.16.0: `node -e "const fs=require('node:fs'); const cp=require('node:child_process'); console.log(process.version, typeof fs.statfsSync, typeof cp.spawnSync, typeof process.memoryUsage, typeof process.memoryUsage.bind(process));"` → `v24.16.0 function function function function`. Executed rifty RED: `pnpm test:parity builtin-loud-members-present` → all four `undefined`; `pnpm test:run packages/runtime-js/src/builtins/absent-members-loud.test.ts` → three missing-member failures (2026-09-23).

## Acceptance

1. `fs.statfsSync` and `child_process.spawnSync` are callable named builtin exports, so the Vitest import can link without calling them. `process.memoryUsage.bind(process)` also succeeds. → I6
2. On invocation, each unavailable capability throws `NotImplementedError` with its specific `module.feature`, including `--changed`'s `spawnSync` and browser GC's `statfsSync`. → I6

## Parity cases

1. `tools/node-parity-runner/cases/modules/builtin-loud-members-present.case.ts` and `builtin-loud-members-named-exports.case.ts` observe the same `function` types, ESM linking and bindability as real Node for the three members. → I6

## Out of scope

Real filesystem capacity, OS process spawn and heap statistics cannot be supplied by the current browser runtime; these calls stay named loud ceilings. Vitest's claimed `run` path imports or binds them but does not invoke them.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ 63422c251723e9dbffc5b99e70126934d2cdea27
