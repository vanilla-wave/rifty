# Map — node-file-entry-parity

## Items

1. **acceptance carrier** — `tests/browser-unit/fixtures/node-file-programs.ts`
   corpus, `tests/no-coi/node-file-parity.spec.ts` (no-COI SDK) and
   `tests/browser-unit/node-file-parity.spec.ts` (COI Workbench); committed RED,
   open rows marked expected-failure. → I1–I4
5c. `distribution/isolate-host-rejection-reason-copy` — isolate rejection
   report built from isolated-vm's copy (props, `[cause]`, class lost); fix is
   a native patch (ADR). Rows `rejection-with-props-cause-subclass`,
   `rejection-fs-enoent`. → I2 I4
5b. **queued work at a fatal** — rows `fatal-with-queued-timer`,
   `rejection-with-queued-work`: due timers still run; owner: exit lifecycle
   (manager thread / PR #416 seam). → I2
5d. **browser-host fatal path** — COI kernel child / no-COI child Worker entry
   throw and realm-uncaught throws print main's report (rolled back after
   review round 4; the browser lifecycle is outside the goal): 24 COI rows
   pinned by first line, the no-COI timer rows silent with `exitCode` null
   (`distribution/no-coi-command-unhandled-rejection-exit`). → I2 I4
8. `runtime-js/esm-stack-positions` — **ESM entry frames** (existing draft;
   hypothesis). → I2 I3
## Open questions

- Settled (goal amend 2026-11-23, user: «давай положим в бэклог на всякий»):
  no Node-format header on any path and a syntax error as main's
  `ModuleLoadError` — deferred to `runtime-js/sync-uncaught-header-throw-site-source`
  and `runtime-js/module-compile-error-node-syntax-error`.

- Isolate ESM entry `TypeError: URLConstructor is not a constructor`: runtime-js
  builds `import.meta.url` with the guest-visible `URL`, which the isolate
  replaces with its ceiling — owner: agent — a string file-URL encoder in
  runtime-js vs the isolate's declared ESM gap (sandbox thread turns it into a
  `NotImplementedError`); decide with item 8.

Settled (ledger 2026-11-22): the frame budget (rifty frames count against
`Error.stackTraceLimit`) and the header rules are declared compat rows; the
COI timer fatal prints main's kernel report again (item 5d, rollback 2026-11-23).

## Out of scope

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
