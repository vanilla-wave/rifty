# Probe: where the guest's JS-backed Web APIs come from

Question (goal `isolate-guest-web-api`, manager question 1): web streams, `EventTarget`/`Event`/
`CustomEvent`, `AbortController`/`AbortSignal`. In Node they are written in JS
(`lib/internal/webstreams/*`, `event_target.js`, `abort_controller.js`). Which source is best for
the isolate guest: a port generated from Node's own files (ADR-0541 precedent), npm polyfills, or
our own JS? Measured 2026-11-24, M3 Pro, load average 3.0–3.6 (quiet): Node v24.16.0 (the
oracle and the source tag), isolated-vm 7.0.2, esbuild 0.28.0.

## Run

```sh
node docs/backlog/epics/isolate-guest-web-api/reference/sources-js/probe.mjs [--timing] [--json out.json]
```

Run from the repo root after `pnpm install`. Network: raw.githubusercontent.com (Node
`lib/internal` at v24.16.0, sha256-pinned in `node-src.sha256.json`, cached in
`$TMPDIR/rifty-node-v24.16.0-lib`) and the npm registry (`npm ci` of `npm/`). Evidence:
`results.json` (`--timing` run; `diffs` holds both sides of every differing case).

- `node-port/build.mjs` bundles Node's files verbatim, each wrapped as a module. `primordials`
  comes from Node's own `per_context/primordials.js`. Node's C++ bindings and the modules that
  would pull in the rest of Node are about 20 small shims (`node-port/shims/`, 144 lines).
- `npm/`: `web-streams-polyfill` 4.5.1 (ponyfill), `event-target-shim` 6.0.2,
  `abortcontroller-polyfill` 1.7.8 (ponyfill; it has `timeout`/`any`/`throwIfAborted`;
  `abort-controller` 3 has none of them).
- `guest-base.js` stands in for what the guest's web-shim already gives every candidate:
  `queueMicrotask`, host timers, the guest's own `TextEncoder`/`TextDecoder` (`text-codec.ts`,
  bundled), a copy of web-shim's `DOMException`, `global`, and a `process` with
  `nextTick`/`emitWarning`.
