# Library probe: pptxgenjs / pdf-lib / docx / exceljs in an isolate-host sandbox

Requirement: server-sandbox requirements 2026-11-24 §6 and «Порядок» item 2 (external doc,
`rifty-requirements/2026-11-24-server-sandbox-requirements.md`). Question: can the four libraries
write a valid document inside an isolate guest today (CommonJS, no network), and if not, what is
missing. Probe only: no template exists (`NotImplementedError('isolate-host.sandbox-template')`),
so `probe.mjs` lays `node_modules` into rifty's FS in the consumer realm at
`/workspace/node_modules` and starts `createSandbox({ snapshot, maxFsBytes })` with a raised
`memoryLimitMb` per `exec` (ADR-0568). It builds the snapshot with the host package's internal
`dist/codec.js` (`MemoryFsSync` + `snapshotFs`, ADR-0567), which a consumer cannot import: the
`snapshotFs` time below is that path's, not a consumer's. Measured 2026-11-24 at `origin/main`
b3731e9c0, M3 Pro, Node v24.16.0, load average 7–30 on 12 cores (other work on the machine).

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build
node docs/backlog/distribution/reference/isolate-library-probe/probe.mjs --min-memory --json out.json
# node_modules from a produceDependencySnapshot artifact instead of npm ci:
node docs/backlog/distribution/reference/isolate-library-probe/produce-artifact.mjs https://registry.npmjs.org/ /tmp/deps.tar.gz
node docs/backlog/distribution/reference/isolate-library-probe/probe.mjs --deps-artifact /tmp/deps.tar.gz
# second OOXML reader (python-pptx 1.0.2, python-docx 1.1.2, openpyxl 3.1.5) over a full kept run:
node docs/backlog/distribution/reference/isolate-library-probe/probe.mjs --keep   # prints the kept dir
python3 -I docs/backlog/distribution/reference/isolate-library-probe/verify/verify.py <kept>/guest-* <kept>/oracle/out/probe-*
```

`probe.mjs` `npm ci`s `deps/` (the four libraries) and `verify/` (readers) into a temp dir — both
locks resolve on `registry.npmjs.org`; npm's own registry config applies — runs every
`gen/<name>.cjs` as `node <file> <out>` in the sandbox and under real `node` over the same
`node_modules` (the oracle), the oracle once more under `trace.cjs` (builtins each run loads, with
the `node_modules` frames of the first load, and the web globals it reads), then checks both
outputs in real Node (`verify/verify.cjs`): pptx/docx/xlsx a ZIP with the expected OOXML parts,
every XML part well-formed, then a reader that is not the generating library — xlsx SheetJS 0.18.5
(cells, formula), docx mammoth 1.11.0 (text), pptx the slide list + slide text; a PDF is checked by
pdf-lib itself (`PDFDocument.load`: pages, title), so "valid PDF" means pdf-lib parses it and it
equals Node's. `vsNode`: guest output vs oracle output — OOXML XML parts as text with timestamps
masked, binary parts as bytes, a nested package per entry; pdf as text with Flate streams inflated
and timestamps, `/ID`, `/Length`, `startxref` masked (pdf-lib's `save()` stamps ModDate).
`gen/diag*.cjs` print one line per surface; the probe lists the lines that differ from real node
(`differs`: the guest's, `nodeOnly`: Node's).

Evidence: `results-npm-ci.json`, `results-artifact.json` (each result's `node.trace` / `trace`),
`results-produce-artifact.txt`, `results-python-readers.txt`. Run-to-run noise: in `diag-outputs`
the sizes of `docx Packer.toBuffer`/`toString`/`toBase64String`/`toArrayBuffer` and exceljs
`xlsx.writeFile`/`writeBuffer` can differ from Node's by a byte (seen in some runs, not others;
cause not verified — those lines compare sizes only).

## Result

Generators are agent-style canonical code (`gen/<kind>.cjs`); `-<variant>` files are
consumer-side routes past a stop, no rifty change.

| library | version (lock) | canonical generator | stops at | consumer-side route (measured) |
|---|---|---|---|---|
| pdf-lib | 1.17.1 | ✅ valid PDF, = node's (masked) | — | — |
| docx | 9.15.3 | ✅ valid docx, = node's (masked) | — | — (`Packer.toBlob` ❌ Blob) |
| pptxgenjs | 4.0.1 | ❌ exit 1 (`writeFile`; `write()` too: `pptx-write`) | `import('node:https')` → `NotImplementedError('isolate-host.https')`, unhandled | ✅ `pptx-handled`: an `unhandledRejection` listener drops those rejections (one per slide); ✅ `pptx-notnode`: `process.release.name` ≠ `'node'` + `write({outputType:'nodebuffer'})` + `fs.writeFileSync`. Image by `path` still fails on the `pptx-handled` route (pass `data:`; not run on `pptx-notnode`). ❌ `pptx-bundle` (browser bundle): `navigator.userAgent`; after PR #436 (2026-11-24): `NotImplementedError: isolate-host.https` at `write()` (the bundle's own `require('https')`, row #2) |
| exceljs | 4.4.0 | ❌ exit 1 at `require('exceljs')` | `node:zlib` → `NotImplementedError('isolate-host.zlib')` | ✅ `xlsx-workbook` / `xlsx-workbook-file`: `require('exceljs/lib/doc/workbook')` + `xlsx.writeBuffer()` / `xlsx.writeFile()`, both verified as files. ✅ read back with `xlsx.load(fs.readFileSync(f))` of a `writeFile` output (one cell checked, `diag-outputs`). ❌ on that route: `csv.writeBuffer` (#5), `xlsx.read(fs.createReadStream)`, `xlsx.readFile`, `csv.read` (#6, #7), `worksheet.protect` (#9). ❌ `xlsx-browser` (`dist/exceljs.min.js`): `navigator.userAgent`; after PR #436 (2026-11-24): `NotImplementedError: isolate-host.crypto.subtle` at `require` (`exceljs.min.js:22`, the bundled crypto-browserify pbkdf2 `default-encoding` module, declared ❌). Streaming `WorkbookWriter`/`WorkbookReader` not reachable (zlib) |

Every ✅ guest output passes the same checks as the oracle's and equals it (`vsNode.equal`);
python-pptx/python-docx/openpyxl read the ✅ OOXML outputs, guest and oracle
(`results-python-readers.txt`). No library is impossible in principle: each has a measured route
for writing today; two need code the agent would not write by itself, and exceljs cannot read a
workbook back through a stream.

### Missing in the guest (deduplicated)

"traced": the chain is in the trace of the named generator (`results-npm-ci.json`); "source": read
from the package source at the lock version, not traced.

| # | API | compat | called from (`node_modules`) | blocks |
|---|---|---|---|---|
| 1 | `node:zlib` at require | declared ❌ (`isolate-host.md:30`; its message: "needs web CompressionStream") | traced (`xlsx`): `exceljs/excel.js:13` → `lib/exceljs.nodejs.js:6` → `stream/xlsx/workbook-writer.js:2` → `archiver/index.js:80` → `archiver/lib/plugins/zip.js:8` → `zip-stream/index.js:10` → compress-commons → `crc32-stream/lib/deflate-crc32-stream.js:11`; source: also `exceljs.nodejs.js:7` → `workbook-reader.js:5` → `unzipper/lib/parse.js:2` | `require('exceljs')`, even when the write itself uses JSZip/pako; the streaming writer/reader for real |
| 2 | `node:https` at load | declared ❌ (`isolate-host.md:25` Network; host README "throw at require") | traced (`pptx`, `pptx-write`): `pptxgenjs/dist/pptxgen.cjs.js:4845`; source: `encodeSlideMediaRels` `:4842-4850` starts `loadNodeDeps()` per slide without awaiting or catching it, and awaits it for an image by `path` (`:4871-4872`) | `pptx.writeFile` and `write()` (measured); the listener route for a `path` image (measured). Node loads the module without network |
| 3 | `Blob` | declared ❌ (`:26`) | traced read: `jszip/lib/support.js:17` (detection in `try`, so `generateAsync({type:'blob'})` → `blob is not supported by this platform`); source: `docx/dist/index.cjs:23939` (`toBlob`) | `Packer.toBlob`, `pptx.write({outputType:'blob'})` only |
| 4 | `navigator.userAgent` | ✅ since 2026-11-24 (PR #436; was declared ❌ `navigator.*`) | traced read: `exceljs/dist/exceljs.min.js:10` (core-js `engine-user-agent`, per the guest's stack); pptxgenjs bundle evaluated via `new Function`, no frame | was the browser-bundle routes only; their next stops: `crypto.subtle` (xlsx-browser), `node:https` (pptx-bundle, #2) |
| 5 | `stream.Transform` subclass `_transform`/`_flush`, `Duplex` subclass `_write` | **undeclared** (streams.md `Transform` was ✅; now ⚠️ + a `Duplex` subclass row) | source: `@fast-csv/format/build/src/CsvFormatterStream.js:6-55` → `exceljs/lib/utils/stream-buf.js:239` | exceljs CSV write (chunks pass through unchanged; silent where a sink accepts them) — `runtime-js/stream-subclass-hooks-ignored` |
| 6 | web `ReadableStream`, under rifty's own `fs.createReadStream` | **undeclared** (isolate-host.md row "`fs.createReadStream` reads" added) | guest stack: `new ReadableStream < MemoryVfs.openReadable < FileReadStream.start` (`diag-fsread`); source: exceljs `xlsx.js:244-253` (`read`), `csv/csv.js:32-43` | every fs read stream in the guest: exceljs `xlsx.read(stream)`, `readFile`, `csv.read` — `distribution/isolate-host-fs-read-stream-needs-web-readablestream` |
| 7 | `fs.ReadStream#close`/`WriteStream#close`, `ReadStream[Symbol.asyncIterator]` | **undeclared** (fs.md row now names them) | source: `exceljs/lib/xlsx/xlsx.js:56`, `:59` (its catch's `close()` masks #6), `:247` | `xlsx.readFile` — `runtime-js/fs-stream-close-method-missing` |
| 8 | `process.umask` | **undeclared** (process.md row added) | source: `fstream/lib/writer.js:8` at load (unzipper → exceljs main) | exceljs main after #1 (`diag`: `require('fstream')`) — `runtime-js/process-umask-missing` |
| 9 | `crypto.createHash('sha512')` / `getHashes()` | declared (`runtime-js/crypto-sync-subset-expansion`; consumer added there) | traced load: `exceljs/lib/utils/encryptor.js:3`; source: `:27-30` checks `getHashes()` | `worksheet.protect(password)` |
| 10 | `require()` of a `"type": "module"` package | declared ❌ (`isolate-host.md` Sandbox row "ES modules" names `NotImplementedError('isolate-host.esm')`; the measured refusal is `TypeError: URLConstructor is not a constructor`, now noted there) | `nanoid` 6.0.2 (`diag`) | nothing measured: docx bundles its own copy — `runtime-js/isolate-require-esm-syntax-gaps` |

