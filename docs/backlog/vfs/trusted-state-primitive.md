---
area: vfs
status: draft
title: Generic TrustedState primitive — lift the stamp authority to the storage layer
created: 2026-07-11
why: the platform keeps growing trust claims over multi-file state (stamp, learned pins' hand-rolled chain+CAS, future build-cache markers, multi-tab plane ownership) — each re-buys single-writer/durable-proof/fencing by hand
user_story: As a contributor adding a trust claim over stored state (cache validity, index, plane ownership), I want a storage-layer primitive with the five invariants built in, but today I hand-roll coordination and inherit the PR #131 bug zoo.
epic: trusted-state-authority
blocked_by: [playground/install-stamp-authority]
sources: [docs/adr/playground/0216-install-tail-latency-background-command-durability-generation-guarded-stamps-learned-pin-swr.md]
code: [packages/workbench/src/glue/eddy-learned-pins.ts]
---

## Context

Deliberately GATED on a second real consumer (entity-cut — no speculative
framework): candidates are learned pins (their pinWriteChain + servable-view
CAS is a hand-rolled instance), a vite/build cache validity marker, and the
multi-tab epic's per-plane ownership (Web Locks). When the second consumer
lands, extract the stamp authority's state machine into a layer-correct home
(packages/vfs or a sibling), parameterized by claim path, guarded scope, and
identity — and migrate both consumers onto it. Until then this item records
the pattern and the trigger; it must NOT be implemented speculatively.
