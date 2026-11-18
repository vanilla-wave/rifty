---
area: distribution
status: draft
title: In the isolate host an uncaught throw followed by an endless microtask chain ends as a timeout, not exit 1
created: 2026-11-18
why: Node exits 1 inside its fatal handler before any further microtask runs; the isolate host reports the throw but the isolate never leaves its microtask checkpoint, so the run ends at the deadline.
sources: [docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/isolate-host/src/child/main.ts]
---

## Context

Measured @ 1d3fc3c43, `node -e` v24.16.0 against `runCode(code, { timeoutMs: 3000 })`:
`setTimeout(() => { const f = () => queueMicrotask(f); f(); throw new Error('x') })`
→ Node exit 1 with the `Error: x` diagnostic; host `{exitCode: null,
termination: 'timeout'}`, stderr empty. The guest's fatal path writes and
calls the runtime's exit, but V8 drains the microtask queue before control
returns to the host, and this one never drains. Node's `process.reallyExit`
leaves from inside the handler. Ending the isolate from the child on the
fatal path was removed in cross-review 2 with `bridge.done` (a guest could
call it); any fix must not give the guest a way to end its own run as a
host-reported status. Bounded by I4; a fidelity gap, compat ⚠️.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
