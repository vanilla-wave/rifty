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

Today's measurements. These are not the pins: the unit takes its own baseline when it is implemented
(Acceptance 2).

- In-process and isolate (`docs/backlog/epics/node-streams-as-in-node/reference/results/c-*.txt`, `summary.txt`): route A equals Node on 1/10 programs
  (`c-csv-write-file`). The probe kept only the first stderr line, ≤ 200 characters (`reference/run.mjs`), so its values are no pin.
- Chromium route A baseline (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium/`, main `c2d03ce05`): taken on an older program set without
  file hashes, and not the same outcomes as in-process. `c-transform-big`: in-process exit 0 with
  `maxInFlight<=1MiB false`, SDK the same, Workbench `timeout (180 s)`. The SDK run lacks `c-csv-write-file`.
- The 5 closure programs on Workbench with the closure in the guest's `/tmp`: 2/8 rows
  (`docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-c/route-a/`). Workbench has 5 of the 10 programs measured with their closure so far.

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

1. The 10 `c-*` programs run as CI cases in the isolate host (sandbox `exec`) against live Node on the same runner. Each case pins today's whole outcome: exit code, stdout, the whole stderr and the written output (sha256 or reloaded values). → I8
2. Pins reuse `Pin`/`pinOf`/`Mask`/`browserMasks` of `packages/isolate-host/tests/zlib-scenario.ts` (PR #453, on `main`): the whole stderr, rewritten only by narrow enumerated masks, each with its `why`. The unit takes the Chromium baseline itself from its first run; the probe's `results/` values are not pins. → I8
3. The same programs run in Chromium on the SDK (`tests/no-coi`, no-COI toolchain) and on Workbench (`tests/browser-unit`, closure in `/tmp` as above), pinned the same way. Each case names its owning unit from `docs/backlog/epics/node-streams-as-in-node/reference/results/ownership.txt`; a changed outcome turns it red. → I8
4. `c-transform-big` is not run on Workbench until 4b/4c land: today it times out at 180 s there. It is a declared skip naming `runtime-js/fs-fd-read-by-range` and `runtime-js/fs-fd-write-by-range`; it runs in the isolate and on the SDK. → I8
5. Cases are independent: each program gets its own sandbox (isolate), its own page and project directory (Workbench) or its own sandbox (SDK); no case reads state another case wrote. → I8
6. Lanes and time: the isolate cases run in `test:run`, the Workbench cases in `browser-unit-chromium` and the SDK cases in `no-coi-chromium`. Each lane grows by at most 2 min: PR #453's zlib carrier added about 1 min per lane, and the 5 Workbench closure programs take 11–12 s each. The PR records the measured growth per lane; over the limit, the unit splits the cases across shards rather than dropping any. → I8
7. `m1`–`m10`, `w1` and `b1` run in Chromium on both hosts as pinned rows, under the same pin rule and inside the same time limit, so later units have their Chromium baseline. → I8
8. The carrier runs once on the Chromium 108 floor (ADR-0469). The PR records the outcome, and a loading failure is pinned by name. → I8

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
- Pins: PR #453's whole-outcome pin with enumerated masks, not the probe's first-line text.
- `c-transform-big` on Workbench waits for 4b/4c, as a declared skip, instead of adding about 3 min to
  every CI run.
