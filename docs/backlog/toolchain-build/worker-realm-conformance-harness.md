---
area: toolchain-build
status: active
title: Worker-realm conformance harness (run conformance subset inside a real kernel worker via Playwright)
created: 2026-06-12
why: node:sqlite passed conformance in vitest/Node realm yet first-ever run in the target kernel-worker realm (ADR-0130 demo) broke — "tested" ≠ "runs where it ships"
sources: [ADR-0130, fullstack-demo feedback 2026-06-12]
code: [tests/conformance, tests/e2e/helpers, packages/kernel/src/worker-entry.ts]
---
## Context
Conformance suite (`tests/conformance/`, Vitest) executes in the Node realm. Target realm = kernel web worker: browser V8, rifty process globals, bundler module resolution, COI — none of which vitest exercises. ADR-0130 bug #1 is the archetype: sqlite engine's Node-detection only broke *after* `installWorkerEntry`/`installProcessGlobals` in a real worker; invisible to every vitest run. Same blind spot applies to any builtin touching `process`, OPFS, timers/event-loop, wasm asset loading. The class is systemic: every builtin is "verified" in a realm it never ships in.

## Options / Next
One harness, every builtin gets both-realm coverage:
- Playwright spec boots a harness page → kernel worker; worker executes a tagged subset of conformance cases through the rifty loader; results postMessage'd out, asserted in the spec.
- Case-format cost (the real work): conformance cases are vitest files (`describe`/`expect`) — not directly loadable in a worker. Fork: (a) thin runner-agnostic case format (code + expected, parity-style) shared by vitest and the worker harness; (b) vitest browser-mode (runs in *page* realm — closer, but still not the kernel worker; partial credit only); (c) re-exec selected case source through the loader with a minimal assert shim. Provisional pick to be made when taken up — recorded here.
- Start with the realm-sensitive set: sqlite, fs/OPFS, process globals/cwd, timers/event-loop order; grow by tagging.
- Pairs with playground/templates-as-stack-consumers: templates give the harness live load.

## Reversibility
REVERSIBLE — test infra only. Case-format choice is the provisional judgment call this item records.
