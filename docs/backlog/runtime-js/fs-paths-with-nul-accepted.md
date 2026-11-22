---
area: runtime-js
status: draft
title: node:fs accepts paths with NUL bytes Node refuses
created: 2026-11-22
why: Node throws ERR_INVALID_ARG_VALUE for a path containing \0; rifty creates the file, and such a name cannot be snapshotted (ADR-0567)
user_story: As a developer running Node code in rifty, I want a path with a NUL byte to throw as in Node, but today rifty creates a file named with it
sources: [ADR-0567, docs/backlog/epics/isolate-host-fs-snapshot/goal.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-path.ts]
---

## Context

Found by the external review of PR #418 (goal `isolate-host-fs-snapshot`).
No match in `docs/backlog` (`grep -rli 'null byte'`: none).

Probe 2026-11-22, `fs.writeFileSync(dir + '/a\0b', 'x')`:

- Node v24.16.0 darwin-arm64: `ERR_INVALID_ARG_VALUE`;
- rifty guest (isolate-guest bundle @ d95ccd2bf): succeeds; `readdirSync`
  lists `"a\u0000b"`.

Other `node:fs` entry points not probed. Link: ADR-0567 refuses a NUL in a
name at snapshot (`ERR_FS_SNAPSHOT_UNREPRESENTABLE`); once rifty refuses such
paths like Node, an honest tree never hits that refusal.

## Challenge

challenge: none — factual capture, no direction proposed
