---
kind: epic
status: draft
title: Fault-honest OPFS persistence — the VFS layer never presents torn state as durable
created: 2026-07-05
value: After any mid-write failure (quota, crash, permission), what OPFS-backed storage reports as durable IS durable — torn state is detected and loud, never trusted.
user_story: As a developer, I want my project files and git history to survive a failed background persist honestly, but today only the npm-install stamp path has a fault-tested ledger — OpfsFsSync structural-op bookkeeping beyond it and iso-git object/ref writes lack torn-state / quota-perm-fail rows.
items: []
---

## Outcome

#107 hardened ONE flow over this layer (install stamp: persist-failure ledger, revoke-proof, ancestor/rename heal) through ~10 review-found bugs on the torn-state / quota-perm-fail / provenance-lie axes (`docs/process/fault-classes.md`). The layer itself — OpfsFsSync mirror bookkeeping on structural ops, iso-git writes over VFS — carries the same axes unswept. Scope = the vfs/OPFS layer; consumers (boot/restore orchestration) are `fault-honest-boot-restore`.

## Candidate boundaries (items carved at refine)

- OpfsFsSync structural ops beyond the install path (rename/rm/mkdir ledger bookkeeping — partially healed in #107 r15/r19)
- iso-git object/ref writes over VFS (torn ref = corrupt graph)
- quota/perm fault rows for the mirror FIFO (mid-queue failure semantics)

## Items

(to be carved by `rifty-refine`)
