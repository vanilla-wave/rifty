---
area: npm-client
status: draft
title: sass-embedded substitution admits semver ranges that include 1.100.0, like the esbuild and lightningcss recipes
created: 2026-09-27
why: the sass recipe is `exact-only` so every organic request (`^1.70.0` Vite peer, any `^1.x`, `*`) throws `NotImplementedError('sass-embedded.version')` and fails the whole install — the most common recipe of the catalog has ~zero organic reach
user_story: As a developer whose Vite 7 project lists `"sass-embedded": "^1.89.0"`, I want `npm install` to substitute the exact 1.100.0 twin the way `esbuild@^0.28.0` is admitted, but today the install fails with `sass-embedded.version` even for `^1.100.0`
sources: [ADR-0344, ADR-0361, docs/public/compat/sass-embedded.md, docs/backlog/npm-client/reference/shadow-registry-retro-intake-evidence.md]
code: [tools/shadow-registry/src/internal/catalog-source.ts, tools/shadow-registry/sass-embedded-policy.json, tools/compat-matrix-generator/cli.js, packages/npm-client/src/internal/shadow/admission.ts, tools/checks/sass-compat-matrix.contract.test.ts]
---

## Context

Finding (observed on `99fdf6c91`): recipe
`rifty.shadow-substitution.sass-embedded.v2`
(`tools/shadow-registry/src/internal/catalog-source.ts:524-528`) declares
`admission: { kind: 'exact-only', unsupportedFeature: 'sass-embedded.version' }`
while the esbuild (:461) and lightningcss (:494) recipes declare
`semver-admits`. Two more carriers pin exact-only and change with it:
`tools/shadow-registry/sass-embedded-policy.json:10-13` (`admission.kind`)
and the compat generator, which throws unless that kind is `exact-only`
(`tools/compat-matrix-generator/cli.js:192-194`). `assertShadowRecipeAdmission`
(`packages/npm-client/src/internal/shadow/admission.ts:89-98`) admits an
exact-only recipe only when `requestedRange === trigger.version`; any caret,
tilde, `*` or `>=` form throws. ADR-0344 records this as a decision: "every
request other than literal `1.100.0` throws `sass-embedded.version`" and "the
facade remains version-exact; widening requires new differential and
integration evidence".

Reach facts (2026-09-27): `npm view vite@7.3.6 peerDependencies.sass-embedded`
→ `^1.70.0`; `npm view sass-embedded dist-tags` → `latest: 1.105.0`
(published 2026-09-22); `1.100.0` published 2026-05-22. Under `semver-admits`
every range whose lower bound ≤ 1.100.0 (`^1.70.0` … `^1.100.0`, `*`, `>=1`)
admits the twin; a fresh `npm add -D sass-embedded` (`^1.105.0`) still refuses
loudly, exactly as `esbuild@^0.28.2` does today. Real npm would resolve
`^1.70.0` to 1.105.0; rifty installs 1.100.0 — inside the requested range, the
same version-selection divergence the esbuild policy already carries. The
retro review of the series (2026-08-04) traced the asymmetry to fixture needs:
esbuild got `semver-admits` because Vite's edge is a range, sass got
`exact-only` because its fixture could be pinned.

Expected at pickup: admission flips to `semver-admits` for the sass recipe
(data flag + catalog digest); ADR-0344 gets a dated correction (`DEC-2`, some
clauses: the "literal 1.100.0" clause and the "version-exact facade" consequence;
the differential evidence for 1.100.0 itself is untouched); compat page row
for the admitted request form (README §Shape: an admission surface names the
organic request form it admits); the refusal message for out-of-range requests
is the one `npm-client/shadow-admission-refusal-names-substituted-version`
delivers. Twin bump to 1.105.0 is not this item.

Dedup: no title/`code:`/map match; `docs/adr/README.md` §Declined concepts has
no admission row; `npm-client/sass-closure-upstream-dependency-drift` is the
closure fixture drift, unrelated to admission.

## Challenge

challenge: 2026-09-27 — clear

Checked with the `honest-substitution-signals` goal critic (fresh read-only
subagent): ADR-0344 correction route holds as a `DEC-2` dated correction of
two clauses (literal-1.100.0 admission, version-exact consequence); the
installed artifact stays exact 1.100.0, only request matching changes, so
0344's "widening requires new differential evidence" is not triggered.

## Decisions

- 2026-09-27 — user: «Расширить до semver-admits (Recommended)» — chosen over
  «Оставить exact-only» and «Расширить + бампнуть твин до 1.105.0» (the bump
  needs a new differential oracle; no item filed for it).
