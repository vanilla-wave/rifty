---
area: runtime-js
status: draft
title: Runtime-binding transport lacks positive carriers for every Node-entry variant
created: 2026-08-31
why: Node-entry v3 exposes runtimeBindings on program, eval, and worker-thread launches and recursively inherits them, but the positive snapshot/detachment test exercises only program, so a branch-specific transport regression can pass the suite
user_story: As a maintainer changing Node-entry bootstrap code, I want each public launch variant and recursive child path to prove that admitted runtime bindings survive exactly, but today only program launch has a positive carrier.
sources: [PR-289, docs/process/fault-classes.md]
code: [packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.test.ts]
---

## Context

PR #289 added the public frozen `runtimeBindings` field to all three Node-entry
launch variants. `snapshotLaunch()` handles program, eval, and worker-thread in
separate branches; `buildConfiguredNodeEntryWorkerEntry()` separately inherits
the current realm's bindings into recursive launches.

The positive test mutates its input and proves an exact frozen snapshot only
for a program launch. Corrupt-input cases also construct program. A review
mutation that omitted `runtimeBindings` from eval, worker-thread, or recursive
inheritance would therefore keep the present direct carrier green. No runtime
failure was observed; this is a `sibling-drift` test-coverage finding, not a
claim that the current implementation is broken.

Dedup found no matching backlog title, `code:` owner, goal-map child, or
declined-concepts row. The adjacent Node CLI eval and inherited `execArgv`
items own different observable semantics.

## Observable gap

Positive exact-value, frozen/detached-input tests do not distinguish all launch
variants or recursive inheritance. A future change can silently drop a binding
from one branch without failing a carrier close to the public bootstrap API.

## Challenge

challenge: 2026-08-31 — 3 problems

“Survive exactly” lacks an acceptance matrix: public API vs internal helper, freeze/detachment semantics, and recursive depth/topology are unspecified.

The value is maintainer confidence for an unobserved regression; no consumer scenario, likelihood, or blast radius supports treating this as a standalone M11 priority.

A table-driven extension of the existing positive test is the direct authority, so this should likely ride with Node-entry work unless it adds a real public-launch parity check.
