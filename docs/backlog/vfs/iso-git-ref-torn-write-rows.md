---
area: vfs
status: ready
title: iso-git torn object/ref writes — reload mid-commit never corrupts the graph
created: 2026-07-05
why: git objects and refs ride the same fire-and-forget persist queue with no atomicity primitive (OPFS has no rename); a reload before the ref persist lands can leave HEAD pointing at a never-persisted commit — corrupt graph on next boot; zero tests cover it
user_story: As a developer, I want `git commit` followed by an instant reload to never corrupt my repo — the commit is fully there or cleanly absent, but today no fault test pins what a torn ref/object write does to the next boot
epic: fault-honest-opfs-persistence
code: [packages/vfs/src/opfs-sync.ts, packages/git/src]
---

## Context

FIFO queue order (objects enqueued before the ref update) is the only atomicity primitive available — pin it, don't invent rename-atomicity OPFS can't provide. The dangerous states: (a) objects persisted, ref write failed/torn; (b) object write failed, ref persisted (must be impossible under FIFO — prove it); (c) reload with the whole tail un-persisted (commit cleanly absent — the baseline honest case).

## Acceptance

Fault tests (RED first, injected persist failure / simulated reload between queue entries):

- Object-then-ref sequence with the REF persist failed → next boot: repo opens, HEAD resolves to the pre-commit commit, `git log`/`status` run clean; dangling loose objects tolerated; ledger carries the failure.
- FIFO proof: an injected OBJECT persist failure never lets the subsequent ref update persist ahead of it (state (b) unreachable) — pinned, not assumed.
- Whole-tail loss (reload before any persist) → commit cleanly absent; repeat commit succeeds.
- A torn/truncated ref FILE on disk (crafted fixture) → loud, diagnosable error naming the ref — never a silently wrong resolution (peel trap precedent: a wrong oid silently written corrupts everything downstream).

## Parity cases

- Post-recovery observables match real git at the equivalent clean state: same `git log` / `git status` output at the pre-commit state (parity-runner, real git).
- Real git with a truncated loose ref file errors loudly (`fatal: bad ref`-family) — our torn-ref read matches the loud-error shape, not the exact text.

## Fault matrix

- `torn-state` × ref update after objects → pre-commit state, clean.
- `torn-state` × ref file content (truncated) → loud throw naming the ref.
- `quota-perm-fail` × object write → commit absent cleanly (FIFO), ledger dirty.
- `false-fallback` × in-memory-visible HEAD not yet durable + reload → next boot shows durable truth, never a dangling HEAD.

## Out of scope

- Write-then-rename atomicity emulation (no OPFS primitive; FIFO is the mechanism).
- Packfile/gc paths (rifty git facade uses loose objects).
- Multi-tab concurrent commits to one repo (separate concern, not this item).

## Decisions

- Atomicity = pinned FIFO ordering + torn-ref loud read; no new on-disk format.
- Recovery policy: dangling loose objects tolerated silently (real-git-like), torn REF is always loud — a ref is the trust root, an object is not.
