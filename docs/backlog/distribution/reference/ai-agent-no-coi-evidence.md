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
- Independent reviewer reproduced five RED, SDK baseline 5/5 PASS, and scratch
  packed entry reached `agent.sandbox-host` after restoring the original
  producer snapshot. Scratch JS rebuild is not a tarball/type declaration proof.
- Native Pi validation exposed fixture `edit_file` oldText/newText instead of
  its real old/new schema. No product implementation yet. Corrected those keys,
  retained expected saved/search results, and strengthened Stop event assertions
  plus direct SDK outcome/output/failure comparison after cd/export. Third run
  `/tmp/pr333-no-coi-red3.log`: same five intended RED, zero timeouts.
  Original independent finding retained in
  `ai-agent-no-coi-contract-red-before-fixture-fix.json`.

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

## Implementation observations

- `/tmp/pr333-no-coi-green1.log`: React full cycle, cooperative/forced Stop and
  resident-exit proof PASS. Policy assertion failed: fixture assumed `export`
  exists. Real direct SDK probe (Chromium, current code; no adapter) captured:
  `cd src && export RUN_VALUE=prior && pwd` → exit127, `export: command not found`;
  `cd src && RUN_VALUE=prior && pwd` → exit0, `/agent/src\n`;
  next invocation `pwd && echo "$RUN_VALUE"` → exit0, `/agent\n\n`.
  Command: `pnpm exec playwright test -c playwright.no-coi.config.ts
  tests/no-coi/agent-input-probe.spec.ts`; source retained at
  `/tmp/pr333-no-coi-shell-input-probe.spec.ts`, output
  `/tmp/pr333-no-coi-shell-input-oracle.log` (1 PASS).
  Existing `docs/backlog/shell/shell-state-environment-profile.md` already names
  export/unset as absent and bare assignment as supported. Corrected only the
  fixture's setup syntax to the measured supported assignment. Same success,
  fresh cwd/env and full native outcome/output comparisons remain; no SDK
  behavior was changed to satisfy a false shell assumption (PR-4).
- `/tmp/pr333-no-coi-green2.log`: all five new scenarios PASS, 36.5s; real
  React source cycle, native SDK field/output/failure comparison, cooperative
  and forced Stop events, explicit resident exit/replay semantics.
- Core regression: `RIFTY_PLAYGROUND_PORT=5297 pnpm test:browser-unit
  tests/browser-unit/agent-core.spec.ts tests/browser-unit/agent-core-snapshot.spec.ts`
  → 17/17 PASS, 18.9s (`/tmp/pr333-no-coi-core-regression2.log`). First launch
  on default 5299 stopped before tests because another server owned that port;
  it was not reused or terminated.
- SDK regression: `pnpm exec playwright test -c playwright.no-coi.config.ts
  tests/no-coi/no-coi-agent-sdk.spec.ts tests/no-coi/no-coi-dev-hmr.spec.ts`
  → 22/22 PASS, 1.1m (`/tmp/pr333-no-coi-sdk-regression.log`), including memory
  recovery, dirty acknowledgements, restart reentrancy, ports and actual HMR.
- Agent/SDK TypeScript, architecture/file-size, backlog and refs checks PASS.
- `node tests/integration/workbench-packed-consumer.mjs --keep` → PASS:
  16 first-party + 177 external tarballs, strict installed TypeScript/build,
  new no-COI Pi snapshot cycle and all existing Workbench/snapshot/scoped/HMR/
  SQLite checks. `/tmp/pr333-no-coi-packed.log`; retained consumer root
  `/var/folders/db/686y1tsx0cj84rn_2jmrf9680000gn/T/rifty-workbench-packed-consumer-98cR43`.
  New no-COI agent used the published producer archive, public installed
  agent/SDK exports and copied Worker/SW assets; zero runtime registry requests.
- Full `pnpm pr:check` @ 1989bdfca → 25/25 PASS, test:run 189.9s,
  parity 61.3s, no isolation rerun (`/tmp/pr333-no-coi-prcheck.log`). Independent
  Final+GREEN: 17/17 coverage, no findings, 5/5 browser PASS 35.3s;
  same raw verdict in `ai-agent-no-coi-final-green.json`.
