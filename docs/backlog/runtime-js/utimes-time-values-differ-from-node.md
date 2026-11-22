---
area: runtime-js
status: draft
title: fs.utimesSync keeps NaN, out-of-range and truncated times Node normalises
created: 2026-11-22
why: rifty stores times Node never produces (NaN, beyond the Date range) and drops sub-millisecond precision Node keeps; such a tree also cannot be snapshotted (ADR-0567)
user_story: As a developer running Node code in rifty, I want `fs.utimesSync` to set the times Node would, but today a `new Date(NaN)` or a huge value is stored as is and fractions of a millisecond are cut
sources: [ADR-0567, docs/backlog/epics/isolate-host-fs-snapshot/goal.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/vfs/src/memory-backend.ts]
---

## Context

Found by the external review of PR #418 (goal `isolate-host-fs-snapshot`).
No match in `docs/backlog` (`grep -rli utimes`: only OPFS persistence and WASI
set-times, other concerns).

Probe 2026-11-22, `fs.utimesSync(f, v, v)` then `fs.statSync(f)`:

| `v` | Node v24.16.0 darwin-arm64 (`mtimeMs`, `mtime`) | rifty guest (isolate-guest bundle @ d95ccd2bf) |
|---|---|---|
| `new Date(NaN)` | the current time | `NaN`, `Invalid Date` |
| `Infinity` | `ERR_INVALID_ARG_TYPE` | `ERR_INVALID_ARG_TYPE` |
| `1e306` | 9223372036854.775 (clamped), a valid Date | non-finite, `Invalid Date` |
| `1e300` | 9223372036854.775 (clamped) | `1e+303`, `Invalid Date` |
| `1.0005` (s) | 1000.499999 | 1000 |

Linux not measured. Link: ADR-0567 refuses non-finite and out-of-Date-range
times at snapshot (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`); once rifty stores what
Node stores, an honest tree never hits that refusal.

## Challenge

challenge: none — factual capture, no direction proposed
