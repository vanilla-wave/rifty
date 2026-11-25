---
area: npm-client
status: draft
title: The shadow recipe v2 ledger test pins an order of two concurrent cache puts for esbuild transitive fresh installs
created: 2026-11-25
why: `'esbuild transitive fresh supported'` fails on main now and then — the two `cache:put` events of one install swap places — a red that is the test's, not a product regression, and that blocks unrelated PRs.
sources: [packages/npm-client/src/shadow-recipe-v2-data-authority.contract.test.ts, CI-run-45686381301, CI-run-45697539290, CI-run-45697559045]
code: [packages/npm-client/src/shadow-recipe-v2-data-authority.contract.test.ts]
---

## Context

Observed on main (manager, 2026-11-25, from CI logs): red in runs 45686381301 (`7d153cb8b`, a
docs-only merge) and 45697539290 (`330bb0fc4`), green in 45697559045 and in every earlier run of
the day. The failing assertion is `expectEventLedger` (`:391`, `expect(actual).toEqual(expected)`):

```
-   "cache:put:shadow-authority-host@1.0.0",
    "cache:put:esbuild-wasm@0.28.0",
+   "cache:put:shadow-authority-host@1.0.0",
```

The same function already admits concurrent fresh puts in either order, but only for
`lightningcss` × `transitive` (`concurrentFreshPuts`, `:385-389`); esbuild's transitive fresh case
puts two tarballs the same way and is compared in exact order. Not from PR #460 (it moves the
dependency snapshot envelope reader into npm-client and touches neither the installer nor this
test; the red is on main heads without it).

Open (owner: agent, at pickup): whether the two puts are concurrent by design (then the ledger
compares them as a set, as for lightningcss) or their order is a contract the installer should
keep (then the installer is the fix) — a deterministic repro (delay one put) first.

Owner: npm-client. Trigger: the next red on main, or now — it reddens unrelated PRs.

## Challenge

challenge: 2026-11-25 — none yet (finding capture)
