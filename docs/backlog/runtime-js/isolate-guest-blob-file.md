---
area: runtime-js
status: draft
title: The isolate guest's `Blob` and `File` are Node 24's, and `buffer.Blob`/`buffer.File` are the same objects
created: 2026-11-24
why: both are ceiling throwers; `require('buffer').Blob` is `undefined` (captured at load), so `pptx.write()` (a Blob by default) and `docx Packer.toBlob` fail where Node returns a Blob
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/reference/sources-native/README.md, docs/backlog/distribution/reference/isolate-library-probe/README.md]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/runtime-js/src/builtins/buffer.ts]
---

## Context

Probe `sources-native` (2026-11-24, Node v24.16.0): Node's `lib/internal/blob.js` (14 KB) and
`file.js` (3 KB) are JS over a C++ byte store (`internalBinding('blob')`: `createBlob`, `concat`,
`getReader`). No npm candidate passes: `formdata-node` 6.0.3 differs on 9/19 cases (`text()` needs
`ReadableStream`, no `endings`/`bytes()`, type not lower-cased), `blob-polyfill` 13/19,
`fetch-blob` 4.0.0 does not bundle as an IIFE. Node-only behaviour to keep: `endings: 'native'`
leaves a lone `\r`. Direction: Node's files generated over a JS byte store (ADR-0541 pattern);
`stream()` needs the web-streams unit. Compat ❌ isolate-host.md ceiling row.

`Blob.stream()`: Node's under goal question 1 (b) (web streams in scope); under (a) it throws the
`ReadableStream` named gap (`NotImplementedError('isolate-host.ReadableStream')`), compat ❌.
