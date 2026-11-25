---
area: runtime-js
status: ready
title: The node-streams goal's User scenario runs as cases against real Node in the isolate host and in Chromium, each pinning today's outcome
created: 2026-11-25
why: Acceptance carrier of goal node-streams-as-in-node; the scenario must exist as executable cases with named current outcomes before any stream code changes
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/goal.md, docs/backlog/epics/node-streams-as-in-node/reference/README.md, docs/backlog/epics/node-streams-as-in-node/reference/results/summary.txt]
code: [packages/isolate-host/tests/library-exceljs.test.ts, packages/isolate-host/tests/package-closure.ts]
---

## Context

Unit 0 of goal `node-streams-as-in-node` (map). It turns the goal's scenario into executable cases,
pinned on today's outcome, before any stream code changes. The programs are the 10 `c-*` files of the
goal's `reference/programs/`. Each compares the files it writes by content: by sha256, or by the values
a reload reads.

Today's pins:

- In-process and isolate (`docs/backlog/epics/node-streams-as-in-node/reference/results/c-*.txt`, `summary.txt`): route A equals Node on 1/10 programs
  (`c-csv-write-file`). The rest are pinned by their line, exit status and stderr.
- Chromium, Workbench and SDK: the same outcomes (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium/`).
- The 5 closure programs on Workbench with the closure in the guest's `/tmp`: 2/8 rows
  (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-c/route-a/`).

Harness facts (also in `reference/README.md` §For executors):

- The closure comes from `packages/isolate-host/tests/closure-files.ts` `closureFiles('exceljs')`,
  5941 files.
- On Workbench, `tests/browser-unit/fixtures/zlib-scenario.ts` serves it (`serveSteps`) and unpacks it
  into `/tmp/<dir>` (`UNPACK`). A child `node` started from a project-root runner (`RUNNER`) runs the
  program. This takes 11–12 s per program.
- A plain `cd /tmp/x && node x.cjs` is refused with «package tree readiness is not published».
- Seeding the closure into the project root takes about 35 min (unit P's cost).
- The SDK runs through `createSandbox({ requireCrossOriginIsolation: false, toolchain })` and
  `project({ root }).run('node <file>')`. A COI page has no `node <file>` entry.

## Challenge

challenge: 2026-11-25 — clear (premise in goal §Challenge; this unit changes no behaviour)

## Acceptance

1. The 10 `c-*` programs run as CI cases in the isolate host (sandbox `exec`), against live Node on the same runner. Each case asserts today's outcome from `docs/backlog/epics/node-streams-as-in-node/reference/results/c-*.txt` (line, exit status, stderr) and names its owning unit from `docs/backlog/epics/node-streams-as-in-node/reference/results/ownership.txt`. A changed outcome turns the case red. → I8
2. The same 10 programs run in Chromium, each pinned on today's outcome: on Workbench, with the closure in `/tmp` as above (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-c/route-a/summary.txt`); on the SDK, with the no-COI toolchain (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium/summary.txt`). → I8
3. `m1`–`m10`, `w1` and `b1` run in Chromium on both hosts as pinned rows, so later units have their Chromium baseline. → I8
4. The carrier runs once on the Chromium 108 floor (ADR-0469). The outcome is recorded in the PR, and a loading failure is pinned by name. → I8

## Parity cases

1. Each `c-*` program runs against live Node v24.16.0 on the same runner. Compared: stdout lines, exit status, and the written files' sha256 or reloaded values. Command: `node <file>` in a directory holding the closure. → I8

## Out of scope

- Turning a case green: that is each owning unit's job.
- The DEFLATE `Extract` / `createGzip` joint cases, which belong to the zlib carrier.

## Decisions

- Closure on Workbench: the guest's `/tmp`, through PR #453's helpers. There is no edge to the
  publication-cost unit P.
- Hosts: isolate, Workbench (COI) and SDK (no-COI toolchain). The SDK on a COI page has no
  `node <file>` entry.
