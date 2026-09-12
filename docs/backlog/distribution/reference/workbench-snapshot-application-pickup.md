# I8 pickup evidence — 2026-09-08

Independent read-only DEC-2 research: snapshot_policy_red_research, baseline
d25162b5. Research did not implement or run tests. Subsequent RED preparation
and decisions: ADR-0394; workbench-snapshot-application-policy-evidence.md.

## First acquisition admission

Catalog existence already precedes first acquisition: createScratch seeds an
adopted tree; openProject later runs prepare-first-materialization. Therefore
absence of install trust cannot identify fresh/saved state.

Selected: optional firstMaterialization:pending in existing adopted catalog
provenance. Snapshot create/reset writes seed+pending in its existing transaction.
Absent field (including all old catalog records) means saved. Pending survives
close/reload before first open. First acquisition and removal of the marker share
the existing staged catalog transaction. Commit consumed before exposing session,
whether acquisition returns ready or the existing registry-enabled deferred
install result. A thrown acquisition/failed pre-commit persist restores seed and
pending, with same-owner stamp reconciliation. After consumption, missing/pending/
incompatible trust fails saved reopen without snapshot fetch, install or writes.
Save never copies first-admission entitlement. Install plans keep their baseline.

Killed: in-memory-only permission disappears after create/reload; materialize in
createScratch changes the catalog-only action and still needs a deferred-install
carrier; keep pending until terminal promotion requires another cross-FIFO seam
and risks treating edited user sessions as fresh. A ready/command result is not
proof of stamp promotion (package-acquisition-authority completePromotion).

The marker is an admission receipt, never a second readiness authority. Reuse
catalog FIFO/stages, package FIFO and stamp epochs; owner-package-state's
firstMaterializationPhases is only session-local deferred command bookkeeping.
Do not re-dispatch acquisition from a callback already holding the package FIFO.

## Application target authority

Producer payload is package.json, package-lock.json and node_modules entries/
directories (dep-snapshot-tar.ts). Definition files seed a new project and carry
runtime configuration. Explicit snapshot apply does not reseed source files or
add new definition source entries: use normal file APIs for those. Existing
template node_modules seeds must not be reapplied over preserved saved bytes.
Replay cache is control data, with integrity and durability before lock publish.

Default association must compare stable project/runtime fields, preserving old
baseline provenance. It must admit old v1 definition identities without requiring
an intermediate open using the old snapshot ID. Incompatible metadata/trust stays
an error preserving files; source/snapshot initializer changes alone do not erase.

## Discriminating carriers

- Use real catalog + createOwnerPackageState + OwnerVfsAuthority + SyncMirrorVfs,
  patterned on playground-project-catalog.contract.test.ts:244. The usual :146
  harness has a fake always-successful acquisition: unsuitable for I8.
- DurableOwnerFs supplies exact live/durable trees, persist boundaries, failures
  and restart. Include directories, claims, catalog and replay cache in equality.
- Actual ms2.0 tarball/producer; only fetch is an external fake boundary.
- Default saved: Scratch/named, clean/dirty, same/new unavailable ID, saved
  source/local package edits, no requests. Missing/pending/incompatible claims
  preserve all files with no fallback.
- Explicit apply: same/new ID, default error and overwrite, equal binary files,
  file↔directory, file ancestor, empty dirs, conflict plus absent target, unrelated
  extra files including inside node_modules. Package names are ordinary cases.
- Named project + same snapshot ID + fixed now(): before/after catalog metadata
  otherwise equal while payload repair changes bytes. Existing txId must bind
  commit identity. Crash before catalog pointer rolls back; after pointer before
  phase update rolls forward. No second journal.
- Same-owner rollback then default reopen and explicit retry must reuse the
  restored claim without new fetch. Fresh stamp authority would hide the memory
  pending/absent bug; stale promotion epochs stay fenced.
- First create→reload→open; first admission throw/retry; first application crash
  at pointer; deferred initial fallback before run creates no install/child;
  closing deferred session consumes admission and saved reopen fails unchanged.
- Real OPFS Worker kill: tests/browser-unit/opfs-parallel-drain-kill.spec.ts and
  its wireAuthority fixture. Pause the real path-aware persistent write before/
  after catalog.json, terminate, reopen. Do not race ack against terminate.
- Public packed snapshot-application-proof.ts supplies end-to-end Playground
  entry points; snapshot-proof.ts retains the accepted producer/restore proof.

## Legacy pending adoption — remaining implementation seam

It represents existing user files, never fresh seed. In default snapshot mode,
fail incompatible saved provenance before adoptPending's destructive migration.
Explicit apply needs conflict preflight against preserved legacy source before
adoption effects. Current legacyTree drops all node_modules and empty directories;
the snapshot application path must preserve those non-target saved paths, while
old install-mode migration remains governed by its existing ADR. Verify this
reachable optional legacyWorkspacePrefix branch; do not infer trust from copied
claims or quietly exclude it. ADR-0394 decision 8 selects this policy;
workbench-snapshot-legacy-application.contract.test.ts exercises both modes.
