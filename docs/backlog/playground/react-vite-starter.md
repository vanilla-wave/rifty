---
area: playground
status: draft
title: React + Vite issue-tracker starter replaces the `real-vite` tile
created: 2026-09-02
why: an ordinary React SPA on Vite is the front-end shape PR #111's AI-arena decision and most real Vite projects assume, yet the "Real npm project" hero boots a one-file vanilla page and main has no proof of `@vitejs/plugin-react`, React's `needsInterop` prebundle, TSX dev-serve, or Fast Refresh on the registry esbuild runtime
user_story: As a developer trying rifty, I want the "Real npm project" starter to npm-install and boot an ordinary React 19 + Router + TypeScript app with Fast Refresh in the preview, but today that tile boots a one-file vanilla Vite page and React is unproven on the current runtime
blocked_by: []
sources: [docs/backlog/playground/launch-deeplink-real-npm.md, docs/backlog/playground/outcome-oriented-launcher.md, docs/backlog/epics/open-auditable-launch.md, docs/public/hosting-eddy.md, ADR-0078, ADR-0135, ADR-0174, ADR-0226, ADR-0316]
code: [apps/playground/src/presets.ts, apps/playground/src/templates/registry.ts, apps/playground/src/templates/vite.ts, apps/playground/src/templates/project-spec.ts, tests/e2e/preset-deep-link.spec.ts, tests/browser-unit/esbuild-vite-contract.spec.ts, tools/perf/bench.mjs, perf/benchmarks.json, playwright.config.ts]
---

## Context

Observed 2026-09-02 on `origin/main@1a851d7bc`:

- Ten templates registered (`templates/registry.ts`); none React; no test
  under `tests/` exercises React (only incidental substrings such as
  `requireActive`). Proven on main already
  (`tests/browser-unit/esbuild-vite-contract.spec.ts`, "Vite 7 config graph"):
  a user `vite.config.ts` bundled through a TS helper, `vite optimize --force`
  prebundling CJS `picocolors` into `.vite/deps`, `vite build` plus an executed
  `dist`, all on the registry-attested `esbuild-wasm@0.28.0` runtime
  (ADR-0226/0316). Unproven residue an ordinary React app needs:
  `@vitejs/plugin-react` loading inside the Vite worker, the optimizer's
  `needsInterop` prebundle of CJS `react`/`react-dom`, TSX dev-serve, and Fast
  Refresh without a full reload.
- Tile `real-vite` ("Real npm project", `setup: 'from-scratch'`, `templateId:
  'vite'`) seeds one `src/main.js`. It is the landing hero and a benchmark
  subject: `?preset=real-vite&autorun=1` (`launch-deeplink-real-npm`, ready;
  `tests/landing/landing.spec.ts`) promises "terminal shows `npm install`, then
  the Vite preview responds"; `tools/perf/bench.mjs` measures exactly that run
  as `npmInstallToFirstViteResponseMs` (`perf/benchmarks.json`, 2026-07-07:
  eddy median 2761 ms, standard 5180 ms), quoted by `docs/public/hosting-eddy.md`
  and by the ready epic `open-auditable-launch` ("measured <5s cold start", the
  one number behind the README rewrite). Swapping the tile changes what that
  number measures: the PR's seed resolves 71 packages against the current 12
  (top-level package count, PR snapshot vs main snapshot).
- Template `vite` (vanilla, `optimizeDeps.noDiscovery`) is a shared base, not a
  tile: instant presets `project-files` + `node-worker`, `DEFAULT_TEMPLATE_ID`
  fallback in `playground-app.tsx`/`playground-project-plan.ts`, the
  browser-unit fixture union, the opt-in `m10-hmr` spec (boots
  `project-files`). Replacing it would put the optimizer on every Vite test
  path and re-cut two instant presets for no tile reduction.
- Direction: no repo doc names a front-end outcome — `from-intent-to-running-
  project` / `outcome-oriented-launcher` list Express, Node CLI, WASI, Open
  project; ROADMAP M12 is the AI-first IDE for Node projects. The only recorded
  React decision is PR #111's epic (grilled 2026-07-02): a realistic React SPA,
  "ordinary, not minimal", as the AI-mode arena. This item carries no epic; the
  swap changes gallery content, not the launcher IA, and keeps the tile count.
