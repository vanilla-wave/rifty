---
area: runtime-js
status: draft
title: fs.write and fs.writeSync by fd transfer only the written range on every host
created: 2026-11-25
why: In Workbench every fs.write/writeSync(fd) call reads the whole file and writes it back (fs.ts:424-441 writeBytesAt): 16 MiB written in 64 KiB calls takes 50–82 s, positional writes 114–199 s, against Node's 3–7 ms
epic: node-streams-as-in-node
sources: [docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/workbench-write.jsonl, docs/backlog/epics/node-streams-as-in-node/reference/results/chromium-fd/node-write.jsonl]
---

## Context

Unit 4c of goal node-streams-as-in-node (map), condition of ADR-0575 §3 for `fs.WriteStream` (9w).
Measured (Chromium 148, main `692babe13`, Workbench ephemeral / OPFS, 64 KiB calls, 3 runs, sha256 = Node's
on all 108): `fs.write`/`writeSync`/append 158–194 ms, 2.4–3.3 s, 50–82 s at 1/4/16 MiB; positional into a
16 MiB file 114–199 s; `writeFileSync` 389–652 ms and today's `createWriteStream` 518–824 ms at 16 MiB;
Node 3–7 ms. Per call ≈ 10 / 37 / 195 ms (whole-file read + splice + whole-file write). Unlike reads, no
range write exists in any layer (RPC, OPFS write-through, sync mirror).

Mechanism: a positional write on `FsSync`/`Vfs`. Explicit decision per implementation: memory (in
place, growing the store), OPFS (`SyncAccessHandle.write({ at })` + `truncate`/`flush` semantics as
`fsync`), relay/owner (a new range-write RPC; publication per call is
`perf/workbench-guest-write-cost-grows-with-project`'s), sync mirror (forwards), isolate (memory); any
other: a loud `NotImplementedError`. Acceptance as 4b by byte/RPC counters, append and positional rows
included, with the durability guard (`results/chromium/durability.jsonl`) kept green.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
