# Map — fast-project-open-reopen

Live plan: index, not store. Frontier = open children with `epic:` backlinks.
Goal is `draft`: nothing is picked up until the OPEN user fork in goal.md
`## Decisions` is answered (`rifty-refine`).

## Items

1. `perf/project-vfs-targeted-page-reads` — **targeted-page-reads** — I4;
   independent of the format and of the open fork, no new mechanism; leads as
   the smallest slice, and its real-page-request regression proof is the
   measurement carrier later slices reuse. After it: one editor read on T
   costs the same as on a 521-entry tree.
2. `vfs/segmented-opfs-replica` — **replica-format** — I1, I2 for a project
   FIRST persisted under the new format: the IRREVERSIBLE format ADR
   (candidates: current per-file baseline; B index + lazy — measured, killed;
   A traced segment replica — measured), write path under the existing
   ledger/scheduler/stamp contracts, validated replay, loud refusal of a
   legacy per-file layout (I3 first half), `## Fault matrix` at production
   tier (rows enumerated in the item). Its persona depends on the open fork:
   option (1)/(3) keep it; option (2) deletes it. After it: I1–I2 hold on T.

Unseeded (contract depends on fog): legacy-layout re-materialization (I3
second half — detect, name, re-materialize from the definition) waits on the
playground-loss question; snapshot re-apply on reopen (route R) waits on the
OPEN fork.

## Open questions

- OPEN user fork (blocks ready): route R — re-apply a matching baked snapshot
  on reopen instead of persisting its `node_modules` (goal `## Decisions`
  first line: options 1/2/3) — owner: user — decides the replica's persona
  or existence; fires before any PICKUP → `rifty-refine`.
- Playground-catalog projects (ADR-0165 named projects / scratch) whose only
  source is the per-file layout: is loud loss at open acceptable, or does the
  playground owe an export-before-switch prompt (ADR-0286 archive)? — owner:
  user — surfaced at FIT after the 2026-09-01 interview closed; the
  cold-restore decision was taken on the embedder scenario. Fires with the
  fork above → `rifty-refine`.
- Split of the real 16.3 s cold open on T (fetch / gunzip / JSON.parse /
  base64 decode / apply / git baseline / drain) and the never-measured reopen
  on T — owner: agent — first RED of targeted-page-reads derives T's manifest
  from the embedder asset and measures both; the drain share decides how much
  of the open this goal can win versus `playground/snapshot-carries-substituted-bytes-twice`.
- Post-open touch fraction: what share of T does a real workload (`node -e`,
  `vite build`, `tsc`) read before the first reload? — owner: agent — probe
  (count distinct files read on S) before ready; < ~15 % re-opens candidate B
  as a re-fit (goal Decisions), ≥ that confirms the full-scan kill.
- Order vs `fault-honest-opfs-persistence` items
  (`vfs/iso-git-ref-torn-write-rows`, `vfs/persist-ledger-fault-rows-completion`,
  `playground/reload-crash-consistency-fault-e2e`) — owner: agent — settled at
  replica-format PICKUP by their merge state: landed rows are re-proven in the
  replica `## Fault matrix`; unlanded ones get a demotion note naming the
  substrate move, never silence.
- Segment compaction: trigger, crash point, proof — owner: agent — settled in
  the format ADR; no measurement exists (rounds 1/2 never compacted).
- OS-cold reopen (page cache evicted): does replay keep ≥ 3× over per-file? —
  owner: agent — probe at replica-format Contract+RED if the runner can evict
  the cache; otherwise recorded as an accepted limit (C3).

## Out of scope

- Cross-project dedup / content store shared between projects — route
  reserved by content addressing, not built.
- Honest npm/pnpm materialization (symlink / hardlink / mode) — the format
  reserves fields only.
- Sandbox fork as a speed lever; fork-as-capability for eval tests rides
  manifests, separate epic.
- Executable session before the trusted stamp (pending-ready) — declined.
- Overlay / COW guest-visible FS.
- COI-free ephemeral mode — sync reads need the SAB ring.
- Changing the public `storage.persistence` default.
- Multi-tab shared project — loud refusal stays.
- Snapshot encoding / JSON-parse tax on the open path — owned by
  `playground/snapshot-carries-substituted-bytes-twice`.
- Committing the 28.5 MB tracker-plugin asset — only its path/size manifest
  enters the repo.
- Owner `#assignSubtree`, lockfile hashing — measured non-levers.
