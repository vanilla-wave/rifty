---
area: runtime-js
status: draft
title: Node CLI preload and import flags
created: 2026-07-30
why: Node loads `--require`/`-r` and `--import` modules before eval or entry execution, while Rifty stops each valid form at a named no-child gap.
user_story: As a Node CLI author using startup hooks, I want preload modules to run before my command with exact Node identity, but today Rifty throws one named unsupported-context error.
sources: [M11, ADR-0155, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md]
code: [packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/workbench-project-runtime.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

Node v24.16.0 accepts CommonJS `--require`/`-r` and ESM `--import` preloads
before eval or a program entry. The pinned residual-context probe proves both
require spellings populate `require.cache` before `-p`, and a data-URL import
mutates the eval realm before its source runs:
`reference/node-v24.16.0-cli-eval-probe.md` §Residual CLI contexts.

Rifty throws `NotImplementedError('workbench.node.preload-context')` before
child allocation for valid `--require`, `--require=…`, `-r`, `--import`, and
`--import=…` forms. Missing or explicitly empty option arguments retain Node's
exact exit-9 usage error. It never misreports a supported form as an invalid
option or silently ignores a requested preload.

No matching title, `code:` owner, epic child, or Node CLI preload item was found
on 2026-07-30. The terminal commands above supply the user-action path. A
faithful contract must pin option spellings and ordering, specifier resolution,
preload/eval realm identity, `process.execArgv`, preload failure priority, and
program versus eval consumers. This draft chooses no loader or launch
mechanism; no coordination mechanism is proposed.
