---
area: runtime-js
status: ready
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

Pins on main, measured for each case's first zlib call (`results/browser-pins.txt`: rifty's browser-host
`zlib.ts` bundled into a dedicated Worker of Chromium 148, and the isolate host's `runCode`); the full
library runs confirm them in this unit:

| case | first zlib call | isolate today | browser host today (Chromium 148 Worker) |
|---|---|---|---|
| 1 exceljs `WorkbookWriter` | `class extends zlib.DeflateRaw` | `NotImplementedError` `isolate-host.zlib.DeflateRaw` | `NotImplementedError` `zlib.DeflateRaw` |
| 2 unzipper `Open`/`Parse` | `zlib.createInflateRaw` | `… isolate-host.zlib.createInflateRaw` | `… zlib.createInflateRaw` |
| 3w pngjs `PNG.sync.write` | `zlib.createDeflate` (`new PNG()` → Packer; the probe called `deflateSync` directly) | `… isolate-host.zlib.createDeflate` | `… zlib.createDeflate` |
| 3r pngjs `PNG.sync.read` | `zlib.Inflate.call(this)` | `… isolate-host.zlib.Inflate` | `TypeError: Class constructors cannot be invoked without 'new'` |
| 4 pdfkit + `inflateSync` of its streams | `zlib.deflateSync` (isolate: none — fontkit's load throws first) | `NotImplementedError` `isolate-host.TextDecoder(ascii) (only utf-8)` (`distribution/isolate-guest-textdecoder-legacy-encodings`) | `… zlib.deflateSync` |
| 5a `gunzipSync` of 2 members | `zlib.gunzipSync` | `… isolate-host.zlib.gunzipSync` | `… zlib.gunzipSync` |
| 5b `unzip(cb)` | `zlib.unzip` | `… isolate-host.zlib.unzip` | `… zlib.unzip` |
| 6 ws `PerMessageDeflate` | `zlib.createDeflateRaw` | `… isolate-host.zlib.createDeflateRaw` | `… zlib.createDeflateRaw` |
| 7a `crc32` | `zlib.crc32` | `… isolate-host.zlib.crc32` | `… zlib.crc32` |
| 7b callback `inflate` of a corrupt buffer | `zlib.inflate` | `… isolate-host.zlib.inflate` | `TypeError: The compressed data was not valid: invalid code -- missing end-of-block.` (no `code`; Node: `Error` `Z_DATA_ERROR` `invalid code -- missing end-of-block`) |

The full library runs (this unit, `zlib-scenario` tests) corrected rows 3w and 4 above. Host
specifics on top of the error, pinned per host: the Workbench prints step 1's error as
`Uncaught … (<source>)`; on the SDK every step but 3r and 7b ends `status: 'failed'`, exit code
null (step 1 with no error line on stderr, only `Worker crashed: Uncaught …`;
`distribution/no-coi-command-unhandled-rejection-exit`), where an uncaught throw in Node exits 1.

Probe evidence that each step gives Node's bytes on the engine: `results/consumers.txt` (5/5 under
Node's own `lib/zlib.js`).

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge) and the external review rounds of PR #448

## Acceptance

1. Isolate host: one case per row of the pin table (1, 2, 3w, 3r, 4, 5a, 5b, 6, 7a, 7b), each running the step's program through the sandbox over the same files
   as a live `node` oracle on the same runner, each asserting today's exact outcome (error class and
   message, exit code, stdout) — not a bare `it.fails` → scenario, I1, I5
2. Browser hosts: the same cases in Chromium on the Workbench and on the SDK, through whichever
   existing e2e harness carries both (settled here), against the oracle's output produced on the same
   runner → scenario, I1
3. Every output file and stdout of a step compares byte for byte with the oracle once green; the clock
   is frozen inside the step; a gzip OS byte is compared as goal Decisions say → I2, I5
4. Each case names the unit that turns it green: all ten are expected green after unit 3
   (`runtime-js/zlib-node-lib-port`), except case 4 on the isolate host: it stays red there at least
   because of `TextDecoder('ascii')`, not zlib (what fails after it is not measured) (`distribution/isolate-guest-textdecoder-legacy-encodings`).
   Unit 2 turns none green (no guest surface). Any other case still red after unit 3 is the measured
   wall that keeps unit 4 (`runtime-js/zlib-streams-under-load`) → scenario
5. pdfkit 0.17.2 and pngjs 7.0.0 enter as exact test devDependencies; exceljs 4.4.0, unzipper 0.10.14
   and ws 8.23.0 from the lockfile → scenario

## Parity cases

Oracle: Node v24.16.0, live on the runner, same files; error texts compared whole.

1. Case 1 — exceljs 4.4.0 streaming `WorkbookWriter` (5000 rows, shared strings, frozen clock) → the
   xlsx bytes (`results/consumers.txt`: 111420 B) → I5
2. Case 2 — unzipper 0.10.14 `Open.buffer` and piped `Parse` of that xlsx → each entry's path and
   bytes → I5
3. Case 3w — pngjs 7 `PNG.sync.write` of a 300×200 image → file bytes → I2, I5
4. Case 3r — `PNG.sync.read` of that file → pixel bytes (round trip) → I4, I5
5. Case 4 — pdfkit 0.17.2 compressed document (40 text lines, frozen `CreationDate`) → bytes; each
   FlateDecode stream cut up to `endstream` (EOL kept) → `inflateSync` output → I2, I5
6. Case 5a — `gunzipSync` of two members → their concatenation → I2
7. Case 5b — `unzip(cb)` of gzip and of zlib input → the inflated bytes → I2
8. Case 6 — ws 8.23.0 `PerMessageDeflate` server/client (`serverMaxWindowBits: 10`,
   `clientMaxWindowBits: 11`): 4 messages with and without `fin` → compressed and decompressed bytes → I5
9. Case 7a — `crc32` of every file written → Node's values → I1
10. Case 7b — callback `inflate` of a corrupt buffer → Node's `Error`, `code` `Z_DATA_ERROR`, `errno`
    −3, message `invalid code -- missing end-of-block` → I3

## Out of scope

- Brotli and zstd in any step (manager's scoping, user confirmation pending).
- Windows and macOS Node as oracle on CI (no lane; goal Decisions); Firefox/WebKit (ADR-0469).
- Making any case green: unit 3 (and unit 4 if a wall remains).

## Decisions

- 2026-11-24 — manager: one case per step, each pinning today's named outcome, as `library-exceljs.test.ts:159` does.
- The oracle is live on the runner, never committed digests (goal Decisions, x64 residual).
- 2026-11-25 — harness (map fog, owner: agent): Workbench = `tests/browser-unit` (sealed Workbench
  fixture, COI); SDK = `tests/no-coi` (`createSandbox`). This is the ADR-0571 `node-file-parity`
  pair, accepted by the manager. No new harness.
- 2026-11-25 — inputs: the Node oracle produces steps 2, 3r and 7a's inputs (outputs of steps 1, 3w,
  4) and 5a, 5b, 7b's inputs (`inputs.js`) on the runner. Every host runs a step over the oracle's files.
- 2026-11-25 — browser hosts: a step's workspace (full closure) reaches the guest as one routed
  body, unpacked by a guest `node`. On the Workbench it is unpacked to `/tmp/z<id>`, out of the
  project tree, so the project stays small (a guest write's cost grows with the project's file
  count, `perf/workbench-guest-write-cost-grows-with-project`), accepted by the manager.
- 2026-11-25 — no gzip output in any step (zip raw deflate, zlib png/pdf, ws raw), so the gzip
  OS-byte rule has nothing to compare; Node's `.gz` inputs are inputs only.
