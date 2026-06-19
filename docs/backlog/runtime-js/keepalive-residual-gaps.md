---
area: runtime-js
status: active
title: Event-loop keepalive residual gaps — detached fetch/network uncounted; nested-spawn dispatcher backstop counted
created: 2026-06-20
why: ADR-0152 keepalive counts a deliberately NARROW handle set (timers/immediates/imports), not all libuv handles; two recorded divergences remain after timer .unref()/FSWatcher were closed
user_story: As a Node program detaching a `fetch()` after top-level (`fetch(u).then(write)`) in a run-to-completion child, I want the realm to stay alive until the response settles (Node parity) — instead the network handle holds no keepalive ref, so the child can drain to zero and reap BEFORE the response arrives → silent drop.
sources: [ADR-0152, child-realm-async-lifecycle]
code: [packages/net/src, packages/kernel/src/ipc/sync-dispatch.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Successor to the closed `timer-unref-keepalive` item. The keepalive (ADR-0152) counts a NARROW handle set — timers/immediates/pending dynamic imports. Closed since: timer `.unref()`/`.ref()`/`.hasRef()` + `node:timers` namespace symmetry + `clearTimeout/clearInterval(Number(handle))` by primitive id + `FSWatcher.ref()/.unref()` (all shipped, compat ✅). Two divergences remain, both ADR-0152-scoped-out-by-design (not silent — compat ❌/explicit):

**(d) Detached `fetch()`/network NOT counted (other-direction divergence).** The keepalive counts no network handle, so a `fetch()` (or other in-flight request) still pending after top-level resolve holds no ref → a run-to-completion child can drain to zero and reap BEFORE the response arrives → silent drop. compat `process.md`: Detached `fetch()` keepalive ❌. Faithful fix routes the net builtins' in-flight requests through `keepaliveRef`/`keepaliveUnref` (symmetric with `loader.import` / `esm.ts dynamicImport`). Needs a failing parity/regression test (detached `fetch().then(write)`) first. NOTE: expanding the counted set to network CONTRADICTS ADR-0152's recorded narrow-scope decision → reconcile/supersede ADR-0152 (own ADR), not a silent widening.

**(e) Nested-spawn dispatcher-backstop.** `kernel/src/ipc/sync-dispatch.ts` `ensureTimer()` arms a sync-RPC backstop `setInterval` (infra, not user code), keepalive-counted in the node-env; its host `.unref()` does NOT decrement the keepalive counter → would pin the drain of a run-to-completion child that itself spawned another node child (recursion-depth-2). NOT reachable today (`execSync` of a non-node command is `EUNSUPPORTED`; a speculative host-timer fix was reverted as premature). Fix when reachable: the backstop must use an UNCOUNTED host `setInterval` (same principle as the event-loop-keepalive poll, which already captures the host timer at module-load). Needs a recursion-depth-2 guard test before enabling.

## Reversibility

(d) IRREVERSIBLE-ish — widens the keepalive contract scope recorded in ADR-0152 → own/superseding ADR when built. (e) REVERSIBLE — swap one infra timer to an uncounted host timer; gated on reachability. Recorded here until then. Related: `[[child-realm-async-lifecycle]]`.
