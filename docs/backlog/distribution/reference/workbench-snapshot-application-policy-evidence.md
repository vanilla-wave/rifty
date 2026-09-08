# Snapshot application evidence

## Authority and boundary

2026-09-08. I8 preparation against accepted I2 source
`ab3871d714525c4b7db75d6be0b3631817997783`; driver tree based on its
bookkeeping commit `c5d6f9615`. Product source unchanged during RED preparation.
Raw policy/answers: goal.md and embedder-gaps-evidence.md. Independent DEC-2
research: workbench-snapshot-application-design.md and
workbench-snapshot-application-pickup.md. Selected decisions: ADR-0394.

| source | observable consequence | authority |
|---|---|---|
| User: saved state wins by default, including changed snapshotId | current saved manifest/trust; no unused asset request or automatic reseed/install | I8 |
| User: apply even same ID; overwrite/error; no package-specific conflicts | preflight every payload entry, then one generic overlay; retain untargeted bytes | I8 |
| Existing create precedes first acquisition | durable first-admission receipt; absence of trust cannot classify fresh state | ADR-0394 |
| Existing deferred first-open session may close before install | consume admission before exposing that session; later saved miss fails unchanged | ADR-0394 |
| Existing Reset and starter selection deliberately replace Scratch | host uses Reset for intentional replacement; saved default does not erase it implicitly | ADR-0165, ADR-0394 |
| Existing catalog and sole v4 stamp owner | reuse stages/FIFOs/epochs; captured rollback reconciliation, no new claim store | ADR-0261/0279/0307/0394 |
| Selected legacy source contains real saved user data | default fails before adoption; explicit preflight precedes preserved-copy migration | I8, ADR-0394 |

No new user fork is inferred from API names, catalog receipt, overlay storage or
private rollback seam. Registry controls, namespace/orphan/preview/budgets remain
separately linked goal work.

## Executed RED

Node v24.16.0; pnpm 11.5.2; Playwright 1.60.0, installed Chromium. Real Memory
VFS, owner composition, package acquisition, producer, registry tarballs and
OPFS; fetch/native persistence are the injected external boundaries.

Common unit command: `pnpm --filter @riftydev/workbench exec vitest run <file>
--reporter=json --outputFile=<artifact>`. Relative test paths below are under
`packages/workbench/src/`.

| carrier | executed result | raw local artifact |
|---|---|---|
| workers/workbench-snapshot-saved-state.contract.test.ts | 10 semantic RED: changed initializer rejected/reseeded; saved trust miss restored | /tmp/rifty-316-snapshot-saved-unique-stage-red.json |
| workbench/internal/playground-snapshot-application-options.contract.test.ts | 5 expected policy-shape RED, 10 malformed-shape GREEN | /tmp/rifty-316-application-initial-red.log |
| workers/workbench-snapshot-apply.contract.test.ts | 16 expected unsupported-application RED after real seed/Save/mutation | /tmp/rifty-316-snapshot-application-red.json |
| workers/workbench-snapshot-legacy-application.contract.test.ts | 2 semantic RED (destructive default adoption), 2 application-shape RED | /tmp/rifty-316-snapshot-legacy-application-red.json |
| workers/workbench-snapshot-apply-validation.contract.test.ts | 3 application-shape RED; valid hashed tar carries corrupt/missing replay or incompatible artifact | /tmp/rifty-316-snapshot-apply-validation-red-retry.json |
| workers/workbench-snapshot-initial-admission.contract.test.ts | 2 semantic RED (unproved ready, reused deferred admission), 2 existing GREEN (cold reload, old catalog) | /tmp/rifty-316-application-initial-admission-red-final.json |
| workers/workbench-snapshot-apply-rollback.contract.test.ts | 3 expected application-shape RED; same/new-ID rollback/retry and unproved-rollback fence/recovery branches await implementation | /tmp/rifty-316-snapshot-apply-rollback-fence-red.json |
| glue/install-stamp-rollback.contract.test.ts | 5 expected missing private withRollback RED; real seed/trust/pending promotion setup succeeds | /tmp/rifty-316-stamp-rollback-red.json |

