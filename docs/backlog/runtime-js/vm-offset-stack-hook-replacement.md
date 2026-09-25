---
area: runtime-js
status: draft
title: VM offset provenance is lost after replacing the stack formatter
created: 2026-09-23
why: assigning or deleting Error.prepareStackTrace after host vm evaluation bypasses offset projection for escaped errors
sources: [docs/backlog/runtime-js/reference/vm-run-in-this-context-offsets-evidence.md, docs/adr/runtime-js/0443-preserve-host-vm-offsets-in-immutable-source-identities.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/module-loader/source-maps.ts, packages/runtime-js/src/builtins/vm/index.ts]
---

## Context

Node v24.16.0 reproduction in the evidence's hook-replacement section:
evaluate `new Error()` with filename `/virtual/replaced-hook.js`, offsets10/5;
assign `Error.prepareStackTrace = undefined`; read the escaped error's stack.
Node reports `/virtual/replaced-hook.js:11:6`; rifty exposes encoded sourceURL
and physical1:1. Independent rerun confirms this; unchanged Vite8 interceptor
with an actual source map matches Node at `/virtual/original.ts:11:1`.

Owner: runtime-js/source-maps. Trigger: vi mocking/import helpers or another
scenario requiring post-evaluation formatter replacement. Exact Vitest4.1.11
temporarily replaces the hook in getImporter; the accepted sum scenario never
calls it. Vite resets its interceptor at close. This extends the offset unit's
same-filename lifetime clause with a separate global-hook mutation, rather than
invalidating its proven unchanged-renderer path (independent authority review).

Compat ❌ remains explicit. No implementation prescribed: an accessor intercepts
assignment but changes native writable-data-property observables. Choose and
prove a faithful carrier at pickup; do not hide the loss behind fake coordinates.

Dedup: runtime-js titles/code, epic maps, traps and declined ADR rows contain no
hook-replacement owner. Existing offset evidence/ADR describe this boundary;
util.getCallSites work has a different API. Fault class: provenance-lie across
script lifetime × mutable renderer. No transport or new coordination proposed.
