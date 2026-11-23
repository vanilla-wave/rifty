# ADR 0571: Prove node file entry and fatal report parity against live Node, Node's report in the isolate guest only

Status: Accepted
Date: 2026-11

> TL;DR: `node <file>` gets Node's entry identity on the no-COI SDK and the COI Workbench, proven row by row against live Node; Node's fatal report (no header) prints in the isolate guest only, the browser hosts keep main's fatal text, and every row that is not Node's bytes is an exact pin with a named compat row.

## Context

User scenario (goal `node-file-entry-parity`, PR #421, PR #425): an
agent writes JS, runs `node <file>`, reads the error, fixes it. On main
`50c9d8bf1` `require.main === module` was false and a fatal error printed
shifted lines, rifty frames and no Node shape. Hosts: the no-COI SDK, the COI
Workbench kernel child, the isolate guest bundle (ADR-0557). The fatal path
went through seven external review rounds; the header, the syntax-error report
and the browser lifecycle each failed review more than once and were narrowed
(below).

## The goal, verbatim

User scenario and invariants exactly as in `goal.md` (`docs/backlog/epics/node-file-entry-parity/goal.md` @ 89d48ac10, its amends in
its Decisions; narrowings by the user's words and the manager's reading below,
not in this text).

### User scenario

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

### Invariants

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

## Decision

1. **Entry identity** (proven on the no-COI SDK and the COI Workbench; the
   isolate carrier runs files `require`d from `-e`, no entry row). A CommonJS entry is Node's main module
   (`require.main`, `process.mainModule`, `id` `.`, `parent` null),
   `require.cache` is the live record map, the wrapper receives Node's five
   arguments, an ES module entry reads `import.meta.main` and Node's
   `import.meta` keys (CHANGELOG `runtime-js`; ADR-0450 for frame lines).
2. **Carrier and oracle.** `tests/browser-unit/fixtures/node-file-programs.ts`
   (entry and fatal corpus) runs each program in live `node` v24.16.0 in a temp
   dir and in rifty: `tests/no-coi/node-file-parity.spec.ts`,
   `tests/browser-unit/node-file-parity.spec.ts`,
   `packages/isolate-host/tests/node-file.test.ts`. Normalization: one path
   rewrite (oracle dir ↔ project root, `<root>`), root lengths equal by
   construction (`ORACLE_ROOT_LENGTH`), and on the rifty side only a served
   runtime location reads `<runtime>/packages/<file>`. Two projections of
   Node's side only: P1 — Node's own source (`node:*`, `[eval]-wrapper`) has no
   rifty counterpart: its frames, a header naming it and the `... N lines
   matching cause stack trace ...` line are deleted, an inspect props opener on
   a deleted frame moves up a line; P2 — the trailer names rifty's own
   `process.version`. Each row is Node's bytes (`"node"`) or rifty's exact
   output pinned in `node-file-pins.json`, which must still differ from Node;
   every pinned row is a named compat row (process.md "Fatal error stderr
   bytes", modules.md, isolate-host.md). Every row asserts no Node-format
   header (`NODE_HEADER`). The fatal corpus holds a row for each of these ways
   rifty calls user code (timer, interval, immediate, `nextTick`, microtask,
   promise reaction, emitter listener, fs callback, `new Function`, direct and
   indirect `eval`): frame names, lines, columns; stream callbacks are not in
   it yet (`backlog/runtime-js/guest-builtin-names`). A builtin's name is the
   source name Node prints: `packages/isolate-host/tests/bundle-public-names.test.ts`
   fails on a `function`/`class` declaration named a Node builtin export plus
   a digit (`EventEmitter2`) in the guest bundle and the Workbench's (PR #425);
   bound class expressions (`TextEncoder2 = class`), lowercase exports and the
   generic stream constructor are open (`backlog/runtime-js/guest-builtin-names`).
3. **Node's fatal report in the isolate guest only** (ADR-0445 2026-11-23
   lines): `builtins/fatal-report.ts` behind one switch the guest entry calls
   (`installNodeFatalReport()`); the no-COI SDK and the COI Workbench print
   main's fatal text on every path. Proof of the browser side:
   `docs/backlog/runtime-js/reference/pr-421-browser-fatal-matrix.md`.
4. **CJS compile failures** stay main's `ModuleLoadError` naming the file; the
   source is validated alone as a function body, so nothing of it runs
   (ADR-0450 corrections).
5. **Module loading is a hot path:** a loader change carries a before/after
   CPU measurement of a require-heavy load (the cost of the source-alone
   validation: ADR-0450 2026-11-22 cost line).
6. **Tier works:** Chromium lanes and isolated-vm; Firefox/WebKit stack formats
   are not targeted (ADR-0469).

Rejected: a host-side stderr rewrite per host (one implementation is the
point); forging Node's `node:internal` frames (no fake implementation).

## The user's words

- 2026-11-23, to the manager's «Отчёт об ошибке без заголовка Node; у
  синтаксической ошибки — только имя файла: „ок“ или отдельная задача»: «давай
  положим в бэклог на всякий» — Node's `<file>:<line>` header (source line,
  caret) is printed on no path and a CJS syntax error is main's
  `ModuleLoadError`; deferred: `backlog/runtime-js/sync-uncaught-header-throw-site-source`,
  `backlog/runtime-js/module-compile-error-node-syntax-error`.
