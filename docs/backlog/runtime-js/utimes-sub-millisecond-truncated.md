---
area: runtime-js
status: draft
title: fs.utimesSync drops sub-millisecond precision Node keeps
created: 2026-11-22
why: Node keeps sub-millisecond utimes times (100 ns measured on APFS); rifty cuts them to whole milliseconds, so `stat().mtimeMs` differs after `utimesSync`
user_story: As a developer running Node code in rifty, I want `fs.utimesSync(p, 1.0005, 1.0005)` to report `mtimeMs` 1000.499999 as in Node, but today rifty reports 1000
sources: [ADR-0567]
code: [packages/runtime-js/src/builtins/fs.ts, packages/vfs/src/memory-backend.ts]
---

## Context

Found during the external review of PR #418 (goal `isolate-host-fs-snapshot`).
No match in `docs/backlog` (`grep -rli utimes`: OPFS persistence, WASI
set-times and `runtime-js/fs-stats-atime-observability` — atime only — other
concerns). NaN and out-of-range values are not this item:
the sandbox goal's PR #419 aligns them with Node (`runtime-js/builtins/fs-times.ts`).

Probe 2026-11-22, `fs.utimesSync(f, 1.0005, 1.0005)` then `fs.statSync(f).mtimeMs`:

- Node v24.16.0 darwin-arm64 (APFS): `1000.499999`; with `1.0000001` s:
  `mtimeMs` `1000.0001`, `statSync(f, {bigint: true}).mtimeNs` `1000000100n`;
- rifty guest (isolate-guest bundle @ d95ccd2bf): `1000` (`toMs` =
  `Math.floor(n * 1000)`, `packages/runtime-js/src/builtins/fs.ts`; PR #419's
  `fs-times.ts` keeps it).

Linux not measured. Compat: `docs/public/compat/fs.md` `utimesSync` row.
Owner: runtime-js; trigger: a parity case or a program depending on
sub-millisecond times. The snapshot format keeps whatever time rifty stores
(f64, ADR-0567), so this is the runtime's precision only.

## Challenge

challenge: none — factual capture, no direction proposed
