# Map — fast-project-open-reopen

Live plan: index, not store. Frontier = open children with `epic:` backlinks.

## Items

1. `vfs/legacy-per-file-layout-cold-restore` — **legacy-notice** — I3
   user-facing half: one-time `storage-layout` health issue (carrier: the
   health snapshot ADR-0413 extended; per selected namespace) when `v1`
   exists and `v2` is first created, playground starts with an empty catalog (never
   a starter rebuilt under an old name), loss stated; `v1` reclaim stays with
   `vfs/storage-pressure-and-eviction-ux`. Replica accepted at `631615fb9`. After this unit: I3
   holds end-to-end with the user told once, honestly.

## Open questions

- Required goal acceptance: public openProject → real Node → new offline Chromium
  process → real npm install changing ≥5,000 paths → new offline process. Storage
  boundary proof is accepted; committed public composition proof is next.
- Legacy and corrupt cold-restore diagnoses must reach public health. The legacy
  unit owns this carrier; old native bytes remain untouched.
- Reference timing means fresh Chromium process, not an OS page-cache purge;
  retain the accepted C3 limit. Native baseline and all replica fault results:
  `vfs/reference/segmented-replica-pickup.md`.

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
