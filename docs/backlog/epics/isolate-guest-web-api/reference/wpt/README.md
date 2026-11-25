# Probe: Node's WPT files in the isolate guest through the real testharness.js

Question (external review of PR #443, S4): units 2 (`Blob`/`File`) and 3 (`TextDecoder`) of goal
`isolate-guest-web-api`, and `node-streams-as-in-node` unit 7, write acceptance as «Node's WPT run
ported to an isolate-host test»; rifty has no WPT file and no testharness. Does one WPT file run
cheaply in the isolate guest? Measured 2026-11-25, HEAD `230c3272a` (product code = main
bc3412420), Node v24.16.0, isolated-vm 7.0.2, M3 Pro, macOS. Probe only.

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build
P=docs/backlog/epics/isolate-guest-web-api/reference/wpt
node $P/run.mjs --json $P/results.json \
  --dist packages/isolate-host/dist \
  --dist packages/isolate-host/node_modules/.web-api-probe/td-gb/dist   # optional: the TextDecoder variant (reference/textdecoder/bundle)
node $P/run.mjs --node-only dom/events/Event-isTrusted.any.js           # Node only, any test path
```

Sources: Node v24.16.0's `test/fixtures/wpt/` from raw.githubusercontent.com, sha256-pinned in
`wpt.sha256.json` (`--pin` records), cached in `$TMPDIR/rifty-wpt-v24.16.0`.

## How Node runs them, and what the probe copies

Node's runner (`test/common/wpt.js`, `test/common/wpt/worker.js`): per test file a worker that sets
`self = global`, `GLOBAL = { isWindow() {false}, isShadowRealm() {false} }`, a `fetch` mock for
fixture files, `location = new URL(<test url>)` and `META_TITLE`, runs the real
`resources/testharness.js` (it picks its `ShellTestEnvironment`), then the `// META: script=`
dependencies and the test, reporting through `add_result_callback`/`add_completion_callback`; the
status file (`test/wpt/status/*`) marks expected failures and skips.

The probe concatenates the same pieces into one CommonJS file and runs it unchanged as
`node t.cjs` and as `sandbox.exec('t.cjs')`. Differences from Node's runner, each needed by the guest
or by a single process:
- plain concatenation, no `eval` (rifty refuses literal `eval` in a CommonJS module:
  `module-loader.cjs-dynamic-function-scope`);
- `location` is a plain object (`URL` is a ceiling in the guest);
- `AbortController` is deleted before the harness when constructing it throws: testharness.js builds
  one per test when the global is a function, and the guest's ceiling thrower is one (a no-op in Node
  and once the guest has the class);
- the report is written with `fs.writeSync` and the process exits (Node ends its worker; an open
  `MessagePort` would keep a process alive, and an async `console.log` to a pipe is cut at exit);
- no `fetch` mock: none of the files below reads a fixture.

Shim: 26 lines of prelude/report; the harness is WPT's own `testharness.js` (5 207 lines, pinned).

## Results (`results.txt`, `results.json`: counts, and per guest the subtests whose status differs from live Node)

