---
area: npm-client
status: draft
title: Where rifty's override escape-hatch dialect collides with npm (non-`latest` dist-tags, `@scope/pkg`, `EOVERRIDE`), which reading wins?
created: 2026-09-24
why: ADR-0451 keeps bare words as replacement package names and applies overrides to root direct dependencies; npm reads the same manifests as a dist-tag / directory, or refuses with `EOVERRIDE` — an npm-authored manifest installs something else in rifty
sources: [docs/adr/npm-client/0451-user-override-values-follow-npm-version-and-range-reading.md, docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md, docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json, docs/public/compat/package-tooling.md, docs/public/compat/incompatible-packages.md]
code: [packages/npm-client/src/overrides.ts, packages/npm-client/src/installer-request.ts]
---

## Question

Should an override value npm reads differently from rifty's escape hatch
follow npm (and the escape hatch move to another spelling), stay rifty's
dialect (documented divergence), or become a named loud gap? Cases:

1. dist-tag other than `latest` — `{"ms": "beta"}`: npm installs
   `3.0.0-beta.2` (evidence probe row `tag-beta`); rifty reads a
   replacement package named `beta`.
2. `@scope/pkg` — npm-package-arg 13.0.2 reads a directory
   (`npa.resolve('ms', '@scope/pkg')` → `directory`, probe 2026-09-24);
   rifty a scoped replacement package.
3. root direct dependency — `{"ms": "2.0.0"}` with `dependencies.ms
   ^2.1.0`: npm exits 1 `EOVERRIDE` "Override for ms@^2.1.0 conflicts with
   direct dependency" (row `direct-dep-conflict`); rifty applies it. npm's
   accepted form `$ms` is `NotImplementedError('npm-client.dependency-spec.override-reference')`.

## Context

REV-12 discoveries of `npm-client/reference/overrides-bare-version-spec-evidence.md`
(vitest-run-in-browser item 1), recorded as ADR-0451 §Divergences and
compat ⚠️ `package-tooling.md` "`package.json#overrides` rifty
spellings". ADR-0451 killed "every bare word a dist-tag" because it breaks
ADR-0051's self-map and the `incompatible-packages.md` escape hatch
(`{"better-sqlite3": "sql.js"}`); that trade-off is the decision here.
The goal's scenario manifest has no direct `vite` dependency, so its I7
precondition does not hit case 3.

## Next

Owner npm-client; a user-visible dialect choice — settle at refine with
the user (RDY-6), not by an agent. Trigger: an npm-authored manifest using
one of the three shapes, or a request to retire the escape-hatch spelling.
