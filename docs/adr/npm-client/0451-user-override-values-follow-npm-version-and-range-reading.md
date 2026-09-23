# ADR 0451: User override values follow npm's version/range reading

Status: Accepted
Date: 2026-09-23

> TL;DR: a user `overrides` value npm reads as a version/range (or the tag
> `latest`) resolves the OVERRIDDEN package at that spec; `''`/`*` are no
> override; `$name` is a named loud gap; rifty's `name@range` and bare
> replacement-name spellings stay. Cites ADR-0006 (D-005) and ADR-0051.

## Context

Goal `vitest-run-in-browser` I1: `{"overrides": {"vite": "8.0.16"}}` fails
`Failed to fetch packument 8.0.16: 404` — `overrides.ts` reads every value
without `@` as a replacement package NAME.

Oracle (npm 11.17.0 / Node v24.16.0, npm-package-arg 13.0.2, Arborist 9.8.0;
`docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md`):
Arborist replaces the overridden edge's spec with the value (`edge.js`
`get spec`: `''`/`*` keep the edge spec, `$name` reads the root manifest) and
resolves it as `npa.resolve(edge.name, value)` — version, range or dist-tag of
the SAME package; only `npm:` names another package. The registry hosts
packages literally named `2`, `x`, `latest`, `beta`, so a name misparse
consults an unrelated package.

ADR-0006 promises npm's format; ADR-0051 and the compat escape hatch
(`"better-sqlite3": "sql.js"`) document a rifty bare replacement name, which
npm reads as a dist-tag (ETARGET when none exists).

## Decision

User value `V` for child package `N`, first match wins:

1. `''` or `*` — no user override (npm keeps the edge spec).
2. `npm:…` — alias, unchanged: the rest is `name[@spec]`, so `npm:2` and
   `npm:8.0.16` name packages.
3. `$…` — `NotImplementedError('npm-client.dependency-spec.override-reference')`
   at request admission, before any registry read.
4. `name@range` (`@` after the first character) — rifty extension, unchanged
   (npm: `EINVALIDTAGNAME`); I1 keeps it.
5. npm's registry version/range spelling — `||` branches of hyphen ranges or
   comparators (`<`/`<=`/`>`/`>=`/`=`/`~`/`~>`/`^`, `v`/`=` prefixes, partial
   versions, `x`/`X`/`*`, prerelease/build) — or the dist-tag `latest` →
   `{name: N, range: V.trim()}`.
6. Anything else — rifty replacement package name, unchanged.

Baked table values keep the rifty grammar. The classification lives with the
override parse; rifty's semver matcher is not changed. Lock replay (ADR-0023)
and Eddy consume the same `resolveEffectivePackageRequest` output.

Candidates:

- Exact versions only (`parse`) — killed: `"ms": "2"`, `"x"`, `"^2.0.0"` still
  read as names (probe).
- Full npm reading, every bare word a dist-tag — killed: breaks ADR-0051's
  self-map and the documented escape hatch; the goal authorizes one spelling
  fix; rifty resolves only `latest`.
- `semver` package `validRange` — killed: new external dependency (DEC-1)
  for one predicate; the probe corpus pins the grammar.
- Chosen: grammar predicate + `latest` + no-op + loud `$`.

## Divergences (recorded, not claimed)

Each is pre-existing or outside I1; npm's side is in the probe output:

- dist-tags other than `latest` (`"ms": "beta"` → npm `3.0.0-beta.2`) read as
  replacement names;
- hyphen and `~>` ranges classify as ranges, but the matcher supports neither
  for any spec (`No matching version`);
- range-less `npm:x` keeps the edge range (npm: `*`); alias targets install
  under their own name (ADR-0188);
- a root direct dependency changed by an override: npm `EOVERRIDE`, rifty
  applies it (the escape hatch relies on it);
- re-resolve after adding an override to an existing lock: npm nests the new
  copy under the dependent; rifty claims the version, not the placement;
- `@scope/pkg`: npm reads a directory path, rifty a scoped replacement name.

## Consequences

- (+) npm-authored manifests pinning transitive versions/ranges install the
  locked version npm resolves; no packument is requested for the value.
- (+) `$name` fails with a named `NotImplementedError` instead of a 404.
- (−) Bare words still split npm (dist-tag) and rifty (package); compat lists it.
