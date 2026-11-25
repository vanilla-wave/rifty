---
area: runtime-js
status: draft
title: "Hypothesis: node:zlib's streams need more than unit 3 to behave as Node's under load — kept only if the carrier's run after unit 3 measures a wall"
created: 2026-11-24
why: Node's processCallback defers engine writes on a full readable buffer and its event order is observable; whether rifty needs a unit for it after unit 3 is unmeasured
epic: node-zlib-on-every-host
sources: [docs/backlog/runtime-js/transform-readable-backpressure.md, docs/backlog/runtime-js/duplex-end-finish-close-order.md, docs/backlog/runtime-js/reference/zlib-engine-probe/README.md]
code: [packages/runtime-js/src/builtins/zlib.ts, packages/io/src/streams/transform.ts]
---

## Context

Unit 4 of the goal — a hypothesis, not a contract (manager 2026-11-24, round 3). It exists only if the
carrier's run after unit 3 shows a measured wall under load (backpressure, destroy mid-write, event
order); otherwise this item is deleted — a unit without a measured wall is machinery.

What hints at one today: `zlib-diff.mjs`'s load group (5 MB through a deflate stream with
`highWaterMark: 1024` and a paused consumer) differs on main by one `'drain'` (rifty 1, Node 0); compat
`streams.md` lists `runtime-js/transform-readable-backpressure` and
`runtime-js/duplex-end-finish-close-order`. A delegate's run (round 3 review) of Node's verbatim
`lib/zlib.js` over rifty's `Transform` gave Node's output for exceljs, unzipper, pngjs and pdfkit.

## Challenge

challenge: 2026-11-24 — reuses the goal's FIT challenge (goal.md §Challenge); marked a hypothesis by round 3 of the external review of PR #448
