---
area: distribution
status: draft
title: Isolate host — text extraction from PDFs with a text layer — what works today, what the rest needs; candidate for a goal
created: 2026-11-26
why: a Node service asks the guest for a PDF's text; three CJS libraries give node's text today, pdfjs-dist 6, unpdf, mupdf and PDFium stop on gaps that live in several backlog owners — whether this is a goal of its own is the user's call
user_story: As a Node service running model-written code in an isolate-host sandbox, I want the code to read a user's PDF and print its text with a common npm library as `node` does, but today only pdf2json, pdfreader and pdf-parse 1 do; pdfjs-dist 6.5.438, unpdf, mupdf stop at `isolate-host.esm`, pdf-parse 2 and pdfjs-dist 3 at `isolate-host.URLSearchParams`, @hyzyla/pdfium exits 0 with no output.
sources: [docs/backlog/distribution/reference/isolate-pdf-text-probe/README.md, docs/public/compat/process.md, docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/isolate-guest/src/guest/entry.ts]
---

## Question

owner: user. Is «text from a PDF with a text layer in the isolate host» a goal of its own, and if
so: which libraries/entries count (the pdf.js line, an Emscripten/WASM engine, the CJS three
already working), which documents (beyond the four probe PDFs) and which tier? No direction chosen.

## Context

Facts: probe `reference/isolate-pdf-text-probe` (2026-11-26, `origin/main` `ebaf4945c`,
macOS arm64, Node v24.16.0; rerun record `out/rerun-env.txt`, same verdicts), each library's canonical README-style code (CJS; ESM entries `*.mjs` too), `sandbox.exec`,
four PDFs (Latin uncompressed; 3 pages Flate + object streams; Cyrillic with embedded font and
ToUnicode from pdf-lib; Cyrillic from PDFKit).

Works today, text = node on each PDF (`out/summary-canonical.txt`, rerun
`out/rerun-summary-canonical.txt`):

- `pdf2json@4.1.1` (0 dependencies; own pdf.js fork — research report) — `loadPDF(path)` and `parseBuffer(bytes)`;
- `pdfreader@3.0.8` — wrapper over `pdf2json@3.1.4` (not 4.1.1), `parseFileItems` and `parseBuffer`;
- `pdf-parse@1.1.1` — bundled pdf.js v1.10.100 (2018 line — research report): if adopted only as `X@V`, a declared
  ceiling under `AGENTS.md` §Fidelity, not support.

Not equal to node: four PDFs in one process — node exits 1 on `pdf-parse@1.1.1` (`bad XRef entry`)
and `pdfreader` `parseBuffer` (`Unknown compression method in flate stream: 190, 213`); the guest
exits 0 with the per-PDF texts (`out/results-allrun-check.txt`). Cause not established.

Stops (first stop, `out/summary-canonical.txt`):

- `isolate-host.esm`: `pdfjs-dist@6.5.438` legacy, `unpdf@2.2.3`, `pdf.js-extract@1.0.1`,
  `mupdf@1.28.6` (AGPL-3.0-or-later; `"type": "module"`, top-level `await` — lock and
  `dist/mupdf.js`, probe README);
- `isolate-host.URLSearchParams` at `require`: `pdf-parse@2.4.5` (pdfjs-dist 5.4.296 inside),
  `pdfjs-dist@3.11.174`. pdf-parse 2.4.5 fails under node too in this probe: installed without
  optional deps, node warns `Cannot load "@napi-rs/canvas" package` and exits 1 at `require` with
  `ReferenceError: DOMMatrix is not defined` (`out/rerun-pdfparse2-node.txt`) — no oracle here;
- exit 0, empty output: `@hyzyla/pdfium@3.0.0` → `distribution/isolate-host-async-wasm-compile-run-ends-early`;
  mupdf also calls `WebAssembly.instantiate` (node trace), behind its ESM stop.

Behind the first stop, pdfjs-dist 6.5.438 and unpdf 2.2.3's copy (no 4.x/5.x run) as CJS bundles
with script-side ponyfills (probe, not a product path; `out/chain-pdfjs6bundle.txt`,
`out/chain-unpdfbundle.txt`): `AbortController` → `structuredClone` → `ReadableStream`; with the
three, text = node. pdfjs-dist 3: `URLSearchParams` → `ReadableStream` (`out/chain-pdfjs3.txt`).
For pdfjs-dist 6.5.438 `process.getBuiltinModule`, `DOMMatrix`/`Path2D` are warnings only on the
bytes → text path. pdf-parse 2.4.5: `URLSearchParams` → `ReferenceError: DOMMatrix is not defined`
(a hard stop; with a `getBuiltinModule` ponyfill also `URLConstructor is not a constructor`) →
fake worker `isolate-host.esm`, chain ends (`out/chain-pdfparse2.txt`). No traced library loads `node:zlib`;
`fs.createReadStream` unused — research report, output not kept (fs calls not traced).

| missing in the guest | needed by | backlog owner |
|---|---|---|
| ES modules; `URL`/`URLSearchParams` | pdfjs-dist 6.5.438, unpdf, pdf.js-extract, mupdf; pdf-parse 2, pdfjs-dist 3 | `epics/isolate-guest-modern-code` (draft goal, start is the user's) |
| `AbortController`/`EventTarget` | pdfjs-dist 6.5.438, unpdf fake worker | unit 7 of `epics/node-streams-as-in-node`: `distribution/isolate-stream-core-abort-controller` (PR #472, draft) |
| `structuredClone` | pdfjs-dist 6.5.438, unpdf `LoopbackPort` | no unit (out of scope in `epics/isolate-guest-web-api/map.md`) |
| web streams (`ReadableStream`) | pdfjs-dist 3.11.174, 6.5.438, unpdf `getTextContent` | `distribution/isolate-guest-web-streams` (draft, outside both goals) |
| async WebAssembly held until settled | @hyzyla/pdfium (mupdf behind ESM, not reached) | `distribution/isolate-host-async-wasm-compile-run-ends-early` |
| `process.getBuiltinModule` | pdfjs-dist 6.5.438 (warning only) | `runtime-js/process-get-builtin-module` (draft) |
| `DOMMatrix` (node: from `@napi-rs/canvas`, native) | pdf-parse 2.4.5 at load | none — native modules are not a goal (`AGENTS.md` Mission) |

Browser hosts (repo, not this probe): `pdfjs-dist@6.5.438` legacy and `pdf-parse@2.4.5` extract
text from `{ data }` in the no-COI toolchain (`docs/public/compat/process.md`,
`tests/no-coi/no-coi-pdf-text.spec.ts`).

Not checked: real documents (multi-column, encrypted, CJK with predefined CMaps, large files and
memory), pdf2json's line-joining quality, `runCode` and `createSandbox({ template })` for the
library runs, Linux, whether rifty's own implementations suffice where ponyfills were measured,
stops behind the first for mupdf and pdf.js-extract (no chain run), pdfjs-dist 4.x/5.x.

Dedup 2026-11-26: no backlog item or goal on PDF text in the isolate host (searched «pdf»,
«pdfjs», «pdf-parse», «pdfium»); `reference/isolate-library-probe` covers writing PDFs (pdf-lib),
not reading.

## Challenge

challenge: 2026-11-26 — not run (question capture; no direction proposed)
