# ADR 0153: node:constants hybrid — faithful static data, syscall-boundary gap

Status: Accepted
Date: 2026-06-18

> TL;DR: `node:constants` / `fs.constants` expose the REAL Node numeric values for every constant
> Node exposes (faithful static data, `undefined` for absent keys — Node shape); the honest
> unimplemented-behavior gap moves to the SYSCALL boundary (`fs.open`/`copyFile` throw
> `NotImplementedError` when a flag whose semantics rifty can't honor is actually applied).

## Context

The first `node:constants` impl (PR #44) wrapped a flattened table in a Proxy that threw
`NotImplementedError('constants.<key>')` on any key not yet backed (O_SYNC, S_IF*, UV_*). That was
the literal reading of the Fidelity rule "loud throw over silent stub" (cf. ADR-0010), but it
mislocates the gap: a Node constant is just a NUMBER. Real programs READ these numbers without asking
rifty to implement the matching syscall — `tar`/`archiver`/`ls`-style code does `mode & S_IFMT ===
S_IFDIR` to interpret a `stat().mode` rifty already returned; bitmask builds; logging;
feature-detection. Throwing on the READ crashes the whole program where Node merely returns a number —
a direct hit to goal #1 (run real Node programs faithfully). A secondary bug: the access-time throw
broke `JSON.stringify(require('node:constants'))` (probes `.toJSON`), which Node serializes fine.

The constant's VALUE never lies; only USING an unsupported flag at a syscall can. So the gap belongs
at the syscall, not the data read.

## Decision

1. `node:constants` is a frozen flattened object (no Proxy, no throw): real value for known keys,
   `undefined` for absent keys — exactly Node's shape. Single-source spread of `fs`/`os`/`crypto`
   tables stays (surfaces never drift).
2. `fs.constants` / `os.constants` expose the full Node **Linux-ABI** constant set: O_* flags
   (incl. `O_SYNC`/`O_DSYNC`/`O_DIRECT`/`O_NOATIME`/`O_NOFOLLOW`/`O_NONBLOCK`/`O_NOCTTY`), POSIX
   file-mode bits (`S_IF*`, `S_IR*`/`S_IW*`/`S_IX*`), `COPYFILE_FICLONE*`, `UV_FS_*`, `UV_DIRENT_*`,
   `os UV_UDP_REUSEADDR`. Linux-ABI (consistent with the existing Linux-pinned `os.signals/errno`):
   excludes macOS-only `O_SYMLINK`.
3. Honest gap at the syscall boundary:
   - `fs.openSync`: `O_SYNC`/`O_DSYNC` → `NotImplementedError('fs.openSync.O_SYNC')` (durability not
     honored — OPFS flush is async/batched; consistent with the prior `'rs'`/`'as'` throw). Inert
     flags on a regular VFS file (`O_NONBLOCK`, `O_NOFOLLOW` [no symlinks, ADR-0050], `O_NOCTTY`,
     `O_DIRECT`, `O_NOATIME`) are accepted as no-ops (open succeeds, matching Node). Garbage bits →
     `EINVAL` (unchanged).
   - `copyFileSync`: `COPYFILE_FICLONE` accepted (best-effort → plain copy, like Node on a
     non-reflink fs); `COPYFILE_FICLONE_FORCE` → `NotImplementedError` (no reflink). Garbage → EINVAL.

Supersedes the constant-read loud-throw stance for this surface; refines (does not overturn) ADR-0010
— loud throw stays, relocated to where behavior actually diverges. The prior
`node-constants-residual-static-surface` backlog item is removed (superseded here); the remaining
behavioral gaps are tracked at the syscall boundary by `backlog:
vfs/fs-sync-fd-api-and-fsync-durability` (O_SYNC/O_DSYNC durability) and `backlog:
runtime-wasi/vfs-symlinks` (symlink flags).

## Consequences

- (+) Faithful to Node: constant reads (mode-bit math, bitmasks, logging, `JSON.stringify`,
  feature-detection) behave exactly like Node. Real CLIs that read `S_IF*`/flags no longer crash.
- (+) Gap still loud and honest, surfaced precisely where rifty's behavior diverges from Node (the
  syscall), not on an inert data read.
- (−) Linux-divergent O_* VALUES can't run against a non-Linux dev host, so the parity case prints
  only cross-platform-stable constants (S_IF*, COPYFILE_*, UV_DIRENT_*) + a sibling-equality bool for
  O_SYNC; the divergent O_* values are sourced from asm-generic/fcntl.h and conformance-pinned to
  rifty's Linux ABI — exactly how the existing `os.signals`/`errno` Linux values are handled.
- (−) `fs.constants` conformance test that pinned the old "supported subset only" policy is updated
  (policy change ratified here — not a test edited to make code pass).
