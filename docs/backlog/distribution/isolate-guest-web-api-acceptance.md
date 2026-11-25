---
area: distribution
status: draft
title: The isolate-guest-web-api scenario — pptxgenjs `write()`, docx `Packer.toBlob`, pdfkit's built-in font — runs as sandbox cases against live `node`, committed RED
created: 2026-11-24
why: the goal's acceptance carrier; today the three generators stop at `blob is not supported by this platform`, `isolate-host.Blob` and `isolate-host.TextDecoder(ascii) (only utf-8)`
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/goal.md, docs/backlog/epics/isolate-guest-web-api/reference/today/README.md, docs/backlog/distribution/reference/isolate-library-probe/README.md]
code: [packages/isolate-host/tests]
---

## Context

Goal `isolate-guest-web-api` §User scenario as three `packages/isolate-host/tests` cases,
`it.fails` (RED) before any wall is fixed: the generators run in a sandbox over a `node_modules`
closure (the library probe's way, or `tests/closure-files.ts` / `zlib-scenario.test.ts`) and as
`node <file>` in a temp dir over the same files — stdout, stderr, exit code, output files (OOXML
timestamps masked as the library probe does). pdfkit's case asserts, while the zlib goal is open,
the stop the browser hosts give (`zlib.deflateSync`), and Node's output after it.

Today (`reference/today`, main bc3412420, Node v24.16.0): `pptx.write()` → `Error: blob is not
supported by this platform` (`jszip/lib/utils.js:378`), `Packer.toBlob` →
`NotImplementedError: isolate-host.Blob` (`docx/dist/index.cjs:23940`), pdfkit →
`NotImplementedError: isolate-host.TextDecoder(ascii)` (`fontkit/dist/main.cjs:5424`); Node exit 0
for all three.
