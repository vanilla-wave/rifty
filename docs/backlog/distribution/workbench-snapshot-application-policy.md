---
area: distribution
status: ready
title: Apply snapshots through explicit saved-state and file-conflict policies
created: 2026-09-07
why: Changing snapshotId currently reseeds an edited Scratch, while hosts need saved state by default and an explicit uniform file-conflict policy for application.
user_story: As the plugin-sandbox embedder, I want saved projects to win after initial deployment and choose overwrite or error when explicitly applying a snapshot, but current catalog identity changes can silently replace edited files.
epic: self-hosted-snapshot-workbench
blocked_by: []
sources: [docs/backlog/epics/self-hosted-snapshot-workbench/goal.md, docs/backlog/distribution/reference/embedder-gaps-evidence.md, ADR-0394, ADR-0279, ADR-0261]
code: [packages/workbench/src/workbench/internal/playground-project-definition.ts, packages/workbench/src/workers/playground-project-authority.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/glue/dep-snapshot.ts]
---

## Context

A disposable catalog probe changes only the supplied snapshotId after writing
user.txt to Scratch, then calls createScratch with preserveDirtySameStarter.
Current result is dirty=false and user.txt absent. Same-definition reload
preservation does not cover that path. See the recorded evidence.

User-selected application modes:

- Initial deployment only (default): seed an absent project; subsequently use
  saved state, including when the host supplies a new snapshot. Do not fetch or
  apply an unused asset merely because its id changed. Missing install trust
  is not evidence that no saved project exists. Incompatible saved state fails
  with all bytes retained, awaiting the host's explicit choice.
- Apply: evaluate the supplied payload on every requested application,
  regardless of prior snapshotId. User selects overwrite or error conflict
  policy; error defaults from the preserve-before-explicit-update decision.

Conflict is structural: different bytes at an existing file path, or an
incompatible entry/ancestor type. Identical files and directory/directory
coexistence are nonconflicting. Missing payload targets are added. In error
mode report conflicting paths before ANY payload mutation, including additions.
In overwrite mode replace conflicting targets, including the subtree of an
incompatible directory target; otherwise preserve saved paths absent from the
payload. The request is application of entries, not an implicit whole-project
reset. An archive's user/control namespaces remain disjoint; control entries
are never installed as project files.

No policy branch examines whether a conflicting path is package.json,
package-lock.json or node_modules: the user explicitly rejected that distinction.
A producer artifact still needs valid compatibility and integrity proofs.
Preserving extra/local files does not authorize claiming the entire resulting
tree equals the producer's installed tree. Retire/rederive affected install
claims through their existing authority; do not bypass conflict policy or run
an automatic install to manufacture a clean claim. Source edits outside the
application targets must remain usable as ordinary project state.

The policy owns selection/preflight; catalog transactions and package-acquisition
remain the existing effect owners. Wire/API names are agent-owned ADR decisions.
Cover Scratch and named saved projects on reopen, new/same snapshot ids, ordinary
file/path-type conflicts, exact-equal files, absent targets, retained extra
files, and error-before-any-write. Package filenames are ordinary collision
fixtures, not a separate semantic mode. Real OPFS crash/reopen must not publish
partial application as completed or destroy the only preserved copy.

## Reference contract

I8 is host policy, defined by the user's recorded answers in goal.md and
embedder-gaps-evidence.md. ADR-0394 owns API, saved association and transaction
integration; ADR-0261/0279/0307 retain stamp and catalog authority. No external
Node snapshot-policy oracle exists. Actual Node execution of the producer's
ms@2.0.0 consumer supplies the packed browser program oracle; command/output/
versions and real baseline failures are in reference/workbench-snapshot-application-policy-evidence.md.

## Acceptance

