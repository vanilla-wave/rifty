# ADR 0186: Cross-realm EADDRINUSE via per-port bind-claim broadcast

Status: Accepted
Date: 2026-07

> TL;DR: at `listen(port)`, before registering, a realm broadcasts a `claim` on the per-port preview `BroadcastChannel` (ADR-0043/0180's channel); an existing owner replies `claim-deny` and a concurrent claimant tie-breaks by a deterministic id, so exactly one realm binds and the loser emits Node-shaped `EADDRINUSE` (errno -98, syscall `listen`). Released on `close()`/realm-exit. Kernel port-table rejected (consistent with ADR-0180 D1).

## Context

The port registry is realm-local (`packages/net/src/registry.ts` — a per-Worker `Map<number, PortHandler>`). `listen()` (both `HttpServer.listen` in `http/server.ts` and `Server.listen` in `net.ts`) checks only THAT realm's registry, so it catches an intra-realm double-listen with a Node-shaped `EADDRINUSE` (ADR-0157) but NOT a cross-realm one: two supervised-child node realms (ADR-0150) can each bind `:3000` because their registries don't share a claim.

ADR-0180 made this observable: its broker routes an in-sandbox `http.request` to a loopback port owned by a sibling realm, and when ≥2 remote realms own the same port the client gets first-acker-wins (ADR-0180 D5) — a divergence from Node, where the SECOND cross-process bind never succeeds. ADR-0180 D5 explicitly deferred faithful cross-realm `EADDRINUSE` to this ADR. Single-owner routing is unaffected; this is the missing cross-process bind-conflict semantics.

Node's contract: the second process to `bind`/`listen` an already-bound port fails with `EADDRINUSE`; the first keeps the port; on the first's `close`/exit the port frees. We reproduce the OBSERVABLE contract (second `listen` → async `'error'` EADDRINUSE), not an OS socket.

## Decision

### D1 — Broadcast claim on the existing per-port channel, not a kernel port-table

At `listen(port)`, after the synchronous intra-realm `isPortBound` fast-path (ADR-0157, unchanged) and before registering, the realm opens the per-port `BroadcastChannel` (`previewPortChannelUrl(port)` — the SAME channel ADR-0043/0048/0180 already use) and broadcasts a `claim{port, id}`. It collects responses for a bounded **claim window**, then either registers (win) or emits `EADDRINUSE` (lose). The claim/deny frames are additive members of the existing `PreviewPortFrame` union (ADR-0031 per-frame versioning) — no new transport, no channel-name change.

REJECTED — a kernel/owner authoritative port-claim table consulted synchronously per `listen()`: same rejection as ADR-0180 D1 (adds a sync RPC per listen, leaks cross-PID port visibility, can't pre-populate ephemeral ports). The broadcast reuses shipped machinery and keeps the claim inside `@riftydev/net`. The cost (a claim-window latency on every `listen`) is accepted — see Consequences — exactly as ADR-0180 accepted the probe-window latency for the client path; production perf is a non-goal (AGENTS.md).

### D2 — Deny + deterministic tie-break resolves both races

Two conflict shapes, both resolved without a central arbiter:

- **Existing owner vs new claimant:** a realm that already OWNS `port` (won an earlier claim, registered) keeps a listener on the channel and replies `claim-deny{port, id}` immediately to any incoming `claim`. The claimant that sees a deny within its window loses → `EADDRINUSE`.
- **Two concurrent claimants** (both mid-window): each broadcasts `claim` and sees the other's `claim`. Both apply the SAME total order on the `id` — the LOWER `id` wins, the higher self-denies. `id` is a per-claim unique, lexicographically-orderable string (counter + random tail, `nextClaimId`); a tie is astronomically unlikely and both sides compute the identical winner, so the resolution is symmetric and race-free without extra messages.

The claim window MUST be ≥ the channel's same-origin delivery latency so both peers observe each other's frames; it is injectable (tests/e2e use a short value). A free port has no denier, so an uncontended `listen` waits the full window before firing `'listening'` (Consequences).

### D3 — Owned only between claim-aware peers; additive degrade

`claim`/`claim-deny` are additive (ADR-0031): a pre-0186 peer never sends them, so it neither denies nor competes — a new claimant facing only old peers wins (the pre-0186 double-bind status quo), never mis-fails. Within a single shipped version all realms are claim-aware, so the conflict is caught. No version bump of `PREVIEW_PORT_FRAME_VERSION` (purely additive union members).

### D4 — Release on close / realm-exit

`close()` calls `releasePort(port)`: stop answering `claim` for it and `unregisterPort`. On realm teardown the realm's `BroadcastChannel`s die with it, so its owner-answerer simply stops — a later claimant sees no deny and wins. No explicit cross-realm "released" frame is needed (absence of a denier IS release).

### D5 — Explicit ports only; ephemeral and non-HttpServer owners out of scope

The claim fires only for an EXPLICIT `listen(port)` with `port !== 0`. `listen(0)` ephemeral allocation stays realm-local (Node's `listen(0)` never throws `EADDRINUSE`); cross-realm uniqueness of ephemeral ports is a separate, pre-existing divergence (ADR-0180 D5 for ephemeral) and is NOT claimed here. The claim is driven by `@riftydev/net`'s `listen`/`close`, so only rifty `HttpServer`/`net.Server` owners participate; a port held by a NON-HttpServer owner (e.g. the Vite dev-server preview, which uses `serveCrossRealmPreview` directly, not `listen`) does not deny — a deliberate, honest boundary (a user `listen()` colliding with the dev-server port is not caught).

## Consequences

- Faithful cross-realm `EADDRINUSE`: a second sandbox node process that `listen`s an already-bound port emits Node-shaped `'error'` (errno -98, syscall `listen`) instead of silently double-binding — closing the ADR-0180 D5 gap so port-conflict bugs surface as in Node.
- Every `listen(port)` (port ≠ 0) now waits the claim window before registering, firing `'listening'`, or calling the callback, even uncontended (a free port cannot be proven free without waiting). Bounded, publicly tunable through `getDefaultClaimWindowMs`/`setDefaultClaimWindowMs` for harnesses and deployments; production perf is a non-goal.
- One additive frame pair (`claim`/`claim-deny`) on the existing channel; no new transport, no `PREVIEW_PORT_FRAME_VERSION` bump (ADR-0031 additive).
- Ephemeral (`listen(0)`) and non-HttpServer (Vite preview) cross-realm collisions remain unclaimed (D5) — documented, not hidden.
- Shared helper (`claimPort`/`releasePort`) covers BOTH `HttpServer.listen` and `net.Server.listen`, so the two listen paths stay in lockstep.

## References

- ADR-0180 (cross-realm http loopback via the broker — D5 deferred this; D1 rejection reused), ADR-0157 (intra-realm `EADDRINUSE`), ADR-0043 (cross-realm preview bridge), ADR-0048 (streaming wire-frame / per-port channel), ADR-0150 (supervised child processes), ADR-0031 (per-frame versioning).
- `packages/net/src/registry.ts` (`addrInUseError`, `isPortBound`), `packages/net/src/http/server.ts` (`HttpServer.listen`/`close`), `packages/net/src/net.ts` (`Server.listen`/`close`), `packages/net/src/cross-realm/preview-port.ts` (`PreviewPortFrame`, `previewPortChannelUrl`), new `packages/net/src/cross-realm/port-claim.ts` (`claimPort`/`releasePort`).
