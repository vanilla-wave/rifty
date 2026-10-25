---
area: vfs
status: draft
title: WebKit native OPFS contention returns InvalidStateError outside the replica retry predicate
created: 2026-09-28
why: native WebKit contention differs from the error name the replica admission loop retries; reload recovery may reject early
sources: [ADR-0428, ADR-0469, docs/backlog/playground/reference/browser-floor-cross-engine-evidence.md]
code: [packages/vfs/src/opfs-replica-store.ts]
---

## Context

Finding. Real persistent WebKit 26.4 profile, two dedicated module Workers,
same OPFS file: first sync handle opens; second rejects `InvalidStateError`
(`The object is in an invalid state.`). Chromium 148.0.7778.96 and Firefox
150.0.2 return `NoModificationAllowedError`. Reproducer and output:
`docs/backlog/playground/reference/browser-floor-cross-engine-evidence.md`.

`acquireGuard` retries only `NoModificationAllowedError`; WebKit's native
error bypasses that branch. Public reload failure is not reproduced: normal
exact-byte reload passes. Pickup must discriminate live-guard contention
from stale/closed handle causes before changing the predicate.

Owner: vfs. Trigger: WebKit admission/reload reliability work. Deferred by the
browser-support-floor user's record-only choice; not a goal child. Dedup:
existing no-COI evidence named this as an unmeasured question; no other
backlog item owns this native error predicate.
