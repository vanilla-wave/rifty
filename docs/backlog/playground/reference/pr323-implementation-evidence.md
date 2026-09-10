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
