# ADR 0571: Prove node file entry and fatal report parity against live Node, Node's report in the isolate guest only

Status: Accepted
Date: 2026-11

> TL;DR: `node <file>` gets Node's entry identity on every host, proven row by row against live Node; Node's fatal report (no header) prints in the isolate guest only, the browser hosts keep main's fatal text, and every row that is not Node's bytes is an exact pin with a named compat row.

## Context

User scenario (goal `node-file-entry-parity`, closed 2026-11-23, PR #421): an
agent writes JS, runs `node <file>`, reads the error, fixes it. On main
`50c9d8bf1` `require.main === module` was false and a fatal error printed
shifted lines, rifty frames and no Node shape. Hosts: the no-COI SDK, the COI
Workbench kernel child, the isolate guest bundle (ADR-0557). The fatal path
went through seven external review rounds; the header, the syntax-error report
and the browser lifecycle each failed review more than once and were narrowed
(below).

## Decision

1. **Entry identity, every host.** A CommonJS entry is Node's main module
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
   header (`NODE_HEADER`).
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

Manager's reading, 2026-11-23, not the user's words: two isolate frame
differences are outside the report's frame contract — `RDY-6`: a difference
is a user fork only when it materially affects the requested value, and the
value is a report whose place is the first frame and whose user frames stand
at Node's line, column and name, which holds in both:
- an `[eval]` frame below a callback or catch that Node's 10-frame
  `Error.stackTraceLimit` cuts after its own `node:internal` frames — a real
  `-e` frame, one more at the bottom (rows `rethrow-in-catch`,
  `throw-in-callback`; `backlog/runtime-js/fatal-report-eval-frame-beyond-node-limit`);
- a direct `eval` frame's origin without the call's `:line:col` — the eval'd
  code's own frame keeps its position (row `throw-in-direct-eval`;
  `backlog/runtime-js/fatal-report-direct-eval-call-position`).

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
