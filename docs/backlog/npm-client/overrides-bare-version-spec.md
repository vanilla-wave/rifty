---
area: npm-client
status: ready
title: npm's bare-version override spelling (`"vite": "8.0.16"`) resolves as a range, not a package name
created: 2026-09-15
why: npm's own overrides spelling is a bare version/range; rifty's parser treats a value without '@' as a package NAME, so `{"overrides":{"vite":"8.0.16"}}` fetches packument "8.0.16" (404) — silent misparse of a real npm manifest
user_story: As a developer pinning vite the npm way in package.json overrides, I want `npm install` to honour `"vite": "8.0.16"`, but today rifty resolves package "8.0.16" and fails with a 404
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/npm-client/src/overrides.ts, packages/npm-client/src/shadow-shims.ts]
---

## User scenario

Goal scenario step 2 (`→ I1`): manifest `{"devDependencies":{"vitest":"4.1.11"},
"overrides":{"vite":"8.0.16"}}` installs one `node_modules/vite@8.0.16`
satisfying vitest's `vite ^8` edge; exit 0.

## Context

`overrides.ts` `parseTarget`: `"vite@8.0.16"` / `"npm:vite@8.0.16"` → {name, range}
(works end to end: probe installed one vite 8.0.16 for vitest's `^8` edge);
`"8.0.16"` → {name: "8.0.16", range: null} → `Failed to fetch packument 8.0.16: 404`.
Oracle (npm 11.17.0, evidence §Oracle): the same manifest on the host
resolves one hoisted `node_modules/vite@8.0.16` for vitest's `^8` edge —
a bare version is npm's own value form (alongside `$ref` and `npm:` aliases);
a bare package name is not. Only the npm
spelling needs to parse as "same name, this range"; the rifty `name@range`
extension stays. `$ref` forms remain a loud gap. Scope is this one parse
branch — no resolution/hoisting change (goal Decisions).

## Acceptance

1. `resolveOverride('vite', undefined, {vite: '8.0.16'})` →
   `{name: 'vite', range: '8.0.16', source: 'user'}` — the effective request is
   the overridden package at the bare range (`→ I1`).
2. Bare ranges across npm's shapes: `"8.0.16"`, `"^8.0.0"`, `"2.x"`, `"*"`
   parse as same-name ranges; an install through `install()` with the goal
   manifest resolves vite 8.0.16 from the registry (`→ I1`).
3. The rifty spellings keep working: `"vite@8.0.16"`, `"npm:vite@8.0.16"`,
   bare-name redirects (`bcrypt: 'bcryptjs'`), alias targets
   (`'esbuild-wasm@0.28.0'`), `parent>child` keys, and baked overrides all
   parse unchanged (`→ scenario` step 2 + baseline).

## Parity cases

npm 11.17.0 host oracle (evidence §Oracle): bare-value override resolves one
hoisted vite 8.0.16 for vitest's `^8` edge. RED target: the
`resolveEffectivePackageRequest`/`resolveOverride` shape for the npm spelling;
the install-level case runs the manifest through `install()` against a fake
registry (vitest + one vite version) asserting one vite@8.0.16 link and exit 0.

## Out of scope

- `$ref` override values (`"baz": "$baz"`) — loud gap, honest-npm territory.
- Resolution/hoisting identity changes — goal Decisions reject Arborist dedupe.
- Re-resolving over a stale `node_modules/vite` — `npm-client/stale-package-dir-on-version-change`.

## Fault matrix

| Axis | Operation | Outcome |
|---|---|---|
| malformed manifest | override value that is neither range nor name@spec (e.g. `$ref`) | loud: parsed as a package name → registry 404 surfaces (unchanged baseline) |

## Decisions

- ready-verdict: 2026-10-02 — Contract+RED @ <pending>
- 2026-09-15 — user (goal Decisions): npm route = overrides pin; fix npm's
  bare-version spelling (one line, this unit); lock replay is the second
  documented path; no resolver/hoisting work.
- 2026-10-02 — agent (PICKUP): bare value parses as same-name range only when
  it is range-shaped (npm `npa` treats a value with no name part as the key
  package's spec); non-range bare values (package-name redirects) keep today's
  parse, so baked/registry redirects (`bcrypt: 'bcryptjs'`) are untouched.