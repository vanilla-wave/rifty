---
area: runtime-js
status: draft
title: fs.ReadStream is Node v24.16.0's from lib/internal/fs/streams.js over the core, reading by fd on every host
created: 2026-11-25
why: Today's fs.ReadStream is a hand-written EventEmitter (no for await, a late listener reads nothing, isolate fails at the first read); Node's over route B's core equals Node on the read rows
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/m4-readstream.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-9r/c-for-await.txt]
---

## Context

Unit 9r (map). Stands on 8c (8a–8c), 1, 4, 4b and 7 (map §Row ownership). In Workbench, `for await`
over 16 MiB on route B takes 21 s, against Node's 11 ms (`results/chromium-d/`): that is the 4b edge. The file holds both classes; it is loaded whole and only
`ReadStream`/`createReadStream` are wired, `fs.WriteStream` stays today's class until 9w. Measured in-process (product bindings, today's WriteStream; `results/route-b-9r/`):
- carrier 8/10 programs = Node;
- `c-graceful-fs` fails on today's write class exactly as today;
- `c-unzip-stored` changes in this window, declared and pinned: today it exits 0 with a silently
  empty directory; on 9r it exits 1 with `TypeError: Class constructor FileWriteStream cannot be
  invoked without 'new'`;
- `c-transform-big` through today's WriteStream keeps Node's backpressure (in-flight 65536).

The window rows are in map §Regression risk.
Acceptance: `m4` and the read rows of `m2`/`m3` = Node on every host; carrier read programs = Node;
PR #437's cases; the isolate `ReadableStream` wall gone (absorbs #437, conditional).

## Open findings (review round 4)

Carried verbatim from the manager's review of PR #450, round 4 (2026-11-25); owner = this unit. They close when the unit is taken into work, by its own contract and review.

- B5 (owner 9r): «… окно 9r: `c-unzip-stored`, m3 `instanceof Stream`. Формула: «закреплены на исходе своего окна (колонка окна), изменения относительно сегодняшнего перечислены и объявлены»».
- B4 (owner 9w, 9r): «правило не учитывает тики таймера (B4: `createWriteStream`/fd 256×64 KiB с `setInterval(0)` — Node `true`, сегодня in-process `true`, B `false` → **ребро 9w ← 4 реально, верни**; Workbench read stream тоже нуждается в 4)».

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
