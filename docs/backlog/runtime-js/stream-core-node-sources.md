---
area: runtime-js
status: draft
title: node:stream is Node v24.16.0's own lib/stream.js, lib/stream/promises.js and lib/internal/streams/*.js, generated from the pinned tarball over rifty's bindings
created: 2026-11-25
why: rifty's hand-written stream core differs from Node on every lifecycle, member, Transform and pipeline row measured (m1 0/14, hook matrix 10/76, zlib-diff 26/45); Node's own files over the same modules equal Node there (route B)
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/summary.txt, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-zlib-diff.txt]
---

## Context

Unit 8 «Core» of goal node-streams-as-in-node; contract and acceptance: map item 8, ADR-0575.
Stands on units 1–3 and 7. Absorbs 21 drafts (map §Absorption); each one's repro is an acceptance row.
Entry criteria (map §Open questions, ADR-0575 §Open):
- the user's answer on the generic bundle cap;
- unit 7 (the isolate `AbortController`);
- `check:es-floor` and the Chromium 108 floor for `AbortSignal.any` and `Symbol.dispose`/`asyncDispose`.

The product-shape probe is done (`results/route-b-product-*.txt`). It moves `ServerResponse.write` to
Node's boolean (map §Regression risk).

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
