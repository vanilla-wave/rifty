---
area: distribution
status: draft
title: Isolate host — an unhandled rejection whose promise the GC collects before its task ends exits 0 with no diagnostic
created: 2026-11-19
why: A silent false success in merged code: Node exits 1 with the rejection's report; runCode and the README embedder exit 0, stderr empty.
user_story: As a service running model-generated code that rejects a promise and then allocates (a few ms of work), I want Node's exit 1 and the error so the model can fix it, but today runCode reports a clean exit 0.
sources: [docs/public/compat/isolate-host.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-guest/README.md]
---

## Context

Found in cross-review round 2 of PR #412 (2026-11-19, macOS arm64, Node v24.16.0, isolated-vm 7.0.2):
`Promise.reject(new Error('x')); const e = Date.now() + 10; while (Date.now() < e);` → `node -e` exit 1
with the diagnostic, `runCode` exit 0, stderr `''`; with `+ 2`, exit 1.

Root cause (verified 2026-11-19 @ 9b948d757, not timing): isolated-vm records an unhandled
rejection by **weak** handle (`src/isolate/environment.cc:155`,
`unhandled_promise_rejections.back().SetWeak()`) and reports the list at the end of the isolate
task (`TaskEpilogue`). A GC in between collects an unreferenced promise, the record goes empty,
`onUnhandledRejection` is never called — the report is lost, not late. Busy-waiting is a GC dial
(`Date.now()` allocates HeapNumbers). Evidence:

- bare isolated-vm, no rifty (`node --expose-gc`, `evalSync`, handler counts reports):
  `Promise.reject(1)` → 1; `Promise.reject(1); gc()` → 0; `globalThis.p = Promise.reject(1); gc()` → 1;
  `Promise.reject(1)` + 10 ms busy → 0; + 2 ms → 1.
- `runCode`, 3 runs each: reference held + 10 ms busy → exit 1 3/3; unheld + 2e6 object allocations
  → exit 0 3/3; unheld + a 3e7-iteration integer loop (no allocation) → exit 1 3/3.
- isolated-vm 7.0.2 rebuilt from source without `SetWeak()`: bare counts 1/1/1, `.catch` + `gc()`
  still 0 (handled stays handled); corpus rows `reject-then-*` all green for `runCode` and the
  README embedder (40/40), red on the stock prebuild (23 rows).

Independent re-check 2026-11-19 (second agent, from scratch, bare isolated-vm 7.0.2): under GC pressure 0/12
reports stock, 12/12 without `SetWeak()`, Node 24 12/12 on the same code. Also found:

- `TaskEpilogue` is skipped when a task's body throws (`src/isolate/three_phase_task.cc:182,201,253-264,332`):
  records then wait for the next completed task's epilogue or the isolate's disposal
  (`environment.cc:452` `clear()`). Without `SetWeak()` they are strong meanwhile (64 promises / ~8 MiB survived
  a GC into the next task, then reported). In this host the isolate lives one call and is disposed at its terminal
  frame, and the records sit in the call's own heap (`memoryLimitMb`): retention is bounded by the call. Guest
  tasks do not throw out of the body (`run` and `fireTimer` catch; probe @ f405533a7 of six fatal/exit rows logged
  no escaped `fire`); a record that arrives after the terminal is dropped (`Isolate is disposed`), status already
  Node's in those rows.
- `SetWeak()` came with the #252 leak fix (`8a3ace674bce`, 2021) together with
  `CopyablePersistentTraits`: the leak was the drained list's `Persistent`s never resetting in their destructor.
  The list is `v8::Global` now (resets on destruction) and drained every completed task; upstream's #252
  regression (`tests/promise-error.js`) passes with and without the patch.
- Without `onUnhandledRejection` (isolated-vm 6.2.0, or 7 without the hook) the same loss turns the call's
  rejection into a normal result (`evalSync` returns its value).
- Rejected alternative without a fork: an `ivm.NativeModule` installing `Context::SetPromiseHooks` that roots
  the context's promises reports 12/12, but roots every promise (settled ones too) until the context dies and
  is still rifty-owned native code built per platform — a fork's cost with a leak on top.
- Upstream: npm `latest` 7.0.2; `main` @ d180c553 has the same line; no issue or PR about GC loss.

No guest-realm or host-JS fix is causal: V8 creates the promises (async functions, `then`), only
the embedder's `PromiseRejectCallback` sees them, and isolated-vm owns it. The fix is that one line
in isolated-vm, shipped to consumers. Every isolated-vm embedder of `@riftydev/isolate-guest` has it.

Neighbours checked, different causes (their diagnostic is written, so no report is lost; the
lifecycle after it misbehaves): `isolate-host-queuemicrotask-throw-times-out`,
`isolate-host-uncaught-throw-waits-for-microtask-checkpoint`; `runtime-js/node-eval-unhandled-rejection-timing`
and `late-unhandled-rejection-drain` are rifty lifecycle/browser paths.

RED: `packages/isolate-host/tests/corpus.ts` rows `reject-then-sync-work-{1..20}ms`,
`reject-*-then-gc`, `reject-caught-then-gc` (runCode + README embedder lanes).

## Decisions

- owner: user — how the patched isolated-vm reaches consumers: (A) fork with own prebuilds
  (npm package, or binaries inside the `isolate-host` tarball) + upstream PR, kill condition =
  an upstream release with the fix; (B) upstream PR only, the gap stays ⚠️ until a release.
  Needs a new native dependency and publishing (`DEC-3`). Probe: bare isolated-vm counts above;
  RED rows above.

## Challenge

challenge: 2026-11-19 — finding capture; no premise critic (README §Challenge)
