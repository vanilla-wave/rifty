# ADR 0331: SyncRpc v3 owns one live exchange through reply consumption

Status: Accepted
Date: 2026-07-27

> TL;DR: SyncRpc v3 claims one SAB exchange atomically and retains that claim
> until its caller consumes the reply.

## Context

The real-node dev-loop robust contract requires a second caller or consumer on
one live SAB exchange to fail before interleaved mutation. V2 cleared
`REQ_STATE` when the responder read the request, before its handler wrote a
reply. A second caller could therefore overwrite the request slot while the
first handler remained live; wrapper-local guards could not see that shared
gap. A second responder could likewise consume or answer another wrapper's
exchange.

The draft CI-flake investigation remains unresolved and is not evidence that
this race caused those observations. This decision closes the independently
frozen fault row; it does not close that draft.

## Decision

- Bump `SYNC_RPC_PROTOCOL_VERSION` from 2 to 3. The request-state lifecycle is
  wire behavior; both peers and hand-written fixtures update atomically.
- One shared transition chain owns an exchange:
  `IDLE → WRITING → READY → HANDLING → IDLE`. CAS claims publication and
  dispatch. `HANDLING` remains published through reply write and is released
  only by the caller consuming that reply.
- Each `SabRing` wrapper keeps one caller phase and one responder phase as
  local witnesses of which shared transitions that wrapper won. They authorize
  wait/consume and reply respectively; they are not additional shared owners.
- A same-responder pump while its exchange is handling returns no work. A
  foreign responder, caller, reply writer, or reply consumer fails loudly with
  the full header snapshot.
- The dispatcher no longer duplicates exchange ownership in an `inFlight`
  set. Its pending-arm generation remains only wait registration/cancellation;
  shared `HANDLING` gates dispatch and re-arms on caller release.
- A malformed request discovered after dispatch remains claimed and becomes an
  in-band error reply. Timeout or abandoned caller leaves the claim wedged
  loudly; recovery without peer-death proof would invent ownership.
- Header size and slot offsets stay unchanged. V3 is an atomic two-peer rollout,
  not a cross-version compatibility protocol.

## Consequences

- Two callers cannot cross request/reply identity, and two responders cannot
  dispatch or answer one request.
- Zero-copy request views remain valid through handler decode; reply views keep
  ADR-0084's synchronous-decode requirement.
- V2 peers are incompatible. A V2 caller receives the versioned error from a V3
  responder; a V3 caller rejects V2's early request release at the exact
  `HANDLING` gate because the single version slot is echoed in the reply.
  Every bundled peer and conformance fixture ships together.
- No pipelining, abandonment recovery, or caller migration is introduced.
- Corrects ADR-0084 #17's duplicate `inFlight` guard and #18's early request
  release plus ADR-0032's current version. ADR-0084 #19/#23 and ADR-0011
  single-flight scope remain active.
