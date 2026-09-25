# Map — vitest-run-in-browser

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). One child left;
no ordering constraint.

## Items

12. `runtime-js/vitest-run-acceptance` — **acceptance** — I4, I5, I7; e2e spec
    running the scenario (`vitest.config.ts`, `.ts` tests) on both pools + a
    `vitest.md` page in `docs/public/compat/`; closes the goal.

## Open questions

- `vitest.config.ts` loading (vite `loadConfigFromFile` → rolldown bundle of
  the TS config) and `.ts` test transform under vitest's module runner: no
  wall observed yet because earlier walls block — owner: agent — first
  exercised at item 12; a wall there is a re-chart (new child), never a
  silent narrowing of the claim.

## Out of scope

- `environment: 'jsdom' | 'happy-dom'` — draft epic `jsdom-environment-in-browser`
  (probe: jsdom 30 installs and parses DOM; vitest forces `runScripts:
  'dangerously'` → `vm.constants.DONT_CONTEXTIFY` + Window as a vm-realm global;
  feasibility open). Until then a loud `NotImplementedError` naming that epic.
- watch mode: unclaimed ⚠️ (goal amend 2026-09-23) — shell stdin is non-TTY,
  so bare `vitest` runs once (as Node with piped stdin) and `--watch` waits on
  fs polling; no ceiling, no ban.
- coverage (`@vitest/coverage-v8` → `node:inspector` Session): loud proxy throw.
- `vmThreads` / `vmForks` pools (`vm.SourceTextModule` absent): loud.
- vitest browser mode, `typecheck` pool: loud.
- `--changed` (git through tinyexec `x` → async `spawn`, not `spawnSync` —
  loud-members evidence V1): unclaimed, unprobed.
- vite versions other than exact 8.0.16 and vitest other than 4.1.11: unclaimed
  ⚠️ (goal amend 2026-09-23); vite 8.2+ fails loudly at install
  (`lightningcss.version`), 7.3.6/8.0.x/8.1.x install unverified; no ban.
- re-running `npm install` after changing the pin over an existing
  `node_modules/vite`: stale files survive and the vite install patch aborts —
  `npm-client/stale-package-dir-on-version-change` (honest-npm territory); the
  scenario starts from a clean project.
- `beforeExit` emission (false on main, not on vitest's path) stays with
  `process-lifecycle-events-exit-code` as a note, not an obligation.
- byte-identical reporter timing/ANSI; `process.memoryUsage` real numbers
  (`logHeapUsage` opt-in stays loud).
