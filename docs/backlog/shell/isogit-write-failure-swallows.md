---
area: shell
status: draft
title: isomorphic-git write-side failure swallows (mkdir/write with no prior read failure)
created: 2026-08-15
why: ADR-0357 kills read-failure→absence lies; write-side swallows inside isomorphic-git remain
sources: [PR #260 class-kill sweep of node_modules/isomorphic-git 1.38.x]
code: [packages/git/src/exact-read-failures.ts]
---

## Context

ADR-0357's carrier latches non-absence READ failures and fail-stops subsequent
writes. Sweep found write-side swallows it does not reach when no read failed
first: `FileSystem.mkdir` returns success on codes other than EEXIST/ENOENT
(EACCES/EDQUOT fall through the catch); `FileSystem.write`/checkout
`updateIndex` paths log-and-continue on some failures (console.warn at
isomorphic-git updateIndex). FACADE-authored write swallows sit on the same
axis (`packages/git/src/git.ts`): `ensureParentDirs` mkdir `.catch(() =>
undefined)`, restore/reset unlink `.catch(() => undefined)`, clone-cleanup
`removeTree(...).catch(() => undefined)` — a genuine write failure there
(EDQUOT/EIO with no prior read failure) vanishes; the inventory must include
them. Axis: quota-perm-fail → torn-state at the same VFS→isomorphic-git
boundary, write direction (the read direction — including the clone
gitdir-existence probe — is closed by ADR-0357). Reachable: OPFS quota
exhaustion mid-checkout/clone. Same axis, attribution direction: a write
ISSUED inside an abandoned parallel branch (Promise.all sibling of a failed
read) that reaches the fs AFTER its operation window settled cannot be
distinguished from the next window's own writes at the carrier (no async
context in the browser) — in-flight writes are already beyond the gate, and
late-issued orphan writes adopt the live window. The carrier's fail-stop
covers writes issued while a latch is visible; the orphan-window residue
belongs to this inventory. Needs its own fault inventory (which write
verbs can lie to which facade ops) before a mechanism — likely the same
carrier latching write rejections that isomorphic-git converts into
"success".
