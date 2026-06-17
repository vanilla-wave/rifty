---
area: npm-client
status: active
title: Unconstrained install resolves a prerelease instead of the latest dist-tag
created: 2026-06-16
why: pickBestVersion(versions, '*') treats '*' as matching prereleases and picks the highest, so `npm install <pkg>` (no range) can resolve e.g. 4.0.0-alpha.13 — npm itself installs the `latest` dist-tag (stable)
user_story: As a dev running `npm install prettier` with no version range, I want the latest STABLE (the registry's `latest` dist-tag), not a prerelease alpha.
sources: [ADR-0006, ADR-0042]
code: [packages/npm-client/src/installer.ts]
---

## Context

Found incidentally during the ADR-0150 P6a prettier e2e: `npm install prettier` resolved `prettier@4.0.0-alpha.13`. `pickBestVersion(versions, '*')` (installer.ts ~:851) follows semver-range semantics where `*` matches anything including prereleases, and returns the max — but real npm, for an UNCONSTRAINED install, honors the package's `latest` dist-tag (a stable), not the max version. Diverges from npm for any package whose highest published version is a prerelease.

## Options or Next

For an unconstrained spec (no explicit range / `latest`), prefer the registry `latest` dist-tag; only fall through to max-satisfying when an explicit range is given. Otherwise exclude prereleases from `*` unless the range explicitly opts in (semver convention). Add a regression test with a package whose max is a prerelease + a stable `latest`.

## Reversibility

REVERSIBLE — install-resolution heuristic fix; no public API / wire change.
