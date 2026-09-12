# no-COI Pi host evidence

BASE: core Final+GREEN `523628b0cc4828e4ae802445e683f84a7f0359cc`.
Authority: goal I3/I6/I7, unchanged accepted raw refine/FIT source; ADR-0418
project owner and ADR-0377 replacement owner. Route-only addition: ADR-0426.

## Pickup and RED

`pnpm exec playwright test -c playwright.no-coi.config.ts tests/no-coi/no-coi-pi-agent.spec.ts tests/no-coi/no-coi-resident-exit.spec.ts`

- First run `/tmp/pr333-no-coi-red.log`: resident test starts real HTTP bin,
  proves current restart relaunch and fails at `NotImplementedError:
  sandbox.stopResident`. Four adapter cases fail before product boundary because
  headerless harness's explicit CJS prebundle omits Pi/partial-json. Not accepted
  as product RED. Reused the COI harness's three exact Pi prebundle entries.
- Repeat `/tmp/pr333-no-coi-red2.log`: five intended RED, zero timeouts; four
  `NotImplementedError: agent.sandbox-host`, one `sandbox.stopResident`.
  Agent TypeScript and `pnpm backlog:check` PASS.

Scaffolding exports typed APIs throwing named NotImplementedError only; no
adapter or replacement implementation precedes independent Contract+RED.

Full-cycle source carrier uses the actual React starter, real npm tarballs,
Vite 7.3.6 and records its exact generated lock. Deterministic no-registry
carrier is the packed producer Vite snapshot (same shared scenario); no claim
that a fresh React registry install is a snapshot proof. Existing core's fixed
snapshot and six real-host embedding scenarios retain their accepted evidence.

Mechanism sweep: SDK restarting/activation/dirty state and Worker admission;
project command completion/Stop already owns cancellation. Adapter owns no mode
or generation state; `mode()` comes from caller. Whole replacement body will
serve restart and stopResident. No additional lock/correlation/FIFO/journal.
