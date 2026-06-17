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

## Options or Next

Return a Node-shape Timeout wrapper from `keepaliveSetTimeout`/`keepaliveSetInterval` whose:
- `.unref()` calls `keepaliveUnref()` once (idempotent; marked `_unrefed` flag so fire/cancel doesn't double-count)
- `.ref()` re-calls `keepaliveRef()` (idempotent inverse)
- `.hasRef()` returns the current state

Fix the namespace asymmetry by making the `timers` object point at the keepalive wrappers instead of host globals.

## Reversibility

REVERSIBLE — additive handle behavior, no wire change. Depends-on/related: `[[child-realm-async-lifecycle]]`.
