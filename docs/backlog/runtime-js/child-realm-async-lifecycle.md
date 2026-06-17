---
area: runtime-js
status: active
title: Child realm event-loop keepalive + loud failure on unsettled async
created: 2026-06-16
why: a run-to-completion child worker self.close()s when the entry top-level resolves, dropping pending timers/setImmediate/detached promises — a CLI doing work after top-level (import(...).then(run)) silently no-ops (exit 0, nothing done)
user_story: As a dev running an async CLI in the supervised child (ADR-0150 P6a), I want it to run to real completion (Node-parity event-loop drain) — and if its async work rejects or never settles, fail LOUDLY (stderr + non-zero exit), not silently exit 0.
sources: [ADR-0150, ADR-0085, ADR-0144]
code: [packages/kernel/src/worker-entry.ts, apps/playground/src/workers/node-entry-bootstrap.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/builtins/timers.ts]
---

## Context

ADR-0150 P6a runs each foreground CLI in a child worker (`serve:false` → run-to-completion). `worker-entry.ts` awaits the entry TOP-LEVEL (`runNodeEntry` → `loader.import`), then `finalizeWorkerEntry` posts exit + `self.close()`. Anything scheduled AFTER top-level — `setTimeout`/`setImmediate` callbacks, a detached `promise.then(...)` — is dropped: the realm is gone. Real Node exits on "event loop empty", not "top-level resolved".

Surfaced by `prettier --write` (P6a verification): prettier's bin sets `module.exports.__promise = import(...).then(cli.run)` and returns; the child exits before `cli.run()` (parse/format/`writeFileSync`) runs → silent no-op, exit 0, file unchanged. cowsay works only because it draws SYNCHRONOUSLY during top-level eval. This is a P6a regression: the persistent owner (`serve:true`) kept the loop alive so detached work completed in-realm; the run-to-completion child does not.

Two parts: (1) keepalive — track outstanding timers/immediates/refs, exit on drain (libuv-style refcount); (2) loud-fail — `unhandledrejection` / unsettled-on-drain → stderr + exit≠0 (CLAUDE.md: no silent stub). Often pairs with the routing gap `runtime-js/cjs-dynamic-import-routing` (prettier needs that too — and has a hard ceiling beyond it). Sibling of `kernel/server-shaped-worker-process-lifecycle`: both stem from `installWorkerEntry` exiting on top-level resolve — that item keeps a SERVER alive (the ADR-0144 `serve` flag), this one lets a run-to-completion child DRAIN pending async before it exits.

## Options or Next

Add an event-loop ref tracker (timers/immediates increment, settle decrements); `finalizeWorkerEntry` waits for zero-refs (with a sane cap) before close. Add `self.addEventListener('unhandledrejection', …)` in the worker entry → stderr + exit 1. Likely its own ADR (changes the run-to-completion lifecycle/exit contract).

## Reversibility

IRREVERSIBLE-ish — changes worker process lifecycle / exit contract → own ADR when built. Recorded here until then.
