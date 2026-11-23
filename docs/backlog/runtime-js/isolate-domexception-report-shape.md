---
area: runtime-js
status: draft
title: "The isolate fatal report prints a `DOMException` as Node's `DOMException [AbortError]: m`"
created: 2026-11-23
why: A `DOMException` cause prints `cause: AbortError: m`; Node prints `cause: DOMException [AbortError]: m`
sources: [docs/backlog/runtime-js/reference/guest-builtin-names-baseline.md]
code: [packages/runtime-js/src/builtins/fatal-report.ts]
---

## Context

Found by the CLOSE review of PR #425 (REV-12). Probe 2026-11-23, isolate
`runCode` vs Node v24.16.0: `throw Object.assign(new Error('x'), { cause: new
DOMException('m', 'AbortError') })` → Node `cause: DOMException [AbortError]:
m`, rifty `cause: AbortError: m`. Node's inspect prefixes the constructor name
when it differs from the error's `name`; the guest's `DOMException` is a
ceiling class (its constructor reads `DOMException2`, unit
`runtime-js/guest-builtin-names`), not an `Error` subclass the report
recognizes. A top-level `throw new DOMException(…)` prints `AbortError: m` in
both. Not declared in compat yet.

Owner: runtime-js (fatal report) with isolate-guest (ceiling `DOMException`).
Trigger: the `guest-builtin-names` unit landing, or an agent report.

## Challenge

challenge: 2026-11-23 — finding capture; no premise critic (README §Challenge)
