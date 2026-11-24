---
area: distribution
status: draft
title: exceljs `csv.writeBuffer` in an isolate sandbox has only a one-off probe line, no permanent test
created: 2026-11-24
why: PR #433 made stream subclass hooks run as in Node, and the isolate library probe then measured exceljs `wb.csv.writeBuffer()` once — same result type and byte length as Node, bytes not compared; no permanent test holds it, so a regression would go unseen.
sources: ["PR #433 (stream hook dispatch) review round 3", docs/backlog/distribution/reference/isolate-library-probe/README.md, docs/public/compat/isolate-host.md]
code: [docs/backlog/distribution/reference/isolate-library-probe/gen/diag-outputs.cjs]
---

## Context

Measured once, 2026-11-24 at `975238151` (PR #433 branch), Node v24.16.0:
`pnpm --filter @riftydev/isolate-host build && node docs/backlog/distribution/reference/isolate-library-probe/probe.mjs --json out.json`.
The probe lists only `gen/diag-outputs.cjs` lines that differ from real `node`; `exceljs csv.writeBuffer`
is no longer among them — the line prints result type and byte length only (Node:
`exceljs csv.writeBuffer: ok Uint8Array 3`, `results-npm-ci.json`), so the CSV bytes themselves were
not compared (before PR #433: `exceljs csv.writeBuffer: Error: Chunk must be one of type
String, Buffer or StringBuf.`, `reference/isolate-library-probe/results-npm-ci.json`). The probe is not
a test: it `npm ci`s from the registry and runs by hand. Stream-level parity
(`tools/node-parity-runner/cases/stream/stream-hook-*`) is permanent; the exceljs path is not.

Coupling (PR #433 review S3): the CSV write works because two gaps cancel — `writableObjectMode` is
ignored (`runtime-js/duplex-writable-surface-gaps`) and a byte-mode Writable admits fast-csv's row
arrays (`runtime-js/stream-byte-chunk-kinds`). Fixing the chunk check first breaks this path; the
permanent row is what would catch it.

Owner (assigned by the manager, PR #433 review round 3): the unit "`zlib`/`child_process`/
`worker_threads` load in the isolate" (`distribution/isolate-host-ceiling-modules-load`, not yet on
main; its exceljs test has no CSV row today). Trigger: that unit's real-exceljs test — it adds a
`csv.writeBuffer` row comparing bytes with Node's and deletes this item. Compat: isolate-host.md,
⚠️ document-libraries row (CSV write note).

## Challenge

challenge: 2026-11-24 — none (factual capture of a missing acceptance anchor)
