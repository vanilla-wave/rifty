---
area: service-worker
status: ready
title: Preview dispatch termination chokepoint — settle on every terminal event
created: 2026-07-05
why: the SW reply-await is unbounded and hop deaths (worker kill, channel close, socket destroy) can park a request forever; parity-first error UX needs ONE place that turns «no response will ever come» into a diagnosable reply
user_story: As a developer, I want any preview or loopback request whose upstream died to settle with a diagnosable error promptly, but today `route-preview.ts:108` awaits the reply forever and mid-request worker-death semantics are untested
epic: fault-honest-sw-preview
blocked_by: []
code: [packages/service-worker/src/route-preview.ts, packages/net/src/cross-realm/preview-port.ts, packages/net/src/registry.ts]
---

## Context

Chain: SW `routePreview` (MessageChannel reply-await — UNBOUNDED, `route-preview.ts:108-164`) → page `bridgeCrossRealmPreview` (30s no-progress timer, 502 on dispose) → worker `serveCrossRealmPreview` (accept frame) → `dispatchToPort` → vite/user server. Loopback `http.request` (ADR-0180) rides the same broker. Some terminal events are already honest (owner-departed 503, bridge-disposed 502) — pin them; the rest park. (The blocking `preview-blocked-host-hang` diagnosis RESOLVED — the "host-check parks the iframe" hang was rifty `node:net` missing `isIP` throwing inside vite's async host-check middleware, NOT a lost response; real `isIP` landed with parity `cases/net/is-ip`, and the preview path is unreachable for a rejected Host anyway since the SW stamps `Host: localhost` (ADR-0189 D3). So this chokepoint is now unblocked, and its evidence base is that a hang here means a lost TERMINAL event, never a lost upstream 4xx.)

## Acceptance

Every request through the broker settles on EVERY terminal event; one fault test per row (RED first):

- upstream response, incl. error statuses → relayed verbatim; NO synthesized page when a response exists (epic parity-first decision);
- owner worker dies mid-request → error reply ≤ bound; iframe gets a synthesized diagnosable error page (status + failed hop + hint); loopback `http.request` gets a socket error like real Node against a killed server — never a parked promise;
- channel/port closes (page reload, dispose) → in-flight requests settle (existing 502 — pinned by a fault test);
- reply frame silently lost (no frame at all) → SW-level backstop fires, synthesized page names the silent hop;
- existing honest branches (owner-departed 503, bridge-disposed 502) pinned.

## Parity cases

- Real Node: `http.request` to a server killed mid-response → `'error'` (`ECONNRESET` family) — the loopback path matches the event + error-code family.
- Real browser + vite: kill the dev server mid-load → the browser settles with a connection error, never an infinite pending request — preview settles analogously within the bound.

## Fault matrix

- `unbounded-read` × SW reply-await → bounded backstop (today unbounded).
- `unbounded-read` × worker accepts then goes silent → page 30s no-progress (exists — pin) + SW backstop ordered above it.
- `false-fallback` × worker death mid-stream → error frame → settle (partially exists — pin with a fault test).
- `false-fallback` × `dispatch()` rejects → error reply, never a dropped promise.

## Out of scope

- Backpressure / MessagePort swap — ADR-0017 M12 phase.
- Dual-bind arbitration (two workers, one port) — ADR-0186 owns.
- Non-loopback egress fetch/WS — native browser semantics.

## Decisions

- ONE chokepoint at the SW routing layer owns the backstop + synthesized page; hops report terminal events to it — no per-hop twin timeouts (class-kill shape, `docs/process/fault-classes.md`).
- Bounds: page-bridge keeps its 30s no-progress; the SW backstop is strictly greater so the page bridge's better-informed 502 wins the race; exact constants REVERSIBLE → CHANGELOG at impl.
- Synthesized page = status + failed hop + actionable hint (e.g. «dev server exited — restart it»), no stack dumps.
