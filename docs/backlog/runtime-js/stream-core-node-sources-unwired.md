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
manifest entry (PR #445's mechanism) before anything is published. Not wired: a `check:arch` rule "no
product importer" and byte-identical `main` bundles. Acceptance: a CI test runs the verbatim core on
Node's bindings and on rifty's over `m1`–`m8`, the hook matrix, `cases/stream` and `zlib-diff` = 0
difference. Merge order: 8a and 8b merge when 8c is in work; 8a never sits on `main` unwired open-ended.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
