# Map — vitest-run-in-browser

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). Where a child
depends on another (11 after 8; 12 after all) the order
is also recorded as `blocked_by`; the other children are independent.

## Items

8. `runtime-js/worker-threads-handle-keepalive` — **handle-keepalive** — I2; a
   live `worker_threads.Worker` is a counted handle. Contract is fixed by I2. A
   counted Worker needs a run-to-completion Worker to exit (absorbs
   `runtime-js/worker-threads-kernel-run-to-completion-exit`) and a real
   `unref()` in Node's observable shape (napi-rs neuters `ref` through the
   Worker's own `Symbol(kHandle)`/`Symbol(kPublicPort)` objects; rolldown's
   pool Workers stay unref'd) — else the parent never drains.
11. `runtime-js/worker-threads-stdio-streams-empty-exec-argv` — **worker-stdio** —
    I4/I5; `Worker.stdout/stderr` Readables (`stdout: true` semantics) and the
    pools' real startup options: vitest 4.1.11 passes a non-empty `execArgv`
    (`--experimental-import-meta-resolve`, `--require <vitest>/suppress-warnings.cjs`,
    `--conditions …`) to both `fork` and `new Worker` — honoured with Node
    semantics, any other flag a named throw (today Worker throws, fork drops
    it silently). After 8.
12. `runtime-js/vitest-run-acceptance` — **acceptance** — I4, I5, I7; e2e spec
    running the scenario (`vitest.config.ts`, `.ts` tests) on both pools + a
    `vitest.md` page in `docs/public/compat/`; closes the goal. After 8, 11.

## Open questions

- Natural exit calls the user-reassignable `process.exit` property
  (`node-entry-bootstrap.ts` `exit: (...code) => proc.exit(...code)`): vitest
  4.1.11 pool workers patch it (a throwing patch → exit 1 where Node fires
  `'exit'` 0 and exits 0) — owner: agent — first exercised at item 8 (worker
  natural exit) / item 12; a wall there is a re-chart.
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