- 2026-11-23, to the manager's «Цель обещала один отчёт об ошибке на всех
  хостах: isolate, no-COI и браузерный COI. Изменение жизненного цикла
  браузерных процессов, которое это давало, откачено после двух регрессов
  подряд. В итоге: в isolate отчёт новый: без кадров rifty, с верными номерами
  строк; в браузерных хостах необработанная ошибка из таймера или другого
  callback'а печатается как на main — текстом браузера, с кадрами и URL runtime
  rifty» (options «Принять как есть, отложить в backlog (рекомендую)» /
  «Отдельная цель после этапа»): «ок, не выглядит серьезным, если не так,
  поправь»; then, to the manager's «no-COI: команда с uncaught-ошибкой из
  колбэка теряет код выхода и stderr. Оставить в backlog или отдельная починка
  после этапа?»: «оставить в backlog» — the browser hosts keep main's fatal
  path; deferred: `backlog/runtime-js/browser-host-realm-uncaught-fatal-report`,
  `backlog/distribution/no-coi-command-unhandled-rejection-exit`.

## Not the user's words

Manager's reading, 2026-11-23, not the user's words (the string-compiled
class widened to indirect `eval` and `new Function` after PR #425's mechanism
rows): two classes of isolate frame difference are outside the report's frame contract — `RDY-6`: a difference
is a user fork only when it materially affects the requested value, and the
value is a report whose place is the first frame and whose user frames stand
at Node's line, column and name, which holds in both:
- an `[eval]` frame below a callback or catch that Node's 10-frame
  `Error.stackTraceLimit` cuts after its own `node:internal` frames — a real
  `-e` frame, one more at the bottom (e.g. rows `rethrow-in-catch`,
  `throw-in-callback`, `throw-in-emitter-listener`; `backlog/runtime-js/fatal-report-eval-frame-beyond-node-limit`);
- code compiled from a string: its own frame and every file frame are Node's,
  but the `eval at …` origin lacks the compile site's position — direct and
  indirect `eval`: V8 prints none for a caller itself compiled from a string,
  as every rifty CJS module is (rows `throw-in-direct-eval`,
  `throw-in-indirect-eval`; `backlog/runtime-js/fatal-report-direct-eval-call-position`);
  `new Function`: the file too — rifty's cause, not V8's: the constructor is
  routed through a helper so `import()` works in the body, and V8 names the
  helper as the origin; a fix needs its own contract (row
  `throw-in-new-function`; `backlog/runtime-js/new-function-eval-origin`).

Also not the user's: the browser-host fatal path's rollbacks to main (review
rounds 4 and 5, ADR-0445 2026-11-23) were options the manager decided in
advance and the agent took; the user's words above accept their result.

## Consequences

- An agent on the isolate host reads Node's report: the error with its props,
  `[cause]` and user frames at Node's positions, the trailer; file and line in
  the first frame, not a header.
- On the browser hosts a fatal error prints as main (rifty frames, served
  runtime URLs; a no-COI callback throw ends `failed`, `exitCode` null).
- Pinned rows move with any change to the printed text; the pins file is the
  review surface (`NODE_FILE_DUMP` regenerates it).
- Follow-ups: the deferred records above; `backlog/runtime-js/fatal-report-injected-from-guest`
  (the formatter ships in browser bundles without running there).
