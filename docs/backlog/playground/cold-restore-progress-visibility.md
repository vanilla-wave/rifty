---
area: playground
status: ready
title: Cold snapshot restore visibility — pin surviving indicator, rewire/remove dead #167 carriers
created: 2026-08-29
why: PR #167 (merge 7828b058, claimed mechanical) dropped the grey «restoring project dependencies…» wiring + flipped its e2e assert; measured 2026-08-29 — visible progress SURVIVES via projectBusy carriers, but nothing pins it, restore diagnostics reach no surface, beforeRun is dead machinery.
user_story: As a developer opening a shared deep-link on a slow network (or reloading after storage eviction), I want restore progress visibly indicated and regression-pinned, but today the surviving indicator is unpinned (a #167-class refactor can silently drop it again) and restore/promotion diagnostics are swallowed.
sources: [PR #167 (merge 7828b058), commit 682ec23e4 (progress line), commit 246a40e25 (per-run deps gate), tests/browser-unit/owner-shell-routing.spec.ts:247 (assert flipped to not.toContain), spike 2026-08-29 (Evidence below)]
code: [packages/workbench/src/workers/pty-server.ts, packages/workbench/src/workers/workbench-owner-runtime.ts, packages/workbench/src/glue/project-deps.ts, apps/playground/src/glue/slow-progress.ts, apps/playground/src/adapters/playground-app.tsx, tests/browser-unit/owner-shell-routing.spec.ts]
---

## Context

Baseline (682ec23e4 + 246a40e25): per-run `beforeRun` deps gate in pty-server;
restore overlapping a run >250ms streamed a grey `restoring project
dependencies…` line into the run's stdout; e2e pinned `toContain`.

PR #167 «mechanically extract sealed workbench» removed the only prod wiring
(`beforeRun` + `withSlowProgress` in since-deleted real-vite-bootstrap.ts) and
flipped the assert to `not.toContain` (owner-shell-routing.spec.ts:247);
publish-after-restore means no terminal session exists during restore, so the
exact pre-#167 observable is unreproducible. No CHANGELOG/backlog record. This
item is that record.

Today on main: `pty-server.ts` `beforeRun` (line 148, consumed 412) has zero
prod callers — tests only; `slow-progress.ts` live only in the launcher
instant-prepare label (`playground-app.tsx:680`); owner restore/promotion log
sink is `process.stdout.write` (workbench-owner-runtime.ts:343) with no prod
reader. Cold payloads `apps/playground/public/snapshots/`: vite 3.2MB,
typescript 10.3MB, vite8 18MB gz.

## Evidence

spike 2026-08-29 — local vite dev + `@playwright/test` headless Chromium,
100–150ms UI sampler (rendered-text markers + OPFS stamp poller), restore
window = snapshot gz request start → `.rifty-install-stamp.json` appears.
Slow network simulated by 6s dev-middleware delay on `*node-modules.json.gz`.

- Cold deep-link `?preset=vite8&autorun=1` (chooser closed,
  `shouldOpenInstantProjectChoice`): window 6509ms, 44 samples, **0 silent** —
  livepill `SWITCHING` from +301ms and launcher «Preparing instant project»
  from +601ms persist до publish (+6904ms). Terminal absent the whole window.
- Stamp+tree eviction (OPFS `<root>/node_modules` removed, localStorage
  catalog+hint survive), reload: window 6533ms, 43 samples, **0 silent** —
  `SWITCHING` pill + status bar `switching`. Terminal appears after stamp.
- Unthrottled windows: 720ms / 688ms — >250ms even on localhost.
- Mid-window screenshot: amber `● SWITCHING` pill in header + status bar
  «Vite dev server · switching», workbench otherwise empty.
- `[real-vite/worker] baked node_modules restored…` reached **no console** in
  any run — owner stdout sink is unread; promotion WARNING/CRITICAL lines
  (project-deps.ts reportPromotion) share it.
- Carrier fact: snapshot fetch is SW-mediated — playwright `route()` never
  sees it; blocking SW kills boot entirely. Slow-window seam must be
  server-side (vite/e2e-fixture middleware).

Conclusion: the refine contract (visible progress on every >250ms restore
path) already holds on main via `projectBusy` carriers. The actual #167 loss:
pinned coverage, diagnostics sink, dead `beforeRun` machinery.

## Challenge

challenge: 2026-08-29 — 3 problems
1. Impact oversized: the headline scenario ("developer opening the playground on cold cache… terminal shows nothing") already has visible feedback — first visit necessarily enters via the launcher, where the surviving `withSlowProgress` wiring (playground-app.tsx:680) shows a "Preparing instant project" spinner (Launcher.tsx:99-111) and transitions show a SWITCHING pill; "zero feedback" holds only for the narrow residual paths, unsized in the doc.
2. The 3.2–18MB "slow network = seconds of dead terminal" evidence attaches to the covered path: project-deps.ts priority 1 (slug-keyed OPFS stamp) makes direct reload into a persisted project skip the snapshot fetch entirely, so the truly silent paths (localStorage catalog survives while OPFS stamp gone; closed-launcher deep-link into unstamped starter) pay the cost only in an eviction-divergence scenario the doc gives no occurrence evidence for.
3. Framing/fork padding: by the draft's own architectural note no terminal session exists during restore post-#167, so "silent terminal" (title, `terminal/` area) misnames a pre-session boot-feedback/UI gap, and fork option "exact pre-#167 per-run gate semantics" re-opens the landed sealed-companion decision the same paragraph admits it contradicts — a dead option inflating the refine.

(Problems 1–2 confirmed and sharpened by Evidence: the "truly silent" residual
paths measured NOT silent.)

## User scenario

Developer opens a shared `?preset=vite8&autorun=1` link on a slow network, or
reloads after divergent storage eviction. Expected: continuously visible
restore indication; restore/promotion diagnostics findable in devtools.
Guarded so the next mechanical refactor cannot silently drop it.

## Acceptance

Slow window in tests: server-side delay seam on `*node-modules.json.gz`
(Evidence: playwright route cannot intercept the SW-mediated fetch).

1. **Pin, deep-link**: e2e — cold storage, `?preset=vite8&autorun=1`,
   snapshot delivery stretched ≥2s → a user-visible restore indicator
   (livepill SWITCHING / launcher preparing label) present throughout
   snapshot-request→publish (sampled); terminal MAY be absent. Test fails if
   the indicator machinery is dropped (#167-class regression).
2. **Pin, evicted reload**: same invariant after removing OPFS
   `<root>/node_modules` (incl `.rifty-install-stamp.json`) while
   localStorage catalog+hint survive, then reload.
3. **Diagnostics sink (RED today)**: owner restore/promotion lines
   (`baked node_modules restored…`, reportPromotion WARNING/CRITICAL) reach a
   read surface — devtools console (precedent: console.warn
   owner-package-state.ts ~656). Browser-unit/e2e asserts the restore line
   lands. No terminal streaming (declined pin stands).
4. **Dead machinery gone**: `beforeRun` dep removed from pty-server deps (or
   gains the prod caller row 3 chooses — never left tests-only);
   `slow-progress.ts` keeps only live paths. `pnpm pr:check` green.

## Parity cases

None — own-product UI visibility, no Node oracle; parity-runner n/a.

## Fault matrix

| Fault | Path | Outcome |
| --- | --- | --- |
| OPFS tree+stamp evicted, catalog survives | reload | restore re-runs, indicator visible (Acceptance 2) |
| Snapshot slow (≥2s) | deep-link / reload | indicator persists whole window (Acceptance 1–2) |
| Snapshot unavailable/stale/restore-failed | boot | existing degradation to install/absent; log line lands on read surface (Acceptance 3) |

## Out of scope

- Resurrecting the grey terminal line / streaming restore progress into a
  terminal (declined in refine; publish-after-restore stands).
- New progress UI — surviving carriers suffice (Evidence).
- Shadow-asset prefetch visibility (`primePrefetch`) — background, not the
  decided restore contract; separate finding if gating is ever observed.
- Eviction-divergence frequency instrumentation.

## Decisions

- refine 2026-08-29 (user-owned, active-baseline fork): contract =
  **visibility, not a pinned line** — every path where a snapshot restore
  actually runs >250ms shows visible progress, including the residual paths
  (stamp-evicted reload with surviving catalog; closed-launcher deep-link
  into unstamped starter). Carrier per path is agent-owned (launcher spinner
  where open; terminal boot line or equivalent where not).
  Publish-after-restore stands — no re-open of the sealed-companion decision.
- Declined in the same interview: pinning the grey terminal line as the e2e
  contract; accepting the loss with a record only.
- Loss record: this item is the record of the #167 observable loss; CHANGELOG
  line rides the implementing PR.
- On restore failure the indicator yields to the existing error surface — no
  new fault machinery in this item.
- compile 2026-08-29 (evidence-driven, scope unchanged): spike proves the
  contract already holds on main — surviving `projectBusy` carriers accepted
  as the chosen carriers (agent-owned per refine). Deliverable re-cut to
  pin (Acceptance 1–2) + diagnostics sink (3) + dead-machinery cleanup (4);
  RED today = Acceptance 3. Slow-window seam is server-side (SW-mediated
  fetch, spike-verified).
