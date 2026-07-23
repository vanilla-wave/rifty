---
area: playground
status: ready
title: Mechanical Workbench package extraction by subtraction from the #160 quarry
created: 2026-07-23
why: the quarry's extraction (clean tiering, sealed entrypoints, byte-identical dev-e2e, tests moved unweakened) was verified by review but is trapped inside a 58k-line PR; re-cutting it as a small behavior-preserving PR unblocks every later slice without re-doing proven work
epic: honest-shadow-substitutions
sources: [PR-160, ADR-0303-quarry, docs/backlog/distribution/workbench-controllers.md]
code: [apps/playground/src, packages/npm-client/src/installer.ts]
---

## Context

Produced by SUBTRACTION from quarry branch
`codex/implement-honest-shadow-substitutions` (head `158aaa30`): cut a fresh
branch from `main`, take the quarry tree selectively, strip — never rebuild or
"improve" while moving. A new small PR from the trimmed branch; do NOT
force-push #160. Advances `distribution/workbench-controllers` delivery step 6
(mechanical extraction) without closing that item (public sealing and packed
consumer proof stay there).

## Acceptance

Keeps (exhaustive):

- the 228 renames `apps/playground/src/*` → `packages/workbench/src/*`, the
  sealed-entrypoint arch rule, and the thin playground composition;
- installer per-edge replay + direct-slot reservation (quarry ADR-0303 lands
  here as its ADR) WITH their tests, minus the shadow hooks in `installer.ts`
  (`requireInstallShadowAssetGroup`, `onTreeMutationStart`, substitution
  provenance) — those are point edits and come out;
- bare-file primordial and CJS fixes;
- the dir-owner READMEs that fresh main's `pnpm check:dir-owner` requires.

Strips (hard cut line — nothing that touches trust/epoch/shadow ships here,
regardless of how finished it looks):

- all epoch/facts/admission machinery (carries the nested-cwd blocker; sits
  under ADR-0307/0309);
- the Vite temp-cache cluster (dead per ADR-0307);
- shadow chain, kernel one-shot capability CONSUMERS, shadow MessagePort
  protocol;
- cutover/alias retirement (Vite 7 breaks without delivery);
- Eddy shadow source (not adopted, ADR-0308);
- install stamp stays at v3 semantics (the oracle slice owns the predicate);
- zero backlog-contract edits (`check:contract-drift` clean by construction).

Proof:

- behavior-preserving: dev-e2e byte-identical to main before/after; moved
  tests pass unweakened (no assertion deleted or loosened in the move);
- `pnpm pr:check` + e2e/browser-unit lanes green on one SHA;
- Contract+RED checkpoint = this keeps/strips list frozen on the PR;
  Final+GREEN on the trimmed SHA.

## Parity cases

None new — behavior-preserving mechanical move; the existing parity and e2e
suites re-run unmodified on the extracted layout are the pin.

## Out of scope

- Any semantic fix discovered during the move — capture to backlog, never fix
  in the move PR.
- Public `@riftydev/workbench` API sealing, packed-tarball consumer proof,
  publication (stay in `distribution/workbench-controllers`).

## Decisions

- Quarry ADR-0303 (direct roots reserve flat slots before transitive
  placement) is adopted verbatim and lands with this PR, since its
  implementation and tests ride here.
- Backlog `code:` pointers to the new layout were pre-recorded in the decision
  PR, so this PR edits no ready contracts.
