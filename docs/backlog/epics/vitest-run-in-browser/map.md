# Map — vitest-run-in-browser

Live plan: index, not store. Minimal pattern first; each child a `draft`
finding compiled to `ready` at its own PICKUP (`RDY-1`). Item 8 follows 7;
item 11 is delivered inside 8's merged Worker lifecycle unit. Item 12 follows
all deliveries 1–11 and startup unit14; MessagePort unit13 is accepted. Remaining independent children
retain their ordering.

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
8. `runtime-js/worker-threads-handle-keepalive` — **worker-lifecycle** — I2/I5; a
   live Worker is a counted handle; child natural exit follows parentPort
   listener lifetime; includes item 11's stdio/empty-execArgv and the required
   `worker-threads-kernel-run-to-completion-exit` repair in one checkpoint.
   After 7 (`exit` must exist before the drain contract changes). I2 fixes
   the keepalive contract; the
   instrumented vitest-main run at pickup only confirms coverage (fog below).
9. `runtime-js/child-process-advanced-ipc-serialization` — **advanced-ipc** — I4;
   `fork(..., {serialization:'advanced'})` round-trips structured-clone values.
10. `runtime-js/vm-run-in-this-context-offsets` — **vm-offsets** — I4/I5;
    `lineOffset`/`columnOffset` honoured for stack traces instead of thrown.
11. `runtime-js/worker-threads-stdio-streams-empty-exec-argv` — **worker-stdio** —
    I5; `Worker.stdout/stderr` Readables (`stdout: true` semantics) and explicit
    `execArgv: []` accepted; merged into item 8's delivery (RDY-5, 2026-09-23),
    no separate pickup.
12. `runtime-js/vitest-run-acceptance` — **acceptance** — I4, I5, I7; e2e spec
    running the scenario (`vitest.config.ts`, `.ts` tests) on both pools + a
    `vitest.md` page in `docs/public/compat/`; closes the goal. After 1–11 and14.
14. `runtime-js/worker-threads-startup-options` — **child-startup** — I4, I5, I6;
    exact Vitest flags force generic child CJS preloads, conditions and flagged
    import.meta.resolve parentURL. Worker rejects them; executed fork sibling
    silently drops them. One startup consumer, distinct native inheritance
    authorities, exact typed launch migration. Added from Chromium5419 plus
    native/physical fork probe; no Vitest patch.

## Open questions

- Advanced IPC scope fork pending: candidate Promise brand guard rejects ambiguous
  locked-constructor records with a named opaque-brand ceiling. Exact Vitest10runs
  stays GREEN5447; frozen-Promise native-parity RED remains. User approval required
  before changing the full graph contract; evidence in
  `runtime-js/reference/advanced-ipc-intrinsic-brands-evidence.md`.
- I7 user fork pending: fresh Chromium5428 also runs Vitest4.1.11/Vite8.0.15
  fail/fix correctly. The accepted blanket other-version ceiling is false.
  Watch also ran tests and waited45s without a ceiling (Chromium5429).
  Asked whether to retain exact guarantee without artificial mode/version bans;
  no goal.md amendment until the user's answer. Other work continues.
- Resolved startup-handle fog (2026-09-23): emnapi runtime's
  NodejsWaitingRequestCounter calls missing ref/unref on a global MessageChannel
  port; rolldown deliberately unrefs its Worker. Accepted I4 MessagePort slice owns this class,
  without widening I2. Evidence: message-port-ref-keepalive reference.
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
- watch mode: observed tests + wait without ceiling; I7 user fork above remains open.
- coverage: installed @vitest/coverage-v8 reaches missing node:inspector/promises.
- `vmThreads` / `vmForks`: unsupported --experimental-vm-modules child execArgv is loud.
- vitest browser mode, `typecheck` pool, `--changed` (git via spawnSync): loud.
- Other versions: outside the guarantee; 8.0.15 also passed. Blanket bans remain
  the pending I7 user fork, not an observed runtime boundary.
- re-running `npm install` after changing the pin over an existing
  `node_modules/vite`: stale files survive and the vite install patch aborts —
  `npm-client/stale-package-dir-on-version-change` (honest-npm territory); the
  scenario starts from a clean project.
- `beforeExit` emission (false on main, not on vitest's path) stays with
  `process-lifecycle-events-exit-code` as a note, not an obligation.
- byte-identical reporter timing/ANSI; `process.memoryUsage` real numbers
  (`logHeapUsage` opt-in stays loud).
