# Map — vitest-run-in-browser

Integrated observed-defect delivery; original twelve findings retained until
Final+GREEN. No change to accepted goal.md.

## Items

1. `runtime-js/vitest-run-acceptance` — I1–I7; composed runtime repairs,
   exact real Vitest scenario, production proof, compat page and final review.

## Open questions

None. WASM jobs + guest ports hold the actual Vitest work; ADR-0491/0494/0496.
VM mapping: ADR-0493. TS config/tests proven on both pools. Non-TTY watch
needs finite installed-CLI admission, ADR-0500; the old readline premise was false.

## Out of scope

- `environment: 'jsdom' | 'happy-dom'` — draft epic `jsdom-environment-in-browser`
  (probe: jsdom 30 installs and parses DOM; vitest forces `runScripts:
  'dangerously'` → `vm.constants.DONT_CONTEXTIFY` + Window as a vm-realm global;
  feasibility open). Until then a loud `NotImplementedError` naming that epic.
- watch mode (`vitest` without `run`): `vitest.watch` admission ceiling
  (ADR-0500); real non-TTY watch otherwise runs and waits.
- coverage (`@vitest/coverage-v8` → `node:inspector` Session): loud proxy throw.
- `vmThreads` / `vmForks` pools (`vm.SourceTextModule` absent): loud.
- vitest browser mode, `typecheck` pool, `--changed` (git via spawnSync): loud.
- vite versions other than exact 8.0.16 and vitest other than 4.1.11: unclaimed;
  vite outside the exact set keeps today's loud shadow/patch ceilings.
- re-running `npm install` after changing the pin over an existing
  `node_modules/vite`: stale files survive and the vite install patch aborts —
  `npm-client/stale-package-dir-on-version-change` (honest-npm territory); the
  scenario starts from a clean project.
- `beforeExit` emission (false on main, not on vitest's path) stays with
  `process-lifecycle-events-exit-code` as a note, not an obligation.
- byte-identical reporter timing/ANSI; `process.memoryUsage` real numbers
  (`logHeapUsage` opt-in stays loud).
