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

npm 11.17.0 / Node 24.16.0: scenario lock has one vite 8.0.16; captured in
`docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md` §Oracle.

## Acceptance

1. Bare version keeps the requested dependency name; explicit `vite@8.0.16` remains accepted. Carrier: `packages/npm-client/src/overrides.test.ts`, final scenario install. → I1

## Parity cases

1. `overrides: {vite: '8.0.16'}` selects vite 8.0.16 for vitest's edge, matching the captured npm lock. → I1

## Out of scope

Resolver/hoisting changes; unsupported package spec protocols retain named ceilings.

## Decisions

- 2026-09-23 — RDY-8 observed defect; existing npm artifact supplies baseline. RED: `pnpm exec vitest run packages/npm-client/src/overrides.test.ts`: 6 failures, 3 pass; bare targets misidentified as names. No new state/transport mechanism.
- 2026-09-23 — `corrupt-input` at in-process target projection; user bare targets retain dependency identity, baked bare aliases retain their replacement identity. Shared `resolveOverride` owns both install and lock replay; transport axes physically excluded.
