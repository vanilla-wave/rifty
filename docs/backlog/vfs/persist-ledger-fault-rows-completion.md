---
area: vfs
status: ready
title: Persist-ledger fault rows — complete the matrix (rename stage, mid-queue, consumer-visible)
created: 2026-07-05
why: "#107 proved the ledger on write/mkdir/rm and the stamp gate; the remaining rows are unpinned — rename's quota-stage, one-op-fails-mid-queue isolation, and the consumer-visible degradation (tarball-cache put, learned-pins write) are expected-honest but untested"
user_story: As a developer on a quota-squeezed disk, I want every persistence consumer to degrade the way #107 promised (live session works, durability refused loudly, benign caches just re-learn), but today those rows are asserted only at the ledger layer, not at the consumers
epic: fault-honest-opfs-persistence
code: [packages/vfs/src/opfs-sync.ts, packages/npm-client/src/tarball-cache.ts, packages/workbench/src/glue/eddy-learned-pins.ts]
---

## Context

Test-completion item: each row pins EXISTING expected behavior (a failing row = a real bug → `rifty-fix`, failing test first is already in hand). Rows chosen at the fault-honesty refine from the #107 retro + explorer sweep; expected-green is NOT assumed — that's what the pins are for.

## Acceptance

One fault test per row (RED-checked by reverting the behavior under pin where feasible):

- rename quota-stage: persist failure at the file-move stage of a rename → recorded per affected path; heal on later success (#107 healed source-gone and dest cases; the MOVE-stage failure row is the gap).
- mid-queue isolation: op N fails, ops N+1… on OTHER paths still persist and heal — one path's failure doesn't taint the queue.
- consumer: tarball-cache put persist failure → install completes live, stamp refused (ledger gate), next boot re-installs — asserted end-to-end through npm-shell, not just at the vfs layer.
- consumer: learned-pins write persist failure → no stamp revoke (foreign-path scoping, pinned in #107 at the vfs layer — extend the assert to the consumer), pin silently re-learned on the next install.

## Parity cases

None (browser storage boundary) — honest-outcome contract per `docs/process/fault-classes.md` is the oracle; recorded as the parity substitute.

## Fault matrix

- `quota-perm-fail` × rename move-stage / mid-queue / consumer put → rows above.
- `provenance-lie` × stamp over a failed consumer put → refused (end-to-end pin).

## Out of scope

- New ledger capabilities (watchdog = `vfs/opfs-persist-hang-watchdog`; this item only pins existing semantics).
- Cache eviction / size policy for the tarball cache.

## Decisions

- Injection via an OpfsFsSync fail-persist-by-predicate seam (the fault-tier decorator shape, `docs/backlog/process-meta/fault-tier.md`) — consumers stay real, only the storage boundary is faulted (AGENTS.md §Fidelity: mock only unavoidable boundaries).
