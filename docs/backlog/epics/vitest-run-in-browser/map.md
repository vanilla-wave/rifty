# Map — vitest-run-in-browser

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). Where a child
depends on another (7 and 9 after 4 — shared `process.ts` shape and
file-size headroom; 8 after 7; 11 after 6, 8, 9, 13; 12 after all) the
order is also recorded as `blocked_by`; the other children are independent.

## Items

1. `npm-client/overrides-bare-version-spec` — **overrides-spelling** — I1; npm's
   `"vite": "8.0.16"` parses as a range, not a package name; unblocks the
   scenario install with zero resolver work.
4. `runtime-js/absent-builtin-members-loud-throws` — **loud-members** — I6;
   `fs.statfsSync`, `child_process.spawnSync`, `process.memoryUsage` exist as
   real or named-loud members instead of link-time misses / `undefined.bind`.
5. `runtime-js/symbol-key-global-write-guard-precision` — **guard-precision** — I6;
   ESM+CJS Function guards stop rejecting `globalThis[<Symbol const>]` writes
   (@vitest/utils, undici) and the claimed path's dynamic keys (vitest worker
   `for (const key in config.defines) globalThis[key] = …`, `vi.stubGlobal`
   param key, imported `Symbol.for` consts); the ceiling still fires when the
   key IS `'Function'`.
6. `runtime-js/readable-pipe-never-ends-process-stdio` — **pipe-stdio** — I4;
   `Readable.pipe(process.stdout|stderr)` never calls `end()` (Node exemption).
7. `runtime-js/process-lifecycle-events-exit-code` — **process-events** — I3;
   uncaught/unhandled handlers, `exit` event, `exit()` honours `exitCode`
   (unset `exitCode` reads `undefined`, as cac/vitest branch on it).
8. `runtime-js/worker-threads-handle-keepalive` — **handle-keepalive** — I2; a
   live `worker_threads.Worker` is a counted handle. After 7 (`exit` must
   exist before the drain contract changes). Contract is fixed by I2. A
   counted Worker needs a run-to-completion Worker to exit (absorbs
   `runtime-js/worker-threads-kernel-run-to-completion-exit`) and a real
   `unref()` in Node's observable shape (napi-rs neuters `ref` through the
   Worker's own `Symbol(kHandle)`/`Symbol(kPublicPort)` objects; rolldown's
   pool Workers stay unref'd) — else the parent never drains.
9. `runtime-js/child-process-advanced-ipc-serialization` — **advanced-ipc** — I4;
   `fork(..., {serialization:'advanced'})` round-trips structured-clone values.
10. `runtime-js/vm-run-in-this-context-offsets` — **vm-offsets** — I4/I5;
    `lineOffset`/`columnOffset` honoured for stack traces instead of thrown.
11. `runtime-js/worker-threads-stdio-streams-empty-exec-argv` — **worker-stdio** —
    I4/I5; `Worker.stdout/stderr` Readables (`stdout: true` semantics) and the
    pools' real startup options: vitest 4.1.11 passes a non-empty `execArgv`
    (`--experimental-import-meta-resolve`, `--require <vitest>/suppress-warnings.cjs`,
    `--conditions …`) to both `fork` and `new Worker` — honoured with Node
    semantics, any other flag a named throw (today Worker throws, fork drops
    it silently). After 6, 8, 9, 13.
13. `runtime-js/message-port-ref-keepalive` — **port-keepalive** — I4; a ref'd
    `MessagePort` (`ref`/`unref`/`hasRef`, listener auto-ref) is a counted
    handle — emnapi's holder for pending rolldown napi async work (vite 8
    config bundle), the wait `vitest run` drains on. Independent.
12. `runtime-js/vitest-run-acceptance` — **acceptance** — I4, I5, I7; e2e spec
    running the scenario (`vitest.config.ts`, `.ts` tests) on both pools + a
    `vitest.md` page in `docs/public/compat/`; closes the goal. After 1, 4–11, 13.

## Open questions

- Coverage check, not a contract input: which handle vitest's cac-driven
  `start()` awaits when rifty drains — answered by prior attempts' reads
  (emnapi `MessagePort.ref`, re-charted as item 13 under I4, not a widened
  I2); owner: agent — instrumented run at item 13 pickup confirms it.
- ADR shape for I2/I3: correction note on ADR-0152 vs one short ADR citing it —
  owner: agent — decided at item 7 pickup (`DEC-2`).
- vm offsets carrier: stack remap table vs source prefix — owner: agent — item 10
  pickup. The evidence §Oracle reading is suspect (V8 applies `columnOffset`
  to the first physical line only, no clamp; vite 8's module-runner
  `prepareStackTrace` reads CallSite getters) — pickup re-runs the oracle.
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
- vitest browser mode, `typecheck` pool, `--changed` (git via spawnSync): loud.
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
