# Map — fast-project-open-reopen

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `vfs/segmented-opfs-replica` — **segmented-replica** — I1/I2/I5 storage
   boundary and Outcome (c): one format for base, append and compaction, existing
   OpfsFsSync/ledger plus scheduler batch mode (ADR-0425). Re-cut A+B together:
   omit temporary per-file deltas; preserve all accepted obligations. Native
   fault and fresh-process performance proof on T; configured no-COI consumer.
2. `vfs/legacy-per-file-layout-cold-restore` — **legacy-notice** — I3
   user-facing half: one-time `storage-layout` health issue (carrier: the
   health snapshot ADR-0413 extended; per selected namespace) when `v1`
   exists and `v2` is first created, playground starts with an empty catalog (never
   a starter rebuilt under an old name), loss stated; `v1` reclaim stays with
   `vfs/storage-pressure-and-eviction-ux`. Blocked by slice A. After it: I3
   holds end-to-end with the user told once, honestly.

## Open questions

- Current native baseline measured: drain 10.320 s, fresh offline restore
  4.465 s on T; `vfs/reference/segmented-replica-pickup.md`. Complete goal
  proof still crosses public openProject → Node command → offline reopen →
  real post-init npm install; storage-only numbers do not close those actions.
- Order vs `fault-honest-opfs-persistence` items
  (`vfs/iso-git-ref-torn-write-rows`, `vfs/persist-ledger-fault-rows-completion`,
  `playground/reload-crash-consistency-fault-e2e`) — owner: agent — settled at
  slice A PICKUP by their merge state: landed rows are re-proven in the
  replica `## Fault matrix`; unlanded ones get a demotion note naming the
  substrate move, never silence.
- Small-write/compaction cost: measure with the implemented replica before
  Final+GREEN. Threshold and crash surface are fixed in ADR-0425; one unit
  replaces the former A/B frontier. Owner: agent.
- OS-cold reopen (page cache evicted): does replay keep ≥ 3× over per-file? —
  owner: agent — probe at slice A Contract+RED if the runner can evict the
  cache; otherwise recorded as an accepted limit (C3).

## Out of scope

- Cross-project dedup / content store shared between projects — route
  reserved by content addressing, not built.
- Honest npm/pnpm materialization (symlink / hardlink / mode) — the format
  reserves fields only.
- Sandbox fork as a speed lever; fork-as-capability for eval tests rides
  manifests, separate epic.
- Executable session before the trusted stamp (pending-ready) — declined.
- Route R / snapshot re-apply on reopen — rejected (goal Decisions).
- Overlay / COW guest-visible FS.
- no-COI SDK API/protocol changes (#332) — the tier itself is a consumer of
  the substrate (goal Decisions 2026-09-12).
- Lazy content hydration (`vfs/opfs-lazy-content-preload`) — foreclosed by
  ADR-0393/0406/0411.
- Changing the public `storage.persistence` default.
- Multi-tab shared project — loud refusal stays.
- Export-before-switch prompt for legacy playground projects — declined by
  the user; ADR-0286 archive is the existing route.
- Snapshot encoding / JSON-parse tax on the open path — owned by
  `playground/snapshot-carries-substituted-bytes-twice`.
- Committing the 28.5 MB tracker-plugin asset — only its path/size manifest
  enters the repo.
- Re-baking the embedder's 0.4.0 snapshot against main (unrestorable today:
  identity + shadow-catalog drift) — `playground/baked-snapshot-regeneration`
  (producer: `produceDependencySnapshot`, ADR-0387).
- `createScratch` rebuilding a clean same-starter scratch (40.7 s reopen in
  the embedder's sequence) —
  `playground/create-scratch-clean-same-starter-rematerializes`.
- Owner `#assignSubtree`, lockfile hashing — measured non-levers.
