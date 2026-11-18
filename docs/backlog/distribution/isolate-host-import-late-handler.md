---
area: distribution
status: draft
title: Isolate host — an import() rejection whose handler attaches in a later task exits 0
created: 2026-11-18
why: Node reports the import() rejection unhandled at the microtask checkpoint (exit 1); isolated-vm suppresses its unhandled report once a handler attaches before its late flush.
sources: [docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md, docs/public/compat/isolate-host.md]
code: [packages/isolate-host/src/child/main.ts, packages/isolate-host/src/guest/entry.ts]
---

## Context

`runCode("const p = import('x'); setTimeout(() => p.catch(() => console.log('late')))")`
→ `late`, exit 0, no `unhandledRejection` event; Node v24.16.0 exits 1
(`ERR_MODULE_NOT_FOUND`). Same with `setImmediate` or `await` inside an
immediate; at 2 ms the outcome flips run to run. Instrumented child: for this
promise isolated-vm's `onUnhandledRejection` never fires when the catch lands
first. Plain `Promise.reject` in the same position is reported. The import
promise is created by V8 for a host-served `importModuleDynamically`, so the
guest cannot own its rejection. Declared ⚠️ by RDY-5 trim after three review
rounds (goal `isolate-host-run-code` ledger). Settles it: a probe of isolated-vm's
experimental branch / V8 `PromiseRejectCallback` ordering, or a guest-side
import() rewrite with its own rejection.

## Challenge

challenge: 2026-11-18 — finding capture; no premise critic (README §Challenge)
