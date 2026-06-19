---
area: kernel
status: parked
title: Forward a worker's uncaught GLOBAL error message to the child's stderr
created: 2026-06-20
why: spawn-worker.ts onError maps a worker's global `error` event to exit 1 but discards `ev.message`/stack, so an uncaught error thrown OUTSIDE the top-level await (e.g. inside a queueMicrotask — an unhandled `'error'` EventEmitter re-throw like EADDRINUSE) exits the child 1 with NO text on its stderr. The exit is loud (code 1) but the diagnostic vanishes.
user_story: As a developer whose node child hits an EADDRINUSE (or any async uncaught error), I want the error message on the terminal — not just an opaque exit 1 — so I can see what failed (and the terminal EADDRINUSE quick-fix can fire on the real string).
sources: [ADR-0157]
code: [packages/kernel/src/spawn-worker.ts, packages/runtime-js/src/builtins/process.ts, apps/playground/src/glue/terminal-quick-fix.ts]
---

## Context

`kernel/spawn-worker.ts` `onError(ev)` (the `worker.addEventListener('error', …)` handler)
maps any uncaught worker error to `dispatchExit(1)` but does NOT write `ev.message` to the
child's stderr port. `worker-entry.ts` only catches a TOP-LEVEL throw (mapping it to stderr +
exit 1); an error thrown later (inside a `queueMicrotask`, a timer, or an unhandled `'error'`
EventEmitter re-throw) escapes to the worker global `error` event → `onError` → silent exit 1.
The REPL host path (`host.ts`) DOES forward (`emit stderr [worker error] ${event.message}`); the
kernel-spawned-child path does not. Surfaced by ADR-0157 C3: a same-realm double `listen()` emits
an async `'error'` EADDRINUSE that, if unhandled, exits 1 but its message never reaches the terminal,
so `terminal-quick-fix.ts`'s EADDRINUSE matcher never fires on a real rifty server error.

## Options or Next

In `spawn-worker.ts onError`, before `dispatchExit(1)`, push `ev.message` (+ filename:lineno if
present) into the child's stderr stream so the consumer's `handle.stderr().on('data')` sees it —
mirroring `host.ts`'s `[worker error]` forward. Keep it a single newline-terminated chunk. Add a
regression test (a worker that throws inside a queueMicrotask surfaces its message on stderr + exits 1).

## Reversibility

REVERSIBLE — additive error-forwarding + a test; no public API or wire-format change.
