---
area: npm-client
status: ready
title: npm's bare-version override spelling (`"vite": "8.0.16"`) resolves as a range, not a package name
created: 2026-09-15
why: npm's own overrides spelling accepts an exact version; rifty treats `{"overrides":{"vite":"8.0.16"}}` as a package NAME and fetches packument "8.0.16" (404)
user_story: As a developer pinning vite the npm way in package.json overrides, I want `npm install` to honour `"vite": "8.0.16"`, but today rifty resolves package "8.0.16" and fails with a 404
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md]
code: [packages/npm-client/src/overrides.ts, packages/npm-client/src/shadow-shims.ts]
---

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

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P1 verified by probe)

## Reference contract

npm 11.17.0 on Node 24.16.0: `npm install --package-lock-only --ignore-scripts`
with `devDependencies: {vitest: "4.1.11"}` and `overrides: {vite: "8.0.16"}`
records one `node_modules/vite@8.0.16` for vitest's Vite edge. The command,
lockfile query, and output are in
`docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md` §Oracle.

## Acceptance

1. A clean install of the scenario manifest with npm's `"vite": "8.0.16"` override pins one root-visible `node_modules/vite@8.0.16`; it never requests packument `8.0.16`. → I1
2. The existing rifty `"vite": "vite@8.0.16"` spelling still pins the same package. → I1

## Parity cases

1. npm 11.17.0 resolves the bare exact-version override as a range on the existing Vite package; RED target: the same manifest installs through rifty's `install()` with one Vite 8.0.16. → I1

## Out of scope

`$ref` overrides, general npm override grammar, and resolution/hoisting changes
remain outside this slice; the accepted goal covers only the exact Vite pin.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ ac6136bedeef16b6f5bc11c913e0464885f731c2
- 2026-09-23 — observed defect route: npm 11.17.0 lockfile oracle and rifty browser failure recorded in the goal evidence; installer RED reproduces the mistaken `8.0.16` packument lookup.
- 2026-09-23 — same-name exact version is the parse branch; preserve the existing `name@range` extension and resolver placement (goal Decisions).
