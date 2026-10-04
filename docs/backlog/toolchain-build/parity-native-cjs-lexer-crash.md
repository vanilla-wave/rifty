---
area: toolchain-build
status: draft
title: Diagnose intermittent native CJS lexer termination during worker parity
created: 2026-10-05
why: a full parity run aborted inside Node before reporting a case outcome; the isolated worker suite passed
sources: [docs/backlog/distribution/reference/pr357-npm-repair-evidence.md]
code: [tools/node-parity-runner/src/run-in-rifty.ts, tools/node-parity-runner/src/worker-env-kernel-worker.ts, tools/node-parity-runner/src/cli.ts]
---

## Question

Why does Node24.16.0/macOS occasionally abort with
`FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal` in
`node::cjs_lexer::Parse` while running `pnpm test:parity`?
Observed at PR3571b58f3595 after the printed PASS for
worker_threads/handle-reference-api.case.ts; the active failing case is unknown.
The stack enters node:internal/modules/esm/translators.cjsPreparseModuleExports
inside a native Worker. This does not establish whether the trigger is Node,
TSX loading, or rifty's harness teardown; no standalone reproducer yet.

Attempt: `pnpm test:parity worker_threads` on the same tree passed all cases.
The preceding full gate also passed parity. Raw crash and isolation commands,
logs and stack excerpt are retained by the linked evidence. No runtime repair
or assertion/timeout/worker-count change is justified by this observation.

Owner: parity harness. Trigger: recurring crash or an isolatable reproducer.
Boundary to diagnose: native host execution/loading, before a parity result;
not a demonstrated Worker-message loss/reorder. No coordination proposed.
Dedup: backlog markdown, goal maps, traps and declined ADR index searched for
ToLocalChecked/cjs_lexer/parity crash; no matching finding.
