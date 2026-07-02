---
kind: epic
status: in-progress
title: Playground testable core — behavioral tests below e2e for page↔owner orchestration
created: 2026-07-02
value: Playground changes stop shipping wiring regressions that only an e2e flake hunt can catch — reload/restore, dev-server lifecycle, LIVE-pill truth become provable in seconds, and the same extraction yields the headless workbench core M11 "Embeddable" needs.
user_story: As a developer changing playground/owner wiring, I want orchestration behavior provable in a seconds-fast test, but today App.tsx is a ~3.4K-line component whose tests are 392 source-text greps, the page↔owner↔SW fabric runs only under 46 Playwright specs, and every wiring bug costs an e2e retry-hunt (or reaches users).
items: [playground/app-orchestration-headless-core]
---

## Outcome

Diagnosis (2026-07-02, main 335c7fa9): playground coverage-by-presence is fine (~30.6K prod / ~18K test LOC; truly untested ~1.6K of small UI); the defect is test STRENGTH. 12 test files are source-grep tests (`readFileSync` the module + `expect(source).toContain(...)`): `App.test.ts` 392 source-asserts / 78 its, `real-vite-bootstrap.test.ts` 79/23 — exactly the modules of the documented flake sagas. Root cause is recorded in `App.test.ts` itself: `App()` is one component (~3.4K lines, ~75 signals/effects) transitively importing browser-only xterm → unrenderable in node vitest → tests fell back to grepping source. Grep-tests pin import strings, prove zero behavior, and break as stale-string noise on merges. Between node-vitest and full Playwright no tier exercises the cross-realm fabric, so wiring regressions (reload loses dev server, false-LIVE, dropped terminal marker) are discovered by e2e flake hunts or by users.

Mission anchor: fidelity is only as real as the tests proving it — a grep is a fake test over real code. This epic makes the orchestration layer behaviorally provable below e2e, and the extraction it forces is the same headless-core work M11 "Embeddable" / the parked `distribution/workbench-controllers` package need (sharpens D-002: solid stays a thin binding).

## User scenario

A developer refactors dev-server lifecycle wiring. `pnpm test` (seconds, no browser) fails a behavioral contract test on the orchestration core — the same failure class that previously needed a 90s-timeout×2-retries e2e to even surface. They fix it; e2e stays the thin end-to-end confirmation, not the discovery tool. A reviewer adding a new `expect(source).toContain` test gets a CI refusal. At epic close, `grep -r "expect(source" apps/playground` hits only an allowlist where each residual carries a recorded why-behavioral-is-impossible constraint — ideally empty.

## Items

- `playground/app-orchestration-headless-core` — split `App()` into a thin Solid shell + xterm/monaco-free orchestration modules with injected ports; each extracted slice replaces its source-greps with RED-checked behavioral tests. The bulk of the value. Slice 1 (dev-server lifecycle + LIVE + preview set) DELIVERED (ADR-0195, `src/orchestration/dev-server-lifecycle.ts`, App.test greps 494→432); slices 2-4 open.
- ~~toolchain-build/browser-mode-unit-lane~~ — DELIVERED (deleted-on-done): ADR-0196 thin-Playwright lane, `pnpm test:browser-unit`, own CI job; owner boot + vfs-write-ack + preview-handshake pinned behaviorally against the real owner worker.
- ~~toolchain-build/source-grep-test-ratchet~~ — DELIVERED (deleted-on-done): `pnpm check:source-grep` in pr:check; exact-count allowlist = 15 files/888 asserts (detector corrected the diagnosed 12: +`bundle-local-buffer`, +`TerminalPanel`, +`BottomPanel`); burn-down to zero-or-`why` stays THIS epic's closing gate.

Related (not owned here): `distribution/workbench-controllers` — lifting the extracted core into a public package stays IRREVERSIBLE (own ADR) and gated on a real non-Solid consumer; this epic removes its App.tsx-untangling blocker.
