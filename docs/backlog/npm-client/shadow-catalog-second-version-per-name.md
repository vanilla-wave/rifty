---
area: npm-client
status: draft
title: Should the builtin catalog carry two substituted versions of one package (esbuild 0.25.x beside 0.28.0)?
created: 2026-09-27
why: admission is first-recipe-by-name, so a project whose Vite major needs another esbuild line (vite@6 → `esbuild ^0.25.0`) cannot be served even by adding a recipe; the honest `NotImplementedError('esbuild.version')` today is by design, the growth path is undecided
sources: [ADR-0361, ADR-0371, docs/public/compat/esbuild-js-api.md, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [packages/npm-client/src/internal/shadow/admission.ts, tools/shadow-registry/src/internal/catalog-source.ts]
---

## Question

Which Vite majors (and therefore which esbuild lines) must install on rifty,
and does that require more than one substituted version per package name?

Facts (2026-09-27): `npm view vite@6 dependencies.esbuild` → `^0.25.0`
(6.4.2/6.4.3); the builtin recipe is exact `esbuild@0.28.0` with
`semver-admits`, so a Vite 6 project fails `npm install` with
`NotImplementedError('esbuild.version')` — documented in
`docs/public/compat/esbuild-js-api.md` §Known Limitations ("other esbuild
versions stay loud gaps"). Admission resolves the first recipe by
`trigger.name` (`admission.ts:28`); a second esbuild recipe would be invisible
to requests until lookup becomes all-candidates-by-range. Each additional
exact twin needs its own differential/oracle evidence and generated runtime
patch plan (the esbuild 0.28.0 contract lists 13 ordered patches); the retro
review of the series estimated one substitution at several thousand hand
LOC. Vite 8 transforms via oxc/Rolldown and does not need esbuild
(`incompatible-packages.md`).

Value is the user's (which project generations count for M11 "consumer
ready"); the lookup change is the agent's and is blocked by that answer.
The question was not put to the user in the 2026-09-27 round (that round
settled packaging only), so it stays open here. Related:
`npm-client/shadow-catalog-trigger-name-uniqueness` (the assertion this
question would replace with an explicit design).

## Challenge

<!-- question capture — no premise critic at draft (README §Challenge) -->
