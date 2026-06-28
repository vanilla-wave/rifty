---
area: distribution
status: ready
title: Publish @riftydev/git + @riftydev/ts-language-service to npm
created: 2026-06-28
why: two of the most differentiating capabilities are built/proven in-repo and in the publish SPEC but unpublished — `npm i @riftydev/git` 404s and the umbrella's ./git + ./ts-language-service subpaths are dead until they ship
user_story: As a developer told rifty has real isomorphic-git and a real in-browser tsserver, I want `npm i @riftydev/git` and `@riftydev/ts-language-service` to work at the lockstep version, but today they are unpublished so the umbrella subpaths 404.
epic: open-auditable-launch
sources: [docs/public/publishing.md]
code: [packages/git/package.json, packages/ts-language-service/package.json, packages/rifty/package.json]
---

## Context

Both packages exist with `publishConfig` (not `private`) and are in the `tools/publishing/sync-publish-config.mjs` SPEC; `release.yml` publishes `./packages/*`. The umbrella `packages/rifty/package.json` maps `./git` (`:39,:81-83`) and `./ts-language-service` (`:44,:101-103`) and depends on both (`workspace:*`) — so those subpaths are dead until publish. OIDC trusted-publishing cannot create a brand-new package name → each needs a one-time Phase-1 token bootstrap. `docs/public/publishing.md` still says "Publishable set (12 packages)" / "packages/* (11)" — stale: `packages/` now holds 13 dirs, so the published set is **14** (13 `packages/*` + `@riftydev/shadow-registry`); the "12" recurs at publishing.md lines 14/19/59/68/94/104/108 and the `.github/workflows/release.yml` header. The README packages table omits git + ts-language-service. This is operational, not engineering.

## Acceptance

- On a clean machine, `npm i @riftydev/git` and `npm i @riftydev/ts-language-service` succeed at the current lockstep 0.x version.
- The umbrella subpaths `@riftydev/sdk/git` and `@riftydev/sdk/ts-language-service` resolve from a clean install.
- Both packages appear in the README packages table.
- Every package-count reference in `docs/public/publishing.md` (lines 14/19/59/68/94/104/108) and the `.github/workflows/release.yml` header comment corrected to the new totals: **14 published = 13 `packages/*` + 1 `@riftydev/shadow-registry`**.

## Parity cases

None — release/ops, no Node-API behavior. Verification is the clean-machine install + subpath resolution.

## Out of scope

- No version-line change (stays lockstep 0.x).
- No package CONTENT change (both already built + parity-proven in-repo).
- No trusted-publisher automation beyond the per-name Phase-1 bootstrap.

## Decisions

- Publish at the existing lockstep 0.x.
- CONFIRM-FIRST: first-publish of a new public npm name is outward/irreversible — get explicit go-ahead before the Phase-1 token bootstrap.
- No ADR — packages + publish wiring already exist; this is not a public-API design fork.
