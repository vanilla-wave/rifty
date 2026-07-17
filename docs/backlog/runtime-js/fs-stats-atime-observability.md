---
area: runtime-js
status: draft
title: Preserve fs.Stats atime across VFS and runtime boundaries
created: 2026-07-16
why: VFS backends retain some access-time state, but FsSync, RPC, and runtime Stats omit it and reads do not advance it consistently
user_story: As a Node program, I want stat atime and atimeMs to match real Node after utimes and file reads.
sources: [PR-136-recut]
code: [packages/vfs/src, packages/runtime-js/src/builtins, packages/runtime-js/src/ipc]
---

## Contract to refine

- sync and promise stat expose matching `atime: Date` and `atimeMs`
- `utimes(file, 1, 2)` round-trips both atime and mtime
- a later read advances atime under the selected timestamp policy without
  changing mtime
- Memory, OPFS, RPC, and `watchFile` surfaces agree
- parity: write → utimes → stat → read → stat against real Node

Observed while diagnosing rooted Vite, then proven non-causal. Cross-reload
OPFS timestamp durability, ctime, birthtime, and `O_NOATIME` stay out of scope.
Adding required public VFS fields needs refinement and an ADR before implementation.
