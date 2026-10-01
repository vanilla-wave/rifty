---
area: npm-client
status: draft
title: Picker mis-selects prerelease versions with numeric identifiers above Number.MAX_SAFE_INTEGER
created: 2026-10-01
why: `comparePreRelease` (`semver.ts`) compares numeric prerelease identifiers via `Number.parseInt`, which rounds above 2^53-1 — `8.0.16-beta.9007199254740993` compares equal to `…beta.9007199254740992`, and `pickBestVersion`'s stable max-scan then keeps the earlier (wrong) candidate; npm-pick-manifest 11.0.3 selects the exact `.9007199254740993` (also: npm shortcuts an exact version match before range max-scan, rifty has no such shortcut)
user_story: As a user installing a package whose prerelease versions carry huge numeric identifiers (build numbers, timestamps), I want the same version npm would pick, but today rifty can select a lower prerelease
sources: [docs/backlog/npm-client/reference/overrides-bare-version-spec-final-green.json]
code: [packages/npm-client/src/semver.ts, packages/npm-client/src/installer-sources.ts]
---

## Context

Verified 2026-10-01 by the independent Final+GREEN reviewer of
`overrides-bare-version-spec` (Node v24.16.0, npm-pick-manifest 11.0.3, npa
13.0.2): range `8.0.16-beta.9007199254740993` → rifty picks
`8.0.16-beta.9007199254740992`, npm picks the exact `.9007199254740993`.
Picker/compare are unchanged from BASE 0c4c1b07 — pre-existing, affects
ordinary dependency ranges equally (not overrides-specific). Beyond the
declared clauses of the overrides unit (REV-2/3 NOTE), routed here per
REV-12. Fix shape: compare numeric prerelease identifiers by length-then-lex
when either exceeds MAX_SAFE_INTEGER (semver §11.4 numeric comparison is on
the mathematical value), and consider npm's exact-version shortcut in the
picker.

## Challenge

challenge: 2026-10-01 — factual capture (no premise critic needed, README §Challenge)
