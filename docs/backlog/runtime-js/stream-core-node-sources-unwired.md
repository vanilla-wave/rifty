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
manifest entry (PR #445's mechanism) before anything is published. Also the abort-listener binding.
Node's `addAbortListener` attaches with `kResistStopPropagation`, which a host `EventTarget` ignores. So
the binding listens on a dependent signal, `AbortSignal.any([signal])`, which the abort algorithm
aborts; a guest listener's `stopImmediatePropagation` cannot stop it. Measured:
- `m9`: today the abort is hidden (`pending`), Node is `ABORT_ERR`, and the fixed binding equals Node
  on all 5 rows;
- `results/route-b-abort-semantics.txt`: same semantics on Node v24 and Chromium 148;
- Chromium 108–115 has no `AbortSignal.any`. There the plain listener stays, as a declared gap: a
  stopping guest listener hides the abort.

Not wired:
- a `check:arch` rule «no product importer», 0 B on every bundle artifact;
- the third-party manifest entry. Without it `pnpm build:libs`'s `third-party-notices` step fails
  (`results/chromium-c/route-b/build-libs.log`).

Acceptance: a CI test runs the verbatim core on Node's bindings and on rifty's over the rows
`results/ownership.txt` gives to the core. The rows owned by 1, 2, 4 and 5 stay pinned as expected
RED with their owner. `zlib-diff` is not here: it is zlib unit 3's entry criterion, after 8c.

Merge order: 8a and 8b merge once 8c's PR is open with its differential green.

## Challenge

challenge: 2026-11-25 — none (child of a goal; premise in goal §Challenge)
