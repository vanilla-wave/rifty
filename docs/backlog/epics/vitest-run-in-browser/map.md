# Map — vitest-run-in-browser

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). Where a child
depends on another (8 after 7, 11 after 8, 12 after 1–11) the order is also
recorded as `blocked_by`; the other children are independent.

## Items

1. `npm-client/overrides-bare-version-spec` — **overrides-spelling** — I1; npm's
   `"vite": "8.0.16"` parses as a range, not a package name; unblocks the
   scenario install with zero resolver work.
2. `runtime-js/path-posix-win32-builtins` — **path-subpaths** — I6; `node:path/posix`
   and `node:path/win32` registered from the existing namespaces.
3. `runtime-js/builtin-static-names-prototype-methods` — **process-named-imports** —
   I6; static export names of a builtin include its prototype methods
   (`import { cwd } from 'node:process'`).
4. `runtime-js/absent-builtin-members-loud-throws` — **loud-members** — I6;
   `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage` exist as
   real or named-loud members instead of link-time misses / `undefined.bind`.
5. `runtime-js/symbol-key-global-write-guard-precision` — **guard-precision** — I6;
   ESM+CJS Function guards stop rejecting `globalThis[<Symbol const>]` writes
   (@vitest/utils, undici).
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

## Items

13. `runtime-js/vitest-config-pipeline-suspension` — **config-suspension** —
    I4/I5; vite 8.0.16 `createServer({configFile, plugins})` never settles
    (generic wall, discovered at u12 acceptance 2026-10-05; evidence in
    `runtime-js/reference/vitest-config-pipeline-suspension-evidence.md`).
    Blocks 12.

## Landed (2026-10-05, pending goal close)

1–11 landed on the goal branch (Final+GREEN verdicts per unit in
`docs/backlog/*/reference/<slug>-final-green.json`; re-chart lines in the
ledger). Item 12 (acceptance) is implemented — e2e spec + compat page — and
RED on item 13's wall; it closes when 13 lands.

## Open questions

- ~~Which handle vitest's cac-driven `start()` awaits~~ RESOLVED 2026-10-05:
  not a handle gap — `createVitest` suspends on a never-settling promise in
  vite 8.0.16's configFile+plugins pipeline (item 13). Owner: agent —
  diagnosis at item 13 pickup.
- ~~ADR shape for I2/I3~~ RESOLVED: I2 = dated extension note on ADR-0152
  (Worker handle class); I3 = dispatcher in the keepalive traps + process.ts
  (no ADR-0152 contract change).
- ~~vm offsets carrier~~ RESOLVED: hybrid — physical newline prefix (positive
  lineOffset) + `Error.prepareStackTrace` dispatcher (columns, negative
  lines, eval-marker normalization).
- ~~`vitest.config.ts` loading / `.ts` transform fog~~ RESOLVED as a named
  wall: item 13 (the predicted re-chart).

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
