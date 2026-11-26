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

Unit 9w (map). Stands on 8c, 4, 4c, 5 and `perf/workbench-guest-write-cost-grows-with-project` (map
§Row ownership); after 9r by order only. Node's
`WriteStream` issues one `fs.write`/`writev` per chunk where today's class writes once per burst, so
on Workbench it multiplies per-write publication cost (16 MiB = 256 writes). Measured in Workbench
(`results/chromium-d/`): route B 16 MiB writes in 46.5 s (today 488 ms), and in a 1000-file project
they hit the 900 s cap (today 7.75 s). Acceptance: `m5` and the
write rows of `m2`/`m3` = Node on every host; carrier write programs (`c-graceful-fs`,
`c-unzip-stored`, `c-xlsx-roundtrip` write half) = Node; the 16 MiB stream on Workbench within a small
factor of today's 518 ms in a project with many files; the durability guard; PR #434's cases.

## Open findings (PR #469 external review)

- Today's class hands the store its own image (`persist()` → `writeFileSync(np, this.bytes)`), and a
  later in-range write (`r+`, `start`) overlays `this.bytes` in place: the store's bytes change before
  the next flush, with no write call (no mtime bump; a reader of the store sees it first). Measured
  2026-11-26 (`r+`: write `XY`, then in its callback write `Z` and `readFileSync` at once): Node v24.16.0
  `XYZdef` 20/20, rifty in-process `XYZdef` — no divergence found from a program yet. Node's fd-backed
  class writes through `fs.write`, which closes it by construction (owner: this unit).

## Open findings (review round 4)

Carried verbatim from the manager's review of PR #450, round 4 (2026-11-25); owner = this unit. They close when the unit is taken into work, by its own contract and review.

- S7 (owner 9w): «9w упоминает «c-xlsx write half», а строки xlsx у 9r».
- S8 (owner 9w): «критерий 9w «within a small factor of today's 518 ms» неисполним: в проекте на 1000 файлов сегодня 7,75 с».
- B4 (owner 9w, 9r): «правило не учитывает тики таймера (B4: `createWriteStream`/fd 256×64 KiB с `setInterval(0)` — Node `true`, сегодня in-process `true`, B `false` → **ребро 9w ← 4 реально, верни**; Workbench read stream тоже нуждается в 4)».
- nit (owner 9w): ««9w stands on 9r» — артефакт «последнего владельца», зависимости кода нет: запиши как порядок, не как зависимость».

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
