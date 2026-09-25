---
area: npm-client
status: draft
title: Range matching follows node-semver for hyphen, `~>`, partial `>`/`<=` bounds and empty `||` branches
created: 2026-09-23
why: rifty's `matchesRange` is a semver subset; a spec npm resolves (`<=8`, `8.0.0 - 8.0.16`, `~>8.0`, `||`) locks another version or fails `No matching version` — now reachable from npm-spelled override values that used to 404 loudly
sources: [docs/adr/npm-client/0451-user-override-values-follow-npm-version-and-range-reading.md, docs/backlog/npm-client/reference/overrides-bare-version-spec-final-green.json, docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json]
code: [packages/npm-client/src/semver.ts, docs/public/compat/package-tooling.md]
---

## Context

REV-12 discovery (Final+GREEN concern, Ecosystem UX) of
`npm-client/reference/overrides-bare-version-spec-evidence.md`. `matchesRange` vs npm 11.17.0
`semver.satisfies(v, r, {loose: true})` over `[7.9.9, 8.0.0, 8.0.16, 8.3.0, 9.0.0]`:
`<=8` rifty `[7.9.9, 8.0.0]`, npm adds `8.0.16, 8.3.0`; `8.0.0 - 8.0.16` rifty
`[]`; `~>8.0` rifty `[]`; `||` rifty `[]`, npm all. Pre-existing for every
dependency spec; ADR-0451 opened the override path, so `{"vite": "<=8"}`
now silently locks vite 8.0.0 (npm 8.3.x) where it was a packument-404.
Also listed: `^0.0.x`, `8.0.x-beta`, loose-dropped tokens (`1.2.3 foo`).
Recorded only as ADR-0451 §Divergences and prose in a ✅ compat row.

## Next

Owner npm-client; trigger: a consumer spec in a claimed scenario hitting one
of these forms, or the next resolver unit. Parity first: node-semver
`satisfies`/`maxSatisfying` over a range × version corpus; then decide
whether the compat row stays ✅.
