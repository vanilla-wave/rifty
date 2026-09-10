# ADR 0394: Apply dependency snapshots through catalog transactions and saved-state policy

Status: Accepted
Date: 2026-09

## Context

Goal I8 supersedes automatic snapshot-driven reseed and saved-state fallback.
Real catalog/package/producer probes reproduce both: a new snapshot erases or
rejects saved state; absent/pending/incompatible saved claims cause restoration.
Independent DEC-2 research:
docs/backlog/distribution/reference/workbench-snapshot-application-design.md;
docs/backlog/distribution/reference/workbench-snapshot-application-pickup.md.

## Decision

1. Snapshot firstMaterialization gains optional `application`:
   `{mode:'initial-deployment-only'}` (default), or
   `{mode:'apply-snapshot', conflict?:'error'|'overwrite'}` (default error).
   Exact ownership/wire validation normalizes defaults once. Policy does not
   alter definition/baseline identity. Descriptor validation remains; unused
   asset bytes are neither fetched nor validated during saved open.
2. Default snapshot create/open preserves existing saved files and baseline
   provenance, clean or dirty. Match durable project/runtime association
   (id, kind, templateId, entry/port/args); initializer files, dependency versions,
   starter provenance and snapshot identity alone cannot reseed or reject it.
   Old length-encoded v1 identities remain readable. Validate stored metadata
   against its own adoption evidence; use the current saved manifest for trust.
   Missing/pending/incompatible saved trust rejects without arrival or writes.
3. Existing adopted catalog provenance gains an optional pending first-
   materialization admission receipt for newly seeded snapshot projects.
   Missing receipt, including old records, means saved. First acquisition and
   receipt consumption share the catalog transaction; consume before exposing
   a session, including the existing registry-enabled deferred-install outcome.
   A ready snapshot result requires its real trusted claim and settled durability
   before the catalog pointer; a refused promotion cannot certify that result.
   Throw/pre-commit failure restores seed+receipt. Save never transfers it.
   Install plans and explicit whole-project Reset keep their existing meaning.
4. Apply runs on each requested open, including same snapshotId. It validates
   the complete producer payload, runtime compatibility and replay integrity,
   then preflights structural conflicts before any tree/cache/claim effect.
   `SnapshotApplicationConflictError.conflictingPaths` reports project-rooted
   paths through the public owner boundary. Equal bytes and directory/directory
   are compatible; file/type/ancestor conflicts use one generic rule. Error
   changes nothing; overwrite replaces conflicting targets and preserves all
   paths outside payload targets. Definition source files are not reapplied.
5. Application targets are archive payload entries: manifest, lockfile and
   node_modules. These names select the admitted envelope, never a special
   conflict policy. Runtime-owned claim ingress guards remain. Replay cache
   stays control data; verify and durably merge it before publishing its lock.
6. Reuse catalog stages/pointer, package FIFO and sole v4 stamp authority.
   A staged overlay keeps the pre-state by file-by-file copy; the package
   callback applies the live payload. No whole-tree numeric-array after-image.
   Preflight precedes demotion; affected root/ancestor claims retire through
   their existing owner. Full verified overlay plus exact resulting manifest/
   lock and durability permits ordinary promotion. SnapshotId describes source
   provenance, not the mutable merged tree (ADR-0307). Retained extra files do
   not require another claim format, tree fingerprint or reinstall.
7. Bind afterCatalog to the existing unique transaction id, so equal metadata/
   timestamps cannot falsely prove a same-ID application committed. Before
   pointer: exact rollback; after pointer: completed overlay and cleanup only.
   After proved durable rollback, reconcile only the captured prior claim through
   the same package/stamp authority, fencing old promotion epochs. No public
   force-trust operation. Never dispatch recursively into a held package FIFO.
   Private `withRollback(roots, operation)` captures prior claim bytes/phases;
   its reconciliation callback is valid only inside that operation, after
   catalog rollback proof. Compare all captured bytes before changing memory;
   preserve prior untrusted phases and invalidate old epochs. Unproved catalog
   rollback fences further admission in that owner until reopen recovery.
8. Legacy pending-adoption is saved provenance. Default snapshot open must
   reject incompatible legacy state before destructive adoption. Explicit apply
   preflights its source before effects; the migration path preserves ordinary
   node_modules and empty directories before overlay. Claim exclusion and
   copy-before-pointer/source-cleanup ordering remain. Install-mode legacy
   adoption keeps its previous package cleanup policy.

Candidates: infer freshness from absent trust or in-memory flags — contradicts
I8/reload; perform installs in createScratch or retain pending until terminal
promotion — changes deferred first-open behavior/adds cross-FIFO lifecycle;
new overlay journal/claim store — duplicates current authorities. Selected:
one catalog admission receipt and existing transaction/acquisition owners.

Supersedes only ADR-0278 §Entry and plans source-identity mismatch/unconditional
fallback and definition-manifest matching on explicit apply, §Catalog snapshot
reseed, and §Durable legacy adoption dependency-drop
clauses where this snapshot policy applies; ADR-0346 decision4 and ADR-0165
decision5 whole-node_modules replacement for explicit application. ADR-0279
commit/recovery, ADR-0261/0307 claim semantics and ADR-0329 Save remain; the new
same-ID commit discrimination and captured rollback reconciliation refine them.

## Consequences

Saved state never becomes a fresh project because its claim is missing. An
accepted deferred first-open session is saved on later reopen even if its install
never ran. Hosts use explicit apply or Reset after an incompatible saved state;
intentional first-party starter replacement uses Reset. Existing registry install
mode remains. Conflict and OPFS crash proofs accompany both pending and saved
transitions; no new package compatibility, latency or archive-size promise.

## Corrections (active)

2026-09-10 — ADR-0415 supersedes only the reach/saved-open clauses named there; other decisions remain active.
