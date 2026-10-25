---
area: playground
status: ready
title: Cold snapshot restore stays visible on the no-query reopen; deep-link indicator pinned; dead #167 restore-line wiring removed
created: 2026-08-29
why: PR #167 (merge 7828b058, claimed mechanical) dropped the «restoring project dependencies…» wiring and flipped its e2e assert unrecorded; measured 2026-10-26 on main — the deep-link restore stays visible (unpinned) but the plain-URL reopen re-runs the snapshot restore in full silence (openActive is outside the project-open progress bracket).
user_story: As a developer reopening my persisted project (plain URL) whose first dependency restore was cut short, I want restore progress visibly indicated, but today the whole restore window shows nothing — no pill, no launcher, no terminal.
sources: [PR #167 (merge 7828b058), commit 682ec23e4 (progress line), commit 246a40e25 (per-run deps gate), PR #323 (project-open progress UI), tests/e2e/restore-progress-visibility.spec.ts]
code: [apps/playground/src/adapters/playground-app.tsx, apps/playground/src/glue/project-open-progress.ts, apps/playground/src/glue/slow-progress.ts, packages/workbench/src/workers/pty-server.ts, apps/playground/vite.config.ts, tools/checks/source-grep-ratchet.mjs]
---

## Context

Pre-#167 baseline (682ec23e4 + 246a40e25): a restore overlapping a run >250ms
streamed a grey `restoring project dependencies…` line; e2e pinned it. #167
removed the only prod wiring and flipped the assert; no CHANGELOG/backlog
record. This item is that record.

Main today: `transition()` (adapters/playground-app.tsx:630) brackets starter
and project switches with `projectBusy` + `withProjectOpenProgress` (#323), so
deep-link/launcher restores show the SWITCHING pill / launcher progress.
`initialize()` reopens the persisted active plan via `runtime.openActive(plan)`
(:748) with no bracket. `pty-server.ts` `beforeRun` (:148, :412) has no prod
caller; `slow-progress.ts` `onSettledAfterSlow`/`now` are consumed only by its
own test.

Reachability (probes 2026-10-26, vite 5.4.21 dev, chromium 148.0.7778.96;
transcripts in PR #301): durable state is the segment replica
`.rifty-replica-v1`, so a per-file OPFS eviction cannot occur; whole-origin
OPFS loss with the localStorage hint surviving → launcher chooser, no restore;
`rm -rf node_modules` + reload → no restore (`vite: command not found`); the
install claim path is EPERM to the guest. The reachable restore on reopen: the
first materialization is cut short (tab reload/close while the snapshot is in
flight) → the catalog already names the plan, the claim is absent → plain-URL
reopen re-fetches the snapshot inside `openActive`; every sample silent.

## Challenge

challenge: 2026-08-29 — 3 problems
1. Impact oversized: launcher/transition paths already show feedback; the silent path is narrow and unsized.
2. Eviction-divergence scenario carries no occurrence evidence.
3. «Silent terminal» framing misnames a pre-session boot-feedback gap.

(2026-08-30: 1–2 hold for launcher/deep-link; the silent path is the
no-query `openActive` reopen. 2026-10-26: eviction trigger unreachable on the
replica store; the reachable trigger is an interrupted first restore — a slow
network makes it likely, which is the scenario's premise.)

challenge: 2026-10-26 — 1 problem (Contract+RED reviewer, reconsidered for the changed trigger)
1. Narrower than eviction: once per project, frequency unmeasured; value still follows from the user's path-generic decision (it names «stamp-evicted reload with surviving catalog» = this state); no cheaper route than bracketing `openActive` like `transition()`.

## User scenario

On a slow network a developer opens a starter (`?preset=vite8&autorun=1` or
the launcher) and reloads or closes the tab before its dependency restore
finishes. Later they open `https://…/` (plain URL). The persisted project
re-runs the snapshot restore. Expected: a visible restore indication from the
snapshot request until the project publishes, ending on that same project.
Today: chip «Choose project», pill STOPPED, no launcher, no terminal for the
whole window. The deep-link path stays visible and gets pinned so the next
mechanical refactor cannot silently drop it.

## Acceptance

Carrier: `tests/e2e/restore-progress-visibility.spec.ts` (chromium-heavy,
chromium-only) + dev-only cookie seam `rifty-e2e-snapshot-fault`
(`apps/playground/vite.config.ts`) stalling `*node-modules.json.gz`
server-side (the fetch is SW-mediated; `page.route` cannot reach it). Sampler
= document-start init script, 100ms; `visible` = a RENDERED
`.rf-launcher__progress` or `.rf-livepill[data-state="switching"]`; window =
[gz request start, publication), publication = `.xterm` mounted or the pill
in starting/running; the gz RESPONSE duration must carry ≥3.5s of the 4s
stall.

1. Deep-link cold boot `?preset=vite8&autorun=1` under the stall: every
   in-window sample shows an indicator (GREEN on main — pin). → scenario
2. Plain-URL reopen after an interrupted first restore: the first boot's
   snapshot stalls; once the native replica shows `active: scratch`,
   `starterId: vite8`, no install claim, the page reloads to `/` under the 4s
   stall → every in-window sample shows an indicator, and the replica ends
   with the same plan and an install claim. → scenario
3. Dead #167 wiring removed: `beforeRun` gone from pty-server deps + gate with
   its tests-only harness; `withSlowProgress` keeps exactly `delayMs` +
   `onSlow`. Carrier: the spec's source-shape test (allowlisted in
   `check:source-grep`); the implementing commit deletes that test and its
   allowlist entry with the machinery, and pins the `tests/e2e` scan root in
   `source-grep-ratchet.test.ts`. → REV-7 (note)

## Parity cases

None — own-product UI visibility; no Node oracle.

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| Storage (replica): first materialization interrupted × plain-URL reopen (`openActive`) | restore re-runs on the persisted plan and completes with its claim; indicator every in-window sample | Acceptance 2 | scenario |
| Network (snapshot asset): stall ≥2s × deep-link boot / plain-URL reopen | indicator every in-window sample until publication; stall proven by response duration | Acceptance 1–2 via cookie seam | scenario |

## Out of scope

- Re-creating the grey terminal line / streaming restore progress into a
  terminal (declined in refine; publish-after-restore stands).
- Snapshot degradation (unavailable / stale / corrupt → visible real install,
  ADR-0278) — untouched here.
- Diagnostics read surface for restore/promotion log lines —
  `[[structured-execution-diagnostics]]`.
- Shadow-asset prefetch visibility (`primePrefetch`); eviction-frequency
  instrumentation.

## Decisions

ready-verdict: 2026-10-26 — Contract+RED @ 307a2c76a

- refine 2026-08-29 (user-owned, verbatim): contract = **visibility, not a pinned line** — every path where a snapshot restore actually runs >250ms shows visible progress, including the residual paths (stamp-evicted reload with surviving catalog; closed-launcher deep-link into unstamped starter). Carrier per path is agent-owned (launcher spinner where open; terminal boot line or equivalent where not). Publish-after-restore stands — no re-open of the sealed-companion decision.
- refine 2026-08-29 (user): declined — pinning the grey terminal line; accepting the loss with a record only.
- On restore failure the indicator yields to the existing error surface; no new fault machinery.
- `beforeRun` → delete: reviving it would stream into terminal command output, contradicting the declined pin; cost: its ~10 non-gate pty-server/preview-binding tests move to a test-local gated Shell (Contract+RED concern, accepted).
- Packaging: visibility fix, pin and dead-wiring removal ride one PR (driver's packaging per the hand-off, PR-5); removal stays a REV-7 note row.
- Fault seam is server-side (cookie, dev-only): SW-mediated fetch; blocking the SW kills boot.
- Contract+RED @ b953b3011 (2026-08-30, 5 attempts, pre-JSON format) certified the eviction carrier; superseded by the re-cut below.
- re-cut: 2026-10-26 — Acceptance 2 trigger: OPFS `node_modules` eviction → interrupted first materialization (replica store makes per-file eviction unreachable; whole-origin loss → launcher); persisted-tree sentinel → replica plan+claim check (no reachable state holds user files without an install claim); paths re-anchored to main; long history moved to git/PR body; user's visibility decision unchanged — trace: none
