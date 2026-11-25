---
area: runtime-js
status: draft
title: fs.WriteStream is Node v24.16.0's from lib/internal/fs/streams.js over the core, writing by fd on every host
created: 2026-11-25
why: Today's fs.WriteStream is a hand-written EventEmitter: graceful-fs/fstream/unzipper throw on WriteStream.apply(this); Node's class needs range writes, writev/fsync and cheap publication to not regress Workbench
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/m5-writestream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/workbench-write.jsonl]
---

## Context

Unit 9w (map). Stands on 8, 4, 4c, 5 and `perf/workbench-guest-write-cost-grows-with-project`. Node's
`WriteStream` issues one `fs.write`/`writev` per chunk where today's class writes once per burst, so
on Workbench it multiplies per-write publication cost (16 MiB = 256 writes). Acceptance: `m5` and the
write rows of `m2`/`m3` = Node on every host; carrier write programs (`c-graceful-fs`,
`c-unzip-stored`, `c-xlsx-roundtrip` write half) = Node; the 16 MiB stream on Workbench within a small
factor of today's 518 ms in a project with many files; the durability guard; PR #434's cases.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
