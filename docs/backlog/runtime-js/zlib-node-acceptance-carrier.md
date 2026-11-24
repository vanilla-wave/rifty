---
area: runtime-js
status: draft
title: The node:zlib goal's User scenario runs as a RED parity case against real Node in the isolate host and in Chromium
created: 2026-11-24
why: Acceptance carrier of goal node-zlib-on-every-host — the scenario must exist as an executable expected-failure before any engine code lands
epic: node-zlib-on-every-host
sources: [docs/backlog/epics/node-zlib-on-every-host/goal.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md]
code: [packages/isolate-host/tests/library-exceljs.test.ts, packages/isolate-host/tests/package-closure.ts]
---

## Context

Unit 1 of the goal (FIT 5). One `main.js` + inputs (goal §User scenario 1–7), its library closure
laid out as `node_modules` (the `package-closure.ts` pattern of `library-exceljs.test.ts`), run:

- by real `node main.js` (oracle) and by the isolate host sandbox `exec('main.js')` — every output
  file and stdout compared byte for byte (clock frozen inside `main.js`);
- in Chromium on a browser host over the same files — the e2e lane, same comparison against the
  oracle's committed digests or a live oracle run.

Committed RED (`it.fails` / expected-failure) with the failure each host gives on main: the isolate
stops at `isolate-host.zlib.DeflateRaw` (row in `library-exceljs.test.ts` today); the browser host is
expected to stop at `zlib.DeflateRaw` (`NotImplementedError`; not run — recorded by the carrier's
first run). Probe evidence that the same program gives Node's bytes on
an engine: `results/consumers.txt` (5/5 for pako 3.0.3 and the wasm build under Node's `lib/zlib.js`).

Inputs: exceljs 4.4.0 (isolate-host devDependency) with its unzipper 0.10.14, and ws 8.23.0
(transitively), are in the lockfile; pdfkit 0.17.2 and pngjs 7.0.0 are the probe's
(`consumer-scenarios.cjs`), to be added as test devDependencies. Hosts: isolate sandbox, Workbench (COI) and SDK (no-COI) — which browser lane
runs it is this unit's to settle (open question in the map).

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); findings 3, 5, 6, 12 touched these drafts and are fixed.
