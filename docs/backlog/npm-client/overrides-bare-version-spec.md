---
area: npm-client
status: ready
title: npm's bare-version override spelling (`"vite": "8.0.16"`) resolves as a range, not a package name
created: 2026-09-15
why: npm's own overrides spelling is a bare version/range; rifty's parser treats a value without '@' as a package NAME, so `{"overrides":{"vite":"8.0.16"}}` fetches packument "8.0.16" (404) — silent misparse of a real npm manifest
user_story: As a developer pinning vite the npm way in package.json overrides, I want `npm install` to honour `"vite": "8.0.16"`, but today rifty resolves package "8.0.16" and fails with a 404
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/npm-client/reference/overrides-bare-version-spec-evidence.md]
code: [packages/npm-client/src/overrides.ts, packages/npm-client/src/semver-loose-range.ts, packages/npm-client/src/shadow-shims.ts, packages/npm-client/src/internal/shadow/admission.ts, packages/npm-client/src/installer-request.ts]
---

## Context

`overrides.ts` `parseTarget`: `"vite@8.0.16"` / `"npm:vite@8.0.16"` → {name, range}
(works end to end: probe installed one vite 8.0.16 for vitest's `^8` edge);
`"8.0.16"` → {name: "8.0.16", range: null} → `Failed to fetch packument 8.0.16: 404`.
Oracle (npm 11.17.0): Arborist replaces the overridden edge's spec with the
value and reads it against the edge name — version, range or dist-tag of the
SAME package; only `npm:` names another package. The registry hosts packages
literally named `2`, `x`, `latest`, `beta`, so a name misparse consults an
unrelated package. `$name` references also misparse (404), not a named throw.
The rifty `name@range` extension stays. Scope is the value reading: a
version/range value continues as the edge's own spec, so rifty's per-package
policies still apply — no resolver/hoisting change (goal Decisions).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P1 verified by probe)

## Reference contract

- Oracle: npm 11.17.0 on Node v24.16.0 (npm-package-arg 13.0.2, @npmcli/arborist 9.8.0, semver 7.8.4), registry.npmjs.org; artifact `docs/backlog/npm-client/reference/overrides-bare-version-spec-probe-output.json` (probe `.mjs`, `cmp`-reproducible; commands, hashes and tables in `overrides-bare-version-spec-evidence.md`).
- Mechanism: `edge.js` `get spec` substitutes the override value (`''`/`*` keep the edge spec; `$name` reads the root manifest); `build-ideal-tree.js` `npa.resolve(edge.name, value)` reads version/range/tag of the edge's own package; `npm:` aliases another package.
- Rifty reuse: the one request authority `resolveEffectivePackageRequest` (live resolve, lock replay, Eddy), which the ADR-0051 native gate, builtin shadow-recipe admission and baked redirects already consume; the existing semver matcher (`latest` via `rangeIsUnconstrained`); request admission's `NotImplementedError` ceilings; node-semver 7.8.4's loose grammar (ported, recognition only).

## Acceptance

1. Browser shell, clean project, real registry: the goal scenario manifest (vitest 4.1.11 + `"overrides": {"vite": "8.0.16"}`) `npm install` exits 0 and locks exactly npm 11.17.0's vite entries (one `node_modules/vite@8.0.16` for vitest's `^6 || ^7 || ^8` edge); carriers `tests/e2e/npm-override-bare-version.spec.ts` and `installer-override-npm-value.contract.test.ts` row `scenario-vitest-vite` → I1
2. The rifty spelling `vite@8.0.16` installs the same vite lock entries in that e2e, and in `install()` yields the version npm locks for the bare spelling (debug and scenario manifests); carrier `installer-override-npm-value.contract.test.ts` → I1
3. `install()` over the probe manifests — exact, `v`/`=`-prefixed, caret, tilde, x-range, partial `2`, `x`, comparator set, union, the `latest` dist-tag, the no-op values `''`/`*`, the padded ranges ` * `/` ` (npm: latest, not the edge spec), and a bare override added over an existing lock — leaves the dependent resolving the version npm 11.17.0 locks, requests no packument named after the value, installs no other package, and on fresh installs matches npm's placement; carrier `installer-override-npm-value.contract.test.ts` → ADR-0451
4. Classification of every probe value npm reads as a version/range (incl. whitespace-padded, prerelease, `~>`, hyphen, `||`, and the loose-grammar sweep: spaced operators, `8.0.16beta`, `v 8.0.16`, `1.2.3 foo`, `foo || 8`, `+1`, `||`) gives the overridden package at npm's `fetchSpec`, also for a `parent>child` key (child package); `latest` → overridden package unconstrained; `*` → no user override; `npm:` is read first (`npm:8.0.16`, `npm:2` name packages); ETARGET words (`bcryptjs`, `7zip-bin`) and every other npm tag reading (`beta`, `next`, `x.1`, `1.2.3.4`, `2fa`) keep the rifty replacement name; baked `bcrypt` → `bcryptjs` unchanged; carrier `overrides-npm-value.contract.test.ts` → ADR-0451
5. A `$name` override throws `NotImplementedError('npm-client.dependency-spec.override-reference')` before any registry read (npm resolves it: probe `reference`); carrier `installer-override-npm-value.contract.test.ts` → ADR-0451
6. `docs/public/compat/package-tooling.md` carries `package.json#overrides` value rows: npm version/range/`latest` ✅, rifty `name@range` and bare replacement names as extensions, `$name` ❌, and the ADR-0451 divergences → ADR-0451
7. An npm version/range override is the edge's spec, not a substitution: `install()` with `overrides: {N: V}` ends exactly as the install where the dependent declares `N@V` — ADR-0051 native gate (required abort, optional skip, lock replay), builtin shadow-recipe admission (admitted, `NotImplementedError`), baked redirect; the rifty self-map and `name@range` targets stay exempt from the gate; carrier `installer-override-npm-value-policy.contract.test.ts` → ADR-0451, ADR-0051

