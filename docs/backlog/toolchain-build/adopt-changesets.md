---
area: toolchain-build
status: draft
title: (opt) Adopt changesets for versioning + changelogs
created: 2026-06-08
why: nicer release ergonomics over hand-maintained lockstep versions + changelogs; optional, not yet justified
user_story: As a rifty maintainer cutting a release, I want `@changesets/cli` to bump versions + generate per-package changelogs automatically, but today versions move lockstep by hand and every CHANGELOG is hand-edited.
sources: [A8, ADR-0070]
---
## Context
EPIC A8 (deferred): adopt `changesets` for versioning/changelog generation. ADR-0070 ships lockstep versioning (all `@riftydev/*` released together; `pnpm publish` rewrites `workspace:*` to the same version) + tag-driven release; changelogs are hand-maintained. changesets would automate version bumps + per-package changelog generation.
## Options / Next
Next (when pulled): wire `@changesets/cli`, decide lockstep vs independent (ADR-0070 D4 is lockstep — changesets' `fixed`/`linked` config must encode that), regenerate the per-package CHANGELOGs (subsumes A5). New dev tooling dependency. Deferred: release ergonomics aren't painful at current cadence; revisit when release frequency or contributor count grows.
## Reversibility
IRREVERSIBLE-ish — adds a new external dev dependency (`@changesets/cli`) and touches the release pipeline ADR-0070 defines; ratify with an ADR (cite ADR-0070, especially the D4 lockstep contract) when the track starts. Gate: pull only when the manual release flow becomes a real burden.