- PR #111 (branch `ai-mode-mvp`, never merged, 1238 commits behind main)
  carries a portable issue-tracker SPA template: React 19, `react-router-dom`
  7, `@vitejs/plugin-react` 5, TypeScript, Vite 7, own visible
  `vite.config.ts`; 4 routes, 8 components, mock dataset, 4 planted rough
  edges; a unit test proving zero rifty-specific code; e2e
  `react-vite-preset.spec.ts` (optimizer `_metadata.json` with `needsInterop`,
  react-refresh preamble, iframe render, client-side navigation, Monaco edit →
  Fast Refresh survive-sentinel) and `react-vite-build.spec.ts`. It was proven
  only on that branch's host-realm esbuild (its branch-only esbuild ADR, numbered 0192 there, never merged) and uses
  spec fields retired on main (`runtimeSpecifier`, `server.*`, `hmr`), so the
  port is a rewrite onto ADR-0174's visible-config `ViteProjectSpec`
  (`extraFiles` carrying the template's own `vite.config.ts`). Its e2e helpers
  all still exist on main.
- Lanes: `preset-deep-link.spec.ts` runs in the parallel light lane through
  the live registry proxy (CI sets no `VITE_RIFTY_REGISTRY_URL`); the 71-package
  cold install would ride there unless moved.
- The PR's template file is 1002 lines; `check:file-size` refuses new prod
  files over 800.
- Open PR #122 (webpack-dev-server starter) edits `presets.ts`, `registry.ts`,
  `project-spec.ts`; second to land rebases.

Dedup: no backlog item, goal map, or declined concept covers a React starter
(scan 2026-09-02: `react.*starter|preset|template`, `plugin-react`,
`issue.tracker` → none).

## Challenge

<!-- Advisory premise challenge, fresh independent critic — README §Challenge. -->

challenge: 2026-09-02 — 6 problems
- [blocking] Cheaper route to the stated value: every Acceptance/Parity row (install → render → client route → `needsInterop` → refresh preamble → Fast Refresh no-reload → build/preview) is reachable with a `create-vite react-ts`-sized seed; the 1002-line, 4-route/8-component issue tracker with mock dataset exists to anchor agent-bench tasks (PR #111 body: "4 planted rough edges anchoring bench tasks"), which the draft itself puts out of scope, and it alone forces the ≤800-line module split (`pnpm check:file-size`) and inflates every hero-path boot; the `## Decisions` user line keeps the rough edges but never names why the PR-sized app (not a minimal seed carrying the same four edges) is required — closes with one Decisions line naming that override.
- [advisory] Proof-gap sizing overstated: `why`/Context claim the CJS-prebundle/dep-optimizer chain has "zero proof on main", but `tests/browser-unit/esbuild-vite-contract.spec.ts:1004-1190` already proves on main a user `vite.config.ts` bundled through a TS helper, `vite optimize --force` prebundling CJS `picocolors` into `.vite/deps`, `vite build` + executed dist, all on registry esbuild 0.28.0 (ADR-0226 lists context/prebundle in scope); the real residue is `@vitejs/plugin-react` loading, react-specific `needsInterop`, TSX dev-serve, and Fast Refresh no-reload — the doc should claim that residue, not the whole chain.
- [advisory] "The main vibecoding scenario is an ordinary React SPA" is unevidenced and unanchored: no repo doc names React SPA as a scenario (grep react/vibecod across docs → only this draft); ROADMAP M12 is "AI-first IDE for Node projects", `epics/open-bolt-ai-sandbox-demo.md` prompts "build an Express API", `epics/from-intent-to-running-project.md` + `outcome-oriented-launcher.md` list first-level outcomes Express / Node CLI / WASI / Open project with no front-end outcome; the item carries no `epic:` and no M11/M12 tag, so the hero-tile swap contradicts the cited launcher-IA epic rather than serving it.
- [advisory] Launch/benchmark coupling missed: `tools/perf/bench.mjs:68` measures `?preset=real-vite&autorun=1` npm-install→first-Vite-response; `perf/benchmarks.json` (eddy 2761ms / standard 5180ms) is cited by `docs/public/hosting-eddy.md:9` and is the "ONE measured number" of ready epic `open-auditable-launch.md` (scenario "<5s cold start"; `distribution/readme-open-auditable-rewrite.md` sources GIF+benchmark from this deep link); swapping the hero to a 71-package install (verified 71 vs 12 top-level packages, PR snapshot vs main) changes the benchmark subject and likely breaks the <5s promise, yet the go/no-go is sized only against the CI heavy-lane budget and `tools/perf`/`perf/benchmarks.json`/`hosting-eddy.md` appear nowhere in `code:`/Acceptance.
- [advisory] Acceptance names the wrong tests: `m10-hmr.spec.ts` boots `project-files` via `bootProjectFiles` (`tests/e2e/helpers/playground.ts:176`) and is opt-in (`RIFTY_E2E_HMR=1`), so "stays green on the new tile" is vacuous; conversely `preset-deep-link.spec.ts` is light-lane (absent from `playwright.config.ts` HEAVY_SPECS; light sized "~13s/test, no dominating spec", ci.yml:120) and would carry the 71-package cold install through the live-registry dev proxy (`apps/playground/vite.config.ts:85`; CI sets no `VITE_RIFTY_REGISTRY_URL`, ci.yml:194) in parallel with other light specs (traps.md cross-file-contention-flake) — outside the draft's lane go/no-go.
- [advisory] Context slips: "`grep -rli react tests/` hits only a fixture type union" — the hits are `requireActive` substrings and `@bem-react/classname` in `real-tree-manifest.json`; the branch's ADR numbered 0192 never landed on main (exists only under the branch's `toolchain-build` ADR dir on `origin/ai-mode-mvp`) [ADR token reworded to pass `tools/refs/check.mjs`; otherwise verbatim], so "superseded" should read "never merged"; PR #111's template also uses retired spec fields (`runtimeSpecifier`, `server.optimizeDepsDisabled`, `hmr.enabled`, `allowedHosts`) absent from main's `project-spec.ts`, so the "port" is a rewrite against ADR-0174's visible-config shape — worth stating so the carrier is not under-sized.

Problems 2, 4, 5, 6 are answered in `## Context`/`## Acceptance` above and
below (residue-only claim, benchmark budget in the go/no-go, lane handling,
corrected facts). Problem 3 stands as a direction note (no front-end outcome
is named anywhere; this item adds none, it re-fills an existing tile). Problem
1 is closed by the recorded user override in `## Decisions` (pole A).

## User scenario

Open the playground → Starters → "Real npm project". The terminal runs a visible
`npm install` (per-package lines) for the seeded `package.json`, then `vite`;
the LIVE pill lights and `/preview/5174/` renders the issue-tracker dashboard
from the mock dataset. Clicking "Issues" navigates client-side inside the
iframe. Editing `src/components/StatusBadge.tsx` in Monaco updates the preview
through Fast Refresh with no full reload. The seeded `README.md` lists four
rough edges to try fixing. `npm run build` then `npm run preview` serve the
production bundle. The launch deep link `?preset=real-vite&autorun=1` lands on
the same npm-install → preview moment. The identical seeded tree, copied out and
run locally with `npm i && npm run dev`, serves the same app.

## Acceptance

- Template `react-vite` registered as registry data (ADR-0078) on main's
  `ViteProjectSpec` shape: `runtime: 'vite'`, `vite@^7`, own `vite.config.ts`
  in `extraFiles` with `@vitejs/plugin-react`, optimizer on (no
  `noDiscovery`), `build`/`preview` scripts; seeded files carry no
  rifty-specific code or config (the PR's portability unit test, ported).
- Preset `real-vite`: id unchanged; `templateId: 'react-vite'`; `setup:
  'from-scratch'`; label, blurb, `openFiles` updated; no baked snapshot for
  `react-vite` (`bakedNodeModulesUrl` absent; `check:snapshot-artifact-drift`
  untouched).
- `templates/vite.ts` byte-identical; `project-files`, `node-worker`, `vite8`,
  the default fallback, and the browser-unit fixture untouched.
- `preset-deep-link.spec.ts` asserts the new tile's `npm install` → Vite
  preview; it moves into `HEAVY_SPECS` if its cold install exceeds the light
  lane's per-test budget (measured at RED). The landing prod spec stays green.
- CI heavy-lane e2e (ported `react-vite-preset.spec.ts`), RED first on main:
  visible install → `vite` → dashboard renders all mock issues → client-side
  route change inside the iframe → `node_modules/.vite/deps/_metadata.json`
  lists `react` and `react-dom` with `needsInterop: true` → a served component
  carries the react-refresh preamble → a Monaco edit of a component updates the
  preview with the survive-sentinel intact (no full reload).
- `react-vite-build.spec.ts` ported: `npm run build` writes `dist/`; `npm run
  preview` serves it through the routed preview.
- Seeded `README.md` names the four planted rough edges; no template code hides
  them.
- Template source split into modules ≤ 800 lines; `pnpm pr:check` green;
  `apps/playground/CHANGELOG.md` line.
- Go/no-go recorded in `## Decisions` at pickup, two budgets: (a) cold-install
  + boot wall time of the from-scratch tile on the CI heavy lane; (b) `pnpm
  bench` (`tools/perf/bench.mjs`) on the new tile — `npmInstallToFirstViteResponseMs`
  over the eddy transport must keep `open-auditable-launch`'s "<5s cold start".
  Either budget breached → stop and return the tile question to the user
  (instant tile after re-cutting `launch-deeplink-real-npm`, or a different
  tile); never silently bake. On a green go, `perf/benchmarks.json` and the
  figure quoted in `docs/public/hosting-eddy.md` regenerate in the same PR.

## Parity cases

Oracle: local Node 24 + npm + Vite 7 on the identical seeded tree; each row is a
failing-test-first target run as the same scenario locally and in rifty.

- `npm install` on the seeded `package.json` resolves the same package set and
  versions as local npm (lockfile replay parity, ADR-0023).
- Dev server: `.vite/deps/_metadata.json` optimizes `react`, `react-dom`,
  `react-dom/client`, `react-router-dom`, with `needsInterop: true` on the CJS
  members, same as local.
- Served `/src/main.tsx` carries the `@vitejs/plugin-react` refresh preamble
  (`$RefreshReg$`, `import.meta.hot`) of the same shape as local.
- Editing a component emits a `js-update` HMR payload and no full reload, same
  as local.
- `vite build` emits `dist/index.html` plus hashed assets; `vite preview` serves
  them; same file set as local.
- The exported seeded tree runs unchanged under local `npm i && npm run dev`.

## Out of scope

- Replacing the vanilla `vite` template or the `vite8` tile (both stay as-is).
- A baked instant snapshot for `react-vite` — only as a later item, after
  `launch-deeplink-real-npm` is re-cut; never inside this one.
- A new front-end launcher outcome (`outcome-oriented-launcher` owns the IA).
- AI mode, `tools/agent-bench`, and bench task seeds from PR #111: later items.
- Direct sub-route entry (`/preview/<port>/issues/3`) — client-side navigation
  only; PR #111 recorded a sub-route loss that is unreproduced on main. Whatever
  main does today is observed at pickup and captured separately if still broken.
- Fixing the four planted rough edges (they are the point of the seed).
- SSR, a backend, state/query libraries.

## Decisions

- 2026-09-02 (user override, critic problem 1 — closed): app size = A, the
  PR-sized issue tracker (4 routes, 8 components, mock dataset). Override on
  record: this starter is the arena for the later AI-mode / agent-bench
  re-land from PR #111 (2026-07-02 grill: agents win on toys, collapse on
  normal apps); a `create-vite react-ts`-sized seed (pole B) would carry the
  four rough edges but not that value. Costs accepted: ≤800-line module split,
  heavier hero and benchmark subject — both still gated by the go/no-go in
  `## Acceptance`. Implementation deferred to a separate session.
- 2026-09-02 (user): swap the tile, not the shared template — `vite` stays the
  internal base. Evidence: coupling inventory in `## Context`.
- 2026-09-02 (user): `setup: 'from-scratch'`, no baked snapshot — keeps the
  deep-link contract and zero repo growth; boot time and the launch benchmark
  are measured at RED; instant is the recorded fallback that first re-cuts
  `launch-deeplink-real-npm`.
- 2026-09-02 (user): keep the four planted rough edges, document them in a
  seeded `README.md`.
- Preset id `real-vite` kept for the deep-link, landing, and benchmark
  contracts; only its label/blurb change.
- Vite 7 + `@vitejs/plugin-react` 5: the Fast Refresh path has evidence only on
  Vite 7 here; Vite 8 HMR stays disabled (ADR-0161/0317).
- PR #111 is a quarry: re-author the template on main's spec shape, port its
  portability test and the two e2e specs; never cherry-pick.
- Template source split by file group (app, pages/components, data/styles);
  carrier is agent-owned.
- REVERSIBLE: registry/preset data + tests + CHANGELOG + benchmark artifact;
  no ADR.
