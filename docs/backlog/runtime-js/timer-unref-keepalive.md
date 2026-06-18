---
area: runtime-js
status: active
title: Event-loop keepalive does not honor timer `.unref()`/`.ref()`; node:timers namespace setTimeout not refcounted
created: 2026-06-17
why: keepaliveSetTimeout/Interval refs EVERY timer; an `.unref()`'d timer that Node lets the loop exit through instead holds the realm alive until the drain cap loud-fails — observable Node-divergence
user_story: As a Node program that calls `setInterval(fn,1000).unref()` to avoid blocking exit, I want the realm to drain cleanly — instead rifty ignores `.unref()` and the keepalive holds the realm until the 30s drain cap.
sources: [child-realm-async-lifecycle]
code: [packages/runtime-js/src/builtins/timers.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

`keepaliveSetTimeout`/`keepaliveSetInterval` (timers.ts) call `keepaliveRef()` for every timer. The raw host handle is returned — a number in the browser worker (no `.unref()` exists), a Node `Timeout` object in the test env (whose `.unref()` the keepalive silently ignores). So `.unref()` is a no-op against the keepalive counter, and the realm stays alive until the 30s drain cap triggers a loud failure instead of a clean exit — observable divergence from Node.

Related asymmetry: the `timers` namespace object (`const timers = { setTimeout, ... }`) captures the HOST `setTimeout` at module load, so `require('node:timers').setTimeout` is NOT refcounted, while the global `setTimeout` (installed by `installTimerGlobals`) IS. Same call, different keepalive behavior depending on how the caller imports.

## Confirmed conditional drain leaks (empirically established during child-realm-async-lifecycle work)

The count-all keepalive model produces confirmed hang paths:

**User `.unref()` ignored.** A user program calling `setInterval(fn, 1000).unref()` or `setTimeout(fn, 1000).unref()` to avoid blocking exit gets no relief: in the browser worker the host `setTimeout` returns a plain number (`.unref()` throws loudly); in the node-env the returned `Timeout` object's `.unref()` is silently ignored by the keepalive counter. Either way the refCount stays elevated → realm held until the 30s drain cap → loud forced exit instead of clean drain.

**`fs.watch`/`fs.watchFile` FSWatcher `.ref()`/`.unref()` are no-op stubs.** `fs-watch.ts` exposes `FSWatcher` but `ref()`/`unref()` do nothing; any user program that watches a file and unrefs the watcher is silently pinned.

**Nested-spawn dispatcher-backstop.** `kernel/src/ipc/sync-dispatch.ts` `ensureTimer()` arms a sync-RPC backstop `setInterval` (infra, not user code). In the node-env this is keepalive-counted, and its `.unref()` no-ops → would pin the drain of a run-to-completion child that itself spawned another node child (recursion-depth-2). NOT reachable today (`execSync` of a non-node command is `EUNSUPPORTED`; a speculative host-timer fix was reverted as premature). **Fix when reachable**: the backstop must use an uncounted HOST `setInterval` (same principle as the event-loop-keepalive poll — rifty infra timers must not keep a Node process alive). Needs a recursion-depth-2 guard test before enabling.

## Options or Next

Faithful fix requires two coordinated changes:

1. Return a Node-shape `Timeout` wrapper from `keepaliveSetTimeout`/`keepaliveSetInterval` with `.unref()` → `keepaliveUnref()` (idempotent, `_unrefed` flag prevents double-count), `.ref()` → `keepaliveRef()`, `.hasRef()` → current state.
2. Make all rifty infra timers (event-loop-keepalive poll, sync-dispatch backstop) use raw uncounted HOST timers — they must never contribute to keepalive refCount.

Fix the `timers` namespace asymmetry (point `require('node:timers').setTimeout` at the keepalive wrapper, not the host global) as part of step 1.

## Reversibility

REVERSIBLE — additive handle behavior, no wire change. Depends-on/related: `[[child-realm-async-lifecycle]]`.
