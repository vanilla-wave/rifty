---
area: vfs
status: ready
title: Persist-queue watchdog — a hung OPFS op becomes a bounded ledger failure
created: 2026-07-05
why: a single never-settling OPFS promise (wedged handle, browser bug) parks `flush()` forever — and with it every durability gate (install stamp, boot drain); ops record failures on REJECTION, but a promise that never settles is unrecordable today
user_story: As a developer, I want a wedged background persist to surface as a recorded durability failure within a bound, but today `npm install`'s stamp phase (and any flush caller) parks forever on one hung write
epic: fault-honest-opfs-persistence
code: [packages/vfs/src/opfs-sync.ts]
---

## Context

The mirror's background queue is fire-and-forget with FIFO ordering (ADR-0072); `flush()` drains it and returns the `PersistFailureReport` that gates the install stamp (ADR-0187 Corrected). Rejections are recorded per-path with heal-on-success; a HUNG promise is the uncovered case — `unbounded-read` axis at the storage boundary.

## Acceptance

Fault tests (RED first, injected never-settling persist op):

- `flush()` settles within a per-op bound even when an op never settles; the hung op is recorded in the ledger (path + op kind) → report dirty.
- Stamp path over a hung op: dirty report → stamp refused loudly (existing gate, pinned end-to-end against a HANG, not just a rejection).
- Late success after the watchdog fired → heal-on-success clears the entry (next flush clean).
- Sync in-memory reads/writes unaffected throughout (mirror stays live).
- A hung op does NOT wedge reporting of subsequent flush calls (each answers within its bound).

## Parity cases

No Node analog (browser storage boundary) — the honest-outcome contract of `docs/process/fault-classes.md` applies instead: degraded-but-correct (durability refused loudly; live session unaffected), never a hang. Recorded as the parity substitute per testing.md Fault tier.

## Fault matrix

- `unbounded-read` × background persist op → bounded ledger record; `flush()` always answers.
- `false-fallback` × flush callers (stamp, boot drain) → dirty report, never a park.
- `quota-perm-fail` × one op mid-queue → later flushes keep answering; heal path intact.

## Out of scope

- Cancelling the underlying OPFS operation (no API for it) — the op stays pending; only REPORTING is bounded.
- Quota backoff / retry policy for the queue.
- Per-path FIFO reordering — the queue order is load-bearing (ADR-0072) and does not change.

## Decisions

- Watchdog bounds REPORTING only: the queue keeps waiting for the op (FIFO preserved); `flush()` records `hung` and settles. No skip-ahead — skipping would reorder same-path writes.
- Bound value = code constant, REVERSIBLE → CHANGELOG at impl.
- A `hung`-recorded op that later rejects converts to a normal failure record; later success heals — one ledger, no new states beyond the record kind.
