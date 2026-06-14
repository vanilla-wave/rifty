---
area: vfs
status: parked
title: Lower-layer FsSync fd API + honest fsync durability contract
created: 2026-06-12
why: runtime-local node:fs fds and WASI positional fd syscalls landed without changing the public FsSync contract; true inode-like open-unlink/rename semantics and sync durability need a lower VFS fd design and ADR
user_story: As a dev keeping an `openSync` fd valid across `unlinkSync`/`renameSync` and calling `fsyncSync` to durably flush to OPFS, I want Node-like inode-bound fds, but today fds resolve by path and `fsyncSync` on OPFS would be a fake durability guarantee
sources: [docs/research/open-webcontainers-alternative-2026-06.md, ADR-0072, ADR-0090]
code: [packages/vfs/src/fs-sync.ts, packages/vfs/src/sync-mirror.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

The runtime slice implements practical fd coverage at the runtime layer:
`node:fs` has a path-backed fd table, and WASI now implements `fd_pread`,
`fd_pwrite`, and `fd_filestat_set_size` over its existing fd table. That closes
the high-frequency build-tool surface without adding public lower-layer API.

What remains is lower-layer fidelity, not immediate consumer adoption: Node keeps open file
descriptors bound to file objects across unlink/rename, while the runtime-local
table resolves through paths. OPFS durability also remains async write-through
under ADR-0072, so a synchronous `fsyncSync` contract would be fake unless the
lower VFS explicitly models a sync flush boundary or a loud unsupported path.

## Options or Next

- Design a public `FsSync` fd primitive set only with a dedicated ADR. This is a
  cross-package lower-layer contract, like ADR-0090's copy/cp/rename precedent.
- Decide whether fd handles are inode-like handles, path-backed handles, or
  backend-specific capabilities with documented limitations.
- Define `fsync`/`fsyncSync` honestly for memory and OPFS. Async `flush()` exists,
  but sync OPFS durability is not currently guaranteed.

## Reversibility

IRREVERSIBLE if it changes `FsSync`: public cross-package API. Keep parked until
a real package or conformance gap proves path-backed runtime fds are insufficient.
