# Probe: text extraction from PDFs with a text layer in an isolate-host sandbox

Question: which npm PDF libraries give `node`'s text from a PDF's bytes inside `sandbox.exec`
today (CommonJS, no network), and what stops the rest. Probe only, not a product path.
Research run 2026-11-26 at `origin/main` `ebaf4945c`, macOS arm64, Node v24.16.0 (research report;
not recorded in `out/`). Rerun the same day at the same commit, all steps below
(`out/rerun-env.txt`: `ebaf4945c`, node v24.16.0, Darwin arm64; `out/rerun-*`): same verdicts.
The guest reports `v24.0.0`. Scripts were reformatted for `biome check` between the two runs
(`node:` prefixes, optional chaining, `biome-ignore` on `delete`); `out/rerun-*` come from the
kept scripts, the other `out/*` from the research run. Evidence for
`docs/backlog/distribution/isolate-host-async-wasm-compile-run-ends-early.md` and
`docs/backlog/distribution/isolate-host-pdf-text-extraction.md`.

## Method

`scripts/probe.mjs` (method of `../isolate-library-probe/probe.mjs`) lays each case's
`deps/node_modules` subset into rifty's FS at `/node_modules` with the host package's internal
`dist/codec.js`, starts `createSandbox({ snapshot })` and runs `scripts/gen/<case>` as `node <file>
<pdf…>`: once per PDF, then once over all four. The oracle is real `node` on a copy of the same
tree (`oracle/`), once more under `scripts/trace.cjs` (builtins loaded, ESM files, web globals read
or called; functions of `fs` are not traced). Verdict: `EQUAL` = same exit code and stdout;
`DIFFERS`; `GUEST-STOPS` = guest fails, node passes; `NODE-FAILS` = node exits non-zero.
`scripts/chain.mjs` re-runs a stopped case with script-side ponyfills (`scripts/chain/_stubs.cjs`,
PROBE ONLY) one stop at a time, to show the next stop. ESM-only libraries enter the chain as
CommonJS bundles made by esbuild (`scripts/bundle-src`, bundles not kept).

Fixtures (`pdfs/`, made by `scripts/make-pdfs.cjs` from `gen-deps`; features `out/make-pdfs.txt`):
`latin-raw.pdf` (1 page, no compression), `multi-flate.pdf` (3 pages, Flate + object/xref streams),
`cyrillic.pdf` (pdf-lib, embedded DejaVu, Identity-H + ToUnicode, object streams),
`cyrillic-pdfkit.pdf` (PDFKit, embedded font + ToUnicode).

## Run

Writes `deps/node_modules`, `oracle/`, `bundles/` next to the scripts: copy the directory out first.

```sh
pnpm install --frozen-lockfile && pnpm --filter @riftydev/isolate-host build   # in the checkout R
cp -R docs/backlog/distribution/reference/isolate-pdf-text-probe /tmp/pdf-probe && cd /tmp/pdf-probe
(cd deps && npm ci --registry=https://registry.npmjs.org/ --no-audit --no-fund --ignore-scripts --omit=optional)
(cd gen-deps && npm ci --registry=https://registry.npmjs.org/ --no-audit --no-fund --ignore-scripts)
node scripts/make-pdfs.cjs pdfs                                   # fixtures (kept; byte-stability not checked)
node scripts/probe.mjs $R --json out/results-canonical.json       # every scripts/gen/*, with trace
node scripts/summary.mjs out/results-canonical.json
node scripts/probe.mjs $R --json out/results-pdfium.json pdfium.cjs   # one case (research kept pdfium apart)
node scripts/namesrun.mjs $R                                      # WebAssembly entry names, Blob read
node scripts/diagrun.mjs $R scripts/diag/diag.cjs                 # platform surfaces, lines unequal to node
node scripts/wasmdiag.mjs $R deps/node_modules/@hyzyla/pdfium/dist/pdfium.wasm
node scripts/wasmdiag-async.mjs $R deps/node_modules/@hyzyla/pdfium/dist/pdfium.wasm   # + runCode
(cd scripts/bundle-src && for n in pdfjs-legacy unpdf pdfjsextract; do NODE_PATH=../../deps/node_modules $R/node_modules/.bin/esbuild $n.entry.mjs --bundle --format=cjs --platform=node --outfile=../../bundles/$n.cjs --define:import.meta.url=__probe_import_meta_url "--banner:js=const __probe_import_meta_url = 'file://' + __filename;"; done)
for c in pdfjs3 pdfjs6bundle unpdfbundle pdfparse2; do node scripts/chain.mjs $R --json out/chain-$c.json $c; done
```

