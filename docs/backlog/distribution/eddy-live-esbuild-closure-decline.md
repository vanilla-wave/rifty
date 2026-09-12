---
area: distribution
status: draft
title: Deployed eddy declines every esbuild closure (`integrity-missing`) — the launch eddy figure is unmeasurable
created: 2026-09-02
why: eddy.rifty.dev answers any dependency set that closes over `esbuild@0.28.0` (every Vite project, the launch deep-link tile) with `422 integrity-missing`; the client falls back to standard install, `pnpm bench` records the eddy pass `unmeasured`, and the 1.88x in `docs/public/hosting-eddy.md` cannot be reproduced — while the CI live smoke stays green because it posts a closure without esbuild
user_story: As a developer opening the launch deep-link on rifty.dev, I want the opt-in eddy fast install to serve the Vite project the tile boots, but today the deployed resolver declines it and every such install takes the standard path
epic: fast-install-resolver
blocked_by: []
sources: [PR-300, docs/adr/npm-client/0182-eddy-opt-in-fast-install-resolver.md, docs/adr/npm-client/0371-registry-twins-carry-substituted-runtime-bytes-in-the-installed-tree.md, docs/public/hosting-eddy.md, docs/backlog/distribution/eddy-package-and-deploy.md, docs/backlog/playground/react-vite-starter.md]
code: [services/eddy/src/resolver.ts, tools/eddy/smoke-eddy.mjs, .github/workflows/netlify.yml, tools/perf/bench.mjs, perf/benchmarks.json, docs/public/hosting-eddy.md, deploy/yandex/eddy/docker-compose.yml]
---

## Context

Observed 2026-09-02 against production, from `react-vite-starter@8bf5df9c8`:

- `POST https://eddy.rifty.dev {"dependencies":{"vite":"^7"}}` → `HTTP 422
  {"kind":"unsupported","feature":"integrity-missing","message":"no integrity
  for esbuild@0.28.0"}`. PR #300 recorded the same decline for the React 19
  dependency set. `POST … {"dependencies":{"debug":"^4.4.1"}}` — the closure
  `tools/eddy/smoke-eddy.mjs` posts from `netlify.yml` — → `200`,
  `x-eddy-npm-client-version: 0.1.0`.
