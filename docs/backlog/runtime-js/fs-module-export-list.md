---
area: runtime-js
status: draft
title: The fs and fs.promises export lists miss Node's functions silently (fs.chmod is undefined)
created: 2026-11-26
why: "`require('fs').chmod(…)` is `TypeError: … is not a function` on every host: a member Node v24.16.0 exports reads `undefined`, no named gap (AGENTS §Fidelity)"
sources: ["PR #468 (runtime-js/fs-callbacks-io-turn) export sweep, manager-relayed review of PR #469", docs/backlog/net/http-module-export-list.md]
code: [packages/runtime-js/src/builtins/fs.ts]
---

## Context

Observed 2026-11-26. Node v24.16.0:
`node -e "const fs=require('fs');console.log(Object.keys(fs).filter(k=>typeof fs[k]==='function'&&!/Sync$/.test(k)&&!/^[A-Z]/.test(k)).join(' '))"`.
rifty is the default export of `packages/runtime-js/src/builtins/fs.ts`, the module registered as `fs`, on PR #468's
tree (`tsx` import), which adds `appendFile` and `rm`.
`typeof` reads `undefined` for:

- **a sync form already exists** (a two-line wrapper over it): `rmdir`, `utimes`, `lutimes`, `cp`,
  `exists` (its callback takes a boolean);
- **no sync form in rifty**: `chmod`, `chown`, `fchmod`, `fchown`, `lchmod`, `lchown`, `fsync`,
  `fdatasync`, `readv`, `writev`, `statfs` (`statfsSync` is a loud member), `glob`, `_toUnixTimestamp`;
  `writev`/`fsync`/`fdatasync` (and their Sync forms) are unit 5 of goal `node-streams-as-in-node`
  (`runtime-js/fs-writev-fsync`);
- **`fs.promises`** (same filter over `Object.keys(fs.promises)`): `open` (`FileHandle` is compat ❌,
  `docs/public/compat/fs.md`), `glob`, `statfs`, `chmod`, `lchmod`, `lchown`, `chown`,
  `mkdtempDisposable`, `watch`.

Not re-measured per host; `fs` is one runtime-js module in every host's guest. Same class
as `net/http-module-export-list` (`node:http`). Dedup: no other backlog, trap or declined-concept
match. Done would read: `Object.keys` of `fs` and `fs.promises` against Node: the difference
is empty or each entry is listed; every function works or throws `NotImplementedError` with
compat ❌; no silent `undefined`.

## Challenge

challenge: 2026-11-26 — finding capture; no premise critic (README §Challenge)
