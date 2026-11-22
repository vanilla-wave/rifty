---
area: vfs
status: draft
title: rifty's FS accepts file names Node refuses with ENAMETOOLONG
created: 2026-11-22
why: a Node program that hits NAME_MAX gets ENAMETOOLONG; in rifty the same call succeeds, and such a name also cannot be snapshotted (ADR-0567 caps names at 16 383 code units)
user_story: As a developer running Node code in rifty, I want a too-long file name to fail with ENAMETOOLONG as in Node, but today rifty creates it
sources: [ADR-0567, docs/backlog/epics/isolate-host-fs-snapshot/goal.md, docs/public/compat/isolate-host.md]
code: [packages/vfs/src/memory-backend.ts, packages/runtime-js/src/builtins/fs.ts]
---

## Context

Found in the Final+GREEN review of PR #418 (goal `isolate-host-fs-snapshot`).
No match in `docs/backlog`, `docs/process/traps.md` or ADR §Declined concepts
(`grep -rli 'ENAMETOOLONG\|NAME_MAX'`: none; no `ENAMETOOLONG` in
`packages/vfs/src` or `runtime-js` fs builtins).

Probe 2026-11-22, `fs.writeFileSync(dir + '/' + name, '')`:

| name | Node v24.16.0, darwin-arm64, APFS | rifty guest (isolate-guest bundle @ 62a73512e) |
|---|---|---|
| 255 × `a` | ok | ok |
| 256 × `a` | `ENAMETOOLONG` | ok |
| 86 × `€` (258 UTF-8 bytes) | ok (APFS counts characters) | ok |
| 16 384 × `a` | — | ok |

Linux NAME_MAX (ext4: 255 bytes) not measured here — the reference platform
and the unit (bytes vs characters) are an open fork for whoever picks this up.

Link: ADR-0567 caps snapshot names at 16 383 code units (V8 hashes longer
strings by length alone); a guest run that creates a longer name cannot save
its state. Once rifty refuses names over NAME_MAX, that cap is unreachable for
an honest tree and the snapshot goal's I1 holds for every name again.

## Challenge

challenge: none — factual capture, no direction proposed
