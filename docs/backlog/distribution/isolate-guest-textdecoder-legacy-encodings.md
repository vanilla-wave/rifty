---
area: distribution
status: draft
title: The isolate guest's TextDecoder throws for every label but utf-8, so pdfkit (fontkit) cannot load in the isolate host
created: 2026-11-25
why: Measured by the node:zlib goal's carrier — pdfkit 0.17.2 dies at load in the isolate host on `new TextDecoder('ascii')`, before any zlib call, so the zlib goal's unit 3 alone cannot turn its case 4 green on the isolate
user_story: As an agent running model-written code in the isolate host, I want `require('pdfkit')` to load as in Node, but today fontkit's module top level throws `NotImplementedError: Not implemented: isolate-host.TextDecoder(ascii) (only utf-8)`
sources: [packages/isolate-host/tests/zlib-scenario.test.ts, docs/backlog/runtime-js/zlib-node-acceptance-carrier.md]
code: [packages/isolate-guest/src/guest/text-codec.ts]
---

## Context

Finding, 2026-11-25, main dfad6553e. The node:zlib goal's case 4 (pdfkit 0.17.2
compressed pdf, `packages/isolate-host/tests/zlib-scenario.test.ts`) fails in the isolate host at
`fontkit/dist/main.cjs:5424` (loaded by `pdfkit/js/pdfkit.js:7`):
`NotImplementedError: Not implemented: isolate-host.TextDecoder(ascii) (only utf-8)`. Both
browser hosts get past this point and stop at `zlib.deflateSync`. The isolate guest's
`TextDecoder` (`text-codec.ts:128`) accepts only the utf-8 labels.

One `runCode` measurement (2026-11-25, Node v24.16.0; input bytes `68 69 e9 80`):

| label | Node v24.16.0 | isolate host |
|---|---|---|
| `utf-8` | `utf-8` `"hi�"` | same |
| `ascii`, `latin1`, `iso-8859-1`, `windows-1252` | `windows-1252` `"hié€"` | `NotImplementedError … isolate-host.TextDecoder(<label>) (only utf-8)` |
| `utf-16le` | `utf-16le` `"\u6968\u80e9"` | `NotImplementedError … TextDecoder(utf-16le)` |
| `utf-16be` | `utf-16be` `"\u6869\ue980"` | `NotImplementedError … TextDecoder(utf-16be)` |

Labels outside these were not measured (Node's full WHATWG table, `fatal` per encoding).

Dedup: no backlog item on the isolate `TextDecoder` labels. The draft goal
`epics/isolate-guest-web-api` (PR #443, not on main) covers URL, Blob, ES module files,
web streams and `TextDecoderStream`, but not `TextDecoder` labels; it is this item's likely owner
once it lands. Owner until then: distribution (isolate host). Trigger: unit 3 of
node-zlib-on-every-host (`runtime-js/zlib-node-lib-port`) merging, which leaves case 4 red on the
isolate at least for this reason (what fails after it is not measured).

## Challenge

challenge: 2026-11-25 — not run (factual capture)
