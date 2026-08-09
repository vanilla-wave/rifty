---
area: runtime-js
status: draft
title: Node CLI ESM eval context
created: 2026-07-30
why: Node 24 executes `--input-type=module -e`, while Workbench stops that ESM context before child allocation.
user_story: As an ESM CLI author, I want Node's module eval execution, but today Rifty throws a named unsupported-context error.
sources: [M11, ADR-0339, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md]
code: [packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/workbench-project-runtime.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

Node v24.16.0 executes `--input-type=module -e/--eval` as ESM, including
top-level await. The same input type with `-p/--print/-pe` exits 1 with
`ERR_EVAL_ESM_CANNOT_PRINT`; it does not evaluate and print a completion value.
The executable probe and captured output live in
`reference/node-v24.16.0-cli-eval-probe.md` §Residual CLI contexts.

Workbench throws `NotImplementedError('workbench.node.eval-module-context')`
before child allocation for the ESM eval forms. It never falls back to CommonJS
or transports source through a temporary file. Print forms already stop before
allocation with status 1 and Node's
`ERR_EVAL_ESM_CANNOT_PRINT` code/message instead of masquerading as supported
ESM eval. Missing `-e`/`--eval`/`-pe` and an immediate `--` in their source
position remain usage errors. A separated empty `-e`/`--eval` source selects
this ESM context and reaches its named gap rather than usage; separated empty
`-pe` retains the ESM print rejection. The optional-print boundary remains
exact: `-p -- <nonempty entry>` selects the separately named program gap, while
`-p -- ''` retains the ESM print rejection.

No overlapping backlog item was found on 2026-07-30. A faithful contract must
pin Node's ESM eval identity, argv, loader lifecycle, the preserved print
rejection, and the atomic launch discriminator; this draft chooses none of
those mechanisms. No new coordination mechanism is proposed.
