---
area: playground
status: draft
title: Avoid full dependency reacquisition after Vite transient cache writes revoke the install claim
created: 2026-07-16
why: live Vite repeatedly writes node_modules/.vite-temp after npm install, correctly revoking the whole-tree claim, marking a fresh Scratch UNSAVED, and forcing the next project reopen to reacquire an otherwise usable dependency tree
user_story: As a playground user, I want untouched Vite projects to stay visibly clean and switching back to remain fast and offline-capable, without weakening dependency-tree trust.
sources: [PR-136-recut, ADR-0261, ADR-0279]
code: [packages/workbench/src/glue/package-mutation-executor.ts, packages/workbench/src/workers/package-acquisition-authority.ts, packages/workbench/src/workers/workbench-project-vfs.ts]
---

## Context

The live Vite child emits `mkdir node_modules/.vite-temp`, then repeated
write/remove operations for timestamped config modules. Classifying any
`node_modules` mutation as a tree change is correct: the install authority must
not trust bytes changed after promotion. The resulting revoke can race the
detached npm promotion, leaving no trusted claim; A→B→A then safely reacquires
from the saved current `package.json`. The same guest-mutation classification
also flips a fresh Scratch to `UNSAVED` before any user edit.

The correctness path is covered. Investigate a trust-preserving design that
does not whitelist arbitrary Vite paths or attest a tree while it is still
mutable—for example, a quiescent post-Vite promotion boundary or a separately
owned disposable cache outside the attested dependency tree.

## Reversibility

REVERSIBLE if confined to private playground ownership and cache placement.
Changing what an install claim attests requires an ADR and new fault tests.
