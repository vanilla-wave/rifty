---
area: runtime-js
status: draft
title: node:stream runs Node v24.16.0's generated stream core: wired, internal consumers moved, the hand-written core removed
created: 2026-11-25
why: rifty's hand-written stream core differs from Node on every lifecycle, member, Transform and pipeline row measured (m1 0/14, hook matrix 10/76, zlib-diff 26/45); Node's own files over the same modules equal Node there (route B)
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/summary.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-zlib-diff.txt]
---

## Context

Unit 8c «Core wiring» of goal node-streams-as-in-node (map item 8c, ADR-0575 §7). Stands on 8a, 8b, the
bindings 1–2 and 7 (the isolate's pipeline rows; `results/ownership.txt`).

Scope:
- wire the generated core into `@riftydev/io` and `node:stream`;
- move the internal consumers: `ServerResponse.write` → `false` + `'drain'`; the stream shape that
  `finished(req.socket)` needs; io's `onDestroy`;
- remove the hand-written `packages/io/src/streams`, its unit tests and ADR-0353's callable
  constructors.

Acceptance:
- 8b's rows stay green;
- plain-stream rows of `m1`–`m3`, `m6`–`m8` and the hook matrix = Node in the isolate and Chromium;
- parity `cases/stream` 66/66 and each absorbed draft's repro (map §Absorption, 21 drafts);
- `check:es-floor` lists extended with `AbortSignal.any`, `Symbol.dispose`/`asyncDispose` and
  `Promise.withResolvers`, and/or the Chromium 108 lane on those rows;
- identifier renaming changes 0 of 105 parity cases (`results/route-b-minify.txt`). The earlier
  1/105 (`stream/from-web-options`) named Node's `signal` in `abort_listener`, which is now 8a's
  binding. A guard row runs `from-web-options` on the Workbench consumer bundle.

zlib unit 3 starts after this unit.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