`cp -cR` in `probe.mjs`/`chain.mjs` is macOS's clone copy; Linux not run. Both locks resolve on
`registry.npmjs.org`. `--omit=optional` leaves out `@napi-rs/canvas`'s native binding.

## Results (2026-11-26, `ebaf4945c`)

### Canonical scripts (`out/summary-canonical.txt`, pdfium `out/summary-pdfium*.txt`; rerun of all `out/rerun-summary-canonical.txt`)

| script | library | per PDF (4) | 4 PDFs in one run |
|---|---|---|---|
| `pdf2json.cjs` `loadPDF(path)` | pdf2json 4.1.1 (0 deps, own pdf.js fork) | EQUAL | EQUAL |
| `pdf2json-buffer.cjs` `parseBuffer(bytes)` | pdf2json 4.1.1 | EQUAL | EQUAL |
| `pdfreader.cjs` `parseFileItems(path)` | pdfreader 3.0.8 (over pdf2json **3.1.4**) | EQUAL | EQUAL |
| `pdfreader-buffer.cjs` `parseBuffer(bytes)` | pdfreader 3.0.8 | EQUAL | node exit 1 `Unknown compression method in flate stream: 190, 213`; guest exit 0 |
| `pdfparse1.cjs` (`pagerender`) | pdf-parse 1.1.1 (bundled pdf.js v1.10.100) | EQUAL | node exit 1 `bad XRef entry`; guest exit 0 |
| `pdfparse1-default.cjs` (`data.text`) | pdf-parse 1.1.1 | EQUAL | node exit 1 `bad XRef entry`; guest exit 0 |
| `pdfium.cjs` (README code) | @hyzyla/pdfium 3.0.0 (PDFium WASM, CJS) | guest exit 0, stdout and stderr empty; node prints the text | same |
| `pdfium-keepalive.cjs` (`setInterval` held around `init()`) | @hyzyla/pdfium 3.0.0 | EQUAL | EQUAL |
| `pdfjs-import.cjs`, `pdfjs.mjs` | pdfjs-dist 6.5.438 legacy | `isolate-host.esm` | same |
| `unpdf-import.cjs`, `unpdf.mjs` | unpdf 2.2.3 | `isolate-host.esm` | same |
| `pdfjsextract.cjs` | pdf.js-extract 1.0.1 | `isolate-host.esm` | same |
| `mupdf-import.cjs`, `mupdf.mjs` | mupdf 1.28.6 (AGPL-3.0-or-later; `"type": "module"`, top-level `await import("node:fs")` in `dist/mupdf.js`) | `isolate-host.esm` | same |
| `pdfjs3.cjs` | pdfjs-dist 3.11.174 legacy (last CJS pdf.js — research report) | `isolate-host.URLSearchParams` at `require` | same |
| `pdfparse2.cjs` | pdf-parse 2.4.5 (pdfjs-dist 5.4.296 inside) | `isolate-host.URLSearchParams` at `require`; **node also exits 1** without `@napi-rs/canvas` | same |

4-in-one-run: guest stdout = the four per-PDF node stdouts joined (`out/results-allrun-check.txt`,
probe field `allRunGuestEqualsPerFileNode`); why node fails on the second document in one process —
not established. `out/today-works.txt`: two sample outputs, its generator not kept.

### Ponyfill chains (`out/chain-*.txt`, PROBE ONLY)

| case | stops in order | with ponyfills |
|---|---|---|
| `pdfjs6bundle` (pdfjs-dist 6.5.438 legacy as CJS bundle) | `AbortController` (fake worker) → `structuredClone` → `ReadableStream` | text = node |
| `unpdfbundle` (unpdf 2.2.3 as CJS bundle) | `AbortController` → `structuredClone` → `ReadableStream` | text = node |
| `pdfjs3` (pdfjs-dist 3.11.174) | `URLSearchParams` → `ReadableStream` | text = node |
| `pdfparse2` (pdf-parse 2.4.5) | `URLSearchParams` → `DOMMatrix is not defined` → fake worker `isolate-host.esm` | chain ends; node itself exits 1 at the `DOMMatrix` stop without `@napi-rs/canvas` (`out/rerun-pdfparse2-node.txt`) |

