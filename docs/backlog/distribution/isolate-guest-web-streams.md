---
area: distribution
status: draft
title: Web streams in the isolate guest (`ReadableStream` and the rest, `TextDecoderStream`/`TextEncoderStream`, `Blob.stream()`, `stream/web`) — candidate for a next goal
created: 2026-11-25
why: the 14 web-stream classes and the two text streams are ceiling throwers in the isolate guest; `stream/web.*` throws under another name; goals `isolate-guest-web-api` and `node-streams-as-in-node` both leave them out
sources: [docs/backlog/epics/isolate-guest-web-api/reference/sources-js/README.md, docs/backlog/epics/isolate-guest-web-api/reference/enumerate/README.md, docs/backlog/epics/isolate-guest-web-api/reference/today/README.md]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/runtime-js/src/builtins/stream-web.ts]
---

## Context

Manager decision 2026-11-25 (goal `isolate-guest-web-api` Decisions, question M2, reversible):
web streams in the isolate stay outside both goals; `Blob.prototype.stream()` and
`TextDecoderStream` are named gaps there.

Throws today (main bc3412420, Node v24.16.0): `new ReadableStream()` and the other ceiling classes
→ `NotImplementedError('isolate-host.<Class>')`; `require('stream/web').ReadableStream` (14 classes)
→ `NotImplementedError: stream/web.ReadableStream`, identity with the global lost (`enumerate` a2);
`stream/web.CompressionStream`/`DecompressionStream`/`ReadableStreamBYOBRequest` absent (every host
by source); `fs.createReadStream` reads until goal `node-streams-as-in-node` unit 9r
(`distribution/isolate-host-fs-read-stream-needs-web-readablestream`).

Known consumers: `Blob.prototype.stream()`; `Readable.toWeb`/`fromWeb`; the Fetch classes' bodies
(ADR-0541's `Response`/`Request`, not installed in the guest without `fetch`); exceljs read
paths only through `fs.createReadStream` (now 9r's). No measured consumer stop of the four document
libraries.

Source and size: a port of Node's `lib/internal/webstreams/*` verbatim measured in a bare isolate
(`reference/sources-js`, with events/abort): 169 KB min / 50 KB gzip, +5.4 ms per isolate, 0/55
stream cases differ; inside the real guest bundle not measured.

## Challenge

challenge: 2026-11-25 — not run (factual capture)
