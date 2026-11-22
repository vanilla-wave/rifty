---
area: runtime-js
status: draft
title: fs.utimesSync drops sub-millisecond precision Node keeps
created: 2026-11-22
why: Node stores utimes times to the microsecond; rifty cuts them to whole milliseconds, so `stat().mtimeMs` differs after `utimesSync`
user_story: As a developer running Node code in rifty, I want `fs.utimesSync(p, 1.0005, 1.0005)` to report `mtimeMs` 1000.499999 as in Node, but today rifty reports 1000
sources: [docs/backlog/epics/isolate-host-fs-snapshot/goal.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/vfs/src/memory-backend.ts]
---

## Context

Found during the external review of PR #418 (goal `isolate-host-fs-snapshot`).
No match in `docs/backlog` (`grep -rli utimes`: only OPFS persistence and WASI
set-times, other concerns). NaN and out-of-range values are not this item:
the sandbox goal's PR #419 aligns them with Node (`runtime-js/builtins/fs-times.ts`).

Probe 2026-11-22, `fs.utimesSync(f, 1.0005, 1.0005)` then `fs.statSync(f).mtimeMs`:

- Node v24.16.0 darwin-arm64: `1000.499999`;
- rifty guest (isolate-guest bundle @ d95ccd2bf): `1000`.

Linux not measured. The snapshot format keeps whatever time rifty stores
(f64, ADR-0567), so this is the runtime's precision only.

## Challenge

challenge: none — factual capture, no direction proposed
