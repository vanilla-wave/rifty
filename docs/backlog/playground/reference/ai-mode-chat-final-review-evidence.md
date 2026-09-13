# Independent UI Final+GREEN — cd1c7979c

BASE 1989bdfca0dbb50ee9078a7a94c16b3553c61851. Fresh /root/ui_final_review; no delegation. Main worktree clean and unchanged. Prior accepted core/no-COI not re-audited; current adapter dependencies read only as needed.

## Independent executions

- `RIFTY_PLAYGROUND_PORT=5287 pnpm exec playwright test --project=chromium-heavy --workers=1 tests/e2e/ai-mode.spec.ts` → `/tmp/pr333-ai-ui-review-e2e.log`: 8 PASS, 1.5m; no retries/timeouts.
- `RIFTY_PLAYGROUND_PORT=5297 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/agent-ui-terminal.spec.ts tests/browser-unit/editor-owner-refresh.spec.ts` → `/tmp/pr333-ai-ui-review-browser.log`: 4 PASS, 7.2s.
- `pnpm exec vitest run packages/terminal/src/terminal.test.ts tools/shadow-registry/src/vite-root-url.test.ts tests/integration/vite-cli-prep.test.ts tests/integration/package-install-finalizer.test.ts` → `/tmp/pr333-ai-ui-review-unit.log`: 233 PASS, 4 files.
- Raw full gate `/tmp/pr333-ai-delivery-check.log`: 25 PASS, no isolated reruns; packed `/tmp/pr333-ai-packed-final.log` PASS; prod `/tmp/pr333-ai-prod-final.log` PASS. Logs read, not independently rerun wholesale.

## F1 executed defect

Detached scratch `/tmp/pr333-ui-review-probe` @ cd1c7979c; only scratch files changed. Symlinked installed dependencies; direct Node CLI avoids pnpm auto-install refusal (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`, pre-test infrastructure, no product evidence). Scratch config replaces pnpm webserver launch with equivalent direct Vite CLI; no product change.

App → +chat/settings → select Problems → real scripted-model shell `echo REVIEW_AGENT_VISIBLE` → done/export. `/tmp/pr333-ui-review-problems.log`: output exists but `terminalVisible:false`, `terminalPaneActive:false`, `agentTabSelected:false`; original visibility assertion fails `Received:hidden`. Screenshot inspected `/tmp/pr333-ui-review-problems.png`. Repro appended at scratch `tests/e2e/ai-mode.spec.ts:509`; command in verdict.

Cause: host calls `select(id)` and `showTerminal`; select updates active id, while BottomPanel view remains independent. `showTerminal` only expands collapsed console. Existing focus/reveal signal switches the view but is unused here. Fault class sibling-drift. F1 violates I5/Acceptance1/ADR0427 visible terminal; committed happy-path test never chooses Problems, so coverage is weak for that carrier while the actual code defect is blocking.

## Raw evidence and judging criteria

Read all current production/support diff, goal/unit/ADR0427/0430/0431/0433, required process/review/PR rules and raw preparation failures. UI GREEN additions retain RED assertions and strengthen expanded results, active switch/settings, exact output and production lazy graph. App source pin for inline warmEditorStack removed after pure move; added production network/Monaco proof carries the same loading requirement. Source-grep count decreases 40→39. No correctness criterion weakened to hide a defect.

Root-URL repair executes actual upstream tarball function against ordinary/root-slash identities, acquisition malformed-anchor and trusted-entry rejection; native oracle script/result and HMR RED logs read. In-place clean editor refresh preserves immutable dirty CAS; actual Monaco tests pass. Extracted types/catalog/download/warmup/terminal links preserve behavior. No new coordinator or extra framework/runtime dependency.

Live gzip decoded independently: 11,451,806 bytes, SHA256 8e4ab7758c0f7e0760fb2c9e815d7b36035a8026c2aa50d48ac51cee53555dc6 matches manifest. Actual no-auth config, 1 user/16 assistant/35 tool results, successful build, real preview DOM query/type/click, native errors retained, SCM diff. Read `/tmp/pr333-ai-live.mts` and raw LIVE UI PASS; judge uses actual page, uppercase DARK + closed + Mara, one expected card, same filters/content after navigation reload. Screenshot visually inspected. No model call repeated.

Decoded all three changed snapshots: current acquisition identity/root-URL bytes, plus fresh original Rollup4.63.2 selection in Vite/TS. Added two original tarballs independently match provenance byte sizes and SHA512, metadata integrity/URL. Original retained fixture inputs unchanged.

Goal file unchanged; map keeps I8 and React declaration diagnostics measurement. No goal closure asserted.
