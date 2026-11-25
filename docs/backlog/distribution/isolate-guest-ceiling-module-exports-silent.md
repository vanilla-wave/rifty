---
area: distribution
status: draft
title: In the isolate guest some module exports of ceiling Web APIs are a silent `undefined` or throw under another name instead of the ceiling's named gap
created: 2026-11-25
why: `require('crypto').subtle` is `undefined` in a file run (named gap only under `-e`) and `require('stream/web').*` throws `stream/web.X` with no identity to the global — a gap that must be loud reads as absent or under the wrong name
sources: [docs/backlog/epics/isolate-guest-web-api/reference/enumerate/README.md, docs/backlog/runtime-js/isolate-web-globals-captured-at-load.md]
code: [packages/runtime-js/src/builtins/crypto.ts, packages/runtime-js/src/builtins/stream-web.ts, packages/isolate-guest/src/guest/web-shim.ts]
---

## Context

Probe `reference/enumerate` (2026-11-24, main 1c00c6292, Node v24.16.0; sandbox `exec` and
`runCode`): class a1 `crypto.subtle` — `undefined` in a file run, `isolate-host.crypto.subtle`
under `-e` (when `crypto` first evaluates: `crypto.ts:504` reads `webcrypto?.subtle` before the
ceiling getter); class a2 — the 14 `stream/web.*` classes throw `NotImplementedError: stream/web.<X>`
(not `isolate-host.<X>`) and are not `===` the global. Load-time reads rerun on main bc3412420
(`reference/today/results-trace-load.txt`): `crypto.ts:504`, `stream-web.ts:39` unchanged.

Dedup: `runtime-js/isolate-web-globals-captured-at-load` lists both rows inside its class (now goal
`isolate-guest-modern-code`, `URL`-focused); split out here because no goal takes them
(`isolate-guest-web-api` narrowed 2026-11-25; web streams: `distribution/isolate-guest-web-streams`).
Direction (measured in `reference/seam-esm`): read `subtle` at use, export the ceiling throwers
from `stream/web`. Compat: isolate-host.md row "Web globals absent when the runtime loads".

## Challenge

challenge: 2026-11-25 — not run (factual capture)
