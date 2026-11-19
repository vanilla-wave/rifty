---
area: distribution
status: draft
title: In the isolate host an uncaught throw from a queueMicrotask callback ends as a timeout, not exit 1
created: 2026-11-18
why: ADR-0557 §5 routes a throwing queueMicrotask callback to rifty's uncaught path; the run instead reports the error and then waits for the deadline. Present on main 4018de0fc and in the isolate-guest README embedder (hangs).
sources: [docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md, docs/adr/distribution/0558-export-the-isolate-guest-bundle-and-bridge-contract-as-an-unstable-package.md]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Context

Measured 2026-11-18 @ 2c80b0900 (found by the goal isolate-guest-embed Final+GREEN
reviewer, also at 4018de0fc), Node v24.16.0, `runCode(code, { timeoutMs: 3000 })`:

- `queueMicrotask(()=>{throw 1})` → Node exit 1, stderr `1` diagnostic; host
  `{stdout: '', stderr: '1\n', exitCode: null, termination: 'timeout'}`.
- `queueMicrotask(()=>{throw new Error('x')})` → same shape: the `[eval]`
  diagnostic is written, then `termination: 'timeout'`.
- Contrast `Promise.resolve().then(()=>{throw 1})` → exit 1 (the rejection path).

The fatal text is written, so the uncaught path runs, but the run never ends.
Unlike `isolate-host-uncaught-throw-waits-for-microtask-checkpoint`, no endless
microtask chain is involved. Owner: next isolate-host runtime-fidelity pickup;
trigger: any change to the shim's `queueMicrotask` or the eval lifecycle.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
