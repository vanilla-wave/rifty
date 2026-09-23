# Map — vitest-run-in-browser

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). Items 1–5 passed
Final+GREEN and are in the ledger. Where a child
depends on another (8 after 7, 11 after 8, 12 after 1–11) the order is also
recorded as `blocked_by`; the other children are independent.

## Items

6. `runtime-js/readable-pipe-never-ends-process-stdio` — **pipe-stdio** — I4;
   `Readable.pipe(process.stdout|stderr)` never calls `end()` (Node exemption).
7. `runtime-js/process-lifecycle-events-exit-code` — **process-events** — I3;
   uncaught/unhandled handlers, `exit` event, `exit()` honours `exitCode`.
8. `runtime-js/worker-threads-handle-keepalive` — **handle-keepalive** — I2; a
   live `worker_threads.Worker` is a counted handle. After 7 (`exit` must
   exist before the drain contract changes). Contract is fixed by I2; the
   instrumented vitest-main run at pickup only confirms coverage (fog below).
9. `runtime-js/child-process-advanced-ipc-serialization` — **advanced-ipc** — I4;
   `fork(..., {serialization:'advanced'})` round-trips structured-clone values.
10. `runtime-js/vm-run-in-this-context-offsets` — **vm-offsets** — I4/I5;
    `lineOffset`/`columnOffset` honoured for stack traces instead of thrown.
11. `runtime-js/worker-threads-stdio-streams-empty-exec-argv` — **worker-stdio** —
    I5; `Worker.stdout/stderr` Readables (`stdout: true` semantics) and explicit
    `execArgv: []` accepted; after 8.
12. `runtime-js/vitest-run-acceptance` — **acceptance** — I4, I5, I7; e2e spec
    running the scenario (`vitest.config.ts`, `.ts` tests) on both pools + a
    `vitest.md` page in `docs/public/compat/`; closes the goal. After 1–11.

## Open questions

- Coverage check, not a contract input: which handle vitest's cac-driven
  `start()` awaits when rifty drains (the Worker class is proven; the vitest
  main case may be the rolldown wasm binding's Worker or the pool child) —
  owner: agent — instrumented run at item 8 pickup; a class outside I2 → re-chart
  (`RDY-5`), never a widened I2 without the user.
- ADR shape for I2/I3: correction note on ADR-0152 vs one short ADR citing it —
  owner: agent — decided at item 7 pickup (`DEC-2`).
- vm offsets carrier: stack remap table vs source prefix — owner: agent — item 10
  pickup; oracle already captured (`/virtual/mod2.js:12:21`, evidence §Oracle).
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
- watch mode (`vitest` without `run`): first loud wall stays
  `readline.emitKeypressEvents` NotImplementedError; not claimed.
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
