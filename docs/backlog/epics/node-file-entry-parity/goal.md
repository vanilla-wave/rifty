---
kind: epic
status: ready
title: "`node <file>` behaves and reports errors like real Node"
created: 2026-11-22
value: A program run as `node <file>` sees Node's entry identity, and its fatal error reads as Node's report (its place in the first frame; Node's source-line header deferred, amend 2026-11-23) — so an agent can fix it.
user_story: As a service running model-written JS in rifty (browser or V8 isolate), I want `node <file>` to behave and fail like Node, but today `require.main === module` is false and a fatal error prints shifted lines and rifty frames.
tier: works
---

## Outcome

A Node program started as `node <file>` in rifty observes what Node gives an
entry and its dependencies, and dies with Node's stderr bytes and status. The
user scenario: an agent writes JS, runs it, reads the error, fixes it — the
diagnostic must name the right file and line (the first stack frame; a CJS
syntax error names its file; Node's source-line header is deferred, amend
2026-11-23). One implementation
in `runtime-js` serves every host that runs a file: the no-COI SDK, the COI
Workbench kernel child and the isolate guest bundle (ADR-0557). What cannot be
made Node's is a named compat row with its cause, never a silent difference.

## User scenario

1. The host writes project files and runs `node <file> [args]`.
2. The program runs as Node's main module: `if (require.main === module)
   main()` runs `main`; `module`, `__filename`, `__dirname`, `process.argv`,
   `require.cache`, relative `require`, `import.meta` for an ES module entry
   read as in Node.
3. The program dies (throw in the entry or a dependency, from a timer or an
   async function, unhandled rejection, non-`Error` value, syntax error,
   missing module, error with `cause` or own props). The host reads stderr and
   the exit status: Node's report — the inspected error with user frames at
   Node's positions, `Node.js` trailer; without Node's `<file>:<line>` header,
   source line and caret (deferred, amend 2026-11-23).
4. The agent fixes the named line and reruns.

Oracle: live `node <file>` v24.16.0 over the same files in a temp dir; one path
normalization (temp dir ↔ project root). Two declared projections, applied to
Node's side only (`nodeFileExpected` in the carrier fixture):

- P1 — Node's own source (`node:*`, `[eval]-wrapper`) has no rifty
  counterpart: its frames are deleted; a report header naming it (`node:…:N`,
  source line, caret, blank) is deleted; the `... N lines matching cause stack
  trace ...` line those frames feed is deleted; an inspect props opener ` {`
  on a deleted frame moves to the previous kept line. Nothing else is
  rewritten — a report left without frames keeps its unbracketed first line.
- P2 — the trailer names the runtime's own `process.version` (rifty v24.0.0,
  `runtime-js/process-versions-node-honesty`).

## Invariants

<!-- Evidence, main 50c9d8bf1, carrier `node-file-parity` (no-COI SDK and COI
Workbench, 2026-11-22, chromium; every corpus row differs; isolate rows
`packages/isolate-host/tests/node-file.test.ts`, all 19 differ): `entry-main-guard`
stdout '' (Node `main ran 2`), `require.main` undefined, `require.cache` an
empty object (loader.ts `req.cache = Object.create(null)`); `throw-top-level`
stderr `Error: boom\n    at Object.eval (<root>/main.js:3:7)\n    at
compileCjsSource (http://…/runtime-js/src/module-loader/cjs.ts:…)` … (Node
`<root>/main.js:1\nthrow new Error('boom');\n^\n\nError: boom\n    at
Object.<anonymous> (<root>/main.js:1:7)\n\nNode.js v…`); `syntax-error-entry`
`ModuleLoadError: Failed to compile CJS module …`; COI `throw-from-timer`
`Uncaught Error: timer (<root>/main.js:4)`. Isolate `throw-top-level` via
`node -e "require('./main.js')"`: `Error: boom\n    at Object.eval
(<root>/main.js:3:7)\n    at compileCjsSource (rifty-isolate-guest.js:…)`;
`unhandled-rejection-error`: the eval projection rewrites the file frame to
`[eval]:1` (Node: `<root>/main.js:2` header and frame). -->

1. I1. Entry semantics: on the carrier's entry corpus the program's stdout and
   status equal Node's — `require.main`/`process.mainModule` is the entry
   module (`id` `.`, `parent` null), dependencies see the same `require.main`
   and their own `parent`/`children`/`loaded`, `require.cache` holds the live
   records, `__filename`/`__dirname`/`process.argv`, and an ES module entry's
   `import.meta` and `require.main` (undefined); directory, `.cjs` and
   extensionless entries; a typeless `.js` with ESM syntax (detection).
2. I2. Fatal diagnostics: on the carrier's fatal corpus stderr bytes and status
   equal Node's under the one normalization and the two declared projections.
   A row that cannot reach Node's bytes is a named compat row with its cause.
3. I3. A fatal report prints no rifty-runtime frame or path; the frames it
   prints are the ones Node prints for user code (and V8 builtins), at Node's
   line, column and name.
4. I4. One implementation: I1–I3 hold on the no-COI SDK and the COI Workbench
   (carrier lanes) and the isolate guest bundle prints the same report through
   the same runtime code (isolate rows: a file `require`d from `node -e`).

## Challenge

challenge: 2026-11-22 — clear

Premise (hand-off from the manager thread, user-ratified destination): value
follows — the live sandbox's acceptance (agent reads the error and fixes it)
needs Node's entry identity and report; no cheaper route: each surface is
rifty's own runtime code shared by all hosts, a host-side rewrite would fork
the formatter per host (`sibling-drift`).

## Decisions

- Module loading is a hot path: every loader change carries a before/after
  measurement of a require-heavy load (3061-module CJS tree, 15 runs, median)
  in the ledger.
- tier works: Chromium lanes + isolated-vm; Firefox/WebKit positions follow
  their engines' stacks (non-goal, ADR-0469).
- Carrier compares bytes after exactly one path normalization; P1/P2 above
  are the only oracle projections, listed in compat process.md "Fatal error
  stderr bytes" when the first fatal slice lands.
- COI carrier: the Workbench template root is `"type": "module"`; the carrier
  adds a typeless `nf/package.json` (`{}`), which keeps Node's no-package.json
  semantics (CJS, ESM syntax detection) for the programs below it.
- rejected route: host-side stderr rewrite per host (no-COI, kernel, isolate)
  — violates I4 (one implementation).
- rejected route: forging Node's `node:internal` frames — violates Outcome
  (no fake implementation).
- amend: 2026-11-23 — user: «давай положим в бэклог на всякий» (to the
  manager's: «Отчёт об ошибке без заголовка Node; у синтаксической ошибки —
  только имя файла: „ок“ или отдельная задача», after an example of Node's
  three header lines beside rifty's report, whose file and line are only in the
  first stack frame) — scenario step 3 and I2 no longer require Node's
  `<file>:<line>` header, source line and caret: rifty prints the report
  without it on every path (a throw's and a rejection's place is the first
  stack frame), and a CJS syntax error prints main's `ModuleLoadError` naming
  the file without a line (an ES module's, the loader parser's message and
  position). Both are deferred to the backlog:
  `runtime-js/sync-uncaught-header-throw-site-source` (the header) and
  `runtime-js/module-compile-error-node-syntax-error` (the syntax-error
  report's class, message and place); every row whose Node report has a header
  stays a named compat row (process.md "Fatal error stderr bytes").
- amend: 2026-11-23 — user: «ок, не выглядит серьезным, если не так, поправь»
  (to the manager's: «Цель обещала один отчёт об ошибке на всех хостах:
  isolate, no-COI и браузерный COI. Изменение жизненного цикла браузерных
  процессов, которое это давало, откачено после двух регрессов подряд. В итоге:
  в isolate отчёт новый: без кадров rifty, с верными номерами строк; в
  браузерных хостах необработанная ошибка из таймера или другого callback'а
  печатается как на main — текстом браузера, с кадрами и URL runtime rifty»,
  options «Принять как есть, отложить в backlog (рекомендую)» / «Отдельная
  цель после этапа»), then, after the manager's correction that on no-COI the
  command loses its exit code and stderr, user: «оставить в backlog» (to the
  manager's: «no-COI: команда с uncaught-ошибкой из колбэка теряет код выхода
  и stderr. Оставить в backlog или отдельная починка после этапа?», with
  `exitCode: null`, `WORKER_CRASHED`, the same on main, the PR #421 fix rolled
  back) — I3 and I4 hold for the isolate guest: on the no-COI SDK and the COI
  Workbench every fatal path prints as main (rifty frames and served runtime
  URLs; a no-COI command whose callback throws ends `failed`, `exitCode` null,
  stderr empty), named compat rows; deferred to
  `runtime-js/browser-host-realm-uncaught-fatal-report` and
  `distribution/no-coi-command-unhandled-rejection-exit`.
