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

## Implementation and additional fault proof

- Snapshot default uses saved runtime association/current manifest. Explicit
  application owns generic entry preflight; catalog overlay stages retain the
  exact prior project, and unique transactionId binds commit evidence.
- First snapshot admission has a durable pending receipt, consumed before
  ready/deferred session exposure. Save retains its original baseline-matching
  contract (ADR-0278), copies ordinary bytes through the existing FIFO/rebind,
  and does not transfer pending admission.
- Claim rollback uses the same authority with expired-callback and stale-epoch
  fencing. Catalog rollback proves restoration before removing recovery copies;
  failed journal/marker writes heal through their original owner. Failed proof
  fences admission until owner recovery.
- Legacy preservation retains ordinary node_modules/empty directories. Every
  unretired migration ref keeps strict proof; completed refs retire durably before
  the next catalog mutation (ADR-0397). Unfinished sibling provenance stays exact.
- Existing catalog tree/copy and claim read routines moved into cohesive private
  modules; no new state owner. In-memory legacy tree bytes use Uint8Array; old
  inline journal arrays still decode. Oversized owner/package/catalog pins shrink.

Additional executed RED → GREEN:

| fault | evidence / repair | executed proof |
|---|---|---|
| Save before first open | initial fixture used opaque definition.id incorrectly; corrected to explicit caller id before semantic RED: Save followed by default open fetched/restored | /tmp/rifty-316-application-save-before-open-red-fixed.json; all initial/rollback8 GREEN in catalog-green-2 |
| cache persistence before live lock | real new LightningCSS lock plus actual replay cache persist rejection; prior live lock remains | /tmp/rifty-316-cache-before-lock-red.json → /tmp/rifty-316-package-snapshot-green.json |
| node_modules saved as a file | real stamp demote attempted a child marker under a file, ENOTDIR; distinguish live directory from mere existence | /tmp/rifty-316-stamp-file-tree-red.log →154/154 stamp/apply GREEN |
| legacy repeat new-ID apply / Save | completed migration receipt incorrectly owned current definition/catalog membership; complete and pending-sibling variants fail at restart | /tmp/rifty-316-legacy-post-adoption-red-sibling.json + isolated.json →8/8 /tmp/rifty-316-legacy-post-adoption-green.json |
| original legacy nested archive schema | rebuilding raw NM envelope hid invalid version/root/absolute-path input; decode the original archive once before composition | /tmp/rifty-316-legacy-archive-class-red.json →73/73 suites, /tmp/rifty-316-legacy-archive-schema-fix-evidence.json |

The legacy sibling cases retain its complete source/claims/empty directories,
index bytes, pending catalog entry and journal ref through the other project's
application/Save/reopen. No completed-receipt exemption applies to unfinished refs.

## Changed checking criteria

- Added the public conflict error to the exact root export list and seven
  required private helpers to source inventory (143→150); complete closure
  equality and no-orphan checks remain. Public/closure suite passes.
- The old project-deps hand-built stamp stub became the real authority with
  call-through zero-demote observation; no fake withRollback was added.
- A real JSON field-order regression in new catalog transactionId rollback was
  fixed in production. Exact I8 before-state byte assertions remain untouched.
- Independent read-only PR-4 review (`assets_final_review`) reproduced all14
  remaining old catalog fault failures after that repair. Each differed ONLY
  by retry-issued transactionId `catalog-stage-1`→`catalog-stage-2`. Evidence:
  /tmp/rifty-316-catalog-pr4-review.md,
  /tmp/rifty-316-catalog-pr4-nonce-evidence.json,
  /tmp/rifty-316-catalog-pr4-errors.json. Only same-owner retry expectations now
  use the id actually issued by the test's factory, asserting it differs from
  the failed attempt. Every other byte/path/field/order remains exact; original
  pre/post crash classifiers and first-attempt expectations are unchanged.
  Entire catalog fault matrix rerun:50/50 PASS,
  /tmp/rifty-316-application-catalog-green-3.json.
