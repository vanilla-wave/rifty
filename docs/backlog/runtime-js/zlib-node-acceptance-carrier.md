---
area: runtime-js
status: draft
title: The node:zlib goal's User scenario runs step by step as parity cases against real Node in the isolate host and in Chromium, each pinning today's outcome
created: 2026-11-24
why: Acceptance carrier of goal node-zlib-on-every-host — the scenario must exist as executable cases with named current outcomes before any engine code lands
epic: node-zlib-on-every-host
sources: [docs/backlog/epics/node-zlib-on-every-host/goal.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md]
code: [packages/isolate-host/tests/library-exceljs.test.ts, packages/isolate-host/tests/package-closure.ts]
---

## Context

Unit 1 of the goal (FIT 5). One program per scenario step (goal §User scenario 1–7) plus its
library closure laid out as `node_modules` (the `package-closure.ts` pattern of
`library-exceljs.test.ts`), run by real `node <step>.js` live on the same runner (on the Linux x64
CI runner that is x64 Node; committed macOS digests would not observe x64) and by the isolate host
sandbox; and in Chromium on both browser hosts (Workbench, SDK) against that live oracle's output.
Each output file and stdout is compared byte for byte (clock frozen inside the step; gzip OS byte per
goal Decisions). Which existing e2e harness carries the two browser hosts is this unit's to settle.

Each step is its own case and pins today's exact outcome by name, as `library-exceljs.test.ts:159`
does — not a bare `it.fails`. Expected pins on main (confirmed by the first run; isolate names follow
`isolate-host.zlib.<member>`; only step 1's isolate pin is run today):

| step | first zlib call | isolate today | browser host today |
|---|---|---|---|
| 1 exceljs `WorkbookWriter` | `class extends zlib.DeflateRaw` | `isolate-host.zlib.DeflateRaw` | `zlib.DeflateRaw` |
| 2 unzipper `Open`/`Parse` | `zlib.createInflateRaw` | `isolate-host.zlib.createInflateRaw` | `zlib.createInflateRaw` |
| 3 pngjs `PNG.sync.write` / `.read` | `zlib.deflateSync` / `zlib.Inflate.call(this)` | `isolate-host.zlib.deflateSync` / `isolate-host.zlib.Inflate` | `zlib.deflateSync` / `TypeError: Class constructors cannot be invoked without 'new'` |
| 4 pdfkit + `inflateSync` of its streams | `zlib.deflateSync` | `isolate-host.zlib.deflateSync` | `zlib.deflateSync` |
| 5 `gunzipSync` of 2 members; `unzip` | `zlib.gunzipSync`; `zlib.unzip` | `isolate-host.zlib.gunzipSync`; `isolate-host.zlib.unzip` | `zlib.gunzipSync`; `zlib.unzip` |
| 6 ws `PerMessageDeflate` | `zlib.createDeflateRaw` | `isolate-host.zlib.createDeflateRaw` | `zlib.createDeflateRaw` |
| 7 `crc32`; callback `inflate` of a corrupt buffer | `zlib.crc32`; `zlib.inflate` | `isolate-host.zlib.crc32`; `isolate-host.zlib.inflate` | `zlib.crc32`; a `TypeError` with Node's `code` but not its message |

Green after unit 2: steps 3, 4, 5's `gunzipSync`, 7's `crc32`. After unit 3: 1, 2, 5's `unzip`, 6,
7's callback `inflate`. Probe evidence that each step gives Node's bytes on the engine:
`results/consumers.txt` (5/5 under Node's own `lib/zlib.js`).

Inputs: exceljs 4.4.0 (isolate-host devDependency) with its unzipper 0.10.14, and ws 8.23.0
(transitively), are in the lockfile; pdfkit 0.17.2 and pngjs 7.0.0 are the probe's
(`consumer-scenarios.cjs`), to be added as test devDependencies.

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); re-cut 2026-11-24 after the external review's B1.
