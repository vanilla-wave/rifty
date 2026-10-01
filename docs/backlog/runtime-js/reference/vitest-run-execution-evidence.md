# Vitest delivery execution evidence

2026-10-02; goal `vitest-run-in-browser`; delivery base `0c4c1b07`.
Node v24.16.0; native Vitest 4.1.11 / Vite 8.0.16; Chromium Playwright.
Original baseline and npm oracle: `vitest-run-in-browser-evidence.md`.

## RED and reference

Captured failing runs: `vitest-run-red-proof.txt`. Each section retains its
actual command/test failure. Faults discovered after first GREEN were repaired
against their own reproduced baseline; global key conversion order follows
native rhs-before-ToPropertyKey, not the discarded frozen unit assumption.
Native executable probes: `vitest-execargv-probe.cjs`,
`vitest-cli-admission-probe.mjs`, `vitest-cli-envelope-info-probe.cjs`.
Their captured outputs and independent DEC-2 records live alongside them.

To reproduce CLI probes: create `/tmp/rifty-vitest-native`, install exact
Vitest 4.1.11 with `overrides: {"vite":"8.0.16"}` using native npm,
then execute the committed scripts with Node 24.16.0. ExecArgv probe creates
its own temporary fixture tree; no installed dependency required.

## Acceptance commands

- Dev: `RIFTY_PLAYGROUND_PORT=5395 pnpm exec playwright test --project=chromium-heavy tests/e2e/vitest-run-in-browser.spec.ts`.
- Production: `RIFTY_PLAYGROUND_PORT=5396 pnpm exec playwright test --config playwright.prod.config.ts --project=chromium tests/e2e-prod/vitest-run-in-browser.spec.ts`.
- Delivery gate: `pnpm pr:check` (full lanes; no origin/main merge-base).
- Published bundles: `pnpm test:packed-consumer`.

The same real files execute on native Node and physical runtime Workers.
Vitest acceptance starts clean, installs real tarballs, honours TS config/include,
runs the failing tests on forks/threads, then fixes and reruns them.
Reporter counts/diff and terminal history exit codes discriminate silent exits.
Config-only jsdom/happy-dom and coverage reach actual dependencies and named
ceilings; CLI watch, VM pools, browser and coverage refuse named unclaimed modes.
Root info/canonical help prints once. No Vitest source edits or runner substitute.

## Build inventory

Compiler worker remains 10,022,694 bytes; shared chunk imports changed on rebuild.
Exact SHA-256 updated to `6a5f97ad641ce453a0bc2b9f8c9d0df4fc9a5ec75ef12974feb10a4f9e7be9ea`.
The 2 MB carrier ceiling and negative inventory tests remain unchanged.

## Current execution

- Production composed acceptance: 2 passed, 2.2 min; I1–I7 positive/negative scenarios.
- Config-only DOM/coverage dev acceptance: 1 passed, 1.6 min.
- Startup/admission unit selection: 41 passed; exact version ceilings covered.
- Lint/typecheck/build: passed. Full gate/packed results recorded before final review.

Goal completion requires independent Final+GREEN on the delivered revision.
