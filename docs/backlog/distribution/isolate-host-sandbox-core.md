---
area: distribution
status: draft
title: Isolate host sandbox core — createSandbox, host file ops, exec over the snapshot codec, one operation at a time, destroy
created: 2026-11-22
why: The first wall of goal isolate-host-live-sandbox; compiled at PICKUP once the codec seam (#418) lands.
epic: isolate-host-live-sandbox
blocked_by: []
sources: [docs/backlog/epics/isolate-host-live-sandbox/goal.md, docs/adr/distribution/0568-run-guest-files-in-a-live-sandbox-whose-state-is-filesystem-bytes-held-by-the-consumer.md, docs/backlog/distribution/isolate-host-sandbox-acceptance.md]
code: [packages/isolate-host/src, packages/isolate-guest/src]
---

## Context

ADR-0568 §1–§8 over ADR-0567's codec: the guest's program entry with restore
before and snapshot after, the state frame, the consumer's `Sandbox`. Carries
the acceptance carrier's Fault-matrix rows marked "core unit".

## Challenge

challenge: 2026-11-22 — inherits the goal premise check (`goal.md` §Challenge)
