# ADR 0286: Workspace archives round-trip observable Git and nested dot-rifty state

Status: Accepted
Date: 2026-07-17

> TL;DR: current workspace archives carry Git metadata and ordinary nested
> `.rifty` bytes; only root `.rifty` authority and derived trees stay outside.

## Context

ADR-0278 called the archive an editable-workspace download but excluded every
`.git` and `.rifty` segment. In an ephemeral session the archive can be the only
backup: omitting `.git` silently loses observable commits, refs, index, and Git
configuration. A nested `.rifty` is an ordinary Files-visible project path;
excluding it from export while import rejects it makes the public Files and
archive boundaries disagree.

The shared depth-insensitive blacklist also controls export, import validation,
and crash-recovery stage validation. Changing only export would create an
archive that its own import rejects; changing only the codec would still let
owner promotion preserve stale Git instead of restoring archived history.

## Decision

V1 export and import admit `.git` at any depth and `.rifty` below an ordinary
project directory. Root `.rifty` remains owner-private: export omits it and
import/recovery reject it before effects. `node_modules`, `.vite`, and `dist`
remain derived directory segments at any depth and stay omitted/rejected.

Owner promotion replaces `.git` when the staged archive carries `.git/*`, so a
current export→import round-trip restores the same observable workspace bytes.
For compatibility with pre-0286 V1 archives, a stage with no top-level `.git`
keeps the destination repository while replacing source, matching their
original source-only behavior.

All existing path normalization, topology, canonical-base64, file/count/byte,
durability, and recovery gates remain. Git history counts toward the finite V1
budgets; an oversized repository rejects loudly instead of producing a lossy
archive.

## Consequences

- “Download the editable workspace” now includes Git history and every
  Files-visible nested `.rifty` byte.
- One path classifier owns export, import, and recovery-stage admission, so
  these siblings cannot drift independently.
- Current archives may be materially larger and can hit the existing 32 MiB
  decoded-content limit; this is an honest bounded failure.
- Old V1 source-only archives remain importable but intentionally cannot
  restore history they never contained.

### Rejected

- Tooltip-only disclosure: honest about loss, but leaves the sole ephemeral
  backup lossy and Files/archive boundaries inconsistent.
- Forbid nested `.rifty` through `ProjectFiles`: breaks ordinary user-visible
  project paths to protect no owner namespace; only the first segment is
  private.
- Introduce V2 solely for admitted paths: V1 already has a generic normalized
  path schema; the correction needs no wire-shape change, and old V1 behavior
  is distinguishable by absence of top-level `.git` files.

Corrects ADR-0278's archive exclusion clause only; every other companion and
archive decision there remains active.
