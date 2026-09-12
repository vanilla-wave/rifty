# Snapshot application — independent DEC-2 evidence

2026-09-08, fresh read-only reviewer `snapshot_application_decision`; source
baseline fd829ca42. No implementation or test execution in this decision pass.
Authorities: goal I8; ADR-0278/0279/0261/0307/0346/0165/0329.

## Existing authority supports an overlay

ADR-0307 disclaims pristine-tree identity: the stamp binds current manifest,
lock and installation policy; packages counts the source operation. Existing
owner-package-state applies template node_modules overlays before ordinary
promotion. Keep v4 stamp and outcome:snapshot source provenance; never claim
snapshotId identifies the merged resulting tree. No extra claim store or tree
fingerprint is needed. Promotion must follow full verified payload application,
current manifest/lock and durability; a saved unstamped tree alone is no proof.

Candidate clean reinstall/replacement violates I8 retention/no-auto-install.
A separate persistent overlay claim duplicates existing readiness/recovery.
Existing catalog stage + acquisition FIFO + sole stamp promotion carries the
required operation; file conflict preflight precedes every mutation/demotion.

## Reachable recovery obligations

- Catalog recovery treats afterCatalog equality as commit evidence even in
  prepared phase. Same-ID apply may retain the same metadata and timestamp.
  Bind afterCatalog to the existing unique transaction txId; an old catalog
  must not falsely prove this application committed. No second journal/FIFO.
- Same-root rollback restores raw old stamp bytes, but authority memory may
  remain pending/absent and refuses disk re-read. Reconcile only after catalog
  proves durable rollback, through the sole authority, fencing old promoters.
  No public force-trust API. Test same-owner retry as well as restart.
- Catalog presence determines saved state. Default saved open uses current
  manifest and existing trust; missing/pending/incompatible trust fails without
  snapshot fetch, arrival, or byte changes. Source/snapshot identity cannot
  alone make saved state incompatible; preserve stored baseline provenance.

## ADR scope

Supersede ADR-0278 source-identity/reseed/fallback decisions only for the new
policy; ADR-0346 decision4 and ADR-0165 decision5 mandatory whole-node_modules
replacement yield to explicit file overlay. Preserve integrity/cache-before-
lock, explicit Reset, root binding, claim ingress guards, Save and catalog
commit/recovery. Add saved-miss failure and full verified overlay promotion
conditions; no additional stamp format inferred from local extra files.
