---
area: playground
status: draft
title: Durability-drain progress surface on the workbench owner port
created: 2026-08-15
why: the flush phase is 96% of heavy-tree project open and emits nothing observable — hosts cannot distinguish slow from stuck (issue #256's core complaint)
user_story: As a host UI embedding the workbench, I want an honest signal during the durability flush (still working / N of M persisted), but today WorkbenchOwnerHealthEvent carries only fatal-invariant and persistence, so a 40-second flush looks identical to a hang
blocked_by: []
sources: [https://github.com/vanilla-wave/rifty/issues/256, docs/adr/playground/0187-install-stamp-durability-via-write-through-fifo-order-non-blocking-stamp.md]
code: [packages/workbench/src/workbench/workbench-owner-port.ts, packages/workbench/src/glue/install-stamp-authority.ts, packages/vfs/src/opfs-sync.ts]
---

## Context

Issue #256: on a 98.2 MB / 14 492-file snapshot the `promote()` durability
flush ran 40.4 s of a 41.9 s open with zero observable output.
`WorkbenchOwnerHealthEvent` (workbench-owner-port.ts:33) has only
`fatal-invariant` and `persistence` kinds; no health event, progress callback,
or terminal line exists for the drain (verified: no progress mechanism in
packages/workbench, 2026-08-15). The maintainer chased a "hang" that was this
mute phase plus an unrelated bug. Even after the drain speedups
(`vfs/opfs-mkdir-persist-dedup`, `vfs/opfs-parallel-write-through-drain`) the
phase remains seconds-long on big trees and timeouts still cannot distinguish
slow from stuck.

Carrier sketch (agent-owned): the drain owner (`OpfsFsSync`) knows queued vs
completed persist ops up to the flush watermark — counts done/total are
available without new bookkeeping; the flush seam already threads from
`OpfsFsSync.flush` → owner glue (`options.flush` in install-stamp-authority /
owner-vfs-ipc) → owner port, so a progress observer can ride top-down without
reverse imports or a new coordination mechanism. Honesty rule: only REAL
completed-op counts — no synthetic/timed progress (Fidelity: no lie about
work done).

USER-OBSERVABLE FORK — needs manual `rifty-refine`, do not resolve internally:

1. Shape: heartbeat only ("still draining") vs counts (done/total) vs both.
2. Surface: new `WorkbenchOwnerHealthEvent` kind vs separate
   `subscribeDurabilityProgress` on the owner handle vs extending
   `PlaygroundOwnerOperationalHealth`.
3. Reach: owner-port-only (host UI decides), or also a terminal line during
   visible `npm install` drains (npm parity question: real npm prints nothing
   during fs flush — a terminal line may be a parity deviation).

Cross-package public API on the owner port → IRREVERSIBLE → ADR
(`pnpm adr:new playground "..."`) once the fork is resolved.

Acceptance proof for the shipped capability (DoD): browser-unit/e2e that opens
a large snapshot and asserts progress events arrive during the drain (monotone,
terminal completion event), and that a wedged OPFS op yields a stall signal
distinguishable from progress — not a source grep.

Candidate shared epic with `vfs/opfs-mkdir-persist-dedup` and
`vfs/opfs-parallel-write-through-drain` (user outcome: heavy-node_modules open
40 s → &lt;10 s with honest progress).
