# Probe: today's outcomes for the narrowed goal (Blob/File, TextDecoder, Abort/Event globals)

Question (goal `isolate-guest-web-api` after the user's narrowing, 2026-11-25): what does the isolate
guest do today, per API of the three groups, against live Node; which load-time captures remain in
the narrowed set; where do the consumer's generators stop. Pins, not a fix.

Measured 2026-11-25 at branch HEAD `70923a630` (= origin/main `bc3412420` merged: #444 `node:url`,
#445, #449, #453), guest built from it (`guest.js` 7 173 116 B), Node v24.16.0, isolated-vm 7.0.2,
macOS arm64; pptxgenjs 4.0.1 and pdfkit 0.17.2 (isolate-host devDependencies), docx 9.15.3 (npm).

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build
mkdir -p /tmp/docx915 && (cd /tmp/docx915 && npm init -y && npm i docx@9.15.3)
P=docs/backlog/epics/isolate-guest-web-api/reference/today
node $P/run.mjs /tmp/docx915 --json $P/results.json > $P/results.txt
# load-time reads of ceiling globals (variant dists under packages/isolate-host/node_modules/.web-api-probe/)
node docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/build-variants.mjs
node docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/trace-load.mjs --json $P/results-trace-load.json > $P/results-trace-load.txt
```

`pins.cjs` runs unchanged as `node pins.cjs`, as a sandbox `exec` and (inlined) as `runCode`; one
line per observation. `encodings.json` is WHATWG `encodings.json` (7 groups, 228 labels) as
`[name, labels]`. `run.mjs` also runs three generators over each package's installed closure
(`packages/isolate-host/tests/closure-files.ts`) in a sandbox and in `node`. `exec` and `runCode`
agree on every row (`results.txt`, column 4).

## Pins (guest vs Node v24.16.0)

Class: **=** equal; **gap** the ceiling's named `NotImplementedError`; **leak** an `undefined`,
a foreign `TypeError` or a wrong value (the «captured at load» class or another rifty gap).

| group | observation | guest | Node | class |
|---|---|---|---|---|
| all | global descriptors of `Blob`, `File`, `TextDecoder`, `TextEncoder`, `AbortController`, `AbortSignal`, `EventTarget`, `Event`, `CustomEvent`, `DOMException` | data, `w1e0c1` | same | = |
| Blob | `new Blob`, `size`/`type`, `text`/`arrayBuffer`/`bytes`/`slice`/`stream`; `new File` | `isolate-host.Blob` / `isolate-host.File` | works | gap |
| Blob | `typeof buffer.Blob`, `buffer.File` | `undefined` | `function` | leak (load capture `buffer.ts:42-43`) |
| Blob | `buffer.Blob === Blob`, `buffer.File === File` | `false` | `true` | leak |
| Blob | `new buffer.Blob(['a'])` | `TypeError: buffer.Blob is not a constructor` | size 1 | leak |
| Blob | `({}) instanceof buffer.Blob` | `TypeError: Right-hand side of 'instanceof' is not an object` | `false` | leak |
| Blob | `({}) instanceof Blob`; `buffer.resolveObjectURL` typeof | `false`; `function` | same | = |
| TextDecoder | labels accepted (WHATWG table) | 3/228 (`unicode-1-1-utf-8`, `utf-8`, `utf8`) | 222/228 (all but the 6 `replacement` labels) | gap per label: `isolate-host.TextDecoder(<label>) (only utf-8)` |
| TextDecoder | utf-8 labels `unicode11utf8`, `unicode20utf8`, `x-unicode20utf8` | gap | `utf-8` | gap where Node's utf-8 works |
| TextDecoder | decode `68 69 e9 80 ff` as latin1 / utf-16le / utf-16be / shift_jis / gbk / big5 / euc-kr | gap | `hié€ÿ` / `楨胩�` / `桩�` / `hi騾�` / `hi閫�` / `hi�` / `hi��` | gap |
| TextDecoder | `new TextDecoder('nope')` | `NotImplementedError … TextDecoder(nope)` | `RangeError [ERR_ENCODING_NOT_SUPPORTED]` | leak (wrong error for invalid input) |
| TextDecoder | utf-8 `fatal` on `ff`, `ignoreBOM`, `stream` split | Node's (`ERR_ENCODING_INVALID_ENCODED_DATA`, BOM kept, `é`) | same | = |
| TextDecoder | `util.TextDecoder === TextDecoder`, `util.TextEncoder === TextEncoder` | `true` | `true` | = |
| Abort/Event | `new AbortController()`, `new EventTarget()`, `new Event`, `new CustomEvent` | `isolate-host.<name>` | works | gap |
| Abort/Event | `AbortSignal.abort/timeout/any`, `throwIfAborted` | `TypeError: AbortSignal.abort is not a function` | works | leak (static member of a ceiling; compat row "Static members") |
| Abort/Event | `new DOMException('m','AbortError').code` | 20 | 20 | = |
| Abort/Event | `events.once`/`events.on`/`timers/promises.setTimeout`/`fs.readFile`/`fs.promises.readFile` with an aborted `signal` | `isolate-host.AbortController` (at the caller's `new AbortController()`) | `AbortError [ABORT_ERR]` | gap |
| Abort/Event | `typeof events.addAbortListener`, `typeof util.aborted` | `undefined` | `function` | rifty gap on every host by source (streams goal unit 3 `runtime-js/events-add-abort-listener`; `util.aborted` no item found) |
| Abort/Event | `stream.addAbortSignal(undefined, r)` | `TypeError: Cannot read properties of undefined (reading 'aborted')` | `ERR_INVALID_ARG_TYPE` | rifty's stream core on every host (`packages/io/src/streams/readable.ts:1399`, no validation; streams goal 8c) |
| other | `stream/promises.pipeline` with an async-generator stage | `TypeError: pipeline: argument must be a stream (index 1 …)` | resolves | rifty's pipeline on every host (streams goal `stream-pipeline-callback-generator-stage`) |

## Load-time reads (`results-trace-load.txt`, file run and `runCode` alike: 23 reads, 9 sites)

Only names in `CEILING_GLOBALS` are traced (`TextDecoder` is the shim's, not a ceiling).

- Narrowed set: `Blob`, `File` at `packages/runtime-js/src/builtins/buffer.ts:42-43` — the one
  capture left in this goal (`buffer.Blob`/`buffer.File` `undefined`, the leak rows above).
  `AbortController`, `AbortSignal`, `EventTarget`, `Event`, `CustomEvent`: **no load-time read**;
  runtime uses read them at call time and give the named gap.
- Leaves with `URL`/ESM: `URL` (`internal/posix-file-url.ts:1`), `URLSearchParams`
  (`builtins/url.ts:17`).
- Neither (other owners): web streams ×14 (`builtins/stream-web.ts:39`), `ReadableStream`/
  `WritableStream` (`io/src/streams/from-web-validation.ts:34,38`), `structuredClone`
  (`internal/node-ipc-advanced.ts:23`), `MessageChannel` (`builtins/timers.ts:267`),
  `crypto.subtle` (`builtins/crypto.ts:504`).

## Scenario: first stop (sandbox `exec` vs `node`)

| generator | node | guest |
|---|---|---|
| pptxgenjs `pptx.write()` (no `outputType`) | exit 0, `[object Blob]`, bytes written | exit 1 `Error: blob is not supported by this platform` (`jszip/lib/utils.js:378`: JSZip's load-time `Blob` detection in a `try`) |
| docx `Packer.toBlob(doc)` | exit 0, `[object Blob]`, bytes written | exit 1 `NotImplementedError: isolate-host.Blob` (`docx/dist/index.cjs:23940`) |
| pdfkit `doc.font('Helvetica').text(…)`, `compress: true` | exit 0 | exit 1 `NotImplementedError: isolate-host.TextDecoder(ascii) (only utf-8)` at `fontkit/dist/main.cjs:5424` (load of `pdfkit.js:7`) |

## Not verified

- What each generator hits after its first stop (pdfkit: zlib expected, not run).
- Browser hosts (native globals there); `'X' in globalThis` / `typeof` detections (the trace sees
  property reads of ceiling names only).
- `TextDecoder` decode results for every Node-accepted encoding (only the 7 above, one input).
- Linux; timings (none taken).
