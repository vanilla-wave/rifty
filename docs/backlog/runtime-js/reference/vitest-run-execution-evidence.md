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

## Independent repair pass

Review 1 on 1abb86ea found exit(null) inheritance regression and double-read
Buffer getters. Both real REDs captured; native Node oracle retained. Repair
unit selection: 9 passed; getter physical fork parity: 1 case matches Node.
Sibling sweep uses native Map contents and V8-ordinary Blob properties. Earlier
Blob host-clone assertion was a frozen structuredClone assumption, corrected
by executed Node v24.16.0 V8 oracle, not a widened browser claim.
First packed consumer failed Chromium cleanup deadline while competing with
full unit gate; isolated rerun required. First full gate's actual failures were
uncommitted compat drift, generator file-size, and missing integration import.
No behavior test expectation weakened.

I3 entry-origin sweep: CJS/ESM top-level Native Node v24.16.0 handlers print
entry-boom with origins uncaughtException/unhandledRejection, then after and exit0.
Real loader RED 2; GREEN entry/startup regression selection 26 tests.

Final sibling sweep: native Proxy is uncloneable; snapshot initially copied it
to an ordinary object (executed RED). Shared loader/Node bootstrap now record
guest native Proxy constructor/revocable outputs in one private WeakSet; native
clone rejects before traps. Unit reflection/rejection plus physical fork parity
GREEN. Proxy creation metadata is required; no extra lifetime/terminal owner.
CLI eval handler GREEN: real behavioral RED then 31-test entry/IPC selection;
physical CJS/ESM/eval acceptance 1 passed (27.0 s).
