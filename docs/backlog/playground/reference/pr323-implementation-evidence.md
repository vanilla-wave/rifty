# PR #323 implementation evidence

2026-09-10; source baseline `b4058f421` plus PR documentation `6e973949a`.
User requests implementation in PR #323, push and green CI; no merge requested.

## Decisions

Fresh read-only `/root/decision_323` inspected raw user answers, applicable ADRs
and source (DEC-2). Recommendations retained in ADR-0413/0414/0415. No new
user fork; selected scope and exclusions match the prior final-checked refinement.
Three delivered boundaries stay in the requested PR; original unrelated OPFS
epic obligations are not silently included or declared complete.

## RED

Node v24.16.0, pnpm 11.5.2, Vitest 2.1.9, Chromium via Playwright 1.60.0.

- `pnpm exec vitest run packages/workbench/src/workers/saved-project-access.contract.test.ts apps/playground/src/glue/page-store-reset.contract.test.ts`: 5 failed, 1 passed. Absent/pending/incompatible claim and malformed lock reject saved open with `Saved project is incompatible with current install trust: scratch`; Reset retains true instead of false. Missing ordinary dependency already admits the child; retained as baseline.
- `RIFTY_PLAYGROUND_PORT=56323 pnpm exec playwright test --config playwright.browser-unit.config.ts public-project-open-progress.spec.ts --workers=1`: 1 failed, `events.length` 0. Real produced ms snapshot, real owner/OPFS, source read succeeds. The first attempted test called nonexistent `projects.nodeCli`; discarded as harness error. The committed test uses public Playground companion.
- `pnpm exec vitest run packages/workbench/src/workbench/open-workbench.contract.test.ts -t 'PR323 public'`: progress lifecycle RED; no `projectOpen` after scoped real-count frame at the external owner boundary.

## Progress mechanism sweep

Owner controller serializes open and owns `opId`; browser owner holds that same
pending operation map; public Workbench owns opening/active/closed state; health
authority already publishes snapshots. Reuse those owners. Capture open id at
flush creation; unscoped/retired frames cannot contribute public open progress.
No new correlation ledger, FIFO, subscriber service or public operation handle.

## Remaining proof

Implementation GREEN, full browser Reset/interrupted-install/adapter-use proof,
independent Final+GREEN, `pnpm pr:check` and PR CI remain required.

## Progress GREEN

- Owner/protocol/public health/Launcher: 184 tests pass; old-opId and death-window additions: 72 tests pass.
- Public real snapshot/OPFS progress: 1 browser test passes.
- `RIFTY_PLAYGROUND_PORT=56323 pnpm exec playwright test --project=chromium-light project-opening-progress.spec.ts --workers=1`: 1 passed; actual Vite first-open UI, geometry and screenshot inspected. Screenshot shows `Preparing instant project Project files Saving 1/302 operations`; completion removes the indication.
- Exact public type fixture gains the additive ADR-0413 field; no assertion removed. Source-size and backlog gates pass.

## Saved-open browser RED

- `RIFTY_PLAYGROUND_PORT=56323 pnpm exec playwright test --config playwright.browser-unit.config.ts saved-project-interrupted-install.spec.ts saved-project-adapter-use.spec.ts --workers=1`: 2 failed. Actual saved Vite runs local Node first; real `npm install lodash` is killed with the page only after a native OPFS close of lodash/LICENSE. Its fresh owner fails at saved-open trust. Separately, saved Vite with corrupted esbuild WASM opens but unrelated `node local.cjs` exits 1.
- `saved-project-access.spec.ts`: fresh public owner refuses named saved project after actual file API edits to lock/dependency; RED is saved install trust, after the complete save/mutation/close preparation.
- `entry-adapter-failure.contract.test.ts`: 2 REDs, missing/corrupt WASM blocks unrelated Node entry; explicit adapter activation remains correctly strict.
- New tar fixture: real lodash 4.17.21 from npm registry; upstream metadata/integrity committed. Test boundary is native OPFS close, never a fake installer/owner. Initial fixture import and public CAS/path errors were corrected before claiming these REDs.

## Remaining-unit preparation

Fresh reviewer `/root/saved_dirty_contract`: Contract+RED accepted, 8/8 coverage, no blockers; same final draft read certifies dirty scope attribution. Real interrupted install preserved 1952 lodash/LICENSE bytes before page death. Retained baseline 76 unit + 3 OPFS browser tests green.

Author native oracle, Node v24.16.0: temporary package manifest names ms2.0.0, package-lock is `not JSON`; `node local.cjs` exit0/output `local source ran`; `node main.cjs` missing ms exit1/MODULE_NOT_FOUND; `npm install --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org` exit0; rerun main exit0/output2000, regenerated lockfileVersion3.

Real companion Reset/PageStore browser: 1 RED at page dirty true instead of false, after ownerDirty=false and /note.txt deletion passed. No direct Scratch Reset button is claimed by this carrier; it exercises the public companion operation and the actual page store. Ordered authoritative catalog publication needs no optimistic dirty override; pending-starter protection stays.

## Saved access / dirty GREEN

- Saved access/entry adapter/realm: 10 unit tests pass; extended missing-lock, invalid shadow and missing/malformed manifest cases pass (9 saved cases).
- `saved-project-access.spec.ts`, `saved-project-adapter-use.spec.ts`, `saved-project-interrupted-install.spec.ts`, `scratch-reset-page-state.spec.ts`: 4 browser tests pass. Partial lodash/LICENSE1952 bytes survive page death; explicit retry runs lodash.chunk. Malformed-lock explicit npm repair runs ms with output2000. Damaged esbuild permits independent Node and fails only at use.
- Snapshot suites: 97/97 pass. Only saved-open result/refusal assertions changed under ADR-0415; real snapshot apply validation, rollback fences, recovery, byte identity and failure assertions retained. Saved result is `kind:saved`, without installation provenance.
- Dirty baseline: original first-install and mutation assertions retained by composing the real companion observer; VFS now forwards raw intents and companion suppresses extraneous-tree dirty. The initial clean-baseline eligibility moved into companion finalization.
- Reset retains the legacy optimistic writer's still-unacknowledged edit only; authoritative dirty acknowledges it, then Reset clean wins. Existing pending-starter transition remains. One existing page store, no new queue/epoch/persisted owner; pending source marker replaces the overbroad dirty override.

## Required npm repair discovery

Actual saved browser path exposed the old syntactically corrupt-lock install refusal. Native npm artifact above contradicts it; independent `/root/decision_323` confirmed ADR-0023 already requires missing/unparseable lock → resolve. All 3 reader consumers inspected: installer and source integrity lookup share the parse miss, snapshot producer independently requires non-null v3 before network. No new mode/reader or ADR supersession needed. Catch only JSON.parse; preserve I/O, legacy-v1/v2 and parsed shadow/replay errors. The original syntax-error assertion is replaced with successful-write/failure-preservation/I/O proofs; strict snapshot producer regression added. 98 focused unit tests pass after this repair.

## Related inventory

`readInstallStamp` async readers stay live. Rechecked convenience stamp predicates have no production caller (tests only); retained because deleting their tests is unnecessary to the requested boundary. `treeRevision` remains real VFS/publication evidence; dirty classification has no independent durable revision owner. Existing pure path predicates remain shared facts, while companion owns their dirty meaning.
