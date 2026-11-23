---
area: vfs
status: draft
title: rifty's FS accepts file names Node refuses with ENAMETOOLONG
created: 2026-11-22
why: a Node program that hits NAME_MAX gets ENAMETOOLONG; in rifty the same call succeeds, and a name over 16 383 code units also cannot be snapshotted (ADR-0567)
user_story: As a developer running Node code in rifty, I want a too-long file name to fail with ENAMETOOLONG as in Node, but today rifty creates it
sources: [ADR-0567, docs/public/compat/isolate-host.md]
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
| 86 × `€` (258 UTF-8 bytes) | ok | ok |
| 255 × `€` (765 UTF-8 bytes) | ok | — |
| 256 × `€` | `ENAMETOOLONG` | — |
| 128 × `𝄞` (256 UTF-16 units, 128 code points) | `ENAMETOOLONG` | — |
| 16 384 × `a` | `ENAMETOOLONG` | ok |

On APFS the measured limit is 255 UTF-16 code units (not bytes, not code
points).

Linux not measured here. Open fork for whoever picks this up: the reference
platform, and so the unit (UTF-8 bytes, UTF-16 units or code points).

Link: ADR-0567 caps snapshot names at 16 383 code units (V8 hashes longer
strings by length alone); a guest run that creates a longer name cannot save
its state. Once rifty refuses names over NAME_MAX, that cap is unreachable for
an honest tree and I1 (ADR-0567 «Goal invariants») holds for every name again.

Owner: vfs; trigger: a Node program that relies on `ENAMETOOLONG`, or the snapshot name cap biting a real guest.

## Challenge

challenge: none — factual capture, no direction proposed
