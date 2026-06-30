---
area: net
status: draft
title: Cross-realm EADDRINUSE — two sandbox processes can't bind the same loopback port
created: 2026-06-28
why: cross-realm loopback (ADR-0180) makes a port owned by ≥2 realms ambiguous (first-acker-wins); Node refuses the second cross-process bind with EADDRINUSE, but rifty's realm-local registries silently let both bind
user_story: As a developer running two sandbox node processes that both `listen(3000)`, I want the second to fail with EADDRINUSE like Node (so a port-conflict bug surfaces), but today each realm has its own registry so both bind and a client reaching :3000 is first-acker-wins (ADR-0180 D5).
blocked_by: [net/cross-realm-http-loopback]
sources: [ADR-0180, ADR-0157, ADR-0043, ADR-0048]
code: [packages/net/src/registry.ts, packages/net/src/http/server.ts]
---

## Context

`listen()` only checks the LOCAL realm registry, so it catches an intra-realm double-listen with a Node-shaped `EADDRINUSE` (ADR-0157) but NOT a cross-realm one — two Worker realms can each bind `:3000` because registries don't share a claim. ADR-0180's broker makes this observable: a client reaching a port owned by ≥2 remote realms is first-acker-wins (a divergence from Node, where the second bind never succeeds). Single-owner routing is unaffected; this item is the missing cross-process bind-conflict semantics.

A fix needs a cross-realm port claim AT `listen()` (e.g. a broadcast claim/ack on the per-port `BroadcastChannel`, or an owner/kernel-held claim registry) with the race resolved deterministically: two near-simultaneous binds → exactly one wins, the other gets `EADDRINUSE` (errno -98, syscall `listen`), matching Node. The claim must release on `close()`/realm exit.

## Options or Next

- Broadcast a `claim{port}` on the port channel at `listen()`; an existing owner replies `claim-deny` → `EADDRINUSE`; no deny within a bounded window → bind succeeds and the realm becomes the owner. Race: tie-break by a deterministic key (pid/realm id) so simultaneous claimers converge on one winner.
- Or: an owner/kernel-held authoritative port-claim table (single source of truth) that `listen()` consults synchronously — heavier (sync RPC per listen) but race-free.
- Decide wire shape + race resolution → likely IRREVERSIBLE (new cross-realm claim frame / contract) → ADR when built.

## Reversibility

IRREVERSIBLE-ish — introduces a cross-realm bind-claim contract; recorded here until built (own ADR at implementation).
