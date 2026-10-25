# Legacy completed-ref decision — independent DEC-2 / PR-4

2026-09-08. Read-only depth1 leaf; no tracked edits. Authority: accepted I8 in
`docs/backlog/epics/self-hosted-snapshot-workbench/goal.md` lines98–108;
`docs/backlog/distribution/reference/embedder-gaps-evidence.md` lines180–202;
ready `docs/backlog/distribution/workbench-snapshot-application-policy.md`.
Read original source/oracle at `a17b50506`, not only working edits.

## Verdict

Keep the three adopted corruption tests unchanged. Restore strict adopted-ref
validation. A durable completed migration receipt may be retired, after proof,
before the next catalog mutation. Remove completed refs from the existing
migration journal; pending siblings retain their exact journal/catalog/source
binding. No new store, lock, per-operation receipt synchronization, or history
phase is necessary.

The fourth failure is an obsolete initialization-identity oracle under I8,
not evidence that incompatible saved dependencies should be accepted. Replace
that criterion with real saved-trust acceptance/refusal proof; do not change it
to expect success through the existing fake acquisition port.

## Executed evidence

- Current source: `pnpm exec vitest run packages/workbench/src/workers/playground-legacy-catalog-migration.fault.test.ts --reporter=json --outputFile=/tmp/rifty-316-legacy-decision-current.json` → 205 PASS / 4 FAIL, matches parent's full gate and isolated rerun.
- Scratch source replacement, tests unchanged: `pnpm exec vitest run --workspace /tmp/rifty-316-legacy-retirement.workspace.mjs --reporter=json --outputFile=/tmp/rifty-316-legacy-retirement-before-mutation-probe.json` → 216 PASS / 1 FAIL: legacy208/209; I8 legacy8/8. Sole FAIL is the obsolete first-materialization row.
- Candidate `/tmp/rifty-316-legacy-retirement-candidate.ts`; workspace config replaces only authority source via Vite transform, original imports/tests remain real. This is a feasibility probe, not final fault proof.
- Actual saved-state authority: `pnpm exec vitest run packages/workbench/src/workers/workbench-snapshot-saved-state.contract.test.ts --reporter=json --outputFile=/tmp/rifty-316-legacy-decision-saved-state.json` → 10 PASS: changed unused snapshot and absent/pending/incompatible claims, Scratch/named.
- Startup-only retirement probe `/tmp/rifty-316-legacy-retirement-probe.json` → 215 PASS / 2 FAIL. Extra failure: settled adoption reopen changed journal bytes (`playground-legacy-catalog-migration.fault.test.ts:2198`). Avoid gratuitous startup retirement.
- Completion+startup retirement probe `/tmp/rifty-316-legacy-retirement-at-completion-probe.json` → 212 PASS / 5 FAIL. Extra4: existing quota/permission adoption sweeps require the source-cleanup/adopted receipt when adoption reports failure (`:2433`). That variant retired before later migration cleanup barriers. Not selected; do not weaken these tests to accommodate it.

## Root cause / old and new criteria

`playground-project-authority.ts:1286` currently skips every adopted ref after
checking only source absence. Consequently it bypasses adopted catalog
`definitionIdentity`/`baselineFingerprint` binding, promoted target existence,
and target definition metadata. The old criteria at
`playground-legacy-catalog-migration.fault.test.ts:1641–1649,1690–1694` still
represent corrupt persisted migration state. Each row changes durable input
without a proved catalog transition; I8 does not authorize accepting it.
Original `a17b50506` validator additionally required journal/catalog full count
and positional identity forever. That wrongly makes a completed receipt own
later current-catalog membership/definition. The real apply/new-ID and
Scratch→named Save lifecycle tests demonstrate the conflict, including a
pending sibling. Completed migration and live catalog have different lifetimes.

`playground-legacy-catalog-migration.fault.test.ts:1151–1162` is different:
'first-materialization identity' changes the caller's initializer to snapshot,
then `:1176` demands ProjectDefinitionMismatchError. I8/ADR0394 decision2
explicitly permits saved admission despite unused initializer/snapshot drift.
Runtime association and stored metadata remain checked; actual saved claim
compatibility decides readiness. `openAuthority` at `:341–343` returns a fake
install acquisition unconditionally, so its successful result cannot prove
real compatible dependencies. Keep normalized-seed/template/port install-plan
mismatch rows at `:1139–1150`; only the snapshot-initializer row is superseded.

## Candidates

1. Keep immutable migration receipts forever; update every receipt together
   with apply/Save/reset/delete. Rejected: duplicates current catalog semantic
   authority, couples two durable records to each later transaction. Save
   removes Scratch and creates another id, requiring historical remapping.
   ADR0279/0329 already own these transitions without that mirror.
2. Treat all adopted refs as history immediately. Rejected by the executed
   three corruption REDs: phase alone does not discharge proof obligations.
