---
area: distribution
status: draft
title: A sandbox run's end state is captured where the guest's code cannot reach
created: 2026-11-23
why: The capture runs in the guest's realm after the run's status is out, through intrinsics the guest can replace — a guest that broke its own snapshot can leave a tree the codec accepts with no `stateRefused`, against the goal's I1.
epic: isolate-host-live-sandbox
sources: [ADR-0568, docs/public/compat/isolate-host.md, docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-class.md, PR-424-cross-review]
code: [packages/isolate-guest/src/snapshot.ts, packages/isolate-guest/src/guest/entry.ts, packages/isolate-host/src/child/main.ts]
---

## Context

Found by the PR #424 cross-review (round 2) and held as a CLOSE blocker by the closing review: the
goal's I1 names «a guest that broke its own snapshot» as a run that gets `stateRefused` and the state
of before. Measured @ 82d39db66 against live `node`: a guest that replaces
`DataView.prototype.setUint16` to map 97 → 98 ends `exit 0`, no `stateRefused`, its state's
`/workspace` renamed `/workspbce` and the host's `keep.txt` gone; one that makes `setUint32` loop
ends the run `timeout`, its writes rolled back (Node: exit 0, files kept). Its output there is
already dropped (PR #424). Pinned as declared rows in `sandbox-acceptance` ("the guest's realm
while its state is captured"); compat Sandbox row of the same name.

Open, for PICKUP (`RDY-1`/`RDY-2`), not a design: where can the end state be captured so the
guest's code never runs in it — a fresh realm over the guest's FS records, the worker reading the
isolate's FS through copies, or a codec that uses no guest-replaceable intrinsic? The `runCode`
goal kept the same class open for the runtime's own paths
(`runtime-js/post-guest-paths-use-replaceable-intrinsics`). Owner: the goal `isolate-host-live-sandbox` (its I1; it closes when this lands) — back from `isolate-host-sandbox-template` 2026-11-25: that goal's simple form (the template as the sandbox's own files) rewrites no capture. Trigger: picked up for `isolate-host-live-sandbox`, or with `distribution/isolate-host-sandbox-template-layer` (which rewrites the capture for the difference).

## Challenge

challenge: 2026-11-23 — none yet (factual capture; the closing review's blocker)