- First packed GREEN attempt reached the end of the new browser journey, then
  exposed a missing runner node:assert import. Import repaired; public
  instanceof check added. /tmp/rifty-316-application-packed-green-2.log:
  PASS84.57s, including public prototype/paths, no unused asset/registry requests,
  saved program and repeated application. Final-source proof follows below.

## Executed browser and regression checks

- Real OPFS native catalog close / Worker termination / fresh owner:
 3/3 PASS5.9s, /tmp/rifty-316-application-opfs-green-1.log. Before-pointer Reset
  and apply: exact rollback=true, existing outcome, zero fetch. After-pointer
  apply: completed payload, changed catalog, existing outcome, zero fetch.
- First-party starter switch, every instant Reset, source-edit reload:
 3/3 PASS52.1s, /tmp/rifty-316-application-first-party-green.log.
- Package apply/saved/validation30/30, package/owner regressions195/195,
  owner/rollback/fence51/51; subsequent schema sweep73/73. Raw commands and
  file hashes: /tmp/rifty-316-package-snapshot-implementation-evidence.json and
  /tmp/rifty-316-legacy-archive-schema-fix-evidence.json.
- Full workspace typecheck identified only the new test getter omitted from its
  explicit harness interface; interface corrected, Workbench typecheck passes.
  Lint, architecture, refs/backlog, one-writer, dir-owner and reduced file-size
  ratchets pass. Existing exact emitted compiler/WASM fingerprints remain valid.

## Final implementation verification

First full gate reproduced5 failures in2 files and reran both in isolation:
4 legacy failures plus ratchet-list sort. Log:
/tmp/rifty-316-application-pr-check.log. Sort fixed without test changes (9/9).

Independent DEC-2/PR-4 receipt analysis is committed in
workbench-snapshot-application-receipt-decision.md. The blanket completed-ref
exemption was reverted. All three old adopted corruption checks remain unchanged
and pass. Only the obsolete snapshot-initializer mismatch table entry was
replaced by real post-adoption trusted/absent saved-state cases; the fake ensure
port no longer supplies that policy oracle. Ordinary install-plan seed/template/
port mismatch cases remain. ADR-0397 records finite receipt lifetime, strict
validation and existing-journal retirement before a later catalog mutation.

Retirement carriers:

- Four quota/permission × apply/Save cases: real prior adopted receipt, exact
  failed-journal restoration, same-owner default reuse/retry, pending sibling.
  RED /tmp/rifty-316-legacy-post-adoption-red-retirement.json and isolated.json;
  combined catalog/legacy273/273 GREEN /tmp/rifty-316-legacy-retirement-green-1.json.
- Permanent permission loss also rejects journal rollback flush: no subsequent
  same-owner open/apply effects; fresh owner uses actual durable state/trust,
  zero fetch. Final legacy file16/16 PASS,
  /tmp/rifty-316-legacy-retirement-compensation-all.json.
- Real OPFS native journal close: new2 retirement + old3 catalog tests PASS5/5,
  7.0s, /tmp/rifty-316-legacy-receipt-opfs-2.log. Whole40-entry tree retained;
  after-close only independently pruned journal2→1 refs differs. Payload remains
  edited, catalog/claim and pending sibling/index stay exact; no catalog
  transaction yet. Snapshot preflight requests1, fresh saved reopen requests0.
  Initial fixture run used a fresh companion context for each definition and
  correctly hit foreign-definition rejection; fixed to one frozen context per
  owner, no policy/oracle change. Focused browser TypeScript passes.

Final source: `pnpm pr:check`25/25 PASS (test:run187.5s, parity64.2s), then
`pnpm test:packed-consumer` PASS118.57s. Logs:
/tmp/rifty-316-application-pr-check-final.log;
/tmp/rifty-316-application-packed-final.log. This packed run includes original
archive schema validation repair and strict receipt retirement, plus public
error instanceof, saved/repeated-apply/Node proof and all prior packed journeys.
No compiler/WASM fingerprint exemption changed.
