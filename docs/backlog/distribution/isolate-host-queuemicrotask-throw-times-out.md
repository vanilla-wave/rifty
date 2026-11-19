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

Same shape, 2026-11-19 @ dd4ea8b42 (Node v24.16.0, `timeoutMs: 3000`): a guest `process.exit(n)` from a
promise callback or `queueMicrotask` queued by the code's synchronous run — `Promise.resolve().then(() =>
process.exit(0))`, `main().then(() => process.exit(0))`, `.catch(() => process.exit(1))` — ends as
`termination: 'timeout'` (output kept); Node exits with `n`. From a later task (`setTimeout(() =>
Promise.resolve().then(() => process.exit(3)), 1)`, after `await` of a timer) the host exits as Node;
`process.exitCode = n` in a microtask works. Same with isolated-vm rebuilt without `SetWeak()`. Whether it
shares this item's cause is unverified. Lead: stderr gets `Error: process exit requires an active control port`
at `#requestSelfExit` ← `onFlushed` — the exit lands before the guest entry calls `awaitDrain`, so the eval
lifecycle takes its no-drain path (`completeNodeEvalTerminalWithoutDrain`,
`packages/runtime-js/src/internal/event-loop-keepalive.ts`), which needs a kernel control port this host lacks. Compat ⚠️ row "`process.exit()` from a promise callback". Deterministic (nothing ends such a run): `timeout` in 160/160
runs, 16 concurrent under CPU load; pinned in `packages/isolate-host/tests/parity.test.ts` (runCode lane only:
the corpus lanes would wait a 30 s deadline per run).
Unlike `isolate-host-uncaught-throw-waits-for-microtask-checkpoint`, no endless
microtask chain is involved. Owner: next isolate-host runtime-fidelity pickup;
trigger: any change to the shim's `queueMicrotask` or the eval lifecycle.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
