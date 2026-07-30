---
area: runtime-js
status: draft
title: Node CLI TypeScript-stripping eval context
created: 2026-07-30
why: Node 24 strips supported TypeScript syntax in eval, while Rifty stops at a named gap instead of running partial JavaScript.
user_story: As a TypeScript CLI author, I want source-driven and explicit TypeScript eval modes to match Node 24, but today Rifty stops them at one named context gap.
sources: [M11, ADR-0339, docs/backlog/runtime-js/reference/node-v24.16.0-cli-eval-probe.md]
code: [packages/workbench/src/workers/node-entry-resolve.ts, packages/workbench/src/workers/workbench-project-runtime.ts, packages/runtime-js/src/module-loader/loader.ts]
---

## Context

Node v24.16.0 strips its supported TypeScript subset from `-e/-p` source without
an input-type flag. It also accepts
`--input-type=commonjs-typescript` and `--input-type=module-typescript`.
`module-typescript -e` combines TypeScript stripping with ESM execution;
`module-typescript -p` rejects with `ERR_EVAL_ESM_CANNOT_PRINT`. Unsupported
transforming syntax such as an enum under either explicit TypeScript input type
rejects with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. The exact v24.16.0 probe and captured
status/output live in
`reference/node-v24.16.0-cli-eval-probe.md` §Residual CLI contexts.

This item owns both source-triggered TypeScript and the two explicit TypeScript
input types. At the overlap, `module-typescript` eval routes to this TypeScript
gap before the generic ESM gap; its print forms instead preserve the more
specific ESM print rejection shown by the oracle. For either explicit input
type, `-p -- <nonempty entry>` selects the separately named program gap;
`module-typescript -p -- ''` retains the ESM print rejection, while
`commonjs-typescript -p -- ''` remains this TypeScript gap.

Today source that needs TypeScript and explicit TypeScript input-type eval forms
throw `NotImplementedError('runtime-js.node-eval-typescript-context')`
synchronously. They never execute a partially stripped program, change source
into a file module, or allocate a child.

No overlapping backlog item was found on 2026-07-30. A faithful contract must
pin Node's erasable and non-erasable syntax, syntax-error priority, source
locations, completion values, explicit input-type grammar, and loader
interaction; this draft chooses no stripping or launch mechanism. No new
coordination mechanism is proposed.
