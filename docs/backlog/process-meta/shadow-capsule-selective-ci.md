---
area: process-meta
status: ready
title: Shadow capsules with digest-keyed selective CI — expensive proof runs only for changed capsules
created: 2026-07-13
why: per-package proof (native oracle + contract suites + browser spec) is linear in package count; at 10+ shadow packages every PR would re-run thousands of unrelated tests
user_story: As a contributor adding one shadow package, I want my PR to prove MY capsule plus cheap global gates, but today esbuild's full proof pipeline is monolithic repo-global wiring that each new package would replicate into every PR
epic: honest-shadow-substitutions
blocked_by: [npm-client/sass-embedded-substitution]
sources: [docs/adr/toolchain-build/0226-upstream-derived-filesystem-enabled-esbuild-runtime.md, docs/adr/npm-client/0249-shadow-runtime-assets-install-through-the-npm-pipeline-into-a-workspace-content-store.md]
code: [tools/shadow-registry/src/index.ts, tools/shadow-registry/esbuild-runtime-policy.json, tools/shadow-registry/tools/generate-esbuild-runtime.ts, tools/checks/pr-check.mjs]
---

## Context

The esbuild proof set (contract oracle vs native, generated-runtime contract,
provenance gates, browser contract spec, derivation drift) lives as repo-global
test wiring with the native oracle package as a root devDep. Replicated 10-100×
this is unpayable per PR — and unnecessary: capsule truth is frozen fixtures +
deterministic derivation, both already guarded by cheap byte-compare drift
gates. `blocked_by` is the build trigger, not a technical dependency: do NOT
build this before the second pattern-2 capsule exists (anti-speculation); the
contract is frozen now so building it later adds zero new decisions.

## Acceptance

- Capsule layout: `tools/shadow-registry/capsules/<pkg>/` owns that package's
  policy, patch plan, oracle fixtures, generated outputs + manifest, capsule
  tests, and its OWN devDeps (native oracle package declared in the capsule's
  package.json — root package.json gains no per-capsule native deps).
- Selector (`tools/checks/select-capsules.mjs`): changed set = (diff vs
  origin/main merge-base ∩ capsule paths) ∪ ALL capsules when any cross-cutting
  input changed — patch engine, generator, shared runtime glue, capsule-CI
  wiring itself, root lockfile, node/vitest/playwright configs.
- PR lane split: always-on cheap gates for EVERY capsule (derivation
  byte-compare, identity, snapshot gates — hash checks, O(n) seconds);
  expensive suites (oracle regeneration, contract execution, browser contract
  spec) run only for selected capsules.
- Weekly scheduled lane runs every capsule's full suite (environment-drift
  backstop), reusing the existing cron-lane pattern.
- Selector is RED-proven: (a) flip one byte in a capsule input → that capsule
  selected; (b) unchanged tree → zero expensive tasks selected; (c) generator
  edit → all selected. Each is a test of the selector itself.
- Migration proof: esbuild becomes capsule #1 and the second pattern-2 package
  lands as capsule #2 in this layout; `pnpm pr:check` output names selected
  capsules explicitly (no silent skips — "capsules: esbuild (selected),
  lightningcss (drift-gated only)").

## Parity cases

Selector behaviors to pin, each failing-test-first:

1. Unchanged tree → selected set empty, all always-on gates still executed.
2. One byte in `capsules/<pkg>/policy` → exactly that capsule selected.
3. Patch-engine source change → all capsules selected.
4. Root lockfile change → all capsules selected.
5. Capsule test-file-only change → that capsule selected (tests are inputs).
6. Registry entry removed together with its capsule → no orphan always-on
   gate remains (gate list derives from the registry, not a hand list).

## Out of scope

- Auto-bumping upstream pins (renovate-style automation).
- Cross-PR caching/remote reuse of browser test results.
- Selective execution for anything outside shadow capsules (the general test
  pyramid stays as is).

## Decisions

- Skipping is honest ONLY because capsule truth is frozen: fixtures pin the
  oracle, derivation is deterministic, and byte-compare drift gates stay
  always-on for every capsule — an unchanged capsule's expensive suite would
  re-execute identical inputs against identical fixtures. Environment drift is
  routed to full runs via cross-cutting inputs + the weekly sweep.
- Build trigger: second pattern-2 capsule (recorded here; `blocked_by` encodes
  it). Contract frozen now = zero new decisions at build time.
- Selection is path+digest based on git state, never on test outcomes — a red
  capsule cannot deselect itself.