`RIFTY_PLAYGROUND_PORT=53164 pnpm exec playwright test --config
playwright.browser-unit.config.ts tests/browser-unit/workbench-snapshot-application.spec.ts`:
3 RED, `/tmp/rifty-316-application-opfs-red-final.log`. Reset is a semantic
baseline failure before the actual native catalog writable.close: restarted
owner reports snapshot outcome, requests=1, exact rollback=false. Both explicit
apply cases fail at the absent application shape. Warm named Save/reopen passes
before fault arming. Native close pauses before/after its real durable boundary,
acknowledges and never resolves; Worker termination cannot race ahead of pause.

`pnpm test:packed-consumer`: RED 77.86s,
`/tmp/rifty-316-application-packed-red.log`. Real pack/install/typecheck, existing
Vite/HMR/SQLite and raw-gzip/HTTP-decoded producer proofs pass. New persistent
public named reopen fails `ProjectDefinitionMismatchError: project "packed-saved"
has a different definition`. Later public conflict/overwrite/run checks are
committed in the same mandatory runner, not claimed GREEN.

## Real Node program oracle

The packed producer script executes `node saved-main.cjs` inside the tar-extracted
real ms@2.0.0 project and captures stdout in producer-snapshot.json. The browser
asserts this captured value, never a replacement golden. Independent local replay
using `node --import tsx --input-type=module`, bakeApplicationPackage(), system
`tar -xzf`, then `node saved-main.cjs` confirms:

- Node v24.16.0; ms 2.0.0.
- Source: `console.log('packed-saved-' + require('ms')('3s'))`.
- Output: `packed-saved-3000\n`.
- Produced snapshotId: `sha256:28f2295e92323d151ca953d42af7b2127ed79ef1b4e735aaf8a28a05063597b3`.
- Raw artifact: /tmp/rifty-316-application-node-reference.json.

Node defines program behavior; it does not define host snapshot policy.

## Retained baseline

`pnpm --filter @riftydev/workbench exec vitest run src/glue/dep-snapshot.test.ts
--reporter=json --outputFile=/tmp/rifty-316-application-retained-snapshot-tests.json`:
27/27 PASS, including replay integrity, cache-write failure before lock publish
and real offline LightningCSS replay.

`RIFTY_PLAYGROUND_PORT=53165 pnpm exec playwright test --project=chromium-heavy
--project=chromium-light --workers=1 tests/e2e/project-switch.spec.ts
tests/e2e/starter-file-edit-survives-reload.spec.ts tests/e2e/instant-preset-reset.spec.ts
--grep 'starter pick|edited src/main.js|every instant'`: 3/3 PASS, 41.5s.
Real first-party starter pick, every instant preset after Reset, and saved source
edit after reload. Log: /tmp/rifty-316-application-first-party-baseline.log.

## Carrier corrections before review

- Real createStageId uses crypto.randomUUID, avoiding reused stage names across
  fixture owner lifetimes. No production allocator changed.
- Pending claims use the real guarded mutation/demotion seam. Durable state
  corruption/absent claim uses the closed-owner storage boundary only.
- Final trusted marker requires the caller's outer flush. Warm persistence
  fixtures now explicitly flush before close; closing package state is not a
  claimed durability barrier.
- First-admission claim fault ordinal is selected from an actual successful
  acquisition trace, not a guessed write number. Refused promotion presently
  returns ready: that semantic failure is the expected RED.
- IO rollback may retain valid new shared cache entries; project/catalog/claims
  remain exact. Conflict/invalid-input assertions still compare all bytes.
- Vitest's deep Uint8Array matcher exhausted its heap in the replay-validation
  fixture. Replaced only that equality mechanism with full Buffer.compare and
  exact file/directory sets; no bytes, paths or expectations dropped. First run
  /tmp/rifty-316-snapshot-apply-validation-red.log, completed retry above.
- Playwright's Babel loader cannot import the producer's raw TypeScript declare
  fields. Node producer fixture runs through tsx; browser spec imports its type
  only. Initial loader failure /tmp/rifty-316-application-opfs-red.log is not RED.
- Open handles close in finally so ProjectBusy cleanup cannot mask semantic RED.

Workbench typecheck and pnpm lint pass on preparation; backlog:check and
refs:check pass. Full pr:check waits for implementation: new contract tests are
intentionally RED. Existing accepted I1/I2 oracle/gate assertions remain;
public fixture and runner add the saved/application journey.