1. Owned and serialized snapshot plans accept omitted/default initial-deployment-only and apply-snapshot with omitted/error/overwrite conflict; reject malformed/executable shapes; policy does not change definition identity. Carrier: playground-snapshot-application-options.contract.test.ts. → ADR-0394
2. Default create/open preserves clean/dirty Scratch and named saved files, baseline and catalog association when snapshot/source initializer changes; no unused asset fetch. Current saved manifest and trusted install determine readiness. Carrier: workbench-snapshot-saved-state.contract.test.ts and packed snapshot-application-proof.ts. → I8
3. Absent, pending or incompatible saved trust rejects before tree/cache/claim/catalog effects or automatic acquisition. Legacy pending adoption is saved: default rejects before copying/deleting its source. Carriers: workbench-snapshot-saved-state.contract.test.ts, workbench-snapshot-legacy-application.contract.test.ts. → I8, ADR-0394
4. Fresh snapshot create/reset retains first-admission entitlement across owner reload; acquisition consumes it transactionally before ready/deferred session exposure. Refused trust or failed persist restores seed/entitlement for retry. Old catalog records remain saved; Save does not transfer entitlement. Carrier: workbench-snapshot-initial-admission.contract.test.ts plus saved-state Save/reopen cases. → ADR-0394
5. Each apply request, same/new snapshot ID and Scratch/named, evaluates the actual payload. Default error reports all structural conflict paths before additions or other effects. Equal bytes/directories coexist; missing targets are added. Carrier: workbench-snapshot-apply.contract.test.ts and packed public error path. → I8
6. Overwrite replaces differing targets/type conflicts and adds payload entries while retaining untargeted source, local node_modules files and empty directories. Definition files do not overlay saved source. Legacy explicit apply preflights before adoption and retains ordinary non-target data. Carriers: workbench-snapshot-apply.contract.test.ts, workbench-snapshot-legacy-application.contract.test.ts. → I8, ADR-0394
7. Explicit application validates actual artifact compatibility and replay closure/integrity even over a warm trusted tree. Rejection preserves all project/control/cache bytes; verified replay cache becomes durable before the live lock. Carrier: workbench-snapshot-apply-validation.contract.test.ts and existing dependency-snapshot replay fault tests. → ADR-0346, ADR-0394
8. Application uses existing catalog/package/stamp authorities: exact pre-pointer rollback, completed post-pointer recovery, unique commit evidence for equal metadata, same-owner trusted reopen/retry after proved rollback, and fenced stale promoters. Unproved rollback retains recovery evidence and fences owner admission. Carriers: workbench-snapshot-apply-rollback.contract.test.ts, install-stamp-rollback.contract.test.ts, real OPFS workbench-snapshot-application.spec.ts. → ADR-0279, ADR-0394
9. A packed public Playground consumer saves edited files, closes the persistent Workbench, opens with an unused new snapshot, receives serialized public conflict paths, applies overwrite twice and executes the saved ms program against captured real Node output. Registry counter stays unchanged. Carrier: mandatory workbench-packed-consumer runner and snapshot-application-proof.ts. → I8
10. Explicit Reset and intentional first-party starter replacement remain whole-project reseeds; ordinary same-starter reload preserves edits. Existing project-switch, instant-preset-reset and starter-file-edit-survives-reload browser carriers remain acceptance. → ADR-0165, ADR-0394

## Parity cases

1. Run the actual saved ms@2.0.0 program under real Node in the extracted packed consumer; public browser run matches that captured stdout after saved reopen and repeated overwrite. → I8

## Fault matrix

| axis × operation | honest outcome | artifact / fault target |
|---|---|---|
| provenance-lie × default saved admission | absent/pending/incompatible claim fails without snapshot/registry requests or byte changes | saved-state and legacy-application contract tests → I8 |
| corrupt-input × application plan/payload | exact shape, artifact identity and replay integrity reject before effects | application-options and apply-validation contract tests → ADR-0394 |
| destructive-update × conflict preflight | differing files, entry/ancestor types report paths; even absent targets stay absent | apply and legacy-application contract tests → I8 |
| quota-perm-fail × first admission/ready proof | no false ready; restore seed and admission for same-owner retry | initial-admission contract test → ADR-0394 |
| quota-perm-fail × saved apply catalog pointer | exact prior project/catalog/claim; same-owner saved reuse and later explicit retry | apply-rollback contract test → ADR-0279, ADR-0394 |
| permission-loss × rollback persistence | owner refuses further admission without effects; journal/before-copy retained for fresh-owner recovery after permission returns | apply-rollback contract test → ADR-0279, ADR-0394 |
| torn-state × real OPFS Worker kill around catalog close | before pointer restores prior state; after pointer keeps completed apply; same-ID/equal metadata cannot prove a false commit | workbench-snapshot-application.spec.ts → ADR-0279, ADR-0394 |
| stale-epoch × rollback reconciliation | byte equality for all captured claims before any trust; prior absent/pending preserved; delayed promoter remains stale | install-stamp-rollback.contract.test.ts → ADR-0261, ADR-0394 |
| poisoned-cache × verified overlay | complete replay validation before effects, durable cache before corresponding live lock | apply-validation contract test; dep-snapshot replay faults → ADR-0346 |

## Out of scope

New registry-mode controls, storage namespace selection, orphan download,
preview-prefix configuration and operation budgets remain I3/I4/I6/I5/I7 in
the goal map. Arbitrary node_modules import and new package compatibility are
outside the accepted goal. Existing unsupported capabilities stay loud errors.

## Decisions

ready-verdict: 2026-09-08 — Contract+RED @ fe0c879ba1de72fd2b56ad5690ffbf8fa1b3a383

- 2026-09-08 — reception: Contract+RED PASS, 0 blockers; two advisory NOTES accepted as additional Save-before-open and cache-durability carriers, no scope change.
- 2026-09-08 — ADR-0394 selects exact application API, durable admission receipt, staged overlay and claim rollback reconciliation; independent DEC-2 research recorded under reference/.
- 2026-09-07 — user: initial-deployment-only default; saved state wins afterward; explicit apply mode exists (I8).
- 2026-09-07 — user: conflicts choose overwrite/error, no dependency-specific behavior; applies independently of prior snapshotId (I8).
- 2026-09-07 — default error follows the user's preserve/stop choice; paths not targeted by application remain saved data, not deletion candidates.
- 2026-09-07 — exact API/carrier and install-claim reconciliation need an ADR at pickup, preserving the user-owned policy; inherit production tier for new persistence transitions.

## Challenge

challenge: 2026-09-07 — clear
