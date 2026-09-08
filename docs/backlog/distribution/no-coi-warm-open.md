---
area: distribution
status: ready
title: Open a proven saved no-COI installation without repairing its files
created: 2026-09-08
why: Fresh SDK Workers lack runtime adapter activation; reinstalling to activate them replaces saved dependency edits.
epic: no-coi-persisted-warm-open
sources: [docs/backlog/epics/no-coi-persisted-warm-open/goal.md, docs/backlog/distribution/reference/issue319-refine-evidence.md]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/protocol.ts, packages/runtime-js/src/host.ts, packages/workbench/src/workers/no-coi-toolchain-worker.ts, packages/workbench/src/workers/no-coi-toolchain-install.ts, packages/workbench/src/glue/install-stamp-authority.ts]
---

## Context

Add `sandbox.toolchain.open({cwd, registryUrl})`. Explicit install establishes
compatible installation authority; open checks it and activates fresh-worker
adapters without npm/relink/network/mutation. Missing authority means explicit
install required, never absent project. Saved dependency bytes remain execution
input, including changes and deletions (ADR-0307).

Reuse root-bound v4 install stamps and their exact manifest/lock/policy checks;
read-only `planShadowSubstitutionsFromLockfile` supplies runtime bindings.
No-COI protocol/request identity distinguishes compatible claims from ordinary
Workbench claims. ADR-0392 records the public API and authority reuse; no duplicate receipt or trust ledger.

## Challenge

challenge: 2026-09-08 — clear; inherited accepted I1/I2 direction, independent DEC-4 research compares installer replay, a separate receipt, and the existing stamp/lock owners.

## Acceptance

1. Real no-COI Chromium/OPFS, Vite 7.3.6 install/build, full page recreation, public open/build succeeds; open has zero registry/installer calls and native persistence mutations. Carrier: `tests/no-coi/no-coi-warm-open.spec.ts`, full-page case. → I1
2. Same-length nanoid dependency edit, extra file, deleted module and source edit survive recreation/open byte-for-byte; normal require observes edit/missing module. Carrier: same full-page case, independent native OPFS tree digest and execution. → I2
3. Explicit install with retained replay cache restores changed/missing dependency files without registry; source edit survives and Vite builds. Carrier: same full-page case. This is rifty's accepted repair behavior, not an npm parity claim. → I2
4. Missing/pending/legacy/root-mismatched/policy-mismatched authority, manifest/lock drift and registry request drift reject with explicit-install guidance; saved bytes and native mutation counts unchanged. Carrier: authority refusal cases. → I1
5. Native lockfile/stamp persistence failure rejects install and cannot authorize successful warm-open after page recreation. Carrier: native-failure cases. → I3
6. Public fs and guest copy/rename cannot manufacture or transfer reserved installation authority. Carrier: reserved-authority case. → ADR-0307

## Reference contract

- Node v24.16.0 loads edited CommonJS bytes and rejects a missing module with `MODULE_NOT_FOUND`; executed artifact: [RED evidence](reference/no-coi-warm-open-red-evidence.md#node-execution-oracle).
- Public open is SDK behavior owned by goal I1/I2; no upstream npm warm-open API or repair equivalence is claimed.

## Parity cases

1. After full recreation/open, an edited dependency returns `saved-edit`; a deleted module produces `MODULE_NOT_FOUND`. Browser carrier: full-page case; real Node artifact linked above. → I2

## Fault matrix

| Axis × operation | Honest outcome | Carrier / trace |
| --- | --- | --- |
| restart × open | Fresh Worker activates compatible saved tree; no retained page snapshot needed | full-page case → I1 |
| uncoordinated edit/delete × open | Preserve bytes; ordinary execution sees them | full-page case → I2 |
| missing/pending/legacy/policy/root/manifest/lock/registry × open | Explicit install required; no mutation/replay | authority refusal cases → I1 |
| quota-perm-fail × install lockfile/claim persistence | Reject; no trusted activation on recreation | native-failure cases → I3 |
| claim ingress × fs.writeFile/copyFile/rename | Refuse reserved authority transfer without mutation | reserved-authority case → ADR-0307 |

One existing Worker finite operation slot owns install/open admission. Existing
stamp authority owns claim transitions; ordinary dependency writes do not
invalidate claims. Unreadable preload must be resolved by its existing I3 unit
before activation reads can serve as proof.

## Out of scope

No automatic repair on open, tree-byte surveillance, cross-owner coherence or crash transaction.

## Decisions

ready-verdict: 2026-09-08 — Contract+RED @ f822d4e2281bd66c28aeafbf63056309e23452a9 — docs/backlog/distribution/reference/issue319-contract-red.json

- 2026-09-08 — preparation only; RED executed on absent public method, downstream acceptance awaits GREEN; record: reference/no-coi-warm-open-red-evidence.md.
- 2026-09-08 — 0.6 no-COI install did not mint compatible authority; preserve bytes and require explicit install, never adopt lock/tree presence as proof.
