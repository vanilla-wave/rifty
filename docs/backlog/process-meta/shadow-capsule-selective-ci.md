---
area: process-meta
status: draft
title: Shadow capsules with full-input-digest selective CI
created: 2026-07-13
why: per-package proof (native oracle + contract suites + browser spec) is linear in package count; at 10+ shadow packages every PR would re-run thousands of unrelated tests
user_story: As a contributor adding one shadow package, I want my PR to prove MY capsule plus cheap global gates, but today esbuild's full proof pipeline is monolithic repo-global wiring that each new package would replicate into every PR
epic: honest-shadow-substitutions
blocked_by: []
sources: [docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md, docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workbench-content-store.md]
code: [tools/shadow-registry/src/index.ts, tools/shadow-registry/esbuild-runtime-policy.json, tools/shadow-registry/tools/generate-esbuild-runtime.ts, tools/checks/pr-check.mjs]
---

## Context

The esbuild proof set (native oracle, generated-runtime contract, provenance,
joined browser acceptance, derivation drift) is repo-global wiring with its
oracle package as a root devDep. Replicated 10-100× this is unpayable per PR.
Path-only selection is unsafe: unchanged capsule files can observe changes in
the manager, owner port, VFS/kernel/runtime glue, tools, configs, or their
lockfile closure. Promote this item only when a named second derived-runtime
capsule is ready; Sass counts only if it chooses that pattern.

## Acceptance

- Capsule layout: `tools/shadow-registry/capsules/<pkg>/` owns policy, patch
  plan, oracle fixtures, generated outputs + manifest, adapter, descriptors,
  tests, and its own oracle devDeps.
- Each capsule manifest declares its owned inputs and shared input roots. The
  selector computes a deterministic digest over their complete transitive
  source-import closure, relevant lockfile importer/dependency closure, tool
  versions, Node/browser versions, and test/build configs at merge-base and
  head. Generated outputs are checked against their inputs, never used as a
  lossy proxy for them.
- Shared roots include shadow-registry generators, `ShadowAssetManager` and its
  STD/Eddy adapters, owner-port wiring, VFS/kernel/runtime glue, and capsule-CI
  tooling. A changed shared input selects every dependent capsule. A reachable
  changed input not classified by a manifest fails loud; it never silently
  deselects proof.
- A root lockfile byte change does not select all by itself: only a changed
  relevant importer/dependency closure selects its capsules.
- PR lane split: always-on cheap gates for EVERY capsule (derivation
  byte-compare, identity, snapshot gates — hash checks, O(n) seconds);
  expensive suites (oracle regeneration, contract execution, browser contract
  spec) run only for selected capsules.
- Manager/owner/VFS/kernel/runtime changes select every affected capsule and
  keep joined browser acceptance on the PR SHA. Weekly full runs are only an
  environment-drift backstop, never coverage for an omitted input.
- Selector is RED-proven: capsule input → that capsule; transitive shared
  input → every dependent capsule; relevant lock closure → affected
  capsule; unrelated lock closure → none; unclassified reachable input →
  loud failure; unchanged closure → zero expensive tasks.
- Migration proof: esbuild becomes capsule #1 and the second pattern-2 package
  lands as capsule #2 in this layout; `pnpm pr:check` output names selected
  capsules explicitly with selection reason (no silent skips — the acceptance
  fixture names `esbuild` plus the actual second derived-runtime capsule; it
  never presents an unproved package as drift-gated coverage).

## Parity cases

Selector behaviors to pin, each failing-test-first:

1. Byte-identical full input digest → selected set empty; all cheap gates run.
2. One byte in `capsules/<pkg>/policy` or its tests → exactly that capsule.
3. Shared manager/owner/runtime source change → every dependent capsule.
4. Relevant lockfile importer/dependency change → affected capsules;
   unrelated workspace importer change → none.
5. Unclassified changed source reachable from capsule proof/runtime → selector
   fails loud, never reports drift-only.
6. Registry entry removed together with its capsule → no orphan always-on
   gate remains (gate list derives from the registry, not a hand list).

## Out of scope

- Auto-bumping upstream pins (renovate-style automation).
- Cross-PR caching/remote reuse of browser test results.
- Selective execution for anything outside shadow capsules (the general test
  pyramid stays as is).

## Decisions

- Skipping is honest only when the full declared + transitive input digest is
  unchanged and every cheap gate remains green; a path list is insufficient.
- Promotion/build trigger: a named second derived-runtime capsule. No current
  item is a blocker until its runtime pattern is decided.
- Selection is input-digest based on git state, never test outcomes; a red
  capsule cannot deselect itself. Unknown classification is a loud CI failure.
