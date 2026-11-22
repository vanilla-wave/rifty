# Map — node-file-entry-parity

## Items

1. **acceptance carrier** — `tests/browser-unit/fixtures/node-file-programs.ts`
   corpus, `tests/no-coi/node-file-parity.spec.ts` (no-COI SDK) and
   `tests/browser-unit/node-file-parity.spec.ts` (COI Workbench); committed RED,
   open rows marked expected-failure. → I1–I4
5. **header residue** — no header on any path (ADR-0445 2026-11-22 correction,
   manager decision after external review round 2): every row whose Node
   report has one is pinned without it; carriers assert none (`NODE_HEADER`).
   Reopen only from an engine-level source:
   `runtime-js/sync-uncaught-header-throw-site-source`. → I2
5c. `distribution/isolate-host-rejection-reason-copy` — isolate rejection
   report built from isolated-vm's copy (props, `[cause]`, class lost); fix is
   a native patch (ADR). Rows `rejection-with-props-cause-subclass`,
   `rejection-fs-enoent`. → I2 I4
5b. **queued work at a fatal** — rows `fatal-with-queued-timer`,
   `rejection-with-queued-work`: due timers still run; owner: exit lifecycle
   (manager thread / PR #416 seam). → I2
6. `runtime-js/module-compile-error-node-syntax-error` — CJS and ESM compile
   failure as V8's `SyntaxError` (CJS rolled back to main's `ModuleLoadError`
   after review round 3; dead ends recorded there). → I2
8. `runtime-js/esm-stack-positions` — **ESM entry frames** (existing draft;
   hypothesis). → I2 I3
## Open questions

- No Node-format header (`<file>:<line>`, source line, caret) on any path — a
  throw, an unhandled rejection, a compile error (JS cannot read V8's message
  location; manager decision after external review round 2, ADR-0445
  2026-11-22 correction); a compile error prints main's `ModuleLoadError:
  Failed to compile CJS module <file>: <V8 message>` (file named, no line).
  I2 admits it as a named compat row; whether the scenario accepts headerless
  reports (the first frame names file:line; a compile error names the file) is the
  user's — owner: user — evidence: `fatal-report.test.ts`, the `NODE_HEADER`
  assertion on every carrier row, compat process.md.

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