Touched but harmless (a `try` or `typeof` around them): `CustomEvent` (bluebird
`debuggability.js:146`, traced), `Blob` detection (JSZip). `node:http`, `worker_threads`,
`child_process` throw at require too (declared ❌) but sit on no measured path.
`import('node:fs')` from CJS works.

For ROADMAP M14 E (guest Web API shim), what the evidence supports: no ceiling Web API breaks a
measured write route; reading a file through a stream needs `ReadableStream` (#6, rifty's own fs
path, not a library call); #1 needs `CompressionStream` or a zlib not built on it; #10 needs `URL`
(`runtime-js/isolate-require-esm-syntax-gaps`, `docs/ROADMAP.md` M14 E). The paths behind the
first stops (exceljs's main entry past #1, its streaming writer/reader) are not measured. #5 is
the one silent wrong behavior.

## Measures (requirement 3 baseline)

From `results-npm-ci.json` unless named; `results-artifact.json` ran under heavier load.

| | value |
|---|---|
| `node_modules` (npm ci of `deps/`) | 209 lock packages, 8 001 files, 86.7 MB file bytes; 6 `.bin` links skipped (rifty FS has none) |
| smallest `maxFsBytes` the codec accepts (budget) | 99 458 048 (94.9 MiB); probe ran at 111 MiB |
| snapshot | 88.1 MB, gzip 19.7 MB (> the ~16 MB per-conversation budget alone); `snapshotFs` 77 ms (artifact run 105) |
| `createSandbox({ snapshot })` | 96 ms (artifact run 624, load spike) |
| warm `exec` of an empty file | 601 ms median of 5 (artifact run 719); empty sandbox 15–16 ms |
| `exec` of a generator | ✅ ones 0.83–0.99 s, failing ones up to 1.15 s (real node, process start included: 55–135 ms) |
| smallest `memoryLimitMb` (4 MiB bisection, one run) | 215 empty file; xlsx-workbook-file 209, pdf/pptx/xlsx-workbook 218, docx 222 — within one or two steps of the empty file: the state, not the library, sets it |
| `/node_modules` mount | `require()` from `/workspace` reaches a package at `/node_modules` (prints 42) |

## produceDependencySnapshot (requirements «Найдено дополнительно»)

Published `@riftydev/workbench@0.11.0` in plain Node 24 (`produce-artifact.mjs`): works,
10–12 s, 19.9 MB gzip (`frozen`), two runs byte-identical (`snapshotId` `sha256:4a9fa097…`;
`results-produce-artifact.txt`; the id follows the lock text, so it changed with the registry-host
rewrite). The repo's own `packages/workbench/dist` does not load in plain Node
(`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`, same file: it imports workspace packages as TS sources). The
artifact's `payload/node_modules` equals the npm ci tree except `.bin` entries (plain files, not
links) and no `.package-lock.json` — no shadow substitution for these four libraries — and the
probe over it gives the same outcomes (`results-artifact.json`). As a source of `node_modules`
for the probe: usable after host-side `tar -xz` (the guest has no zlib).

## Not verified

- Browser hosts: #5, #7, #8 measured in the isolate guest only (same `@riftydev/io` / runtime-js
  code by source); #6 is isolate-only by source (browsers have the global).
- Paths behind the first stops: exceljs's main entry past #1 and #8, its streaming
  writer/reader; `pptx.write()` and every other output type with no rejection listener except
  `nodebuffer` (`pptx-write`).
- Content of `Packer.toStream`, pptx `STREAM` and the other `diag-outputs` output types (sizes
  only); pptxgenjs/docx/exceljs images other than PNG data; docx `patchDocument`; custom fonts for
  pdf-lib (`@pdf-lib/fontkit` not installed).
- A consumer-side snapshot build (the probe used the internal `dist/codec.js`); Linux; the
  template-scale memory at low load; a repo-HEAD workbench in plain Node beyond the one attempt
  above.