| file | Node | guest today | guest `td-gb` |
|---|---|---|---|
| `FileAPI/blob/Blob-slice.any.js` | 144 pass, 6 fail (= status `blob.cjs` expected) | 28 fail (`Blob` ceiling; subtests built inside others never start) | same |
| `FileAPI/blob/Blob-constructor.any.js` | 73 pass | 1 pass, 72 fail | same |
| `FileAPI/blob/Blob-text.any.js` | 8 pass | 8 fail | same |
| `FileAPI/file/File-constructor.any.js` | 49 pass | 1 pass, 5 fail | same |
| `encoding/api-basics.any.js` | 6 pass | 3 pass, 3 fail | **6 pass, 0 differ** |
| `encoding/textdecoder-labels.any.js` | 222 pass | 3 pass, 219 fail | 194 pass, 28 fail (the five ICU-only encodings' labels, the named gap) |
| `encoding/textdecoder-fatal-single-byte.any.js` | 7 168 pass | 7 168 fail | **7 168 pass, 0 differ** |
| `encoding/encodeInto.any.js` | 111 pass | 84 pass, 27 fail | 110 pass, 1 fail («detached output buffer»: `MessageChannel`) |
| `dom/abort/event.any.js` | 16 pass | 16 fail | same |
| `dom/abort/timeout.any.js` | 3 pass | 3 fail | same |
| `dom/abort/abort-signal-any.any.js` | 14 pass | 1 fail (harness stops) | same |
| `dom/events/AddEventListenerOptions-signal.any.js` | 11 pass | 11 fail | same |
| `dom/events/Event-constructors.any.js` | 14 pass | 14 fail | same |
| `dom/events/EventTarget-constructible.any.js` | 3 pass | 3 fail | same |

The harness completes (`harness=0`) in every guest run; a file takes 60–200 ms of `exec` wall time
in the guest (12–80 ms of it inside the harness), 26–60 ms under Node. Every `dom/*/*.any.js` Node
runs was also run under Node alone: all pass except `Event-isTrusted.any.js` and
`EventTarget-removeEventListener.any.js`, both as Node's status file says.

## Verdict: cheap

One shared harness runs Node's WPT files in the guest as they are, and the comparison is per subtest
against **live Node** on the same concatenated file (not against the status files: Node's
`status/encoding.json` still skips `textdecoder-labels`, `textdecoder-fatal-single-byte` and
`textencoder-constructor-non-utf` as «iso-8859-16 not supported», which Node v24.16.0 passes —
222/222, 7 168/7 168). Owner: map unit 2 (first consumer); unit 3 and `node-streams-as-in-node`
unit 7 reuse it.

## Exclusions, by file (what live Node passes and the guest cannot after the goal)

- unit 2 (`FileAPI`): `Blob-stream.any.js` (`ReadableStream`, `garbageCollect`); the
  `MessageChannel` subtests of `Blob-constructor.any.js` (l. 389–396); every `.html`/`.window.js`/
  `.worker.js` file (Node skips them too).
- unit 3 (`encoding`): `encodeInto.any.js` «encodeInto() and a detached output buffer»
  (`MessageChannel`); `idlharness.any.js` (its `['streams']` IDL: `TextDecoderStream`); 
  `encoding/streams/*`; `iso-2022-jp-decoder.any.js` and the five ICU-only encodings' subtests of
  `textdecoder-labels.any.js` (28) and the others; `textdecoder-copy.any.js`'s `SharedArrayBuffer`
  half where the guest disables it (`allowSharedArrayBuffer: false`).
- unit 7 / I3 (`dom/abort`, `dom/events`, the 13 `.any.js` files Node runs): none needs
  `MessageChannel`, GC or `fetch`. Excluded as Node excludes them: `timeout-shadowrealm.any.js`
  (ShadowRealm), `EventTarget-removeEventListener.any.js` (`globalThis.removeEventListener`; Node
  fails it too), `Event-isTrusted.any.js` (Node fails it — compare, do not exclude); every
  `.html`/`.window.js`/`.worker.js` (DOM, `importScripts`). `AbortSignal.any.js` takes 2 s
  (`step_timeout(…, 2000)`).

## Not verified

- Files beyond the 14 above (`FileAPI/blob/Blob-array-buffer`, `-bytes`, `-newobject`,
  `-slice-overflow`, `encoding/textdecoder-*` others, `dom/events/AddEventListenerOptions-once`/
  `-passive` in the guest).
- A guest with real `Blob` or `AbortController`/`EventTarget` (not built): the guest columns only show
  that the harness runs and reports there.
- Files needing Node's `fetch` mock (fixture JSON); `idlharness.js` in the guest.
- Linux; timing under load.
