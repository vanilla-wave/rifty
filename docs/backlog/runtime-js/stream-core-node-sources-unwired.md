---
area: runtime-js
status: draft
title: Node v24.16.0's stream core is vendored, generated and bound in rifty, unwired, with a CI differential against Node's bindings
created: 2026-11-25
why: First of the three core units of goal node-streams-as-in-node (8a): the generated core must exist and be proven before anything imports it, as the zlib engine (#452) does
epic: node-streams-as-in-node
sources: [docs/adr/runtime-js/0575-stream-core-and-fs-streams-are-node-v24-16-0-s-own-sources.md, docs/backlog/epics/node-streams-as-in-node/reference/results/route-b-product-build-main.txt]
---

## Context

Unit 8a (map item 8a, ADR-0575 §1–2, §7). Scope: `tools/publishing/node-streams/` vendored sources with
sha256 and `LICENSE`, the generator (ADR-0574 pipeline + drift check), the bindings (`route-b/product/`
probe shape), zlib constants without loading the zlib module (`adapters.js:94`), the third-party
manifest entry (PR #445's mechanism) before anything is published. `internal/events/abort_listener`
is Node's file whole (variant A of `runtime-js/stream-core-abort-listeners-host-event-target`); which
variant ships is that unit's decision, and 8a takes it as it lands.

Not wired:
- a `check:arch` rule «no product importer», 0 B on every bundle artifact;
- the third-party manifest entry. Without it `pnpm build:libs`'s `third-party-notices` step fails
  (`results/chromium-c/route-b/build-libs.log.txt`).

Acceptance: a CI test runs the verbatim core on Node's bindings and on rifty's over the rows
`results/ownership.txt` gives to the core. The rows owned by 1, 2, 4 and 5 stay pinned as expected
RED with their owner. `zlib-diff` is not here: it is zlib unit 3's entry criterion, after 8c.

Merge order: 8a and 8b merge once 8c's PR is open with its differential green.

## Open findings (review round 4)

Carried verbatim from the manager's review of PR #450, round 4 (2026-11-25); owner = this unit. They close when the unit is taken into work, by its own contract and review.

- S7 (owner 8a): «приёмки ≠ таблице: 8a «rows owned by 1, 2, 4, 5 stay pinned RED» при том, что 1, 2, 4 уже приземлятся».

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
