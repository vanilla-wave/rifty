---
area: perf
status: draft
title: In the Workbench, every guest fs write costs time proportional to the project's file count
created: 2026-11-25
epic: node-streams-as-in-node
why: Measured while building the node:zlib goal's carrier — unpacking a 5945-file node_modules into a Workbench project did not finish in 300 s; the same files into `/tmp` of a small project unpack in 12 s
user_story: As a developer in the Workbench, I want a program that writes many files (an unpack, a generator, an install-like step) to run at fs speed, but today each write slows down linearly as the project grows, so a few thousand files take minutes
sources: [docs/backlog/perf/child-fs-write-publication-coalescing.md]
code: [packages/workbench/src/workers/workbench-project-vfs.ts, packages/workbench/src/glue/vfs-snapshot-port.ts]
---

## Context

A unit of goal `node-streams-as-in-node` (map, the write side). It has no other owner, and 9w stands on
it. It starts by establishing the cause; until then the body below is a hypothesis.


Finding, 2026-11-25, main dfad6553e, local macOS, Chromium (Playwright 1.60). Host: the
browser-unit sealed Workbench (`hidden-empty`, `persistence: 'ephemeral'`, after `npm install`).
A guest `node -e` writes 200 files of 1 KiB with `fs.writeFileSync` into each directory below,
in this order, in one project:

| target | ms per write |
|---|---|
| `/tmp/wc0` (project empty) | 1.65 |
| `wc/a` (project root) | 20.5 |
| `wc/b` (200 files already under the root) | 57.1 |
| `wc/c` (400) | 91.8 |
| `wc/node_modules/x` (600) | 118.7 |
| `/tmp/wc1` (800 under the root) | 77.1 |

Under the project root the per-write cost grows by ~0.18 ms for every 1 file already there
(`wc/a`→`wc/c`); `wc/node_modules/x` keeps growing. The last `/tmp` row (77.1 ms, lower than the row
before it, still ~47× the empty-project `/tmp`) is not explained. The first observation: carrier step 1's closure (5945 files, 34 MiB)
did not finish unpacking under the root in 300 s. Step 4 (867 files, 16.7 MiB) took 51 s
(mkdir 54 ms, write 57 ms on average). Into `/tmp` while the project stayed small (a few files), the 5945 files took 12 s; the carrier
unpacks into `/tmp/z<id>` and keeps the project small for this reason.

Where the time goes: not established, nothing was profiled. Consistent with a full owner publication
per mutation (`publishThroughCurrent(true)` → `collectSnapshot`, `workbench-project-vfs.ts`), a
walk of every non-excluded project file (`node_modules` is skipped by name at any depth,
`vfs-snapshot-port.ts:115`) — a hypothesis: the table does not single it out (the `node_modules`
and last `/tmp` rows are not what a pure walk predicts). Sibling item: `perf/child-fs-write-publication-coalescing`
(publication per 256 KiB chunk). Coalescing chunks would not remove a per-file walk.

Repro (ad-hoc, not committed): a browser-unit spec that boots the sealed Workbench as above and
per directory runs `node -e "…mkdirSync(dir,{recursive:true}); for 200: writeFileSync(dir+'/f'+i+'.js', Buffer.alloc(1024,1))"`,
timed with `Date.now()` inside the guest. No fault test: perf only, no lost write was seen.

## Challenge

challenge: 2026-11-25 — not run (factual capture)
