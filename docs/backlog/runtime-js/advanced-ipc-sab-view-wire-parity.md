---
area: runtime-js
status: draft
title: Match Node's V8 wire semantics for SAB-backed views in advanced fork IPC
created: 2026-09-23
why: Node 24 advanced fork IPC accepts SAB-backed typed arrays/DataViews and delivers non-shared ArrayBuffer-backed views; rifty now throws a named ceiling because native structured clone retains shared backing and a simple copy misses Node's offset/alias semantics
sources: [docs/backlog/runtime-js/reference/advanced-ipc-clone-fidelity-evidence.md, docs/adr/runtime-js/0454-reject-unsupported-shared-backed-advanced-ipc-views.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/internal/node-ipc-serialization.ts]
---

## Context

User action: `fork(child, [], { serialization: 'advanced' })`, then
`child.send({ view: new Uint8Array(new SharedArrayBuffer(3)) })`. Node v24.16.0
delivers bytes on a non-shared ArrayBuffer; rifty throws
`NotImplementedError('child_process.serialization.advanced.shared-view')`.
The ceiling replaces a verified silent shared-memory lie (ADR-0454). Three
views of one SAB show Node-specific backing length, offset and alias outcomes
that a direct copy does not reproduce. No Vitest 4.1.11 claimed-path message
requires SAB-backed views. Owner: runtime-js; trigger: a real consumer needs
this payload and a differential contract can pin the V8 wire behavior.

## Challenge

challenge: 2026-09-23 — factual mid-task capture; premise check deferred to pickup if a consumer requires support
final-check: 2026-09-23 — fresh read-only reviewer PASS @ 47faa654947fa9857cab67520d8c3900f909a51a; dedup/scope/attribution clear
