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
