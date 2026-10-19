# ADR 0540: Expose virtual filesystem Stats metadata for stock Node guests

Status: Accepted
Date: 2026-10-20

> VFS owns entry identity and clocks; Node Stats transports that metadata.

## Context

Goal esbuild-upstream-twin I3. Stock Go wasm reads numeric Stats fields;
size/mtime-only Stats panics during file resolution. Host inode/user/device
numbers cannot describe browser storage.

## Decision

- `FsStat` adds optional `metadata` (inode, creation/change clocks), atime and
  link count. Memory and OPFS sync backends supply these; RPC retains them.
  Runtime refuses an incomplete external FsSync provider by name.
- Inodes are session-local VFS entry identities, retained by overwrite/rename;
  a new entry receives a new identity. Restoration creates new identities.
- Memory entry clocks originate at creation; existing atime/mtime survive.
  OPFS sync entries track new creation/change clocks; persisted OPFS exposes
  no birth/change time, represented as zero on restoration. No persistence
  promise for newly added clocks.
- Node's virtual stat device is 1, owner/group 0, regular-file permissions
  0666, directory permissions 0777, no special device, block size 4096,
  allocated logical 512-byte blocks rounded up. Files have one link;
  directories count self/parent plus immediate subdirectories. These describe
  the permissionless, non-sparse VFS; they do not emulate host metadata.
- `atime/mtime/ctime/birthtime` Date views derive from the corresponding
  numeric fields. Missing watchFile targets retain Node's all-zero Stats.
  BigIntStats remains a named gap; atime update policy remains its existing
  separate obligation.

## Consequences

Stock guests receive complete numeric Stats without invented host values.
Adapters must preserve metadata; custom providers lacking it fail explicitly.
Carriers: `esbuild-node-surfaces.spec.ts`, VFS stat/rename and fs watch suites.
