# Map — node-file-entry-parity

## Items

1. **acceptance carrier** — `tests/browser-unit/fixtures/node-file-programs.ts`
   corpus, `tests/no-coi/node-file-parity.spec.ts` (no-COI SDK) and
   `tests/browser-unit/node-file-parity.spec.ts` (COI Workbench); committed RED,
   open rows marked expected-failure. → I1–I4
5. **header residue** — rows `throw-non-error-*` (no stack locates the throw),
   `syntax-error-dependency` (acorn vs V8 caret): declared compat rows
   (process.md "Fatal error stderr bytes"); reopen only with a provable rule. → I2
5b. **queued work at a fatal** — rows `fatal-with-queued-timer`,
   `rejection-with-queued-work`: due timers still run; owner: exit lifecycle
   (manager thread / PR #416 seam). → I2
6. `runtime-js/module-compile-error-node-syntax-error` — **ESM** compile
   failure as V8's `SyntaxError` (CJS landed). → I2
8. `runtime-js/esm-stack-positions` — **ESM entry frames** (existing draft;
   hypothesis). → I2 I3
## Open questions

- A synchronous throw prints no `<file>:<line>` header (V8's throw site is not
  readable from JS; after external review round 1 the manager thread set the
  contract: header only by construction, else none — ADR-0445 2026-11-22). I2
  admits it as a named compat row; whether the scenario accepts headerless
  synchronous reports (the first frame still names file:line:col) is the
  user's — owner: user — evidence: `fatal-report.test.ts`, compat process.md.

- Isolate ESM entry `TypeError: URLConstructor is not a constructor`: runtime-js
  builds `import.meta.url` with the guest-visible `URL`, which the isolate
  replaces with its ceiling — owner: agent — a string file-URL encoder in
  runtime-js vs the isolate's declared ESM gap (sandbox thread turns it into a
  `NotImplementedError`); decide with item 8.

Settled (ledger 2026-11-22): the frame budget (rifty frames count against
`Error.stackTraceLimit`) and the header rules are declared compat rows; the
COI timer fatal now prints the runtime report.

## Out of scope

- `process.version` identity (`runtime-js/process-versions-node-honesty`).
- Node's `node:internal` frames, `--trace-uncaught`, `--enable-source-maps`.
- Guest replacement of `Error.prepareStackTrace` / `Error.stackTraceLimit` /
  intrinsics changing its own output (declared open class, compat
  isolate-host.md).
- `process.exit()` lifecycle (neighbour thread), the isolate sandbox `runFile`
  API (neighbour thread), non-Chromium engines' stack formats.