## Parity cases

1. npm-package-arg reading of the probe corpus (`classify`, 70 values: 30 certified at Contract+RED + a 40-value loose-grammar sweep): version/range → same package at `fetchSpec`; `latest` and other words → tag; `npm:` → alias target name; `vite@8.0.16` / `$vite` → `EINVALIDTAGNAME`; RED `overrides-npm-value.contract.test.ts` (18 failing) → ADR-0451
2. npm locks for debug 4.3.4's ms edge under each claimed override (`installs`: exact/`v`/`=` 2.0.0, caret 2.1.3, tilde 2.0.0, `2.0.x` 2.0.0, `2` 2.1.3, `x` 2.1.3, `*`/`''` 2.1.2, ` * `/` ` 2.1.3, comparator set 2.0.0, union 2.0.0, `latest` 2.1.3, existing lock + `2.0.0` → 2.0.0); RED `installer-override-npm-value.contract.test.ts` → ADR-0451
3. npm lock for the goal scenario (`scenario-vitest-vite`): one `node_modules/vite@8.0.16`; RED install contract and browser e2e (`Failed to fetch packument 8.0.16: 404`, exit 1) → I1
4. npm resolves `$ms` to the root dependency spec (`reference` → ms 2.0.0); rifty target is the named loud gap; RED install contract (`Failed to fetch packument $ms: 404`, not `NotImplementedError`) → ADR-0451

## Out of scope

- `$name` reference overrides: `NotImplementedError('npm-client.dependency-spec.override-reference')`, compat ❌.
- Nested override objects (`{"vitest": {"vite": "8.0.16"}}`): existing `NotImplementedError('npm-client.package-json.overrides')`, compat ❌.
- Non-registry override targets (`file:`, git, URL, `workspace:`): existing `NotImplementedError('npm-client.dependency-spec.<kind>')`, compat ❌.

## Decisions

- ready-verdict: 2026-09-23 — Contract+RED @ 43beed245648f0657143cc0c4705b54dc49627a1
- 2026-09-23 — value grammar and rejected candidates: ADR-0451 (npm version/range + `latest` → overridden package; `''`/`*` no override; `$` loud; rifty `name@range` and bare replacement names kept; baked table unchanged).
- 2026-09-23 — bare-word dist-tag reading is agent-owned (RDY-6): the scenario uses a version; switching words to tags breaks the documented escape hatch (compat `incompatible-packages.md`, ADR-0051 self-map); goal Decision "минимальной заплаткой" keeps the extension.
- 2026-09-23 — divergences outside I1 (other dist-tags, hyphen/`~>` matching, range-less `npm:` alias, alias placement, `EOVERRIDE`, re-resolve placement, `@scope/pkg`) recorded in ADR-0451 and the compat row (Acceptance 6).
- 2026-09-23 — no Fault matrix: owned in-process request projection (value reading + edge-spec continuation); lock replay and Eddy consume the same request authority; no cache/persistence/network/concurrency mechanism changes.
- 2026-09-23 — premise: goal challenge reused; `latest`, `*` and a loud `$` are npm readings of the same parse branch — the loud `$` makes the draft's "loud gap" claim true.
- re-cut: 2026-09-23 — +Acceptance 7 (edge-spec policy continuity, Contract+RED concern 1); Acceptance 3/4 and Parity 1/2 widened to the loose-grammar sweep and padded ` * `/` ` rows (concern 3); Acceptance 6 row split into three rows — trace: none
- 2026-09-23 — Contract+RED concern 1 (ADR-0051 gate skipped) → FIX: the same `override` reading also skipped recipe admission and baked redirects (sibling sweep); version/range values continue as the edge spec (ADR-0451); RED `installer-override-npm-value-policy.contract.test.ts` fails 7/7 against the parse-only fix.
- 2026-09-23 — concern 3 (handwritten grammar) → FIX: node-semver loose recognizer ported; corpus 30 → 70 kills the handwritten grammar on 8 values (evidence).
- 2026-09-23 — concern 2 (ADR-0006 "no dialect") → NOTE: the dialect predates this unit (ADR-0051 escape hatch); ADR-0451 adds a decision on that seam (DEC-2), no graft.
- 2026-09-23 — concerns 4/5 (other dist-tags; matcher gaps) and Acceptance 6 carrier → NOTE: divergences in ADR-0451 + compat rows; matcher gaps hit every dependency spec — routed outside the unit (REV-12).
