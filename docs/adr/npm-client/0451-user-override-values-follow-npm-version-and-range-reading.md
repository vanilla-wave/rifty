# ADR 0451: User override values follow npm's version/range reading

Status: Accepted
Date: 2026-09-23

> TL;DR: a user `overrides` value npm reads as a version/range (or the tag
> `latest`) is the overridden edge's spec — rifty resolves the SAME package at
> it, and baked redirects, shadow recipes and ADR-0051's native gate apply as
> for a declared `N@V`; `''`/`*` are no override; `$name` is a named loud gap;
> rifty's `name@range` and bare replacement-name spellings stay substitutions.
> Cites ADR-0006 (D-005) and ADR-0051.

## Context

Goal `vitest-run-in-browser` I1: `{"overrides": {"vite": "8.0.16"}}` fails
`Failed to fetch packument 8.0.16: 404` — `overrides.ts` reads every value
without `@` as a replacement package NAME.

Oracle (npm 11.17.0 / Node v24.16.0, npm-package-arg 13.0.2, Arborist 9.8.0,
semver 7.8.4; `docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md`):
Arborist replaces the overridden edge's spec with the value (`edge.js`
`get spec`: exact `''`/`*` keep the edge spec, `$name` reads the root
manifest) and resolves it as `npa.resolve(edge.name, value)` — version, range
or dist-tag of the SAME package (`semver.valid`/`validRange` loose, else tag);
only `npm:` names another package. Nothing else about the edge changes. The
registry hosts packages literally named `2`, `x`, `latest`, `beta`, so a name
misparse consults an unrelated package.

ADR-0006 promises npm's format; ADR-0051 and the compat escape hatch
(`"better-sqlite3": "sql.js"`, self-map `"pkg": "pkg"`) document a rifty bare
replacement name, which npm reads as a dist-tag (ETARGET when none exists).

## Decision

User value `V` for child package `N`, first match wins:

1. Exactly `''` or `*` — no user override (npm keeps the edge spec).
2. `npm:…` — alias, unchanged: the rest is `name[@spec]`, so `npm:2` and
   `npm:8.0.16` name packages.
3. `$…` — `NotImplementedError('npm-client.dependency-spec.override-reference')`
   at request admission, before any registry read.
4. `name@range` (`@` after the first character) — rifty extension, unchanged
   (npm: `EINVALIDTAGNAME`); I1 keeps it.
5. What npm reads as a version or range — `semver.validRange(V, true)`,
   node-semver 7.8.4's loose recognizer ported as
   `packages/npm-client/src/semver-loose-range.ts` (loose mode drops invalid
   tokens: `1.2.3 foo` is a range) — or the dist-tag `latest` →
   `{name: N, range: V.trim()}`.
6. Anything else — rifty replacement package name, unchanged.

A decision-5 value is the edge's spec, not a substitution:
`resolveEffectivePackageRequest` continues the request as a plain `N@V` edge —
baked redirects, builtin shadow-recipe admission (against `V`) and ADR-0051's
native gate (live resolve and lock replay) apply exactly as for a dependency
declared `N@V`. Values 2, 4 and 6 stay substitutions, exempt from the gate
(ADR-0051 D2 and its self-map escape hatch: "override" there means a
substitution).

Baked table values keep the rifty grammar. Rifty's semver matcher is not
changed. Lock replay (ADR-0023) and Eddy consume the same
`resolveEffectivePackageRequest` output.

Candidates:

- Exact versions only (`parse`) — killed: `"ms": "2"`, `"x"`, `"^2.0.0"` still
  read as names (probe).
- Full npm reading, every bare word a dist-tag — killed: breaks ADR-0051's
  self-map and the documented escape hatch; the goal authorizes one spelling
  fix; rifty resolves only `latest`.
- Handwritten version/range grammar — killed: the widened probe corpus shows 8
  npm readings it gets wrong (`8.0.16beta`, `v 8.0.16`, `1.2.3 foo`,
  `foo || 8`, `foo *`, `+1`, `1.2.3*`, `x.1`); the port gets 0, and 0 of
  900 000 fuzzed strings against npm's own semver (evidence).
- `semver` package `validRange` — killed: new external dependency (DEC-1)
  in the browser install path for one predicate; the port keeps its grammar
  sources verbatim.
- Decision-5 values as user substitutions (non-null override) — killed: skips
  ADR-0051's gate, recipe admission and baked redirects for npm-authored pins;
  `installer-override-npm-value-policy.contract.test.ts` fails 7 of 7 cases.
- Chosen: ported loose recognizer + `latest` + no-op + loud `$` + edge-spec
  continuation.

## Divergences (recorded, not claimed)

Each is pre-existing or outside I1; npm's side is in the probe output:

- dist-tags other than `latest` (`"ms": "beta"` → npm `3.0.0-beta.2`) read as
  replacement names;
- range matching is rifty's semver subset for every spec: hyphen, `~>`,
  partial `>`/`<=` bounds (`<=8` → rifty `8.0.0`, npm `<9.0.0-0`), `^0.0.x`,
  `8.0.x-beta`, loose-dropped tokens (`1.2.3 foo`) and empty `||` branches
  differ from node-semver (`No matching version` or another version);
- numeric components past `Number.MAX_SAFE_INTEGER`: npm a tag or
  `EINVALIDTAGNAME`, rifty a range — both fail the install;
- range-less `npm:x` keeps the edge range (npm: `*`); alias targets install
  under their own name (ADR-0188);
- a root direct dependency changed by an override: npm `EOVERRIDE`, rifty
  applies it (the escape hatch relies on it);
- re-resolve after adding an override to an existing lock: npm nests the new
  copy under the dependent; rifty claims the version, not the placement;
- `@scope/pkg` and `*.tgz`/`*.tar(.gz)` values: npm reads a directory/file
  (npa tests file extensions before semver); rifty reads a non-version name
  (`vite-8.0.16.tgz`) as a package name (404) and a version-shaped one
  (`8.0.16.tgz`, npm `validRange` loose `8.0.1-6.tgz`) as a decision-5 range
  of the same package that rifty's matcher matches nothing
  (`No matching version`); uppercase `NPM:` aliases read as a package name
  (404).

## Consequences

- (+) npm-authored manifests pinning transitive versions/ranges install the
  locked version npm resolves; no packument is requested for the value.
- (+) An npm version pin of a native or shadow-substituted package meets the
  same policy as a declared dependency (loud `ENATIVEUNSUPPORTED`, recipe
  admission, baked redirect) — never a silent native install.
- (+) `$name` fails with a named `NotImplementedError` instead of a 404.
- (−) Bare words still split npm (dist-tag) and rifty (package); compat lists it.
