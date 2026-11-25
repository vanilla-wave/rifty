---
area: runtime-js
status: draft
title: The node-streams goal's User scenario runs as cases against real Node in the isolate host and in Chromium, each pinning today's outcome
created: 2026-11-25
why: Acceptance carrier of goal node-streams-as-in-node; the scenario must exist as executable cases with named current outcomes before any stream code changes
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/goal.md, docs/backlog/epics/node-streams-as-in-node/reference/README.md, docs/backlog/epics/node-streams-as-in-node/reference/results/summary.txt]
code: [packages/isolate-host/tests/library-exceljs.test.ts, packages/isolate-host/tests/package-closure.ts]
---

## Context

Unit 0 of the goal (FIT 5). The `c-*` programs of the goal's `reference/programs/` are the
scenario. Each one runs with exceljs 4.4.0's closure laid out as `node_modules`, using the
`package-closure.ts` pattern. The runs are:

- real `node <program>`, live on the same runner;
- the isolate host sandbox `exec`;
- Chromium on both browser hosts (Workbench, SDK), compared with that live oracle's output.

Which e2e harness carries the browser hosts is this unit's to settle (map fog).

Each program is its own case and pins today's exact outcome by name. A bare `it.fails` is not
enough; follow `library-exceljs.test.ts:159`. A pin is the line, the exit status and the stderr.
The pins below come from the run at `8ec679b04` (main `b6d37fc01`'s code), in
`reference/results/c-*.txt`. "In-process" means rifty's modules in Node, with rifty's `Buffer`.
Chromium has not been run. Every case exits 0 unless noted.

| case | Node | rifty in-process | rifty isolate |
|---|---|---|---|
| exceljs `xlsx.readFile` → edit → `writeFile` | `readFile ok 120`, reload `999` | `readFile threw TypeError: stream.close is not a function` | same |
| exceljs `csv.readFile` | 4 rows | `TypeError: stream.close is not a function` | `NotImplementedError … isolate-host.ReadableStream` |
| graceful-fs write + read | `read "graceful\n"` | `TypeError: Class constructor FileWriteStream cannot be invoked without 'new'` | same |
| unzipper `Extract`, STORE zip | `a.txt=6000 dir/b.txt=15000` | `'close'` with nothing extracted, then the listing hits `ENOENT` | `extract error NotImplementedError … isolate-host.ReadableStream` |
| `for await` over `createReadStream` | `300000 5 d08928a16895` | `TypeError … is not async iterable` | same line; exit 1, stderr `isolate-host.ReadableStream` |
| late `'data'` listener | `200000` bytes, `end` | `0` bytes, no `end` | same line; exit 1, stderr as above |
| `on('readable')` + `read()` | `150000` bytes, `end` | `0` bytes, `end` | `0` bytes, no `end`; exit 1, stderr as above |
| 16 MiB → async Transform → WriteStream | `maxInFlight<=1MiB true`; stderr in-flight `65536` | `false`; stderr `16777216` | `ws error … isolate-host.ReadableStream` |
| `promises.pipeline` with an async generator | `200000 true` | `TypeError: pipeline: argument must be a stream (index 1 …)` | same line; exit 1, stderr as above |

The node:zlib joint cases (unzipper `Extract` on DEFLATE, the `createGzip` pipe) are not in this
carrier and not yet in the zlib carrier (`runtime-js/zlib-node-acceptance-carrier`, branch
`t3/zlib-engine-probe`, which holds unzipper `Open.buffer` and a piped `Parse`). They are proposed
for the zlib carrier via the manager.

## Challenge

challenge: 2026-11-25 — none (carrier of the goal; the premise is checked in goal §Challenge)
