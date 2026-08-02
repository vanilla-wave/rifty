---
area: runtime-js
status: draft
title: Event-loop drain — late detached-Promise rejection can exit 0
created: 2026-08-02
why: awaitDrain can resolve on its final zero-ref sample before Chromium dispatches a detached Promise's unhandledrejection task, allowing a silent exit 0
user_story: As a Node program with a detached async failure after its last live handle, I want stderr and exit 1 rather than a silent successful exit.
sources: [ADR-0152, docs/backlog/npm-client/reference/sass-embedded-contract-red.md]
code: [packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

During the Sass substitution slice, a detached CJS IIFE awaited a routed import,
then synchronously threw `ENOENT`. Chromium returned child exit 0 before its
`unhandledrejection` task reached the installed trap. Awaiting the IIFE only for
diagnosis exposed the real error; that non-Node export protocol was removed.

This is `observable-order` at the child Worker lifecycle boundary. A focused
browser RED must release the last ref, reject through a multi-hop Promise chain,
and require stderr plus exit 1. The sole existing owner is `awaitDrain`; no new
lock, ledger, FIFO, epoch, or second drain owner is justified.

Dedup: `same-realm-child-async-throw-ownership` concerns fallback callback
exceptions; `worker-threads-kernel-error-event` concerns the parent `'error'`
event after a loud exit; `in-process-harness-vitest-ipc-noise` concerns test
teardown. None owns this Worker drain race.
