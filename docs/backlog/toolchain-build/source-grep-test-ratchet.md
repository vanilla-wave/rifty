---
area: toolchain-build
status: ready
title: Ratchet check — no new source-grep tests, burn down the existing 15
created: 2026-07-02
epic: playground-testable-core
why: 15 playground test files assert readFileSync'd source text (950 asserts total; App.test 494, real-vite-bootstrap 93, EditorHost 88, FileExplorer.source 70, …) — they pin strings, prove no behavior, break as stale-string noise on merges; nothing stops the pattern from growing
user_story: As a reviewer, I want CI to refuse a new expect(source).toContain-style test so the extraction epic's payoff isn't silently re-accumulated, but today the pattern passes every gate.
sources: [tools/checks/pr-check.mjs]
---
## Context
Detector-verified 15 (2026-07-02, corrects the draft's 12: +`bundle-local-buffer.test.ts` reads 4 bootstrap sources, +`TerminalPanel.test.ts`/`BottomPanel.test.ts` grep under non-`source` variable names; `node-entry-resolve.test.ts` is NOT one, it asserts generated output). Baseline counts = the detector's (incl. derived bindings like `const tail = source.slice(…)`, hence higher than the manual sweep): App.test.ts 494, real-vite-bootstrap 93, EditorHost 88, FileExplorer.source 70, ts-ls-monaco-providers-source 63, dev-server-boot 44, PreviewPanel 28, vite-cli-prep 26, node-entry-bootstrap 9, build-boot 9, realVite 8, TerminalPanel 6, kernel-worker-entry 5, bundle-local-buffer 5, BottomPanel 2 — canonical list lives in `tools/checks/source-grep-ratchet.mjs` ALLOWLIST.

## Acceptance
- `tools/checks/source-grep-ratchet.mjs` scans `apps/playground/src/**/*.test.{ts,tsx}`: a file is source-grep if it `readFileSync`s a first-party `.ts`/`.tsx` source module and asserts on the text; per-file metric = count of such assertions.
- Allowlist (in the check, one entry per file: path + count + optional `why` residual constraint). Fail on: file not in allowlist with count > 0; actual count ≠ allowlisted count (either direction — a burn-down must shrink the allowlist in the same PR, stale entries are violations too).
- Wired as `check:source-grep` in root package.json and in `pr-check.mjs` TASKS — a PR adding `expect(source).toContain` to a new file fails `pnpm pr:check`.
- The check itself has unit tests (allowlist match, new-file refusal, count drift both directions, `why`-carrying residual accepted) in `tools/checks/`.
- RED-check: adding a synthetic source-grep test file makes the check fail (verified once, then removed).
- Epic-close gate (owned by the epic, not this item): every entry reaches count 0 (deleted) or carries `why`.

## Parity cases
None — CI tooling, no Node-API behavior. Verification is the check's own unit tests + RED-check per Acceptance.

## Out of scope
- Burning down the allowlist — rides `playground/app-orchestration-headless-core` (App/realVite), `toolchain-build/browser-mode-unit-lane` (worker modules), and direct behavioral conversion for component files.
- Non-playground packages: the sweep found the pattern only under `apps/playground`; the check's scope stays `apps/playground` until a hit appears elsewhere (extending scope = one-line glob change).
- Fixture reads (test reading its own fixture/golden files) — not source-grep; detector keys on first-party src modules.

## Decisions
- Detector = two-pass regex over the test file (identifiers assigned from `readFileSync(...)` of a path ending `.ts`/`.tsx` under `src/`, then `expect(<id>...)` assertion count) — an AST parse is overkill for a ratchet; false-negative risk accepted because the allowlist is exact-count and any NEW pattern variant gets added to the detector when seen (REVERSIBLE tooling).
- Exact-count equality (not ≤) so burn-down is forced to be recorded — mirrors honest-❌ compat stance.
- Plain check script + pr-check task (not a dep-cruiser rule) — the signal is assertion shape, not import graph.
