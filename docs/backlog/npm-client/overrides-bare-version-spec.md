---
area: npm-client
status: ready
title: npm's bare-version override spelling (`"vite": "8.0.16"`) resolves as a range, not a package name
created: 2026-09-15
why: npm's own overrides spelling is a bare version/range; rifty's parser treats a value without '@' as a package NAME, so `{"overrides":{"vite":"8.0.16"}}` fetches packument "8.0.16" (404) — silent misparse of a real npm manifest
user_story: As a developer pinning vite the npm way in package.json overrides, I want `npm install` to honour `"vite": "8.0.16"`, but today rifty resolves package "8.0.16" and fails with a 404
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md]
code: [packages/npm-client/src/overrides.ts, packages/npm-client/src/shadow-shims.ts]
---

## Context

`overrides.ts` `parseTarget`: `"vite@8.0.16"` / `"npm:vite@8.0.16"` → {name, range}
(works end to end: probe installed one vite 8.0.16 for vitest's `^8` edge);
`"8.0.16"` → {name: "8.0.16", range: null} → `Failed to fetch packument 8.0.16: 404`.
Oracle (npm 11.17.0, evidence §Oracle): the same manifest on the host
resolves one hoisted `node_modules/vite@8.0.16` for vitest's `^8` edge —
a bare version is npm's own value form (alongside `$ref` and `npm:` aliases).
Discrimination (npa 13.0.2 probe, reference evidence): a bare value parsing as
a semver range binds to the KEYED package; a bare non-range value is a
same-name dist-tag in npm (rifty keeps its replacement-name reading — recorded
divergence, not claimed). `$ref` forms are an arborist feature above npa and
stay a named loud gap. Scope is this one parse branch — no
resolution/hoisting change (goal Decisions).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P1 verified by probe)

## Acceptance

1. Manifest `{"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}`
   with a fake registry serving vitest 4.1.11 (edge `vite: ^8.0.0`) and vite
   8.0.16 + 8.3.0 installs successfully and pins exactly `vite@8.0.16` (never
   8.3.0, never a packument fetch for the literal "8.0.16") → I1
2. Bare range forms npm binds to the keyed package — `"^8"`, `"8.x"`, `"*"` —
   resolve against the keyed package's packument (parse-level:
   `resolveOverride('vite', undefined, {vite: '^8'})` → `{name: 'vite', range: '^8'}`) → I1
3. The rifty extension spelling `"vite@8.0.16"` keeps resolving to
   `{name: 'vite', range: '8.0.16'}` (regression guard) → I1
4. A bare value that is not a valid range (`"bcryptjs"`) keeps today's
   replacement-name reading `{name: 'bcryptjs', range: null}` — the
   discriminator never swallows a package name → I1

## Reference contract

- Oracle: npm 11.17.0 (Node v24.16.0 host) + npm-package-arg 13.0.2 —
  `docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md`
  (commands + outputs + versions) and the epic evidence §Oracle.
- Mechanism: `npa.resolve(keyName, value)` discrimination — bare valid range ⇒
  same-name range; implemented on rifty's existing `semver.ts` forms (no new
  dependency, no resolver change).

## Parity cases

1. npm 11.17.0 installs one hoisted `node_modules/vite@8.0.16` for the
   scenario manifest (artifact: epic evidence §Oracle, command + output +
   version); rifty carrier = Acceptance-1 installer test asserting the same
   pinned tree shape against the fake registry → I1
2. npa 13.0.2 value discrimination: `"8.0.16"`/`"^8"`/`"8.x"` → same-name
   version/range, `"bcryptjs"`/`"latest"` → same-name tag, `"$dep"` → handled
   above npa (arborist `$ref`) (artifact: reference evidence probe); rifty
   carrier = Acceptance-2/4 parse-level tests → I1

## Out of scope

- `$ref` override values (`{"vite": "$dep"}`) — loud
  `NotImplementedError('npm-client.overrides.dollar-ref')`, never a packument
  fetch for the `$`-name.
- Range forms rifty's `semver.ts` cannot evaluate (hyphen ranges
  `"1.2.3 - 2.0.0"`) — not classified as ranges; keep today's loud
  packument-404 path.
- Bare non-range values (`"bcryptjs"`, `"latest"`): npm reads them as
  same-name dist-tags; rifty keeps its replacement-name reading — recorded
  divergence (reference evidence), not claimed here.
- Resolution/hoisting/dedupe changes — goal Decisions reject them ("honest
  npm" is a separate planned goal).

## Decisions

- 2026-10-01 — discriminator: a bare override value is range-like iff every
  `||`-branch's every comparator is a version/x-range rifty `semver.ts`
  evaluates; non-range bare values keep name semantics; `$`-prefixed values
  throw the named gap.
