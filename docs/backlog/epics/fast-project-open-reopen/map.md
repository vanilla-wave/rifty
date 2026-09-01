# Map — fast-project-open-reopen

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `perf/project-vfs-targeted-page-reads` — **targeted-page-reads** — I4;
   independent of the format, no new mechanism; leads as the smallest slice,
   and its RED commits T's manifest (paths + sizes from the embedder asset) as
   the fixture every later slice reuses. After it: one editor read on T costs
   the same as on a 521-entry tree.
2. `vfs/segmented-opfs-replica` — **replica-base-segment** (slice A) — I1,
   I2: the IRREVERSIBLE format ADR (candidates: current per-file baseline; B
   index + lazy — measured, killed; A traced segment replica — measured),
   write-once base segment at init under the existing ledger/scheduler/stamp
   contracts, validated replay on reopen, mutations after init on today's
   per-file path with an explicit precedence + tombstone rule, store
   namespace bump `/.rifty/workbench/v1` → `v2` so a legacy per-file tree is
   never read (I3 mechanism; `v1` bytes untouched), `## Fault matrix` at
   production tier. After it: I1–I2 hold on T for a freshly materialized
   project; a legacy project reopens from its definition.
3. `vfs/segmented-replica-append-compaction` — **replica-append** (slice B) —
   I5 + Outcome (c): mutations append into segments, deletions as tombstones,
   compaction = base-segment re-emission from the live front with a
   crash-safe swap; the per-file mutation layer retires. Blocked by slice A.
   After it: one substrate under every writer; reopen after a package-scale
   `npm install` still ≤ 2 s.
4. `vfs/legacy-per-file-layout-cold-restore` — **legacy-notice** — I3
   user-facing half: one-time `storage-layout` health issue when `v1` exists
   and `v2` is first created, playground starts with an empty catalog (never
   a starter rebuilt under an old name), loss stated; `v1` reclaim stays with
   `vfs/storage-pressure-and-eviction-ux`. Blocked by slice A. After it: I3
   holds end-to-end with the user told once, honestly.

## Open questions

- Post-open touch fraction: what share of T does a real workload (`node -e`,
  `vite build`, `tsc`) read before the first reload? — owner: agent — probe
  (count distinct files read on T) before slice A PICKUP; < ~15 % re-opens
  candidate B as a re-fit (goal Decisions), ≥ that confirms the full-scan kill.
- Order vs `fault-honest-opfs-persistence` items
  (`vfs/iso-git-ref-torn-write-rows`, `vfs/persist-ledger-fault-rows-completion`,
  `playground/reload-crash-consistency-fault-e2e`) — owner: agent — settled at
  slice A PICKUP by their merge state: landed rows are re-proven in the
  replica `## Fault matrix`; unlanded ones get a demotion note naming the
  substrate move, never silence.
- Slice B probes: append cost per small write vs today's per-file
  write-through, and the compaction trigger (appended bytes since last base
  as a fraction of the base) — owner: agent — measured on slice A's writer
  before slice B PICKUP; the crash surface of the swap is a fault row, not
  fog.
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
- COI-free ephemeral mode — sync reads need the SAB ring.
- Changing the public `storage.persistence` default.
- Multi-tab shared project — loud refusal stays.
- Export-before-switch prompt for legacy playground projects — declined by
  the user; ADR-0286 archive is the existing route.
- Snapshot encoding / JSON-parse tax on the open path — owned by
  `playground/snapshot-carries-substituted-bytes-twice`.
- Committing the 28.5 MB tracker-plugin asset — only its path/size manifest
  enters the repo.
- Re-baking the embedder's 0.4.0 snapshot against main (unrestorable today:
  identity + shadow-catalog drift) — `playground/baked-snapshot-regeneration`.
- `createScratch` rebuilding a clean same-starter scratch (40.7 s reopen in
  the embedder's sequence) —
  `playground/create-scratch-clean-same-starter-rematerializes`.
- Owner `#assignSubtree`, lockfile hashing — measured non-levers.
