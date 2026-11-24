# Library probe: pptxgenjs / pdf-lib / docx / exceljs in an isolate-host sandbox

Requirement: server-sandbox requirements 2026-11-24 §6 and «Порядок» item 2 (external doc,
`rifty-requirements/2026-11-24-server-sandbox-requirements.md`). Question: can the four libraries
write a valid document inside an isolate guest today (CommonJS, no network), and if not, what is
missing. Probe only: no template exists (`NotImplementedError('isolate-host.sandbox-template')`),
so `probe.mjs` lays `node_modules` into rifty's FS in the consumer realm
(`dist/codec.js`: `MemoryFsSync` + `snapshotFs`, ADR-0567) at `/workspace/node_modules` and
starts `createSandbox({ snapshot, maxFsBytes })` with a raised `memoryLimitMb` per `exec`
(ADR-0568). Measured 2026-11-24 at `origin/main` b3731e9c0, M3 Pro, Node v24.16.0, load average 2–6 on 12 cores.

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build
node docs/backlog/distribution/reference/isolate-library-probe/probe.mjs --min-memory --json out.json
# node_modules from a produceDependencySnapshot artifact instead of npm ci:
node docs/backlog/distribution/reference/isolate-library-probe/produce-artifact.mjs https://registry.npmjs.org/ /tmp/deps.tar.gz
node docs/backlog/distribution/reference/isolate-library-probe/probe.mjs --deps-artifact /tmp/deps.tar.gz
# second OOXML reader over kept outputs (python-pptx 1.0.2, python-docx 1.1.2, openpyxl 3.1.5):
node …/probe.mjs --keep docx pptx-handled pptx-notnode xlsx-workbook   # prints the kept dir
python3 -I …/verify/verify.py <kept>/guest-* <kept>/oracle/out/*
```

`probe.mjs` `npm ci`s `deps/` (the four libraries, lock pinned) and `verify/` (readers) into a
temp dir, runs every `gen/<name>.cjs` as `node <file> <out>` in the sandbox and under real `node`
over the same `node_modules` (the oracle), then checks both outputs in real Node
(`verify/verify.cjs`): pptx/docx/xlsx a ZIP with the expected OOXML parts, every XML part
well-formed, then a reader — xlsx SheetJS 0.18.5 (cells, formula), docx mammoth 1.11.0 (text),
pptx the slide list + slide text; pdf `PDFDocument.load` (pages, title). `vsNode`: guest output
vs oracle output with timestamps masked — OOXML per part (a nested package per entry), pdf as text
with Flate streams inflated and `/Length`/`startxref` masked (pdf-lib's `save()` stamps ModDate). `gen/diag*.cjs`
print one line per surface; the probe lists the lines that differ from real node. `trace.cjs`
(real Node only, `node -r ./trace.cjs gen/<x>.cjs out`) lists the builtins and web globals a run
touches. Evidence: `results-npm-ci.json`, `results-artifact.json`, `results-produce-artifact.txt`,
`results-python-readers.txt`. Run-to-run noise: the `diag-outputs` sizes of `docx Packer.toBuffer`/
`toBase64String`/`toString` can differ by a byte (`core.xml` timestamp under compression).

## Result

Generators are agent-style canonical code (`gen/<kind>.cjs`); `-<variant>` files are
consumer-side routes past a stop, no rifty change.

| library | version (lock) | canonical generator | stops at | consumer-side route (verified) |
|---|---|---|---|---|
| pdf-lib | 1.17.1 | ✅ valid PDF, = node's (masked) | — | — |
| docx | 9.15.3 | ✅ valid docx, = node's (masked) | — | — (`Packer.toBlob` ❌ Blob) |
| pptxgenjs | 4.0.1 | ❌ exit 1 | `import('node:https')` → `NotImplementedError('isolate-host.https')`, unhandled | ✅ `pptx-handled`: an `unhandledRejection` listener drops that one rejection; ✅ `pptx-notnode`: `process.release.name` ≠ `'node'` + `write({outputType:'nodebuffer'})` + `fs.writeFileSync`. Image by `path` still fails on the `pptx-handled` route (pass `data:`; not run on `pptx-notnode`). ❌ `pptx-bundle` (browser bundle): `navigator.userAgent` |
| exceljs | 4.4.0 | ❌ exit 1 at `require('exceljs')` | `node:zlib` → `NotImplementedError('isolate-host.zlib')` | ✅ `xlsx-workbook`: `require('exceljs/lib/doc/workbook')` + `xlsx.writeBuffer()`/`writeFile()`. ❌ `xlsx-browser` (`dist/exceljs.min.js`): `navigator.userAgent`. On that route: `csv.writeBuffer` ❌ (Transform), `xlsx.readFile` ❌ (`close`; `xlsx.load(fs.readFileSync(f))` ✅), streaming `WorkbookWriter`/`WorkbookReader` not reachable (zlib) |

Every ✅ guest output passes the same checks as the oracle's and equals it (`vsNode.equal`);
python-pptx/python-docx/openpyxl read the ✅ OOXML outputs, guest and oracle
(`results-python-readers.txt`). No library is impossible in principle: each
has a verified route today; two need code the agent would not write by itself.

### Missing in the guest (deduplicated; evidence = probe line vs node)

| # | API | compat | called from (`node_modules`) | blocks |
|---|---|---|---|---|
| 1 | `node:zlib` at require | declared ❌ (`isolate-host.zlib`) | `exceljs/excel.js:13` → `lib/exceljs.nodejs.js:6` → `stream/xlsx/workbook-writer.js:2` → archiver → zip-stream → compress-commons → `crc32-stream/lib/deflate-crc32-stream.js:11`; also `:7` → `workbook-reader.js:5` → `unzipper/lib/parse.js:2` | `require('exceljs')`, even when the write itself uses JSZip/pako; the streaming writer/reader for real |
| 2 | `node:https` at load (`import()` or `require`) | declared ❌ (network, «throw at require») | `pptxgenjs/dist/pptxgen.cjs.js:4842-4850` (`encodeSlideMediaRels`: `loadNodeDeps()` per slide, never awaited/caught) | every `pptx.writeFile`/`write`; awaited for an image by `path` (`:4871-4872`), so the listener route fails there. Node loads the module without network |
| 3 | `Blob` | declared ❌ | `docx/dist/index.cjs:23939` (`toBlob`); `jszip/lib/support.js:17` (detection in `try`, so `generateAsync({type:'blob'})` → `blob is not supported by this platform`) | `Packer.toBlob`, `pptx.write({outputType:'blob'})` only |
| 4 | `navigator.userAgent` | declared ❌ (`navigator.*`) | core-js `engine-user-agent` inside `exceljs/dist/exceljs.min.js:10`, `pptxgenjs/dist/pptxgen.bundle.js` | the browser-bundle routes only. Node 24 has it |
| 5 | `stream.Transform` subclass `_transform`/`_flush`, `Duplex` subclass `_write` | **undeclared** (streams.md said ✅; now ⚠️) | `@fast-csv/format/build/src/CsvFormatterStream.js:6-55` → `exceljs/lib/utils/stream-buf.js:239` | exceljs CSV write (chunks pass through unchanged; silent where a sink accepts them) — `runtime-js/stream-subclass-hooks-ignored` |
| 6 | `fs.ReadStream#close`/`WriteStream#close` | **undeclared** (fs.md row now names it) | `exceljs/lib/xlsx/xlsx.js:56`, `:59` | `xlsx.readFile` — `runtime-js/fs-stream-close-method-missing` |
| 7 | `process.umask` | **undeclared** (process.md row added) | `fstream/lib/writer.js:8` at load (unzipper → exceljs main) | next stop of exceljs main after #1 — `runtime-js/process-umask-missing` |
| 8 | `require()` of an ESM-only package | declared ❌ | `nanoid` 6 (`"type":"module"`): `TypeError: URLConstructor is not a constructor` | nothing measured: docx bundles its own copy |

Touched but harmless (a `try` or `typeof` around them): `CustomEvent` (bluebird
`debuggability.js:146`), `Blob` detection (JSZip). `node:http`, `worker_threads`, `child_process`
throw at require too (declared ❌) but sit on no measured path. `import('node:fs')` from CJS works.
For ROADMAP M14 E (guest Web API shim): none of the Web APIs it lists (URL, structuredClone, web
streams, …) blocks these libraries' Node paths; the blockers are Node modules and members (#1, #2,
#5–#7), and #5 is the one silent wrong behavior. Web APIs appear only on routes Node does not
need (#3 Blob outputs, #4 browser bundles).

## Measures (requirement 3 baseline)

| | value |
|---|---|
| `node_modules` (npm ci of `deps/`) | 209 lock packages, 8 001 files, 86.7 MB file bytes; 6 `.bin` links skipped (rifty FS has none) |
| smallest `maxFsBytes` the codec accepts (budget) | 99 458 048 (94.9 MiB); probe ran at 111 MiB |
| snapshot | 88.1 MB, gzip 19.7 MB (> the ~16 MB per-conversation budget alone); `snapshotFs` 72 ms |
| `createSandbox({ snapshot })` | 91 ms |
| warm `exec` of an empty file | 597–628 ms median of 5 over runs (empty sandbox: 14–15 ms) |
| `exec` of a generator | ✅ ones 0.77–0.97 s, failing ones up to 1.2 s (real node, process start included: 51–132 ms) |
| smallest `memoryLimitMb` (4 MiB bisection) | 215 empty file; pdf 213, xlsx-workbook 218, pptx-notnode 218, pptx-handled 222, docx 230 — the state, not the library, sets it |
| `/node_modules` mount | `require()` from `/workspace` reaches a package at `/node_modules` (prints 42) |

## produceDependencySnapshot (requirements «Найдено дополнительно»)

Published `@riftydev/workbench@0.11.0` in plain Node 24 (`produce-artifact.mjs`): works,
14–16 s, 19.9 MB gzip (`frozen`), two runs byte-identical (`snapshotId` `sha256:533a3f51…`;
`results-produce-artifact.txt`). The repo's own `packages/workbench/dist` does not load in plain Node
(`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`: it imports workspace packages as TS sources). The
artifact's `payload/node_modules` equals the npm ci tree except `.bin` entries (plain files, not
links) and no `.package-lock.json` — no shadow substitution for these four libraries — and the
probe over it gives the same outcomes (`results-artifact.json`). As a source of `node_modules`
for the probe: usable after host-side `tar -xz` (the guest has no zlib).

## Not verified

- Browser hosts: findings #5–#7 measured in the isolate guest only (same `@riftydev/io` /
  runtime-js code by source).
- Library features beyond the generators: pptxgenjs media other than PNG data, docx
  `patchDocument`, exceljs streaming writer/reader (blocked by zlib), custom fonts for pdf-lib
  (`@pdf-lib/fontkit` not installed).
- Linux; the template-scale memory under load; a repo-HEAD workbench in plain Node beyond the one
  attempt above.
