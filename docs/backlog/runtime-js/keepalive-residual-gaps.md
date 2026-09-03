---
area: runtime-js
status: draft
title: Event-loop keepalive — detached fetch + nested-spawn backstop SHIPPED (ADR-0158); residual = depth-2 end-to-end drain guard, blocked on nested node-spawn reachability
created: 2026-06-20
why: ADR-0152 §1 counts a narrow handle set; gap-d (detached fetch uncounted) and gap-e (dispatcher backstop counted) are now closed by ADR-0158. The only residual is verifying the gap-e fix END-TO-END at recursion depth ≥ 2, which is unreachable today (execSync of a node command is EUNSUPPORTED).
user_story: As a Node program detaching a `fetch()` after top-level (`fetch(u).then(r=>r.text()).then(write)`) in a run-to-completion child, I want the realm to stay alive until the response settles (Node parity).
sources: [ADR-0152, ADR-0158]
code: [packages/runtime-js/src/builtins/fetch-keepalive.ts, packages/kernel/src/ipc/sync-dispatch.ts, packages/runtime-js/src/internal/event-loop-keepalive.ts]
---

## Context

Successor to the closed `timer-unref-keepalive` item. ADR-0152 §1 counts a NARROW handle set — timers/immediates/pending dynamic imports. Earlier-closed: timer `.unref()/.ref()/.hasRef()` + `node:timers` symmetry + `clearTimeout/clearInterval(Number(handle))` + `FSWatcher.ref()/.unref()` (compat ✅).

## SHIPPED — ADR-0158

**(d) Detached `fetch()`/network — DONE for public Body consumers.** `installFetchKeepalive()` (`packages/runtime-js/src/builtins/fetch-keepalive.ts`) wraps the realm's global `fetch`: `keepaliveRef()` on dispatch, released once a Body-mixin/`body` stream consumes, cancels, or errors, on request reject, or when there is no body. Held until the body (not headers) because Node keeps the socket refed until the body is read. `http.request`-to-external routes through `fetch` (covered); loopback is in-process; `https`/`net.connect` are loud-throws. Package loopback guards; compat `process.md`: Detached `fetch()` ✅.

**Native WebAssembly streaming — explicit loud gap.** Chromium consumes Response
internal slots and accepts arbitrary clone/untracked PromiseLike carriers, so
exact-fetch mediation cannot own the whole boundary. Both streaming APIs reject
feature-specific `NotImplementedError` Promises unconditionally; byte-buffer
compile/instantiate remain available. Real-Chromium ceiling/carrier/priority/
effective-descriptor guard; compat `process.md`: WebAssembly streaming ❌.

**(e) Nested-spawn dispatcher backstop — DONE (mechanism).** `sync-dispatch.ts` now captures the HOST `setInterval`/`clearInterval` at module load and arms the backstop on them, so the infra timer never enters the keepalive count by construction (ADR-0152 §5 precedent) — at ANY recursion depth. Removes the prior depth-1 count-then-`.unref()` coupling. Guard: `packages/kernel/src/ipc/sync-dispatch.test.ts` (backstop arms the host timer, not the keepalive-wrapped global).

## Residual (blocked)

The gap-e mechanism is proven by the unit guard (backstop is uncounted at any depth). An END-TO-END depth-2 test — a node child that spawns another node child and drains correctly — cannot be written today: `execSync` of a node command is `EUNSUPPORTED` (a speculative host-timer fix was reverted as premature). Add the recursion-depth-2 drain guard when nested node-spawn becomes reachable. No behavioral gap remains; this is end-to-end verification blocked on an absent capability.

Related: ADR-0152 and package-tooling e2e `tests/e2e/owner-shell-prettier-eslint.spec.ts`.
