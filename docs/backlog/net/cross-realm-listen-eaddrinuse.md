---
area: net
status: ready
title: Cross-realm EADDRINUSE — two sandbox processes can't bind the same loopback port
created: 2026-06-28
why: cross-realm loopback (ADR-0180) makes a port owned by ≥2 realms ambiguous (first-acker-wins); Node refuses the second cross-process bind with EADDRINUSE, but rifty's realm-local registries silently let both bind
user_story: As a developer running two sandbox node processes that both `listen(3000)`, I want the second to fail with EADDRINUSE like Node (so a port-conflict bug surfaces), but today each realm has its own registry so both bind and a client reaching :3000 is first-acker-wins (ADR-0180 D5).
sources: [ADR-0185, ADR-0180, ADR-0157, ADR-0043, ADR-0048]
code: [packages/net/src/registry.ts, packages/net/src/http/server.ts, packages/net/src/net.ts, packages/net/src/cross-realm/preview-port.ts]
---

## Context

`listen()` (both `HttpServer.listen` and `net.Server.listen`) only checks the LOCAL realm registry, so it catches an intra-realm double-listen with a Node-shaped `EADDRINUSE` (ADR-0157) but NOT a cross-realm one — two Worker realms can each bind `:3000` because registries don't share a claim. ADR-0180's broker makes this observable: a client reaching a port owned by ≥2 remote realms is first-acker-wins (a divergence from Node, where the second bind never succeeds). Single-owner routing is unaffected; this item is the missing cross-process bind-conflict semantics. Mechanism (the broadcast bind-claim + race resolution) is decided in **ADR-0185**.

## User scenario

A developer runs a multi-process node app in the sandbox (ADR-0150 supervised children): `proc-a` is `node server-a.js` which does `http.createServer(...).listen(3000)`; `proc-b` is `node server-b.js` which ALSO does `.listen(3000)` (a real bug — two services fighting for a port). In real Node the second process's server emits `Error: listen EADDRINUSE: address already in use :::3000` (`code:'EADDRINUSE'`, `errno:-98`, `syscall:'listen'`) and never starts; the first keeps the port. Today in rifty both bind silently and an in-sandbox `http.request('http://localhost:3000')` from a third realm reaches whichever realm acked first (ADR-0180 D5) — the conflict is hidden. Done when `proc-b`'s `listen(3000)` emits the Node-shaped `'error'` EADDRINUSE while `proc-a` keeps serving :3000, and after `proc-a` exits a fresh `listen(3000)` succeeds.

## Acceptance

- A second realm's `listen(port)` for a port a sibling realm already owns emits an asynchronous `'error'` carrying `{ code:'EADDRINUSE', errno:-98, syscall:'listen', port }` (the `addrInUseError` shape already used intra-realm); `'listening'` never fires for it and it is NOT registered.
- The first (owning) realm is unaffected — it keeps serving the port; the cross-realm client routing (ADR-0180) reaches it deterministically (no more first-acker-wins for that port).
- After the owner `close()`s or its realm exits, a fresh `listen(port)` from any realm succeeds and becomes the new owner.
- Two near-simultaneous `listen(port)` from different realms resolve to EXACTLY one winner and one EADDRINUSE (deterministic tie-break, ADR-0185 D2) — never both-win, never both-fail.
- The intra-realm double-listen path (ADR-0157) is unchanged (still a synchronous-registry fast-path → async EADDRINUSE).
- A browser e2e drives two real supervised-child realms binding the same port and asserts the second's EADDRINUSE + the survivor's continued service.

## Parity cases

Node behaviors to pin (cross-realm ones via the browser e2e; the error SHAPE via a unit/parity test):

1. `addrInUseError` shape parity: `code==='EADDRINUSE'`, `errno===-98`, `syscall==='listen'`, message `listen EADDRINUSE: address already in use …:<port>` — already pinned intra-realm (ADR-0157); reused verbatim for the cross-realm emit.
2. Cross-realm second bind (e2e): realm A `listen(3000)` succeeds (`'listening'` fires); realm B `listen(3000)` emits `'error'` EADDRINUSE and no `'listening'`.
3. Survivor routing (e2e): with A owning :3000 and B refused, a third realm's `http.request('http://localhost:3000')` reaches A (deterministic, not first-acker-wins).
4. Release (e2e): A `close()`s (or exits) → B (or a fresh realm) can now `listen(3000)` successfully.
5. Tie-break (unit, with injected short window + simulated concurrent claim): two claims for the same port in one window → exactly one `win`, one `in-use`, decided by the lower claim id.
6. `listen(0)` is never refused cross-realm (ephemeral; out of scope D5) — a parity/unit case asserts `listen(0)` skips the claim and always binds.

## Out of scope

- Ephemeral `listen(0)` cross-realm uniqueness — Node's `listen(0)` never throws `EADDRINUSE`; rifty allocates ephemeral ports realm-locally and does NOT claim them (ADR-0185 D5). Two realms `listen(0)` landing on the same virtual port stays the pre-existing ADR-0180-D5 ambiguity for ephemeral ports.
- Collision with a NON-`listen()` port owner (e.g. the Vite dev-server preview, which uses `serveCrossRealmPreview` directly) — it does not participate in the claim, so a user `listen(<vite-port>)` is not refused (ADR-0185 D5). Honest boundary, not silently "handled".
- The `host`/interface dimension of `EADDRINUSE` (Node distinguishes `0.0.0.0` vs `127.0.0.1` binds) — rifty is loopback-only (host ignored), so the claim keys on `port` alone, consistent with the intra-realm `addrInUseError` already reporting `127.0.0.1`.
- `SO_REUSEADDR`/`exclusive:false` semantics — accepted-but-unused (the option is parsed for Node shape; rifty has no shared sockets to re-use).

## Decisions

All mechanism is in **ADR-0185** (IRREVERSIBLE — new cross-realm claim contract):
- **Broadcast claim on the existing per-port channel** (not a kernel port-table) — ADR-0185 D1.
- **Deny + deterministic id tie-break** resolves owner-vs-claimant and claimant-vs-claimant races — ADR-0185 D2.
- **Additive `claim`/`claim-deny` frames**, degrade-per-peer, no version bump — ADR-0185 D3.
- **Release on `close()`/realm-exit** (absence of a denier = released) — ADR-0185 D4.
- **Explicit ports only; ephemeral + non-HttpServer owners out of scope** — ADR-0185 D5.
- Shared `claimPort`/`releasePort` helper (`packages/net/src/cross-realm/port-claim.ts`) called by BOTH `HttpServer.listen` and `net.Server.listen` so the two paths stay in lockstep.
