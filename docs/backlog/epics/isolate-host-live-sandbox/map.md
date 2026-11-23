# Map — isolate-host-live-sandbox

## Items

None left to build: the acceptance carrier and `distribution/isolate-host-sandbox-core` landed
(PR #419, external review rounds 1–4). CLOSE waits on the one `owner: user` question below; it
runs as a small PR on the user's words.

## Open questions

- Три поведенческих расхождения с Node остаются в песочнице объявленными ⚠️: (1) работа, уже стоявшая в очереди на момент `process.exit()`, исполняется, и записанный ею файл остаётся в состоянии; (2) микрозадача из `'exit'`-listener'а после явного `exit()` исполняется и может записать файл; (3) uncaught throw с бесконечной цепочкой микрозадач заканчивается таймаутом с откатом записей, Node выходит с кодом 1 и записи сохраняет. Принять цель с ними и чинить по записям backlog — или держать цель открытой до починки — owner: user — asked by the manager 2026-11-23 (the goal's decision «the same holds for anything found in the class "a run silently does something else"» narrows I2 only in the user's words, `RDY-6`); evidence: `sandbox-acceptance` declared rows; backlog `runtime-js/node-eval-work-queued-at-exit-runs`, `distribution/isolate-host-natural-exit-listener-queued-work`, `distribution/isolate-host-uncaught-throw-waits-for-microtask-checkpoint`, lead `distribution/isolate-host-sandbox-capture-at-process-terminal`. Everything else of the goal is delivered and proven (CLOSE review 2026-11-23 @ 35fb53023: the only blocker is this gate).

## Closes elsewhere

- The `isolate-host-fs-snapshot` goal's residual "a snapshot refuses NUL names and times outside
  Date" is closed in rifty's fs by this branch: `fs-path.ts` (Node's `nullCheck`) and
  `fs-times.ts` (utimes as Node 24.16.0) — rifty's FS no longer holds such values.

## Out of scope

- The library template (`createSandbox({ template })` → `NotImplementedError('isolate-host.sandbox-template')`).
- Web API shims (`URL`, `structuredClone`, web streams, `AbortController`, `EventTarget`): loud ceilings as in `runCode`; their own ROADMAP direction.
- ESM: an ESM entry or module (`.mjs`, `"type": "module"`, ESM syntax in a typeless `.js`) → `NotImplementedError('isolate-host.esm')` + compat ❌.
- `exec` options `env`, `cwd`, `stdin` → `NotImplementedError('isolate-host.sandbox-exec-<option>')`; shell syntax (the path is one file path, never parsed).
- Keeping a killed run's partial writes (whole-run rollback, compat ⚠️); a host-disk directory model (not built, ADR critic only).
- Text of `node file.js` diagnostics (positions, header, caret, footer, `SyntaxError` shape, `Cannot find module` header): the runtime-js diagnostics goal; pinned ⚠️ here.
- npm publication; RPC transport; per-tenant worker affinity; `process.exit()` from a microtask and the suite flake (neighbour threads).
