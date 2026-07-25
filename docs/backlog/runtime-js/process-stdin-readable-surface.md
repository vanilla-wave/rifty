---
area: runtime-js
status: draft
title: Seeded process.stdin Readable identity and passive unpipe
created: 2026-07-17
why: nodemon's `--no-stdin` path calls Readable `unpipe()`, but rifty process.stdin is an EventEmitter-shaped source with no unpipe surface
epic: real-node-server-dev-loop
sources: [ADR-0230, ADR-0237, ADR-0255]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/ipc/install-process.ts, packages/io/src/streams/readable.ts, tools/node-parity-runner/cases/process]
---

## Context

ADR-0230 deliberately bounded seeded stdin to flowing `data`, encoding,
pause/resume, EOF, and TTY resize. Real nodemon now forces the next observable
surface: Node Readable identity and passive `unpipe()` when no destination is
attached. The change must use ADR-0237's one Readable state/demand owner,
preserve split-UTF-8 and exact EOF, and keep unclaimed pull, `pipe`, async
iteration, and raw-mode surfaces loud. Injected-stdin parity runs only in
ADR-0255 disposable Workers. This needs a successor or correction ADR that
explicitly changes ADR-0230 before `ready`; PR #129's older Readable and public
same-realm reset helper are excluded.
