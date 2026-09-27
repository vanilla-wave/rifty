---
area: npm-client
status: draft
title: A refused substitution request names the substituted version and admission rule beside the package and range
created: 2026-09-27
why: the admission gate renders `Not implemented: esbuild.version (shadow recipe does not admit ^0.21.0)` — the package only through the feature id, and neither the exact version rifty substitutes nor the rule, so an honest ceiling reads like an internal bug
user_story: As a developer whose project pins `esbuild@^0.21.0`, I want `npm install` to tell me rifty substitutes exact esbuild 0.28.0 and which requests it admits, but today the error says `shadow recipe does not admit ^0.21.0` and points nowhere
epic: honest-substitution-signals
sources: [ADR-0361, docs/public/compat/esbuild-js-api.md, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [packages/npm-client/src/internal/shadow/admission.ts, tools/shadow-registry/src/internal/catalog-source.ts]
---

## Context

Finding (observed on `99fdf6c91`): `assertShadowRecipeAdmission`
(`packages/npm-client/src/internal/shadow/admission.ts:95-98`) throws
`NotImplementedError(recipe.admission.unsupportedFeature, 'shadow recipe does
not admit ${requestedRange ?? '*'}')`, rendered by `packages/io/src/errors.ts:10`
as `Not implemented: <feature> (<hint>)`. The feature id (`esbuild.version`,
`sass-embedded.version`, `lightningcss.version`) is the only hint of which
package refused; the message carries no `trigger.version`, no
`admission.kind`, no pointer to the compat page. The retro review of the
shadow-substitution series (2026-08-04) listed it under "gap errors read as
internal bugs"; the same shape reaches the user through `npm install` for every
recipe in the builtin catalog, and will be the surface of the planned sass
widening (`npm-client/sass-embedded-semver-admission`).

Expected: the message names `<name>@<range>`, the exact substituted version
(`0.28.0` / `1.32.0` / `1.100.0`), and the rule (`semver-admits` /
`exact-only`); the `NotImplementedError` feature id stays unchanged so existing
compat rows and tests keep binding. No hardcoded external URL (D-004); a
repo-relative compat path is acceptable if the pickup finds it useful.

Dedup: no title/`code:`/map/declined match; related surface only
(`npm-client/sass-embedded-semver-admission`). No new mechanism.

## Challenge

<!-- finding capture — no premise critic at draft (README §Challenge) -->
