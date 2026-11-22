# Map — node-file-entry-parity

## Items

1. **acceptance carrier** — `tests/browser-unit/fixtures/node-file-programs.ts`
   corpus, `tests/no-coi/node-file-parity.spec.ts` (no-COI SDK) and
   `tests/browser-unit/node-file-parity.spec.ts` (COI Workbench); committed RED,
   open rows marked expected-failure. → I1–I4
3. `runtime-js/require-cache-module-record-surface` — **live `require.cache`**
   (existing draft). → I1
3b. **ESM entry facts** — `import.meta.main`; a CJS module required through
   `createRequire` sees its synthetic parent (Node `[object Object]`). → I1
3c. `runtime-js/cjs-wrapper-arguments-shape` — top-level `arguments.length`
   8 (rifty helper parameters) vs Node 5 (existing draft). → I1
4. `runtime-js/timer-callback-this-is-timeout` — **timer callback as
   `Timeout._onTimeout`** (`this`, frame name; row `throw-from-timer`). → I2 I3
5. **header residue** — rows `rethrow-in-catch`, `error-with-props`,
   `throw-non-error-*`, `syntax-error-dependency` (acorn vs V8 caret): no
   provable throw site from JS; probe a source-proven rule or keep as declared
   compat rows (process.md "Fatal error stderr bytes"). → I2
6. `runtime-js/module-compile-error-node-syntax-error` — **ESM** compile
   failure as V8's `SyntaxError` (CJS landed). → I2
8. `runtime-js/esm-stack-positions` — **ESM entry frames** (existing draft;
   hypothesis). → I2 I3
9. **isolate rows** — `packages/isolate-host` parity: a file `require`d from
   `node -e` prints the shared report; the eval projection rewrites a file
   frame to `[eval]:1` today (`unhandled-rejection-error`). → I4

## Open questions

- Fatal frame budget: rifty's own frames count against the guest's
  `Error.stackTraceLimit` (10) before the printer drops them, so a deep
  require chain can show fewer user frames than Node — owner: agent — probe at
  item 4 (capture vs declared row).

- Header line of a synchronous throw: Node uses V8's throw site; JS sees only
  the error's creation frame. Which cases are provable from source + frames
  (and which print no header, declared) — owner: agent — probe rows
  `rethrow-in-catch`, `throw-non-error-*` at item 4's PICKUP.
- Isolate ESM entry `TypeError: URLConstructor is not a constructor`: shared
  runtime-js cause or isolate ceiling — owner: agent — read
  `fileURLFromResolvedPath` under the isolate's URL ceiling at item 8.
- Does the COI kernel child's timer fatal (`Uncaught … (file:line)`) share the
  runtime formatter after item 4 — owner: agent — carrier row
  `throw-from-timer` on COI.

## Out of scope

- `process.version` identity (`runtime-js/process-versions-node-honesty`).
- Node's `node:internal` frames, `--trace-uncaught`, `--enable-source-maps`.
- Guest replacement of `Error.prepareStackTrace` / `Error.stackTraceLimit` /
  intrinsics changing its own output (declared open class, compat
  isolate-host.md).
- `process.exit()` lifecycle (neighbour thread), the isolate sandbox `runFile`
  API (neighbour thread), non-Chromium engines' stack formats.
