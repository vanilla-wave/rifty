---
kind: epic
status: draft
title: Fault-honest persistence — reload never trusts torn state
created: 2026-07-05
value: After any mid-write failure (quota, crash, permission), reload/restore yields a provably-correct project or a loud error — never a silently corrupted tree presented as healthy.
user_story: As a developer, I want a page reload after a failed background persist to restore exactly what durable storage proves, but today only the npm-install stamp path has a fault-tested ledger — boot/restore, git object writes, and structural VFS ops lack torn-state / quota-perm-fail rows.
items: []
---

## Outcome

#107 hardened ONE persistence flow (install stamp: persist-failure ledger, revoke-proof, ancestor/rename heal) through ~10 review-found bugs on the torn-state / quota-perm-fail / provenance-lie axes. The same axes are unswept on every other OPFS-backed state (`docs/process/fault-classes.md`). Durable-looking must be durable or loud.

## Candidate boundaries (items carved at refine)

- boot/restore snapshot + owner re-root (reload path)
- iso-git object/ref writes over VFS (torn ref = corrupt graph)
- OpfsFsSync structural ops beyond the install path (rename/rm bookkeeping — partially healed in #107 r15/r19)
- session/tab/terminal persisted state
- related existing item: `playground/install-stamp-invalidation`

## Items

(to be carved by `rifty-refine`)
