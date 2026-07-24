# ADR 0318: Retain verified shadow assets for manager lifetime

Status: Accepted
Date: 2026-07

> TL;DR: a ready shadow-asset manager serves its immutable SHA-verified bytes
> until terminal close; backing-store eviction affects only a replacement owner.

## Context

The `shadow-registry-core` contract required both owner-lifetime verified-byte
retention and a retryable error when the backing store is cleared mid-read.
Those clauses conflict. `ensure()` must read and SHA-verify every admitted
object before publishing `ReadySet`; serving the retained copy then has no
storage dependency. Detecting external eviction exactly would require a new
clear/epoch notification protocol. There is no production clear consumer:
hard reset closes the owner before deleting OPFS, and the manager is the sole
storage-to-ready owner.

## Decision

- A manager retains one immutable copy of each SHA-verified admitted object.
  Port reads copy those bytes without storage reads, reacquisition, or another
  SHA pass.
- Terminal `close()` aborts acquisition, drains active manager operations,
  releases retained bytes, and invalidates that owner's readiness. A
  replacement owner reopens pointer → receipt → objects and revalidates or
  honestly reacquires/fails.
- `shadow-registry-core` parity row 5's store-clear-mid-read clause is
  superseded as a process-level `frozen-assumption`. Port close/peer death still
  settles through the existing typed retryable failure.
- No public `clear()`, per-read storage revalidation, epoch, event, or lock is
  introduced solely to make backing eviction observable to a live owner.

## Consequences

- Hot reads stay bounded to one retained-byte copy after one verified load.
- Backing eviction cannot corrupt or revoke a live owner's already-attested
  bytes; cold reopen remains the durability/reacquisition boundary.
- The manager contract proves both sides: two reads survive backing removal
  without another read/SHA/acquire, while a replacement owner validates the
  persisted chain before claiming ready.
