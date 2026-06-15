---
area: runtime-js
status: parked
title: node:constants residual static surface — unsupported fs/libuv/mode keys throw loudly
created: 2026-06-17
why: The empty-placeholder bug is fixed, but full Node exposes more constants than rifty can honestly support today; unsupported keys must stay loud and tracked instead of drifting back to silent undefined.
user_story: As a dev whose dependency reads `require('node:constants').O_SYNC` or `UV_DIRENT_FILE`, I want either the real Node value with matching runtime semantics or a clear NotImplementedError; today unsupported constants throw loudly by design.
sources: [AGENTS.md no-silent-stubs, docs/public/compat/modules.md, docs/public/compat/fs.md, ADR-0050]
code: [packages/runtime-js/src/builtins/constants.ts, packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/os.ts, packages/runtime-js/src/builtins/crypto.ts]
---

## Context

`node:constants` now exposes rifty-backed flattened data: supported `fs.constants`,
Linux-ABI `os.constants.{signals,errno,priority,dlopen}`, and `crypto.constants`.
Full Node also exposes residual keys that are not honest to publish blindly in
rifty yet: unsupported fs flags (`O_SYNC`, `O_DSYNC`, `O_NOFOLLOW`,
`O_NONBLOCK`, `O_SYMLINK`), reflink/copy-on-write constants
(`COPYFILE_FICLONE*` / `UV_FS_COPYFILE_FICLONE*`), libuv dirent/filemap/symlink
constants (`UV_DIRENT_*`, `UV_FS_O_FILEMAP`, `UV_FS_SYMLINK_*`), and file mode
bits (`S_IF*`, `S_IR*`, `S_IW*`, `S_IX*`).

Some are pure numbers, but Node code often feeds them back into `node:fs`.
Publishing them without matching VFS/fs behavior would create another fake
implementation. The proxy therefore throws `NotImplementedError('constants.<key>')`
for unknown keys. Related implementation gates already exist for fsync/durability
(`vfs/fs-sync-fd-api-and-fsync-durability`) and symlinks (`runtime-wasi/vfs-symlinks`).

## Options or Next

Promote one subgroup only when a real package needs it. Each promotion needs:
parity values from real Node, conformance for the consuming API, and a compat
matrix update. Do not bulk-add raw numbers unless the consuming behavior is
implemented or the key is proven to be harmless static data.

## Reversibility

REVERSIBLE — current state is an honest loud throw plus tracked limitation.
Implementing fs flag behavior, reflinks, or symlink/file-mode semantics may become
IRREVERSIBLE if it changes VFS/fs contracts; follow the specific lower-layer
backlog/ADR gates.
