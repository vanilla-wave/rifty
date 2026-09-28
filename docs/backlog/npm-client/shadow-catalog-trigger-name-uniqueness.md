---
area: npm-client
status: draft
title: The builtin shadow catalog rejects two recipes with the same trigger name at decode
created: 2026-09-27
why: the codec checks recipe `id` uniqueness only, and request admission picks the first recipe by `trigger.name`, so a second recipe for an already-substituted package decodes silently and is shadowed or half-applied depending on which lookup runs
sources: [ADR-0361, docs/process/rules/fault-classes.md, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [tools/shadow-registry/src/internal/codec.ts, packages/npm-client/src/internal/shadow/admission.ts, packages/npm-client/src/internal/shadow/planner.ts]
---

## Context

Finding (observed on `99fdf6c91`): `decodeCatalog`
(`tools/shadow-registry/src/internal/codec.ts:553-558`) runs `sortedUnique`
over `recipes.map((recipe) => recipe.id)` and nothing else; `trigger.name`
uniqueness is not asserted. Two lookups read the catalog: request admission
(`packages/npm-client/src/internal/shadow/admission.ts:28`,
`recipes.find((candidate) => candidate.trigger.name === name)` — first match)
and planning (`planner.ts:135`, `find` by `trigger.name && trigger.version`).
A second recipe with the same trigger name and another id or version is
accepted at decode; admission always sees the first, the planner may resolve
the other — `sibling-drift` / `corrupt-input` at the "owned in-process
policy/graph projection" boundary (fault-classes §Boundary failure models:
validate once at the trust boundary). The retro review of the series
(2026-08-04) found this while checking why two esbuild versions cannot coexist;
one-recipe-per-name is therefore an implicit invariant nobody enforces.

Expected: the codec asserts `trigger.name` uniqueness with the same
`ShadowRegistryCodecError` shape it uses for ids (data-only ratchet, one
chokepoint), and the catalog-v2 data-authority contract test carries the RED.
If the project later wants two versions per name
(`npm-client/shadow-catalog-second-version-per-name`), that decision replaces
this assertion with an explicit all-candidates lookup — not both.

Dedup: no title/`code:`/map/declined match.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
