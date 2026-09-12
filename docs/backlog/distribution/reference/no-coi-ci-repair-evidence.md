# PR #332 CI repair

Baseline 0f8283931149d030339eeb8091de050990546ccf; CI run 34545833308,
no-coi job 103098911773: 80 passed, three failures. Isolated local command:
`pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-dev-hmr.spec.ts tests/no-coi/no-coi-sandbox-build-loop.spec.ts -g 'resident start rejects pre-bound|request-identical Vite|threaded-WASM: Vite 8'` reproduced all three.

- Vite-name decoys: concrete preparation rejected absent Vite CLI before executing
  installed bytes. Generic adapter preparation + existing source-driven CLI hook
  preserves ADR-0375. Registry acquisition keeps the prepared producer recipe.
- Failed resident start: actual EADDRINUSE arrived before a later timer's exit;
  no timer can promise cross-worker settlement. Existing terminal frame now owns
  serialized failure plus exit; no extra state owner or deadline.
- Vite 8 harness: prepared acquisition changed the exact action anchor. Updated
  test-owned export, retained named threaded-WASM failure and real byte execution.
- With generic tracking, packed invalid-lock failure is visible; subsequent
  repaired build replayed that same error because the global first-rejection
  slot persisted. Existing serialized run owner now takes and reports that slot;
  refcounts and eval lifecycle untouched. Native packed RED is in
  `/tmp/rifty-332-packed-generic-entry.log`; focused ownership RED in
  `/tmp/rifty-332-invocation-error-red.log`.

Class: sibling-drift / provenance-lie at the existing invocation/terminal owner.
Dedicated Worker boundary excludes lost/reordered/duplicate live frames; no new
FIFO, correlation, epoch, completion stamp or error ledger. Workbench's own
concrete entry policy remains scoped to its consumers. ADR-0423.

GREEN: isolated three CI cases 3/3; keepalive + host/startup suites 65/65;
terminal-cause regression 7/7. Full packed consumer completed exit 0 in
`/tmp/rifty-332-packed-recovery-green.log`, including invalid-lock failure,
explicit force reapply and successful next Vite build in the same worker.
Exact rebuilt TypeScript asset remains 10,022,694 bytes; only its import-derived
SHA changed. Retirement inventory verifies unchanged negative/size constraints.

Full native no-COI lane: 83/83, exit 0 (3.8 min),
`/tmp/rifty-332-full-no-coi-repair.log`. Full `pnpm pr:check`: 25/25, exit 0;
unit/conformance 189.6s, parity 62.4s,
`/tmp/rifty-332-ci-repair-pr-check.log`.
