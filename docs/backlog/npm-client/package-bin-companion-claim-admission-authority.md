---
area: npm-client
status: ready
title: Package-bin companion claim admission authority
created: 2026-07-30
why: PR #233 proved Rifty's injected Rollup parser companion is incorrectly treated as a user-visible same-command claimant
user_story: As a browser-IDE user installing Vite, I want Rifty's internal Rollup parser companion to stay installed without stealing or blocking the Rollup CLI, while an ordinarily requested companion keeps its real CLI
epic: honest-shadow-substitutions
sources: [ADR-0188, ADR-0335, ADR-0343, docs/backlog/npm-client/reference/package-bin-linker-contract-red.md]
code:
  - packages/npm-client/src/installer.ts
---

## Context

This is the post-pickup split predecessor discovered by PR #233's remote
browser and packed-consumer acceptance. The generic link-ingress contract was
correct for ordinary claims, but its first production composition exposed
that ADR-0188's auto-injected `@rollup/wasm-node` support package and ordinary
`rollup` both publish the root command `rollup`.

The package remains a real installed registry package. This unit owns only
whether its own bin metadata enters the active linker claim set. The existing
dependency walk and prepared linker remain the sole owners; there is no public
API, second resolver, package-name filter, or collision policy.

## Reference contract

- ADR-0188 owns exact-version, replay-derived companion injection.
- ADR-0343 distinguishes companion-only claim eligibility from raw registry,
  result, and lock metadata; any ordinary edge monotonically restores the
  claim for the same identity and install path.
- ADR-0335 still rejects true ordinary same-command ambiguity. This unit never
  selects a winner.
- Pinned npm manifests:

```sh
npm view rollup@4.62.2 bin --json
# {"rollup":"dist/bin/rollup"}
npm view @rollup/wasm-node@4.62.2 bin --json
# {"rollup":"dist/bin/rollup"}
```

## Acceptance

- A fresh `rollup@4.62.2` install with only its injected
  `@rollup/wasm-node@4.62.2` companion succeeds. Both exact packages and raw
  bin metadata remain in `InstallResult`, package files, and the lock, while
  `.bin/rollup` targets `../rollup/dist/bin/rollup`.
- Immediate lock replay re-derives the same companion-only eligibility and
  produces byte-identical launcher and metadata with zero registry reads.
- An ordinary direct `@rollup/wasm-node@4.62.2` install keeps its exact
  `.bin/rollup` launcher.
- When ordinary `rollup` and ordinary `@rollup/wasm-node` reach the same
  identity/path in either request order, the companion visit cannot suppress
  the ordinary claim. The focused carrier proves both claims reach the
  existing linker; the serial link-ingress successor owns the exact
  pre-mutation ceiling.
- Only the target of the injected companion edge loses active claim
  eligibility. Its manifest dependencies remain ordinary claimants.

## Parity cases

1. Auto-only fresh and replay keep raw metadata but link Rollup's launcher.
2. Ordinary companion-only links the companion's launcher.
3. Auto-first then ordinary-later and ordinary-first request orders both retain
   the companion's active claim.
4. Root and nested injected companions derive eligibility per install path;
   one path cannot suppress an ordinary claimant in another scope.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| frozen-assumption / provenance-lie | faithful Rollup manifests do not turn Rifty-injected support into a user claim | pinned manifest output plus real installer fresh case |
| sibling-drift | fresh and replay derive identical eligibility; root and nested paths stay independent | live/replay and scoped table |
| observable-order | ordinary demand upgrades an earlier or later companion-only visit | opposite request-order cases |
| lossy-aggregate | eligibility keys exact identity plus install path, preserving raw metadata and separate scopes | result/lock/launcher assertions |

## Out of scope

- Weakening ordinary claim normalization or settlement.
- npm ADD/CHANGE/no-op/remove/rebuild collision ownership; it remains the exact
  `npm-client.bin-collision-reify` compat ❌ ceiling.
- Recipe-v2 acquired-twin suppression, materialization, aliases, reporting, or
  lock commit; `npm-client/shadow-materialized-bin-commit-authority` owns them.
- All-files-before-bins and detached launcher writing;
  `npm-client/package-bin-phased-linker-authority` owns them.
- A public flag, custom companion interface, second walk, or new scheduler.

## Decisions

ready-verdict: 2026-07-30 — Contract+RED @ 873710b408989228033079686dc6f23763ce9ca0

- Split from the blocked PR #233 link-ingress attempt after remote run
  `30562763189` reproduced the same Vite install failure in browser-unit,
  packed-consumer, and owner-shell acceptance.
- Reuse the dependency walk's existing per-install-path schedule with one
  monotone ordinary-demand bit. A second map, graph pass, or package-name
  special case is unnecessary.
- Preserve raw package/result/lock bin metadata. The linker receives a
  package-private prepared projection only for companion-only paths, so later
  ordinary demand and replay never need to reconstruct registry facts.
- The serial link-ingress item remains draft and blocked until this unit lands.
