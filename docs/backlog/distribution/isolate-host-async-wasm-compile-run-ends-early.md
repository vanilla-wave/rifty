---
area: distribution
status: draft
title: Isolate host — a run ends with exit 0 before a pending async WebAssembly compile of a large module settles
created: 2026-11-26
why: Silent false success — Node waits for `WebAssembly.compile`/`instantiate` and runs its continuation; the isolate guest exits 0 without it, so an Emscripten library with async init (`@hyzyla/pdfium`) gives exit 0 and empty stdout/stderr instead of its result.
user_story: As a Node service running model-written code in an isolate-host sandbox, I want `await PDFiumLibrary.init()` from `@hyzyla/pdfium`'s README to load the library and print the PDF's text as `node` does, but today the run ends with exit 0 and empty output.
sources: [docs/backlog/distribution/reference/isolate-pdf-text-probe/README.md, docs/adr/runtime-js/0529-count-host-task-async-node-surface-requests-in-child-realm-keepalive.md, docs/public/compat/process.md, docs/public/compat/isolate-host.md]
code: [packages/isolate-guest/src/guest/entry.ts, packages/runtime-js/src/builtins/host-async-keepalive.ts]
---

## Context

Measured 2026-11-26 at `origin/main` `ebaf4945c`, macOS arm64, Node v24.16.0 (rerun record
`out/rerun-env.txt`; probe
`reference/isolate-pdf-text-probe`, `out/diag-wasm.txt`, rerun `out/rerun-diag-wasm.txt`,
`out/rerun-wasm-async.txt`). `pdfium.wasm` = 5 298 237 bytes;
`scripts/diag/wasm-async.cjs compile`: `WebAssembly.compile(bytes).then(ok, bad)`, nothing else
pending (`out/rerun-wasm-async.txt`, verbatim):

```
--- pdfium compile
  node     exit 0: bytes 5298237 | compile: settled Module | exit event code 0
  exec     exit 0: bytes 5298237 | exit event code 0
  runCode  exit 0: bytes 5298237 | exit event code 0
```

Same in `exec` and `runCode` for `await WebAssembly.compile(bytes)` in an async function and for
`WebAssembly.instantiate(bytes, {})` (node: `rejected TypeError`, imports missing; guest: no line).
Equal to node: `instantiate(new WebAssembly.Module(bytes), {})` (`exec`, `runCode`); in `exec`
(`runCode` not run) sync `new WebAssembly.Module(bytes)`, the same compile with a `setInterval`
held until it settles, or with a 3 s `setTimeout` pending. Unsubscribed failing compile: pdfium cut by 1000 bytes → exit 1 with
`CompileError` (Data section length) in node, `exec` and `runCode`; when that error arises (before
or after the async work) is not timed. A 34-byte module: `compile`, `instantiate(bytes)`,
`instantiate(Module)` settle in `exec` and `runCode` as in node; an unsubscribed invalid compile
exits 1 in all three. Threshold between the sizes not measured.

On a library: `@hyzyla/pdfium@3.0.0` (CJS, PDFium in WASM, `WebAssembly.instantiate` per trace),
its README code → guest exit 0, stdout and stderr empty on all four probe PDFs; node prints the
text (`out/results-pdfium.txt`, rerun `out/rerun-summary-canonical.txt` `pdfium.cjs`). The same code with a
`setInterval` held around `PDFiumLibrary.init()` → text equal to node on all four
(`out/results-pdfium-keepalive.txt`, rerun `pdfium-keepalive.cjs`).

Danger: exit 0 + empty output reads as success with no result — an Emscripten module large enough
(threshold unknown; 34 bytes settles, 5.3 MB does not) whose init compiles asynchronously while
nothing else keeps the loop alive ends this way. mupdf 1.28.6 also calls `WebAssembly.instantiate`
(node trace), behind its ESM stop — not reached in the guest.

Browser hosts already count these requests: «Host-async Node API keepalive» ✅
(`docs/public/compat/process.md`, ADR-0529; `installHostAsyncKeepalive` holds
`WebAssembly.compile`/`instantiate` until settlement), installed by
`packages/workbench/src/workers/kernel-worker-entry.ts`,
`packages/workbench/src/workers/no-coi-toolchain-owner.ts` and
`packages/runtime-js/src/ipc/no-coi-child-worker.ts`. The isolate guest's `setUp`
(`packages/isolate-guest/src/guest/entry.ts`) does not call it. That this is the cause is visible
in code but not proven (no fixed build run). `docs/public/compat/isolate-host.md` has no row for
async WebAssembly.

Adjacent, same probe: `WebAssembly.compileStreaming`/`instantiateStreaming` are `undefined` in
the guest (`exec` and `runCode`), `function` in node — a silent absence, not a named gap
(`out/rerun-wasm-async.txt`, `out/rerun-streaming-names.txt`); browser hosts declare both ❌ as a
`NotImplementedError` ceiling (`docs/public/compat/process.md`). A pending 4 MiB
`Blob#arrayBuffer()` settles in `exec` and `runCode` as in node.

Dedup 2026-11-26: no backlog item, goal map or trap on async WebAssembly / host-async keepalive in
the isolate host (searched «keepalive», «WebAssembly», «host-async», «run ends», «exit 0»,
`instantiateStreaming`); no §Declined concepts row. Neighbours: `runtime-js/keepalive-residual-gaps` (browser
hosts' history of the same mechanism, ADR-0529); other surfaces:
`isolate-host-rejection-in-exit-listener-exits-0`, `isolate-host-unhandled-rejection-lost-to-gc`.
Owner: none assigned — no goal covers it. Trigger: the user's/manager's choice; also asked by
`distribution/isolate-host-pdf-text-extraction`.

## Challenge

challenge: 2026-11-26 — not run (factual capture)
