---
area: npm-client
status: draft
title: Shadow recipe v2 acquisition validation authority
created: 2026-07-28
why: the blocked recipe-v2 predecessor proved the current LightningCSS registry twin is accepted without verifying its exact registry projection or embedded manifest
user_story: As a browser-IDE user installing a registry-backed substitution, I want drift in the reviewed source rejected before it can change my project
epic: honest-shadow-substitutions
sources: [ADR-0335, docs/backlog/npm-client/reference/lightningcss-wasm-1.32.0-packument.md]
code:
  - packages/npm-client/src/installer.ts
---

## Context

This is the first dependency-ordered validation successor to blocked
predecessor `npm-client/shadow-recipe-v2-authority` / PR #212. The
materialized-bin successor landed through PR #237 at fresh baseline
`main@4a2beb233cc2127ef531b0eba2584797234865f1`.

Combined checkpoint `812cd8b0e5c653674bae949d67f0ac21db90748f`
mixed acquisition with protocol-v2 replay and was blocked. Re-cut checkpoint
`f5dbb4e021380dbdbbd964e33b434e47c2348618` then lacked negative embedded
manifest proof. That was the second consecutive Contract+RED blocker, so
`docs/process/fault-classes.md` §Review convergence requires another in-place
split. Although `0455ceb9683d6bed9a0ddc9f4fd1a5738ab537d7` technically passed
both review axes after adding the missing proof, it cannot authorize pickup.

This narrowed Item 19 owns only exact registry projection plus embedded
manifest validation at the existing shared tarball-to-package ingress. Draft
child `npm-client/shadow-recipe-v2-embedded-source-authority` owns bundled
traversal, lock topology, and current-protocol replay/Eddy completeness. Draft
grandchild `npm-client/shadow-recipe-v2-protocol-replay-authority` then owns
protocol-v2 provenance and acceptance consumers.

## Reference contract

- `lightningcss-wasm@1.32.0` registry identity, integrity, complete dependency
  maps, bundled `napi-wasm` membership, and all four embedded
  `napi-wasm@1.1.3` members are pinned from the official npm tarball. Positive
  proof feeds those exact bytes through the real installer; generated archives
  are negative mutation inputs only.
- The completed schema-2 data authority owns recipe codec, catalog identity,
  admission mode/feature, and schema-1 identity detection. This item consumes
  those facts without adding a second data, source, cache, or trace owner.

## Acceptance

- Consume the completed clone-safe schema-2 data authority and preserve its
  `semver-admits`/`exact-only` result and named feature through every execution
  path; add no second codec or admission owner.
- After exact version selection and before tarball/cache/VFS/report/lock work,
  strict-compare required `napi-wasm@^1.0.1`, bundled `napi-wasm`, and complete
  empty optional/peer maps with the recipe projection. Removing, adding, or
  changing any member throws
  `NotImplementedError('lightningcss.acquisition')`.
- At the shared extracted-package ingress, require
  `node_modules/napi-wasm/package.json`, exact name `napi-wasm`, and a version
  satisfying `^1.0.1`. Missing, wrong-name, or out-of-range manifests throw the
  same named feature after bounded parent acquisition but before VFS, report,
  or lock mutation.
- Root and nested fresh, matching current-protocol replay, and generic Eddy
  ingress all feed the same integrity-verified official parent bytes through
  that validation seam. The parent package manifest and every one of the four
  real embedded members survive extraction with exact byte length and SHA-256.
- Preserve current source traversal, lock topology, materialization, replay,
  and Eddy behavior unchanged; the dependency-ordered embedded-source child
  changes those observables. Preserve completed v2 catalog/install/snapshot
  identity gates and bounded registry faults. Add one concise npm-client
  CHANGELOG entry.

## Parity cases

1. Root and nested fresh installs admit the current LightningCSS request,
   verify exact registry maps, and validate the integrity-verified official
   `lightningcss-wasm@1.32.0` archive through the real installer.
2. Matching current-protocol replay and generic Eddy ingress validate the same
   parent bytes without registry fallback; raw replay lock bytes stay unchanged.
3. Eight independent required/optional/peer/bundle projection mutations reject
   with the named feature before tarball/cache/VFS/report/lock effects.
4. Missing embedded manifest, wrong child name, and out-of-range child version
   reject after parent acquisition but before VFS/report/lock effects.
5. Existing schema-2 admission and registry bounded-read/cancellation suites
   remain green.

## Fault matrix

| Fault class | Required outcome | Proof |
|---|---|---|
| corrupt-input / provenance-lie | complete registry maps strict-compare; official SRI bytes contain a valid in-range embedded manifest | eight map mutations, three generated embedded-manifest mutations, official root/nested real-tar carrier |
| observable-order | admission precedes registry; projection precedes tar/cache; embedded validation precedes VFS/report/lock | exact fresh-install operation ledgers |
| unbounded-read | registry headers/bodies remain progress-bounded, runaway bodies capped, discarded responses cancelled | inherited `RegistryClient` fault suite (8/8) |
| sibling-drift | fresh, replay, and Eddy use the same generic recipe-backed validation seam | root/nested real-tar carrier through all three ingresses plus finite generic-source gate |

## Out of scope

- Filtering verified bundled children from ordinary traversal; absence of a
  standalone registry/cache/root source; parent bundle and embedded-child lock
  facts; current replay/Eddy completeness for that topology; acquired-twin bin
  suppression. Child `npm-client/shadow-recipe-v2-embedded-source-authority`
  owns them.
- Protocol-v2 trace/materialization-bin provenance, literal-v2 replay,
  corruption gates, Workbench FIFO assertions, and Chromium v2 lock proof;
  `npm-client/shadow-recipe-v2-protocol-replay-authority` owns them.
- Matching non-bundled required/retained-optional traversal, omitted optionals,
  non-empty peer handoff, and accepted scoped keys;
  `npm-client/shadow-recipe-v2-dependency-projection-execution` owns them.
- npm same-command collision settlement, peer placement, Sass, a public/custom
  recipe SPI, raw concurrent public `install()`, or any second resolver, cache,
  lock, FIFO, or coordination mechanism.

## Decisions

- `2026-08-02` fresh baseline
  `main@4a2beb233cc2127ef531b0eba2584797234865f1` includes PR #237.
- Standards blocked `812cd8b0e5c653674bae949d67f0ac21db90748f`:
  fake positive tar evidence, unratified replay `cause`, and an over-budget
  combined carrier. It split protocol-v2 replay downstream.
- Spec blocked `f5dbb4e021380dbdbbd964e33b434e47c2348618`:
  no negative embedded-manifest proof. Because this was the second consecutive
  Contract+RED blocker, the contract escalates to validation → embedded-source
  topology → protocol-v2 replay. Technical PASS
  `0455ceb9683d6bed9a0ddc9f4fd1a5738ab537d7` is lineage only.
- `split-predecessor:
  87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`; earlier checkpoint lineage:
  `8f3251e89020772f15ff5a13022e7f7310f703d2`,
  `d5ffb3d2de8a27b26a13f541d2e5d16260d4b8d8`,
  `5c450fb9a5cab66a45b24eb8b19a1729c622e5a9`,
  `b7725a3e88278f4f24efb1d8c8d90e80de08de43`,
  `092d931a533ea45fa060367bd9373f78a7f2c684`, and
  `87098d2dbaeb5665188b98cbc1a5cdd6ba876cf9`.
- No new module, public API, coordination mechanism, or package-specific branch:
  validation stays at the existing recipe-backed resolution/extraction seam.