- `node tools/perf/bench.mjs --runs 5` (registry.rifty.dev + eddy.rifty.dev)
  on the deep-link tile: 0/5 eddy runs carried the terminal proof `via eddy
  (fast)` → `npmInstallToFirstViteResponseMs.status = "unmeasured"`
  (`perf/benchmarks.json`, 2026-09-02); the standard pass measured 9820 ms.
  Same outcome on the previous vanilla-Vite tile (PR #300 `## Decisions`).
- Decline site: `services/eddy/src/resolver.ts:122` — a resolved package
  without `integrity` is a typed `unsupported` decline. The live image was
  deployed 2026-08-23 (`services/eddy/CHANGELOG.md` §Deployed) and carries the
  catalog of that date, where `esbuild@0.28.0` resolves without an integrity —
  the decline is as old as the image, not a drift that began at #289. Main's
  catalog acquires it as `kind: registry` `esbuild-wasm@0.28.0`
  (`tools/shadow-registry/generated/shadow-substitution-catalog.json`, #289,
  ADR-0371); whether that shape yields an integrity through `resolveBundle` is
  unproven in-tree.
- Client side is honest: `packages/npm-client/src/eddy-fast-path.ts:493` warns
  `npm: fast install (eddy) unavailable, using standard install — …` and falls
  back (ADR-0182). No install breaks; the speedup is absent for every esbuild
  closure.
- Coverage gap: the live smoke's closure contains no esbuild, so both Netlify
  deploy paths report `eddy smoke ok` while the hero path is declined.

Impact: the "ONE measured number" of `epics/open-auditable-launch`
(`perf/benchmarks.json` eddy headline) and the 1.88x in
`docs/public/hosting-eddy.md` are unreproducible today; `hosting-eddy.md` says
so since PR #300.

Dedup (2026-09-02): `distribution/eddy-package-and-deploy` owns the deploy
recipe + first npm publish and records past redeploys, not this drift;
`perf/eddy-http3-cold-validation` needs a measured eddy pass and is blocked by
this; no declined concept covers it.

## Question

Does an eddy image rebuilt from main (npm-client carrying #289's esbuild
registry twin) return `integrity` for `esbuild@0.28.0`, or does the resolver's
`integrity-missing` decline also fire for twin-acquired packages?

- Cheapest answer (critic problem 2): a `services/eddy/tests` vitest case
  running `resolveBundle` over a `{"dependencies":{"vite":"^7"}}` recipe
  closure — the answer and the regression test in one; the Docker build only
  if the test cannot reach the twin path. `200` + tar → a redeploy (operator,
  confirm-first) closes the gap; `422` → resolver gap, its own item under
  `npm-client`.
- Redeploy gate is client-side (critic problem 3): a local playground run
  against the rebuilt eddy must print `via eddy (fast)` for the deep-link tile
  before the operator redeploys — a server-side `200` alone can still leave
  `perf/benchmarks.json` `unmeasured`.
- The live smoke must post a closure that contains esbuild, so this class of
  gap fails the deploy workflow instead of the launch demo — landed WITH the
  redeploy, never before it (critic problem 4: `netlify.yml` runs the smoke on
  every main push).
- After the fix: `pnpm bench` re-run on the deep-link tile,
  `perf/benchmarks.json` + `docs/public/hosting-eddy.md` regenerated;
  `perf/eddy-http3-cold-validation` unblocks.

## Challenge

<!-- Advisory premise challenge, fresh independent critic — README §Challenge. -->

challenge: 2026-09-02 — 4 problems
- [advisory] Timeline/cause unsupported: the doc and its cited `docs/public/hosting-eddy.md` ("the deployed resolver predates the esbuild registry twin (#289)") frame this as drift vs #289, but `integrity-missing` has been in `services/eddy/src/resolver.ts` since caadb74ce (2026-06-30) and the catalog made `esbuild@0.28.0` a `kind: "synthetic"` (no tarball, no integrity) acquisition at f03ce1da0 (2026-07-24) — so image 0.2.4 (2026-08-23, `services/eddy/CHANGELOG.md:25`) declined every esbuild closure from first boot and its "ordinary bundle smoke 200" was already an esbuild-free closure; the hero has been on the slow path ~10 days longer than the doc sizes, and the fix hypothesis is "main's twin path", not "redeploy past #289".
- [advisory] §Question is answerable cheaper than a Docker build and lacks the RED test Fidelity requires: `services/eddy/tests` never runs `resolveBundle` over a recipe closure (`client-roundtrip.test.ts:162` DEPS = debug + diamond-conflict-parent; the LightningCSS twin bundle at :114 is hand-built via `eddyBundleFor`), so `resolver.ts:118-133` on a `kind: "registry"` twin (the esbuild v2 catalog shape, same path as fixture `SOURCE = lightningcss-wasm`) is unproven in-tree; a vitest case there is both the answer and the regression test — the doc names only the live smoke as proof.
- [advisory] Redeploy gate is server-side only ("`200` + tar → a redeploy"), but the user value needs client adoption (`via eddy (fast)`, replay of the twin through `substitution.ts:240` `cache.get(acquisition.name…)` against the bundle's manifest names); a confirm-first redeploy triggered on 200 alone can still leave `perf/benchmarks.json` `unmeasured` — gate it on a local playground run against the rebuilt eddy showing the proof string.
- [advisory] Smoke sequencing: `.github/workflows/netlify.yml:149-155` runs the eddy smoke on every push to main after the production playground deploy; landing an esbuild closure in `tools/eddy/smoke-eddy.mjs` before the operator redeploy (or on the 422 branch) turns every main push red with no repo-side remedy — land it with the redeploy or make it depend on the resolver item.

## Decisions

- Captured mid-task from PR #300's go/no-go (budget (b)); the deploy itself is
  an outward operator action (`eddy-package-and-deploy` §Decisions), never part
  of this capture. REVERSIBLE — no ADR.
