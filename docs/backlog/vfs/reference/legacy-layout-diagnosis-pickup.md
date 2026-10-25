# Storage diagnosis pickup

Authority: goal I3, Outcome (c,d), ADR-0285/0413/0425. Replica accepted
Final+GREEN at `631615fb9`; public T/npm/offline proof committed `92bf92de9`.
No product implementation in this preparation.

Independent DEC-2: `/root/replica_decision`, 2026-09-13; ADR-0432:
existing global health slot/replay, no recovery action; canonical summaries;
ordinary same-replica corruption record before first possible HEAD publication;
existing no-COI stderr → SDK startup logger. Source sweep found no automatic
no-COI logical writes before ready; native observer confirms zero HEAD writes.

Mechanism sweep: existing owner-ready frame and subscribeHealth replay;
existing page health authority/global owner/fatal slots; existing OpfsFsSync
ledger/drain and HEAD publication; existing project-store record validator;
existing RuntimeController.on disposer and SDK logger. No new journal, queue,
correlation id, writer guard, recovery scope or acknowledgment. Raw corruption
messages can contain logical paths; public text must be fixed by diagnosis kind.

RED on current implementation:

- `pnpm test:browser-unit tests/browser-unit/legacy-layout-notice.spec.ts tests/browser-unit/public-project-open-progress.spec.ts`
  — 10 RED / two baseline PASS. Missing legacy/corrupt health, marker quota
  incorrectly allows ready. Native before/after first HEAD and materialization
  publication cuts reached; page reload resumes actual OPFS. Baseline healthy
  progress and unrelated-namespace/ephemeral control PASS.
- `pnpm test:no-coi tests/no-coi/no-coi-layout-notice.spec.ts` — two RED / clean
  baseline PASS: logger empty for legacy/corrupt; every boot has zero HEAD writes.
- `pnpm test:e2e:light tests/e2e/storage-layout-notice.spec.ts --workers=1` — RED:
  actual Playground has no storage-layout banner.

Harness preparation faults were corrected before these claims: mandatory
`firstMaterialization:{kind:'install'}` was initially absent; native stage target
includes first project publication because transient staging may coalesce away.
The cut waits race real owner outcome, so a pre-cut fixture rejection is visible.
Native-only historical read/guard errors remain covered by the accepted replica
matrix; they are not reclassified as informational corruption.

Separate observation: npm 404 followed by successful Node verification and failed
owner close; question captured in `runtime-js/workbench-close-after-npm-acquisition-failure`.
It is neither attributed to replica nor claimed repaired.

Contract+RED accepted at `90bcbba4e`: /root/layout_red_review, 23/23 coverage,
zero blockers. Independent scratch repeat: 10 RED / two controls; native
stage-before and quota outcomes individually verified. RDY-6 npm-close question
accepted against raw log. Advisory reception: tighten exact reached cut and
notice continuity across every emitted project-generation state; public loss
categories/redaction remain implementation and final-review checks.

## Implementation and class sweep

- Captured canonical Workbench diagnosis before native proof; same-replica record
  survives first-HEAD death. Existing project-store validator determines completed
  restoration; Playground supplies catalog ids, plain Workbench direct candidates.
- Existing global health/replay and owner-ready field carry the notice. No false
  recovery button; actual opening progress remains visible. SDK startup stderr
  reaches existing logger on both initial spawn and replacement.
- Additional RED: preferred proof fallback dropped the captured corruption;
  restart dropped its startup logger message. Both repaired without changing
  preferred policy or restart operation admission. Existing SDK test caught an
  extra await introduced by a helper; observation is now synchronous, and original
  ready/restore ordering remains. Forty SDK tests PASS unchanged.
- Native quota carrier correction independently accepted under PR-4 by
  /root/layout_red_review: real `denied:marker-quota` plus failed ready replaces
  an unsupported exact outer-error-text expectation. Existing proof AggregateError
  formatter remains unchanged. Preferred case also checks actual memory backend
  and native denial. Native quota/fallback pair PASS.
- Plain Workbench probes use real ProjectStore stage/promote/waitForDurability;
  malformed key, metadata and missing-tree candidates cannot count as completion.
  Valid sibling suppresses notice, malformed bytes retained. Native PASS.
- Public readiness type oracle extended only by ADR-0432's exact union variant;
  recovery-scope union unchanged. Empty/blank/non-string owner diagnosis rejected:
  protocol RED → 102 tests PASS.
- Native/SDK/UI mutation checks: absent health, diagnosis scheduled after the
  first publication turn, healthy-only progress, false Retry, silent startup sink,
  dropped preferred diagnosis and fatal orphan scan all produce real RED. Source
  restored after each. No timeout/no-test/compiler-error RED credited.
- Main bundle grew to 86,191 > 86,000 B. The default backend now has a named lazy
  entry inside SDK, avoiding the whole public VFS namespace as that import target.
  Published-build measurement: 85,184 B. Existing numeric ceilings unchanged;
  packed backend-load provenance follows the actual new entry, and existing
  browser deferral/failed-load assertions remain unchanged.

Mutant commands use the committed native/UI/SDK carriers, one guard at a time.
Public first-open, offline, no-COI and packed final gates follow on the committed
implementation; raw goal performance remains in `replica-public-scale-evidence`.

Final targeted native set: 14 diagnosis/progress cases plus public T sequence —
15 PASS. Complete installed-file byte oracle then passed independently: 5,418
original npm files verified against native Node after install and offline reopen.
Exact compiler artifact remains 10,022,694 B; normalized body matches BASE,
only chunk references changed. Pin updated without changing byte ceiling.

## Whole-gate reception

First complete gate at `8ecbffa65`: 10,368 unit tests PASS; one extraction-inventory
failure reproduced once in isolation (163 expected, 164 actual). ADR-0432 adds
`workbench-storage-layout.ts`; exact inventory updated, complete reachable-closure
comparison unchanged. Three JSON files required repository formatting; parsed
fixture/evidence data unchanged. No product/test/bundle ceiling increased.

CI at `7df33326b` exposed 32 obsolete no-COI physical per-file carriers.
Namespace/saved-access/build-fault failures reproduced in isolation. Current
configured consumers use replica; standalone unconfigured preload remains per-file.
Seeds and between-owner edits now use a fresh real replica Worker; custody hashes
read committed native HEAD/segments independently. Quota/hold probes select the
same logical entry from actual native segment bytes. Existing outcome assertions
remain, including zero package-entry writes on cached install and Node stream parity.
Targeted set: 46 PASS plus one fixture eval-scope error; corrected helper injection,
then isolated dedup PASS including quota rejection and repair.

CI's progress UI observation timed out; unchanged isolated case passed. It now
holds a real Vite-package segment write until the existing text/count/geometry
assertions finish, checks the hold was reached, releases, and checks settlement.
Actual application state is observed throughout; no synthetic progress. PASS.
Hosted webpack launcher timeout did not reproduce unchanged in isolation; no
product repair claimed. Final CI still required.

Final reception: pr:check25/25, whole no-COI95/95, final progress e2e PASS.
Independent Final+GREEN at203fe369d accepts all I1–I5 and the composed public
scenario; zero required unit/goal residuals. One advisory: strengthen text
assertions for the already-present loss categories. Hosted CI passed on the next
ordinary run; its unresolved timing question remains separately recorded.
