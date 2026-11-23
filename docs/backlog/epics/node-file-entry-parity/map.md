# Map — node-file-entry-parity

## Items

1. **acceptance carrier** — delivered: `tests/browser-unit/fixtures/node-file-programs.ts`
   (9 entry + 43 fatal rows, live Node oracle, root length equal by
   construction), `tests/no-coi/node-file-parity.spec.ts`,
   `tests/browser-unit/node-file-parity.spec.ts`,
   `packages/isolate-host/tests/node-file.test.ts`: every row Node's bytes or
   its pin in `node-file-pins.json` (a named compat row), no Node header on
   any row. Removed at CLOSE. → I1–I4
5d. **browser-host fatal path** — on the no-COI SDK and the COI Workbench
   every fatal path prints as main (rolled back after review rounds 4 and 5;
   Node's report only in the isolate guest): rows pinned with runtime
   locations as `<runtime>/packages/<file>`, the no-COI timer rows `failed`
   with `exitCode` null; proof `runtime-js/reference/pr-421-browser-fatal-matrix.md`.
   Open: the user question below;
   `runtime-js/browser-host-realm-uncaught-fatal-report`. → I2 I3 I4
## Open questions

- В браузерных хостах (COI и no-COI) необработанная ошибка из таймера или
  другого callback'а печатается как на main: текст браузера с кадрами и URL
  runtime rifty, не отчёт Node. Цель обещала один отчёт на всех хостах;
  изменение жизненного цикла браузерных процессов, которое это давало, откачено
  после двух регрессов. Принять как есть и отложить в backlog — или отдельная
  цель — owner: user — evidence: map item 5d, compat process.md "Fatal error
  stderr bytes", `runtime-js/browser-host-realm-uncaught-fatal-report`.
  Measured 2026-11-23 on the tree after the rollback, `console.log('before');
  setTimeout(() => { throw new Error('x') }, 0)`: no-COI SDK
  `project.run('node main.js')` → `status: 'failed'`, `exitCode: null`, stdout
  `before\n`, stderr '', `error: { code: 'WORKER_CRASHED', message: 'Worker
  crashed: Uncaught Error: x' }`, toolchain Worker `replaced`; the next `node -p
  1+1` in the same sandbox → `exited`, 0, `2`. COI Workbench shell `node
  zz/main.js` → exit 1, output `before\nUncaught Error: x
  (/home/project/zz/main.js:2)` (one browser line, no frames); the next `node -p
  1+1` → 0, `2`. Node: its report, exit 1. The user's first answer
  («ок, не выглядит серьезным, если не так, поправь») was given before these
  facts; asked again by the manager.

- Settled (goal amend 2026-11-23, user: «давай положим в бэклог на всякий»):
  no Node-format header on any path and a syntax error as main's
  `ModuleLoadError` — deferred to `runtime-js/sync-uncaught-header-throw-site-source`
  and `runtime-js/module-compile-error-node-syntax-error`.

- Settled (probe 2026-11-23): in the isolate every `require()` of an ES module
  fails `TypeError: URLConstructor is not a constructor` before the module runs
  — compat isolate-host.md ❌, `runtime-js/isolate-require-esm-syntax-gaps`;
  deferred (below).

Settled (ledger 2026-11-22): the frame budget (rifty frames count against
`Error.stackTraceLimit`) and the header rules are declared compat rows; the
COI timer fatal prints main's kernel report again (item 5d, rollback 2026-11-23).

## Out of scope

- Deferred with a named compat row (manager decision 2026-11-23): queued work
  at a fatal (rows `fatal-with-queued-*`, `rejection-with-queued-work`; exit
  lifecycle, `runtime-js/node-eval-queued-exit-overrides-pending-fatal`); the
  isolate rejection reason copy (native patch,
  `distribution/isolate-host-rejection-reason-copy`); ES module entry frames
  (probe 2026-11-23: `esm-throw` prints `at eval (<root>/main.mjs:7:7)`, Node
  `at file://<root>/main.mjs:2:7` — the loader rewrite, `runtime-js/esm-stack-positions`,
  compat modules.md "ESM stack positions"); the isolate `require(esm)`
  `URLConstructor` failure (`runtime-js/isolate-require-esm-syntax-gaps`).

- Deferred by the user (goal amend 2026-11-23): Node's `<file>:<line>` header
  on every path (`runtime-js/sync-uncaught-header-throw-site-source`) and the
  syntax-error report's class, message and place
  (`runtime-js/module-compile-error-node-syntax-error`); the rows stay named
  compat rows.

- `process.version` identity (`runtime-js/process-versions-node-honesty`).
- Node's `node:internal` frames, `--trace-uncaught`, `--enable-source-maps`.
- Guest replacement of `Error.prepareStackTrace` / `Error.stackTraceLimit` /
  intrinsics changing its own output (declared open class, compat
  isolate-host.md).
- `process.exit()` lifecycle (neighbour thread), the isolate sandbox `runFile`
  API (neighbour thread), non-Chromium engines' stack formats.