On the text path `process.getBuiltinModule is not a function`, `Cannot polyfill DOMMatrix/Path2D`
and `standardFontDataUrl` are warnings only: the run still passes (`chain-pdfjs6bundle.txt` step 4).
No traced library loads `node:zlib` (0 mentions in `out/results-canonical.json`).
`fs.createReadStream` is not traced: «no measured library reads it» — research report, output not
kept; pdf.js sources (`pdfjs-dist`, `unpdf`, `pdf-parse`, `pdf.js-extract` copies) do contain it
(grep 2026-11-26). mupdf's trace shows `WebAssembly.instantiate()×1` too (behind its ESM stop; no
chain run for mupdf or pdf.js-extract).

### Async WebAssembly (`out/diag-wasm.txt`, `out/rerun-diag-wasm.txt`, `out/rerun-wasm-async.txt`)

`scripts/diag/wasm.cjs`, `scripts/diag/wasm-async.cjs`: `pdfium.wasm` (5 298 237 bytes) and a
34-byte module (`tiny`). `exec` = `sandbox.exec`; `runCode` gets the bytes inline (base64).

| case | node | exec | runCode |
|---|---|---|---|
| pdfium `new WebAssembly.Module` (sync) | ok | ok | not run |
| pdfium `WebAssembly.compile(bytes).then(…)` | `compile: settled Module`, exit 0 | exit 0, no settled line | same as exec |
| pdfium `await WebAssembly.compile(bytes)` in an async IIFE | `await compile: Module` | exit 0, no line | same |
| pdfium `WebAssembly.instantiate(bytes, {})` (rejects: imports missing) | `rejected TypeError` | exit 0, no line | same |
| pdfium `WebAssembly.instantiate(new WebAssembly.Module(bytes), {})` | `rejected TypeError` | same as node | same as node |
| pdfium compile + `setInterval` held until settled | settled | settled | not run |
| pdfium compile + 3 s `setTimeout` | settled, timer fired | settled, timer fired | not run |
| pdfium via the library: `PDFiumLibrary.init()` (`WebAssembly.instantiate`, trace) | text | exit 0, empty | not run |
| pdfium cut by 1000 bytes, compile nobody subscribes | exit 1 (unhandled `CompileError`) | exit 1 (`CompileError` at the Data section's length) | exit 1 |
| tiny `compile`, `await compile`, `instantiate(bytes)`, `instantiate(Module)` | settled | settled | settled |
| 6 invalid bytes, compile nobody subscribes | exit 1 | exit 1 | exit 1 |
| `typeof WebAssembly.compileStreaming` / `instantiateStreaming` | `function` / `function` | `undefined` / `undefined` | `undefined` / `undefined` |
| pending 4 MiB `Blob#arrayBuffer()` (`out/rerun-streaming-names.txt`) | settled | settled | settled |

When the cut module's `CompileError` arises (before or after the async work) is not timed. Size threshold between 34 bytes and 5.3 MB not measured. Code (main `ebaf4945c`): the guest's
`setUp` (`packages/isolate-guest/src/guest/entry.ts`) does not call `installHostAsyncKeepalive`
(`packages/runtime-js/src/builtins/host-async-keepalive.ts`, ADR-0529), which browser hosts install
(`packages/workbench/src/workers/kernel-worker-entry.ts`, `packages/workbench/src/workers/no-coi-toolchain-owner.ts`,
`packages/runtime-js/src/ipc/no-coi-child-worker.ts`);
that this is the cause is not proven (no fixed build run).

## Not checked

Real documents (multi-column, encrypted, CJK with predefined CMaps, large files and memory), line
joining quality of pdf2json, `createSandbox({ template })`, Linux, whether rifty's own
implementations suffice where ponyfills were measured, pdf-parse 2.4.5 with its canvas binding.
`out/pdfparse2-node-nocanvas.head.txt`: first lines only (the full node stderr carried the
minified bundle, 472 KB).