3. Strict validate → durably prune completed refs before the first subsequent
   catalog mutation. Selected. Existing journal's bounded metadata and existing
   catalog FIFO suffice; later catalog transactions independently own current
   state. Scratch Save and new-ID apply plus pending sibling all pass unchanged.
4. Retained explicit 'retired' phase/tombstone per ref. Unneeded extra schema
   and dead historical proof fields; no acceptance requires that audit history.
   Removal is the minimal interface once durable cleanup and adoption are proved.

## Implementation/checking criteria

- In validateMigrationState remove the early adopted `continue`. Every still
  present ref must match current id/kind/starter/catalog provenance. Restore
  exact definition+baseline checks and target/tree/definition metadata checks;
  adopted source must be completely absent, including non-directory remnants.
- Journal membership is remaining migration work, not the whole mutable catalog:
  every pending-adoption catalog entry requires its active journal ref; every
  remaining journal ref must bind its catalog entry. Match by id; require unique
  ids. Unrelated already-adopted catalog projects need no journal membership.
- In existing runCatalogMutation, after valid operation preconditions and before
  transaction/tree/claim work, validate the entire current migration state.
  Filter only adopted refs; durableWriteJson the existing journal; update
  in-memory migration only after required flush. Keep prefix/schema envelope,
  even with empty refs, and leave unfinished refs/index/source bytes exact.
  No writes when no completed refs exist. Payload compatibility/conflict
  preflight stays before this retirement step.
- Retirement is completed-receipt bookkeeping durably preceding the next
  transaction. Catalog transaction rollback still restores exactly its prior
  project/catalog/claim. Do not silently interpret receipt retirement as payload
  application or a new catalog commit. Record this boundary explicitly.
- Refused retirement cannot start the later transaction or publish a session/
  catalog result. Restore previous live journal bytes through existing durable
  write/flush on proven rollback, or fence further admission if durability is
  unknown; never let in-memory pruned refs authorize mutation before durability.
- Add fault sweep around retirement write/close for quota and permission, first
  of several completed refs and last ref; same-owner retry and fresh-owner
  crash/reopen. At each durable cut either old validated receipt or pruned
  receipt is valid; pending sibling source/catalog/ref/index remains unchanged.
- Add an adopted valid ref plus corrupted pending sibling: reject before any
  retirement effects, repeated reopen unchanged. Preserve the existing three
  adopted corruption rows exactly, including repeated no-effects assertions.
- Existing I8 legacy8 remain GREEN; cover completed-ref reset/delete/create-
  Scratch where runCatalogMutation is shared. No new serializer needed.

## Minimal obsolete-oracle replacement

Remove only the `first-materialization identity` table entry at legacy test
lines1151–1162, explicitly citing this PR-4 change and ADR0394 decision2. Keep
all other rows and all three cross-state corruption rows unchanged.

Add a small real-authority case to
`workbench-snapshot-legacy-application.contract.test.ts`, reusing `seedLegacy`,
`openLegacy('overwrite')`, `savedSnapshotDefinition`, and
`openSavedSnapshotOwner` from `test-fixtures/snapshot-saved-state.ts:153`.
After actual legacy adoption/trusted snapshot acquisition, close and reopen
with a different valid descriptor whose asset is unavailable, same runtime
association. For trusted claim require ready/existing, zero requests, exact
project+catalog+durable bytes. For absent claim, remove it at the persisted
storage boundary, flush, reopen; require Error/no session/zero requests/exact
bytes, with no requirement for ProjectDefinitionMismatchError. This replaces
initializer rejection with both halves of the accepted policy at the real
package/stamp graph. The existing saved-state10 prove these two semantics
already for ordinary saved projects; the new case attaches them to completed
legacy provenance. If retaining the exact install→snapshot trigger, run legacy
install admission through the real owner package graph and assert subsequent
snapshot open refuses its absent saved trust; never use fake ensure success as
that proof.

## ADR record

No user choice remains. I8 already chose policy; ADR0279/0329 retain commit and
Save authority. Add a short ADR on receipt retirement, citing ADR0278 legacy
adoption, ADR0279 catalog transactions, and ADR0394 decision2/8. This adds a
finite journal lifetime on an owned seam, not a new state owner. Explain the
three corruption REDs, compared candidates, durable validation→retirement
boundary, and fault matrix.

ADR0394's current uncommitted sentence ('completed adopted ref records source
cleanup, not permanent catalog membership/definition') needs qualification:
unretired adopted receipts retain strict identity/baseline/target validation;
only proved durable retirement releases their catalog binding. Do not leave
a sentence that appears to endorse the blanket skip. Link the new ADR there.
ADR0278 Corrections should retain its existing I8 scope (snapshot initializer
rejection, saved reseed/fallback, explicit-apply manifest match, dependency drop).
If a correction is added, narrowly state that the successor retires completed
journal receipts before later catalog mutations; copy/promote/mark/source-
cleanup validation, catalog-first source deletion and last-ref index tombstone
remain. No correction to ADR0279/0329 commit/Save semantics is needed.
