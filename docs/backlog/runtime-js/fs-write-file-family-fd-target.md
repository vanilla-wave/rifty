---
area: runtime-js
status: draft
title: "`writeFile`/`appendFile` given a file descriptor instead of a path throw a non-Node TypeError"
created: 2026-11-26
why: "Node's `writeFile`/`appendFile` family takes a path or an fd (`isFd`); rifty sends the fd to its path operation, so a program that appends through an open fd fails where Node writes"
sources: ["PR #468 review round 3 (R3-1, manager-relayed, 2026-11-26)", docs/public/compat/fs.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/fs-arguments.ts]
---

## Context

Measured 2026-11-26, Node v24.16.0 vs PR #468 in-process (`fs.writeFileSync('a.txt', 'old')`,
then each through an fd opened before):

| call | Node | rifty |
|---|---|---|
| `fs.appendFile(fd /* 'a' */, 'new', cb)` | file `oldnew` | cb `TypeError: fs path must be string, Buffer, or URL` |
| `fs.writeFile(fd /* 'r+' */, 'W', cb)` | file `Wldnew` (written at the fd's position) | same TypeError |
| `fs.appendFileSync(fd, 'S')` | file `WldnewS` | throws the same TypeError |

Same on main `c2250727d` for `writeFile`/`appendFileSync` (main has no callback `appendFile`), so
not a regression of PR #468. `fs.promises.writeFile`/`appendFile` take a `FileHandle`, ❌ in
rifty (compat `fs.md`). Not in `fs-write-data-argument-types` (the data argument) nor
`fs-module-export-list` (missing exports). Compat `fs.md` row «Callback `fs.appendFile` / `fs.rm`».

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
