---
area: playground
status: ready
title: Cold snapshot restore visibility — silent openActive reopen, pinned indicator, dead #167 wiring removed
created: 2026-08-29
why: PR #167 (merge 7828b058, claimed mechanical) dropped the grey «restoring project dependencies…» wiring + flipped its e2e assert; measured 2026-08-30 — deep-link/transition paths stay visible via projectBusy carriers (unpinned), but the no-query persisted reopen (openActive) restores in FULL silence; beforeRun is dead machinery.
user_story: As a developer reopening my persisted project (plain URL) after storage eviction on a slow network, I want restore progress visibly indicated, but today the whole restore window shows nothing — no pill, no launcher, no terminal (openActive bypasses projectBusy).
sources: [PR #167 (merge 7828b058), commit 682ec23e4 (progress line), commit 246a40e25 (per-run deps gate), tests/browser-unit/owner-shell-routing.spec.ts:247 (assert flipped to not.toContain), ADR-0278:180-186 (first-materialization install visibility), Contract+RED attempt-1 verdict + adjudication 2026-08-30, spike artifacts (## Evidence)]
code: [apps/playground/src/adapters/playground-app.tsx, packages/workbench/src/workers/pty-server.ts, packages/workbench/src/glue/project-deps.ts, apps/playground/src/glue/slow-progress.ts, apps/playground/vite.config.ts, tests/e2e/restore-progress-visibility.spec.ts]
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
instant-prepare label; the ordinary persisted reopen path calls
`runtime.openActive` (playground-app.tsx:773) with NO `projectBusy` bracket
(setters live only on the transition paths: 662/899/988) — the SWITCHING
pill, launcher, and terminal are all absent for the whole restore window.
Cold payloads `apps/playground/public/snapshots/`: vite 3.2MB, typescript
10.3MB, vite8 18MB gz.

## Evidence

Spikes 2026-08-29/30 — vite dev (`RIFTY_PLAYGROUND_PORT=5391 pnpm --dir
apps/playground dev`, vite 5.4.21) + `@playwright/test` 1.60.0 headless
chromium 148.0.7778.96, node v24.16.0, darwin-25.3.0. 100–150ms rendered-text
sampler + OPFS stamp poller; restore window = snapshot gz request (network
event, wall) → `.rifty-install-stamp.json` appears. Slow delivery = dev
middleware stall on `*node-modules.json.gz` (now the committed cookie seam
`rifty-e2e-snapshot-fault`, vite.config.ts) — playwright `route()` never sees
the SW-mediated fetch; blocking the SW kills boot entirely.

- **RED — no-query persisted reopen** (boot vite8 deep-link → settle → remove
  OPFS `<root>/node_modules` incl stamp, localStorage hint survives → goto
  `/`): window 454ms unthrottled, `samples=5 SILENT=5` — no pill, no
  launcher, no banner; terminal mounts only after the stamp (+800ms).
  Reproduce: e2e below (fails today, full-window silence ~4.7s under the
  seam).
- **Deep-link `?preset=vite8&autorun=1`** (chooser closed): stretched window
  6509ms, 44 samples, 0 silent — SWITCHING pill +301ms и «Preparing instant
  project» +601ms persist до publish; unthrottled window 720ms. Covered, was
  UNPINNED (the #167 assert flip removed the only guard).
- **Transition reload with query** (createScratch path): 6533ms window, 0
  silent — SWITCHING + status-bar `switching`.
- Correction of the 2026-08-29 compile: its «reload» kept the deep-link query
  → went through `createScratch` (playground-app.tsx:763), not `openActive`;
  «contract already holds on main» was measured on the wrong path. The
  attempt-1 reviewer caught this (Ecosystem UX blocker).
- **Snapshot unavailable (seam `status:404`)**: single 404 on the gz, boot
  degrades to a real install (npm-client peer/optional-dep resolver lines in
  console) and reaches LIVE — never a silent absent tree. The ADR-0278:183
  printed-reason/visible-install transcript was NOT observable in the terminal
  viewport (scrollback unverified) → recorded in
  `[[owner-restore-diagnostics-unread]]`, not this unit.
- Diagnostics side-finding (out of scope here): restore/promotion log lines
  reach no console on any path → `[[owner-restore-diagnostics-unread]]`.

## Challenge

challenge: 2026-08-29 — 3 problems
1. Impact oversized: the headline scenario ("developer opening the playground on cold cache… terminal shows nothing") already has visible feedback — first visit necessarily enters via the launcher, where the surviving `withSlowProgress` wiring (playground-app.tsx:680) shows a "Preparing instant project" spinner (Launcher.tsx:99-111) and transitions show a SWITCHING pill; "zero feedback" holds only for the narrow residual paths, unsized in the doc.
2. The 3.2–18MB "slow network = seconds of dead terminal" evidence attaches to the covered path: project-deps.ts priority 1 (slug-keyed OPFS stamp) makes direct reload into a persisted project skip the snapshot fetch entirely, so the truly silent paths (localStorage catalog survives while OPFS stamp gone; closed-launcher deep-link into unstamped starter) pay the cost only in an eviction-divergence scenario the doc gives no occurrence evidence for.
3. Framing/fork padding: by the draft's own architectural note no terminal session exists during restore post-#167, so "silent terminal" (title, `terminal/` area) misnames a pre-session boot-feedback/UI gap, and fork option "exact pre-#167 per-run gate semantics" re-opens the landed sealed-companion decision the same paragraph admits it contradicts — a dead option inflating the refine.

(2026-08-30: problems 1–2 stand for the launcher/deep-link paths; the truly
silent path turned out to be the no-query `openActive` reopen — measured, see
Evidence.)

## User scenario

Developer's browser evicts OPFS under pressure (localStorage survives); they
reopen `https://…/` (plain URL, persisted project) on a slow network. Expected:
visible restore indication until the project publishes. Today: dead empty
workbench for the whole window. Deep-link/launcher paths stay visible and get
pinned so the next mechanical refactor cannot silently drop them.

## Acceptance

Committed carrier: `tests/e2e/restore-progress-visibility.spec.ts`
(chromium-heavy lane) + dev-only cookie seam `rifty-e2e-snapshot-fault`
(vite.config.ts) stalling `*node-modules.json.gz` server-side. Both tests
sample every 100ms and reject ANY silent sample inside
[gz request start, publish); a single flash cannot pass; a ≥3s window floor
guards seam regression.

1. **Pin, deep-link** (GREEN today): cold `?preset=vite8&autorun=1`, delivery
   stalled 4s → indicator (SWITCHING pill / «Preparing instant project»)
   present in every in-window sample.
2. **No-query persisted reopen** (RED today — the unit's fix): boot, evict
   OPFS `<root>/node_modules` (stamp included; localStorage hint survives),
   goto `/` → same every-sample indicator invariant through the re-restore.
   Carrier for the indicator is agent-owned (refine decision); the committed
   test pins only the observable.
3. **Dead machinery gone**: `beforeRun` deleted from pty-server deps + gate
   (line 148/412) with its tests-only harness; `slow-progress.ts` keeps only
   prod-consumed paths. `pnpm pr:check` green.

## Parity cases

None — own-product UI visibility, no Node oracle; parity-runner n/a.

## Fault matrix

Boundary rows per `fault-classes.md` §Boundary failure models (Storage,
Network); operations are the two dependency-arrival entries this item pins.

| Boundary × fault | Operation | Honest outcome | Carrier |
| --- | --- | --- | --- |
| Storage (OPFS): tree+stamp evicted, localStorage survives | no-query reopen (`openActive`) | restore re-runs; indicator every in-window sample | Acceptance 2 e2e (RED today) |
| Network (snapshot asset): stall ≥2s | deep-link boot / no-query reopen | indicator every in-window sample until publish | Acceptance 1–2 e2e via cookie seam |
| Network (snapshot asset): unavailable (HTTP error) | first materialization | declared: rejected probe prints its recorded reason, then the same visible real install (ADR-0278:183); never a silent absent tree | seam `status:<code>` + Evidence artifact (install ran, tree arrived; reason/transcript visibility gap → `[[owner-restore-diagnostics-unread]]`); degradation logic untouched here |
| Network (snapshot asset): stale identity / corrupt body | first materialization | distinct rejection reasons preserved (`snapshot-template-mismatch`, `snapshot-restore-failed:*`), same visible-install outcome | existing unit coverage project-deps.test.ts; behavior untouched here |

## Out of scope

- Resurrecting the grey terminal line / streaming restore progress into a
  terminal (declined in refine; publish-after-restore stands).
- Diagnostics read surface for restore/promotion log lines —
  `[[owner-restore-diagnostics-unread]]` (adjudicated out: attempt-1
  Goal-drift blocker; refine chose visibility + existing failure surfaces).
- Changing snapshot degradation behavior (unavailable/stale/failed) — rows
  above pin the declared ADR-0278 outcome, delivered elsewhere.
- Shadow-asset prefetch visibility (`primePrefetch`) — background, not the
  decided restore contract.
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
- Contract+RED attempt 1 @ b994a9a19: blocker — 9 findings, adjudicated
  7 HOLDS / 2 STRETCH; batch re-cut in place (this commit), attempt count
  carries.
- Re-cut per adjudication 2026-08-30: (a) Evidence corrected — the compile's
  «already holds on main» was measured on the query-contaminated reload; the
  no-query `openActive` reopen is fully silent and is the unit's RED;
  (b) devtools-diagnostics acceptance removed — outside the recorded refine
  scope → `[[owner-restore-diagnostics-unread]]`; (c) `beforeRun` fork
  resolved to DELETE — reviving it would stream into terminal command output,
  contradicting the declined pin; (d) fault rows re-expressed as boundary ×
  operation with ADR-0278:183 outcomes — no undifferentiated «install/absent».
- Slow-window seam is server-side (`rifty-e2e-snapshot-fault` cookie,
  dev-only): the snapshot fetch is SW-mediated — playwright `route()` cannot
  reach it; SW-block kills boot (spike-verified).