- `cases.js` has 86 cases (55 streams, 31 events/abort), including one shape case per class: own
  prototype names, statics, `length`, `Symbol.toStringTag`, parent. The same text runs under live
  Node (a fresh `vm` context holding Node's globals) and in a bare isolate over each candidate.
  Errors are compared by constructor, `name`, `code` and `message`.
- `--timing`: for each fresh isolate, `compileScript` with the worker's code cache and `run`, the
  way `packages/isolate-host/src/child/main.ts` does it. Median of 40 runs after 3 warm-ups.

## Result

| API set | candidate | min. IIFE bytes (gzip) | per-isolate eval, median ms | cases differing from Node | upkeep |
|---|---|---|---|---|---|
| streams + events + abort | **Node port** | 169 394 (50 306) | 5.40 (p90 5.69) | **0 / 86** | 16 Node files verbatim (~12 600 lines) + 144 shim lines + 2 anchored edits; refresh = bump the tag, re-pin the hashes |
| streams + events + abort | npm | 96 228 (25 593) | 2.30 (p90 2.63) | 41 / 86 (streams 19/55, events 22/31) | 3 packages; no `TextEncoderStream`/`TextDecoderStream`/`CustomEvent`/`DOMException` |
| events + abort only | **Node port** | 88 215 (29 886) | 3.39 (p90 3.53) | **0 / 31** | 8 of the 16 files |
| events + abort only | npm | 22 023 (7 395) | 0.45 (p90 0.58) | 22 / 31 | 2 packages |
| (breakdown) | Node `primordials` alone | 8 083 (2 804) | 1.01 | — | — |
| (breakdown) | `primordials` + Node `errors.js` | 55 375 (19 298) | 2.34 | — | — |
| baseline | empty script | — | 0.02 | — | — |

For scale: the guest bundle is 7 123 270 bytes, and a warm call costs 13–16 ms (ADR-0563).

The npm candidates differ from Node in kind, not only in error text:
- `new AbortSignal()` constructs (Node: `ERR_ILLEGAL_CONSTRUCTOR`).
- `dispatchEvent({type:'x'})` returns `true` (Node: `ERR_INVALID_ARG_TYPE`).
- `abort()` twice fires listeners twice and replaces `reason`.
- `AbortSignal` chains to its own `Emitter`, not `EventTarget`, and has no static `abort`.
- `WritableStreamDefaultController` has an extra `abortReason`, and its `signal` is unsupported.
- The error texts and codes are the polyfill's: `getReader()` twice gives `This stream has
  already been locked…` with no `code` (Node: `ERR_INVALID_STATE`, `Invalid state: ReadableStream
  is locked`).
- `AbortSignal.timeout` reason message: `This signal is timeout in 5ms` (Node: `The operation was
  aborted due to timeout`).
- The pipeTo abort reason is an `Error` named `AbortError`, not a `DOMException`.

The port reproduces even Node's quirks. One example: after `AbortSignal.any([a, b])`,
`b.abort('B'); a.abort('A')` leaves `reason` `'A'` in Node v24.16.0, and the port gives `'A'`
too.

### What the Node files pull in (from the v24.16.0 sources)

| needed by the files | Node has it in | in the probe | in the guest (generation target) |
|---|---|---|---|
| `primordials` | per-context JS | Node's file verbatim | same (or a generated subset: about 100 names used, 1.0 ms for the full set) |
| `internal/errors` (codes `ERR_INVALID_THIS`/`_STATE`/`_ARG_TYPE`/`_ARG_VALUE`/`OUT_OF_RANGE`/`ILLEGAL_CONSTRUCTOR`/`MISSING_ARGS`/`EVENT_RECURSION`/…) | JS | `errors.js` verbatim (+1.3 ms) | rifty has no central Node-errors module; port the file or generate the ~12 codes' `E()` rows |
| `internal/validators`, `internal/webidl`, `util/types` | JS (types partly C++) | verbatim; `internalBinding('types')` shimmed with brand checks | same |
| `DOMException` (`internalBinding('messaging')`) | per-context JS | Node's `per_context/domexception.js` | replaces web-shim's own class (Node's `ERR_INVALID_THIS` brand checks and `code` table) |
| `isPromisePending` (`internalBinding('util').getPromiseDetails`) | C++ | anchored edit: `PromiseWithResolvers` records track pending (the only promises it is asked about) | same edit |
| `copyArrayBuffer` (`internalBinding('buffer')`) | C++ | `Uint8Array#set` | same |
| `util.inspect`, `customInspectSymbol` | JS | minimal stand-in | rifty's `util.inspect` |
| `process.nextTick` (tee, listener errors), `process.emitWarning` (max-listeners) | JS | microtask stand-in | rifty's `process` |
| `timers.setTimeout(...).unref()` (`AbortSignal.timeout`) | JS | host-timer stand-in | rifty's timers (`Timeout#unref` exists); Node's timer is unref'd, so the run must not wait for it (not verified) |
| `WeakRef`, `FinalizationRegistry` (`AbortSignal.any`, timeout cleanup) | V8 | V8 | V8 |
| `MessageChannel`, `structuredClone` (`internal/worker/io`, `js_transferable`) | C++ | constructor throws | only for transferring a stream (`postMessage`); stays with the `MessageChannel` ceiling |
| `TextEncoder`/`TextDecoder` (`internal/encoding`) | C++ (ICU) | the guest's own UTF-8 codec | same (non-UTF-8 labels stay loud) |
| `CompressionStream`/`DecompressionStream` (`webstreams/compression.js` over `zlib`) | JS over C++ zlib | not built | needs a zlib engine: the guest's `zlib` is a ceiling, so outside this set |
| `stream.Readable.toWeb`/`fromWeb` (`webstreams/adapters.js`, `internalBinding('stream_wrap')`) | JS | not built | rifty's own `io` streams adapt over the global classes |

## Recommendation (evidence above)

- **Web streams (14 classes + `TextEncoderStream`/`TextDecoderStream`): Node port.** It differs
  from Node in 0 of 55 cases; `web-streams-polyfill` differs in 19 (codes, messages, controller
  shape, missing text streams). The `ReadableStream` that `fs.createReadStream` and exceljs need
  would then be Node's own.
- **`EventTarget`/`Event`/`CustomEvent`, `AbortController`/`AbortSignal`, `DOMException`: Node
  port.** It differs in 0 of 31 cases; the npm packages differ in 22, with behavior errors
  (constructible `AbortSignal`, a second `abort`, no `CustomEvent`).
- **Our own JS: no.** Reimplementing about 12 600 lines of spec state machines adds an
  approximation. Generating from Node gives Node's behavior by construction and a mechanical
  refresh path (bump the tag, re-pin the hashes, anchored edits fail loudly on drift, like
  `check:fetch-classes-drift`).
- **Cost:** eager evaluation adds 5.4 ms to every isolate (about +35% on a 13–16 ms warm call).
  About 2.3 ms of that is fixed: Node's full `primordials` (1.0) plus `errors.js` (1.3). A
  generator can cut it with a used-names primordials subset and only the used error codes (not
  measured). Install the globals lazily, evaluating the module on first access (esbuild's CJS
  wrappers already run module bodies on first `require`), so runs that never touch them pay ~0.
  That only works if runtime-js does not read the globals at load: that is the seam fork's
  question. The npm set is cheaper (2.3 ms) but not Node.

## Not verified

- Integration with rifty in the real guest bundle: rifty's `util.inspect`, `process.nextTick`
  ordering (here a microtask), unref'd `AbortSignal.timeout` not holding the run open,
  listener-throw reporting (Node rethrows on `nextTick`; not run here), `util.inspect` of the
  classes, `stream/web` identity with the globals, and `Readable.toWeb`/`fromWeb` over these
  classes.
- The generated-subset cost cut (primordials subset, error-code subset) and lazy install: both
  estimates.
- WPT streams / DOM events suites: only the 86 cases above.
- Linux; heavier load (only the quiet run above).
- `CompressionStream`, stream transfer (`postMessage`), `structuredClone`-based paths:
  out of this set.
